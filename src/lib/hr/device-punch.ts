// Records attendance from a biometric terminal used for BOTH door access and
// clock-in/out. The machine runs in attendance mode (Manual): each scan
// carries a status — Check In or Check Out — and we honor it.
//
// Model — explicit Check In / Check Out, multi-session:
//   • Check In  → open a session (clock-in). If a session is already open
//                 (they're already in / re-entered without checking out) →
//                 ignored, so a re-entry never double-clocks or clocks out.
//   • Check Out → close the open session (clock-out). Total = sum of all
//                 closed sessions, so lunch in/out is handled.
//   • A scan with NO status (plain door open) → treated as Check In only
//     (never clocks anyone out) — safe default.
//   • Duplicate/retried events for the same scan are debounced (10s).
//   • Earliest punch wins: a punch that lands EARLIER than the recorded
//     clock-in pulls the day's start back to it. A morning punch buffered
//     during a network drop and flushed minutes later still becomes the real
//     clock-in — even when it arrives AFTER a later live punch opened the day.
import prisma from "@/lib/prisma";
import { istDateOnlyFrom, istMinutesOfDay } from "@/lib/ist-date";
import { stringifyAttLoc } from "@/lib/attendance-location";
import { isAttendanceEnabled } from "@/lib/hr/notification-policy";
import { dayBars, lateCutoffMinFor, type DayShift } from "@/lib/hr/day-rules";

const DEVICE_LOCATION = stringifyAttLoc({
  mode: "office",
  address: "Biometric terminal (face / fingerprint)",
  atOffice: true,
});
const DEBOUNCE_MS = 10_000;

export type DevicePunchResult =
  | { action: "clock_in" | "clock_out" | "noop"; userId: number; status?: string; totalMinutes?: number; note?: string }
  | { action: "unmapped"; employeeNo: string };

// The user's shift with the fields day-rules needs — read via raw SQL so a
// stale generated Prisma client can't hide the sat* columns (the clock-in /
// clock-out routes read the shift raw for the same reason). Fails soft to
// "no shift" (day-rules then applies the legacy 10:00 defaults).
async function fetchDayShift(userId: number, db: any = prisma): Promise<DayShift> {
  const rows = await db
    .$queryRawUnsafe(
      `SELECT s."startTime", s."endTime", s."breakMinutes",
              s."satStartTime", s."satEndTime", s."satGraceMinutes"
         FROM "UserShift" us JOIN "Shift" s ON s.id = us."shiftId"
        WHERE us."userId" = $1`,
      userId,
    )
    .catch(() => [] as any[]);
  return (rows[0] ?? null) as DayShift;
}

// Present vs late for a first punch — uses the shared day-rules late cutoff
// (shift start + grace, Saturday-aware) so the biometric path agrees with the
// web clock-in route instead of re-implementing the rule.
async function statusAtPunch(userId: number, at: Date, db: any = prisma): Promise<string> {
  const shift = await fetchDayShift(userId, db);
  const cutoff = lateCutoffMinFor(istDateOnlyFrom(at), shift);
  return istMinutesOfDay(at) > cutoff ? "late" : "present";
}

export async function resolveUserByDeviceId(employeeNo: string): Promise<number | null> {
  const id = String(employeeNo || "").trim();
  if (!id) return null;
  const rows = await prisma.$queryRawUnsafe<Array<{ userId: number }>>(
    `SELECT "userId" FROM "EmployeeProfile" WHERE "employeeId" = $1 OR "biometricId" = $1 LIMIT 1`,
    id,
  );
  return rows[0]?.userId ?? null;
}

export async function recordDevicePunch(opts: { employeeNo: string; at: Date; checkOut?: boolean }): Promise<DevicePunchResult> {
  const userId = await resolveUserByDeviceId(opts.employeeNo);
  if (!userId) return { action: "unmapped", employeeNo: opts.employeeNo };

  // Respect the per-employee attendance toggle (HR Dashboard → Permissions →
  // Payroll & Attendance). CEO / developers default OFF — their door scans
  // must NOT create attendance, same as the Web clock-in route enforces.
  if (!(await isAttendanceEnabled(userId))) {
    return { action: "noop", userId, note: "attendance tracking disabled" };
  }

  const at = opts.at;
  const date = istDateOnlyFrom(at);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.attendance.findUnique({
      where: { userId_date: { userId, date } },
      select: { id: true, clockIn: true, clockOut: true, status: true },
    });

    // Debounce duplicate / retried events for the same scan.
    if (existing) {
      const r = await tx.$queryRawUnsafe<Array<{ t: Date | null }>>(
        `SELECT MAX(GREATEST("clockIn", COALESCE("clockOut","clockIn"))) AS t FROM "AttendanceSession" WHERE "attendanceId"=$1`,
        existing.id,
      );
      const lastT = r[0]?.t ? new Date(r[0].t as any).getTime() : 0;
      if (lastT && Math.abs(at.getTime() - lastT) < DEBOUNCE_MS) return { action: "noop", userId, note: "debounced (<10s)" };
    }

    const openRows = existing
      ? await tx.$queryRawUnsafe<Array<{ id: number }>>(
          `SELECT id FROM "AttendanceSession" WHERE "attendanceId"=$1 AND "clockOut" IS NULL ORDER BY "clockIn" DESC LIMIT 1`,
          existing.id,
        )
      : [];
    const open = openRows[0] ?? null;

    // ── CHECK OUT → close the open session ──
    if (opts.checkOut) {
      if (!existing || !existing.clockIn || !open) return { action: "noop", userId, note: "checkout but not clocked in" };
      const punchAt = at.getTime() < existing.clockIn.getTime() ? existing.clockIn : at;
      await tx.$executeRawUnsafe(`UPDATE "AttendanceSession" SET "clockOut"=$1, "clockOutLocation"=$2 WHERE id=$3`, punchAt, DEVICE_LOCATION, open.id);
      const sum = await tx.$queryRawUnsafe<Array<{ totalSeconds: number }>>(
        `SELECT COALESCE(EXTRACT(EPOCH FROM SUM("clockOut" - "clockIn")),0)::int AS "totalSeconds" FROM "AttendanceSession" WHERE "attendanceId"=$1 AND "clockOut" IS NOT NULL`,
        existing.id,
      );
      const totalMinutes = Math.floor((sum[0]?.totalSeconds ?? 0) / 60);
      // Full/half bars from the shared day-rules (Saturday-aware) instead of
      // hardcoded 540/270 — same source of truth as the web clock-out route.
      const { full, half } = dayBars(date, await fetchDayShift(userId, tx));
      let status = existing.status;
      if (totalMinutes >= full) status = existing.status === "late" ? "late" : "present";
      else if (totalMinutes >= half) status = "half_day";
      await tx.attendance.update({ where: { id: existing.id }, data: { clockOut: punchAt, totalMinutes, status, overtimeMinutes: Math.max(0, totalMinutes - full) } });
      return { action: "clock_out", userId, status, totalMinutes };
    }

    // ── CHECK IN (or plain scan) ──
    // Log EVERY entry scan to the door-entry audit: the day's first clock-in
    // AND every mid-day re-entry from break / washroom. Purely additive — it
    // does NOT touch the clock-in/out or worked-hours logic below (those keep
    // working on first-in / last-out exactly as before). Surfaced only to
    // managers / HR / CEO / developers. attendanceId links to today's row when
    // it already exists (null on the very first scan, which creates it next).
    await tx.$executeRawUnsafe(
      `INSERT INTO "DoorEntry" ("userId","attendanceId","scannedAt","source") VALUES ($1,$2,$3,$4)`,
      userId, existing?.id ?? null, at, "device",
    );

    // ── Earliest punch wins ──
    // A punch EARLIER than the day's recorded clock-in means the real first
    // punch was delayed (buffered during a network drop) and arrived after a
    // later one already opened the day. Pull the day's start back to it: move
    // the first session's start, then recompute total + present/late/half from
    // the shared day-rules. clockOut is left untouched. Idempotent: a re-send
    // of the SAME earliest punch is not < clockIn, so it falls through.
    if (existing?.clockIn && at.getTime() < existing.clockIn.getTime()) {
      const firstRows = await tx.$queryRawUnsafe<Array<{ id: number }>>(
        `SELECT id FROM "AttendanceSession" WHERE "attendanceId"=$1 ORDER BY "clockIn" ASC LIMIT 1`,
        existing.id,
      );
      if (firstRows[0]) {
        await tx.$executeRawUnsafe(`UPDATE "AttendanceSession" SET "clockIn"=$1, "clockInLocation"=$2 WHERE id=$3`, at, DEVICE_LOCATION, firstRows[0].id);
      }
      const sum = await tx.$queryRawUnsafe<Array<{ totalSeconds: number }>>(
        `SELECT COALESCE(EXTRACT(EPOCH FROM SUM("clockOut" - "clockIn")),0)::int AS "totalSeconds" FROM "AttendanceSession" WHERE "attendanceId"=$1 AND "clockOut" IS NOT NULL`,
        existing.id,
      );
      const totalMinutes = Math.floor((sum[0]?.totalSeconds ?? 0) / 60);
      const { full, half } = dayBars(date, await fetchDayShift(userId, tx));
      const late = (await statusAtPunch(userId, at, tx)) === "late";
      let status = existing.status;
      if (totalMinutes >= full) status = late ? "late" : "present";
      else if (totalMinutes >= half) status = "half_day";
      else if (status === "present" || status === "late") status = late ? "late" : "present";
      await tx.attendance.update({
        where: { id: existing.id },
        data: { clockIn: at, status, totalMinutes, overtimeMinutes: Math.max(0, totalMinutes - full), location: DEVICE_LOCATION },
      });
      return { action: "clock_in", userId, status, totalMinutes, note: "earlier punch — clock-in pulled back" };
    }

    // → then open / resume a session exactly as before
    if (open) return { action: "noop", userId, note: "already clocked in (re-entry ignored)" };
    if (!existing) {
      const status = await statusAtPunch(userId, at, tx);
      const created = await tx.attendance.create({ data: { userId, date, clockIn: at, status, location: DEVICE_LOCATION } });
      await tx.$executeRawUnsafe(`INSERT INTO "AttendanceSession" ("attendanceId","clockIn","clockInLocation") VALUES ($1,$2,$3)`, created.id, at, DEVICE_LOCATION);
      return { action: "clock_in", userId, status };
    }
    if (!existing.clockIn) {
      // Row exists but never clocked in → treat as first clock-in.
      const status = await statusAtPunch(userId, at, tx);
      await tx.attendance.update({ where: { id: existing.id }, data: { clockIn: at, status, clockOut: null, location: DEVICE_LOCATION } });
      await tx.$executeRawUnsafe(`INSERT INTO "AttendanceSession" ("attendanceId","clockIn","clockInLocation") VALUES ($1,$2,$3)`, existing.id, at, DEVICE_LOCATION);
      return { action: "clock_in", userId, status };
    }
    // Resume after a check-out (e.g. back from lunch): new session, keep the
    // day's first clock-in + status, re-open the day. Guard: only a punch
    // AFTER the last clock-out is a genuine re-entry — a stale / re-sent punch
    // dated at or before it must NOT reopen the day (that would fabricate a
    // session out of a duplicate buffer flush).
    if (existing.clockOut && at.getTime() <= existing.clockOut.getTime()) {
      return { action: "noop", userId, note: "stale re-entry (<= last clock-out) ignored" };
    }
    await tx.attendance.update({
      where: { id: existing.id },
      data: {
        clockOut: null,
        status: existing.status === "absent" || existing.status === "missed_clock_out" ? await statusAtPunch(userId, at, tx) : existing.status,
        location: DEVICE_LOCATION,
      },
    });
    await tx.$executeRawUnsafe(`INSERT INTO "AttendanceSession" ("attendanceId","clockIn","clockInLocation") VALUES ($1,$2,$3)`, existing.id, at, DEVICE_LOCATION);
    return { action: "clock_in", userId, status: existing.status };
  });
}
