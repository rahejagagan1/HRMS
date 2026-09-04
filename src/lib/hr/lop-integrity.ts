import prisma from "@/lib/prisma";
import { ACTIVE_REQUEST_STATUSES, OPEN_REQUEST_STATUSES, HALF_MARKER_RE, dayBars, isWorkingDayForShift } from "@/lib/hr/day-rules";
import { isShortLeaveReason, SHORT_LEAVE_MINUTES, SHORT_LOP_DAYS } from "@/lib/hr/short-leave";

/**
 * LOP integrity engine — the single place that prices UNRESOLVED attendance
 * state at payroll time and detects rows whose stored status contradicts
 * their own history.
 *
 * Why this exists (2026-08-03, the "Sheril 16 Jul" incident): a day's LOP
 * verdict used to be decided once, at write time, by whichever job touched
 * the row last (clock-out route / sweep / auto-LOP / manual edit) — and
 * payroll then trusted the stored status string weeks later. Any late
 * reversal (a manual DB edit, a job that never re-scanned an aged-out day)
 * silently turned a penalised day into a FREE day, while the LWP counter
 * kept the charge. This module closes that hole from the consumer side:
 *
 *   • priceMissedSwipes() — every `missed_clock_out` row still unresolved at
 *     payroll time is priced by the SAME rules auto-LOP applies (0.5 day,
 *     shift-aware, half-day-leave aware), instead of silently costing 0.
 *     Stored statuses stop being load-bearing for money: even if a row is
 *     reverted or the auto-LOP window aged out, payroll reprices it.
 *
 *   • findTamperedRows() — rows whose auto-LOP note asserts a penalty the
 *     current status no longer carries (the exact fingerprint a raw-SQL
 *     revert leaves behind). Surfaced as pre-check warnings so drift is seen
 *     BEFORE a run is generated, never after payday.
 *
 * Both payroll/generate and payroll/attendance-summary consume this module,
 * so the pre-check table and the actual payslip math cannot disagree.
 */

export type MissedSwipeCharge = {
  attendanceId: number;
  userId: number;
  /** YYYY-MM-DD */
  date: string;
  totalMinutes: number;
  /** 0 | 0.5 — LOP days this row contributes at generate time. */
  charge: number;
  /** Human reason for the pre-check table / payslip trace. */
  reason: string;
  /** Set when the row is NOT charged because a request/leave shields it —
   *  surfaced as a warning so HR resolves it before locking the run. */
  pendingDecision?: string;
};

export type TamperedRow = {
  attendanceId: number;
  userId: number;
  userName?: string;
  date: string;
  status: string;
  note: string;
  /** What the note says the status should have been. */
  expectedStatus: string;
};

type ShiftCtx = {
  workDays: unknown;
  saturdayPolicy: string | null;
  saturdayWeeks: number[] | null;
  saturdayDates: string[] | null;
  satStartTime: string | null;
  satEndTime: string | null;
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number | null;
  effectiveFrom: Date | null;
  shiftCreatedAt: Date | null;
};

const ymd = (d: Date) => new Date(d).toISOString().slice(0, 10);

/** One query: shift work-rules for a set of users (raw SQL so new Shift
 *  columns work even if the generated client is stale — same reason as
 *  /api/hr/me/shift). Users absent from the map have no shift assigned. */
export async function shiftContextForUsers(userIds: number[]): Promise<Map<number, ShiftCtx>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.$queryRawUnsafe<Array<ShiftCtx & { userId: number }>>(
    `SELECT us."userId", s."workDays", s."saturdayPolicy", s."saturdayWeeks",
            COALESCE(s."saturdayDates", '{}') AS "saturdayDates",
            s."satStartTime", s."satEndTime", s."startTime", s."endTime",
            s."breakMinutes", us."effectiveFrom", s."createdAt" AS "shiftCreatedAt"
       FROM "UserShift" us JOIN "Shift" s ON s.id = us."shiftId"
      WHERE us."userId" = ANY($1::int[])`,
    userIds,
  );
  return new Map(rows.map((r) => [r.userId, r]));
}

/** A shift assignment governs only dates ON/AFTER its effectiveFrom. Days
 *  before it were lived under a different (since-overwritten) shift, so
 *  current-shift rules must not re-judge them — they fall back to the
 *  legacy defaults, and stored verdicts stand (2026-09-03: a YT shift
 *  change re-priced August under the new calendar). */
export function shiftIfGoverns(date: Date, shift: ShiftCtx | undefined): ShiftCtx | undefined {
  if (!shift?.effectiveFrom) return shift;
  const eff = new Date(shift.effectiveFrom);
  const effDay = Date.UTC(eff.getUTCFullYear(), eff.getUTCMonth(), eff.getUTCDate());
  return date.getTime() < effDay ? undefined : shift;
}

/** Shift-aware working-day test with the same legacy fallback payroll always
 *  used (Mon–Fri) for users with no shift. Exported so the unpaid-leave loops
 *  in generate + attendance-summary count LWP days off the SAME calendar. */
export function isPayrollWorkingDay(date: Date, shiftIn: ShiftCtx | undefined): boolean {
  const shift = shiftIfGoverns(date, shiftIn);
  if (!shift) {
    const dow = date.getUTCDay();
    return dow !== 0 && dow !== 6;
  }
  return isWorkingDayForShift(
    date,
    { workDays: shift.workDays, saturdayPolicy: shift.saturdayPolicy, saturdayWeeks: shift.saturdayWeeks, saturdayDates: shift.saturdayDates },
    { alternateAnchor: shift.shiftCreatedAt ?? shift.effectiveFrom },
  );
}

/**
 * Price every unresolved missed clock-out in [firstDay, lastDay] for the
 * given users. Mirrors auto-LOP's decision table, evaluated fresh at call
 * time (so it doesn't matter whether the auto-LOP job ran, aged out, or was
 * reverted):
 *   worked ≥ full bar        → 0   (ghost session — day demonstrably done)
 *   holiday / non-working    → 0
 *   open request in flight   → 0 + pendingDecision warning (HR must decide)
 *   approved full-day leave  → 0   (paid leave covers the day)
 *   approved half-day leave  → 0 if worked ≥ half bar, else 0.5
 *   otherwise                → 0.5 (the standard missed-swipe penalty)
 * Rows with isRegularized=true are never charged (that's the explicit,
 * audited waive/regularize path).
 */
export async function priceMissedSwipes(opts: {
  userIds: number[];
  firstDay: Date;
  lastDay: Date;
}): Promise<MissedSwipeCharge[]> {
  const { userIds, firstDay, lastDay } = opts;
  if (userIds.length === 0) return [];

  const rows = await prisma.attendance.findMany({
    where: {
      userId: { in: userIds },
      date: { gte: firstDay, lte: lastDay },
      status: "missed_clock_out",
      isRegularized: false,
    },
    select: { id: true, userId: true, date: true, totalMinutes: true },
  });
  if (rows.length === 0) return [];

  const affectedIds = Array.from(new Set(rows.map((r) => r.userId)));
  const ACTIVE = [...ACTIVE_REQUEST_STATUSES];
  const [shifts, leaves, regs, wfhs, ods, compOffs, holidays] = await Promise.all([
    shiftContextForUsers(affectedIds),
    prisma.leaveApplication.findMany({
      // Rejected SHORT leaves ride along: the "applied" fact alone softens a
      // missed-swipe charge to ¼ day (agreed 2026-08-04), so pricing must
      // see them even though rejected rows grant no leave.
      where: {
        userId: { in: affectedIds }, fromDate: { lte: lastDay }, toDate: { gte: firstDay },
        OR: [
          { status: { in: ACTIVE } },
          { status: "rejected", reason: { contains: "[Short Leave", mode: "insensitive" } },
        ],
      },
      select: { userId: true, status: true, reason: true, fromDate: true, toDate: true, totalDays: true, leaveType: { select: { name: true } } },
    }),
    prisma.attendanceRegularization.findMany({
      where: { userId: { in: affectedIds }, date: { gte: firstDay, lte: lastDay }, status: { in: ACTIVE } },
      select: { userId: true, date: true, status: true },
    }),
    prisma.wFHRequest.findMany({
      where: { userId: { in: affectedIds }, date: { gte: firstDay, lte: lastDay }, status: { in: ACTIVE } },
      select: { userId: true, date: true, status: true, reason: true },
    }),
    prisma.onDutyRequest.findMany({
      where: { userId: { in: affectedIds }, date: { gte: firstDay, lte: lastDay }, status: { in: ACTIVE } },
      select: { userId: true, date: true, status: true },
    }),
    prisma.compOffRequest.findMany({
      where: { userId: { in: affectedIds }, workedDate: { gte: firstDay, lte: lastDay }, status: { in: ACTIVE } },
      select: { userId: true, workedDate: true, status: true },
    }),
    prisma.holidayCalendar.findMany({
      where: { date: { gte: firstDay, lte: lastDay } },
      select: { date: true },
    }),
  ]);
  const holidaySet = new Set(holidays.map((h) => ymd(h.date)));
  const isOpen = (s: string) => (OPEN_REQUEST_STATUSES as readonly string[]).includes(s);

  const out: MissedSwipeCharge[] = [];
  for (const r of rows) {
    const key = ymd(r.date);
    // Only the shift in force ON that date judges it (legacy bars otherwise).
    const shift = shiftIfGoverns(r.date, shifts.get(r.userId));
    const worked = r.totalMinutes ?? 0;
    const bars = dayBars(r.date, shift ?? null);
    const base = { attendanceId: r.id, userId: r.userId, date: key, totalMinutes: worked };

    if (holidaySet.has(key) || !isPayrollWorkingDay(r.date, shift)) {
      continue; // off-day rows never charge and need no warning
    }
    if (worked >= bars.full) {
      // Closed sessions already cover the full day — the open session is a
      // ghost (double-scan). Free, but the status is stale; flag it.
      out.push({ ...base, charge: 0, reason: "Worked full day — stale missed-clock-out status", pendingDecision: "stale_status" });
      continue;
    }

    const reg = regs.find((x) => x.userId === r.userId && ymd(x.date) === key);
    const od = ods.find((x) => x.userId === r.userId && ymd(x.date) === key);
    const co = compOffs.find((x) => x.userId === r.userId && ymd(x.workedDate) === key);
    const wfh = wfhs.find((x) => x.userId === r.userId && ymd(x.date) === key);
    const dayLeaves = leaves.filter((l) => l.userId === r.userId && key >= ymd(l.fromDate) && key <= ymd(l.toDate));
    const openReq = [reg, od, co, wfh, ...dayLeaves].find((x) => x && isOpen(x.status));
    if (openReq) {
      out.push({ ...base, charge: 0, reason: "Request awaiting decision — resolve before generating", pendingDecision: "open_request" });
      continue;
    }
    if (reg || od || co) {
      // Approved regularization / OD / comp-off asserts the day was worked.
      out.push({ ...base, charge: 0, reason: "Covered by approved regularization / OD / comp-off" });
      continue;
    }
    // Short-leave day: a forgotten punch costs ¼ day instead of ½ — the
    // application (even a rejected one) shows intent. When the APPROVED
    // excuse plus recorded minutes already cover the reduced bar, the row
    // is a stale artefact like the ghost-session case: free, but flagged.
    const slRows = dayLeaves.filter((l) => isShortLeaveReason(l.reason));
    if (slRows.length > 0) {
      const approvedMin = slRows.filter((l) => l.status === "approved").length * SHORT_LEAVE_MINUTES;
      if (approvedMin > 0 && worked >= bars.full - approvedMin) {
        out.push({ ...base, charge: 0, reason: "Short leave honored — reduced day completed; stale missed-clock-out status", pendingDecision: "stale_status" });
      } else {
        out.push({ ...base, charge: SHORT_LOP_DAYS, reason: "Missed clock-out on a short-leave day (auto ¼ day)" });
      }
      continue;
    }
    const halfLeave = dayLeaves.find((l) => HALF_MARKER_RE.test(String(l.reason ?? "")) && Number(l.totalDays) <= 0.5);
    const fullLeave = dayLeaves.find((l) => !(HALF_MARKER_RE.test(String(l.reason ?? "")) && Number(l.totalDays) <= 0.5));
    if (fullLeave) {
      out.push({ ...base, charge: 0, reason: `Covered by approved ${fullLeave.leaveType?.name ?? "leave"}`, pendingDecision: "stale_status" });
      continue;
    }
    if (halfLeave) {
      if (worked >= bars.half) {
        out.push({ ...base, charge: 0, reason: "Half-day leave + worked half completed" });
      } else {
        out.push({ ...base, charge: 0.5, reason: "Half-day leave — worked half not completed (missed clock-out)" });
      }
      continue;
    }
    out.push({ ...base, charge: 0.5, reason: "Missed clock-out, not regularized (auto ½ day)" });
  }
  return out;
}

/**
 * Rows whose own note says a penalty was applied but whose status no longer
 * carries it — the fingerprint an out-of-band revert (raw SQL edit) leaves
 * behind, since no code path in the app downgrades a penalty status while
 * keeping the auto-LOP note. isRegularized=true rows are excluded: the
 * audited waive path clears penalties legitimately.
 */
export async function findTamperedRows(opts: { firstDay: Date; lastDay: Date; userIds?: number[] }): Promise<TamperedRow[]> {
  const { firstDay, lastDay, userIds } = opts;
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: number; userId: number; userName: string; date: Date; status: string; notes: string;
  }>>(
    `SELECT a.id, a."userId", u.name AS "userName", a.date, a.status, a.notes
       FROM "Attendance" a JOIN "User" u ON u.id = a."userId"
      WHERE a.date >= $1 AND a.date <= $2
        AND a."isRegularized" = FALSE
        AND a.notes IS NOT NULL
        AND a.notes NOT ILIKE '%LOP waived%'
        AND (
              (a.notes ILIKE 'Auto-marked half-day LOP%' AND a.status <> 'half_day_lop')
           OR (a.notes ILIKE 'Auto-marked LOP%'          AND a.status <> 'lop')
           OR (a.notes ILIKE 'Auto-marked quarter-day LOP%' AND a.status <> 'short_lop')
           OR (a.notes ILIKE 'Auto-LOP:%half-day%'       AND a.status NOT IN ('half_day_lop'))
           OR (a.notes ILIKE 'Auto-LOP: approved full-day%' AND a.status <> 'lop')
        )
        ${userIds && userIds.length ? `AND a."userId" = ANY($3::int[])` : ""}`,
    ...(userIds && userIds.length ? [firstDay, lastDay, userIds] : [firstDay, lastDay]),
  );
  return rows.map((r) => ({
    attendanceId: r.id,
    userId: r.userId,
    userName: r.userName,
    date: ymd(r.date),
    status: r.status,
    note: r.notes,
    expectedStatus: /^Auto-marked quarter-day LOP/i.test(r.notes) ? "short_lop"
      : /^Auto-marked LOP|^Auto-LOP: approved full-day/i.test(r.notes) ? "lop" : "half_day_lop",
  }));
}

/** Adjust the LWP (Leave Without Pay) usage counter — the leave-balance side
 *  of an LOP charge. Positive delta charges, negative reverses; usage never
 *  goes below zero. Kept here so the waive endpoint and any future charge
 *  path move the counter through ONE function. */
export async function adjustLwpUsage(userId: number, year: number, delta: number): Promise<void> {
  const lwpType = await prisma.leaveType.findFirst({ where: { code: "LWP" }, select: { id: true } });
  if (!lwpType) return;
  const bal = await prisma.leaveBalance.findUnique({
    where: { userId_leaveTypeId_year: { userId, leaveTypeId: lwpType.id, year } },
    select: { usedDays: true },
  });
  const current = bal ? Number(bal.usedDays) : 0;
  const next = Math.max(0, current + delta);
  await prisma.leaveBalance.upsert({
    where: { userId_leaveTypeId_year: { userId, leaveTypeId: lwpType.id, year } },
    create: { userId, leaveTypeId: lwpType.id, year, totalDays: 0, usedDays: next, pendingDays: 0 },
    update: { usedDays: next },
  });
}
