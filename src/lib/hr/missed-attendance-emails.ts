import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email/sender";
import { attendanceReminderEmail, hrLateSummaryEmail } from "@/lib/email/templates";
import { istTodayDateOnly, istTimeOnDate } from "@/lib/ist-date";
import { getPoliciesByUser } from "@/lib/hr/notification-policy";
import { isEmailEnabled, devEmailRecipientsClause } from "@/lib/email/toggles";

/**
 * Comma-separated env var of emails who should never receive attendance
 * reminders (e.g. interns the team has already excused, contract folks
 * on a different schedule). Resolved per-call so a .env change reflects
 * on the next cron tick without restart, but cached as a Set for O(1)
 * lookups within a single run.
 */
function reminderExclusionSet(): Set<string> {
  const raw = process.env.EMAIL_REMINDER_EXCLUDE_EMAILS || "";
  return new Set(
    raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
}

/**
 * Find every active user who has NOT clocked in for today (IST) AND has
 * NOT applied for leave for today — then nudge each of them. WFH / OD
 * users still need to clock in (they're working, just from elsewhere),
 * so those statuses don't shield from the reminder anymore. Only an
 * actual leave application keeps a user out of the list.
 *
 * Returns the number of emails actually sent.
 *
 * Skip rules (in order — earliest exit wins):
 *   1. Today is Saturday / Sunday → 0 emails.
 *   2. Today is in HolidayCalendar → 0 emails.
 *   3. Per-user filters:
 *      • Already clocked in today.
 *      • Has ANY leave application covering today, in any status that
 *        isn't rejected/cancelled (pending counts — if they bothered to
 *        apply, don't nag them while HR is still reviewing it).
 *      • No email on file.
 *      • In EMAIL_REMINDER_EXCLUDE_EMAILS env list.
 */
export async function sendMissedClockInReminders(): Promise<number> {
  // Admin-controllable kill-switch (Admin → Emails Automation). Same
  // toggle gates clock-in nudges, the HR late summary, and clock-out
  // nudges below — they're a single "missed-attendance" surface.
  if (!(await isEmailEnabled("missed_attendance"))) {
    console.log("[missed-attendance] clock-in reminders skipped — disabled in admin toggles");
    return 0;
  }
  const today = istTodayDateOnly();

  // 0. Weekend gate (Mon–Fri only). UTC day-of-week is identical to
  //    IST day-of-week here because `today` is UTC-midnight of the
  //    IST calendar day, so 0 = Sun, 6 = Sat in IST too.
  const dow = new Date(today).getUTCDay();
  if (dow === 0 || dow === 6) return 0;

  // 1. Active users. Excludes exited employees whose isActive flag was never
  //    flipped (past last-working-day exit) — same test as the master-sheet
  //    "active" filter — so leavers don't get clock-in nudges.
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      NOT: { employeeExit: { lastWorkingDay: { lt: today } } },
    },
    select: { id: true, name: true, email: true },
  });

  // 2. Pull today's attendance + leave + holiday in bulk so we don't
  //    fire one query per user. WFH / OD are intentionally NOT in this
  //    set — those folks are working, just remotely / off-site, and the
  //    org policy is they must still record a clock-in. The reminder
  //    therefore goes to them too if they forget.
  const [todays, leaves, holidayHit] = await Promise.all([
    prisma.attendance.findMany({
      where: { date: today, clockIn: { not: null } },
      select: { userId: true },
    }),
    prisma.leaveApplication.findMany({
      where: {
        status:   { notIn: ["rejected", "cancelled"] },
        fromDate: { lte: today },
        toDate:   { gte: today },
      },
      select: { userId: true },
    }),
    // Optional (floater) holidays are still working days — only full
    // public/company holidays silence the reminders (2026-07-22, matches
    // the working-day semantic in attendance-month-summary).
    prisma.holidayCalendar.findFirst({ where: { date: today, NOT: { type: "optional" } }, select: { id: true } }),
  ]);

  // No emails on a full (public/company) holiday — nobody's expected to clock in.
  if (holidayHit) return 0;

  const clockedInIds = new Set(todays.map(a => a.userId));
  const onLeaveIds   = new Set(leaves.map(l => l.userId));
  const excluded     = reminderExclusionSet();

  // Per-user attendance gate. CEO + developers default OFF and so are
  // skipped automatically; HR can override per employee via the Payroll
  // & Attendance toggles page.
  const policies = await getPoliciesByUser(users.map((u) => u.id));

  const candidates = users.filter(u =>
    !clockedInIds.has(u.id)
    && !onLeaveIds.has(u.id)
    && !!u.email
    && !excluded.has(u.email.toLowerCase())
    && (policies.get(u.id)?.attendanceEnabled !== false)
  );

  let sent = 0;
  for (const u of candidates) {
    try {
      const content = attendanceReminderEmail({ userName: u.name, kind: "clock-in" });
      await sendEmail({ to: u.email, content });
      sent++;
    } catch (e) {
      console.error(`[missed-clockin] ${u.email}:`, e);
    }
  }
  return sent;
}

/**
 * Builds and sends ONE consolidated email to the HR admin tier listing
 * everyone who, by 10:05 IST, either:
 *   • didn't clock in AND didn't apply for leave (WFH / OD don't shield —
 *     those folks are expected to clock in too), or
 *   • clocked in AFTER 10:00 IST (late).
 *
 * Returns 1 when an email was sent, 0 when there's nothing to report
 * (or it's a weekend / holiday — same skip rules as the employee mail).
 *
 * Recipients: every active user in the HR admin tier — CEO, developers
 * (DEVELOPER_EMAILS env), orgLevel=special_access, role=admin,
 * orgLevel=hr_manager, role=hr_manager. Mirrors the gate used in the
 * rest of the HR module.
 */
/**
 * `brand` — when set, the digest is restricted to ONE brand: only
 * employees of that brand show up in the absent/late rosters, and only
 * recipients belonging to that brand (HR / special_access + the brand's
 * CEO) receive an email. Unset → original "all brands mixed" behavior
 * (kept for any external caller; the cron now calls with a brand).
 *
 * `lateCutoffHour` / `lateCutoffMin` — the IST clock time after which
 * a clock-in counts as "late". Each brand uses its own cutoff because
 * the shift starts differ:
 *   NB Media: 10:00 IST   (matches the 10:10 fire window)
 *   YT Labs : 11:00 IST   (matches the 11:15 fire window)
 * Defaults to 10:00 IST when omitted, matching the pre-split behavior.
 */
export async function sendHrLateClockInSummary(
  opts: {
    brand?: string;
    lateCutoffHour?: number;
    lateCutoffMin?: number;
    /** Header label in the rendered email — e.g. "10:10 AM IST" for NB
     *  Media, "11:15 AM IST" for YT Labs. Defaults to "10:05 AM IST" to
     *  preserve the legacy behavior. */
    fireTimeLabel?: string;
    /** Late-section heading label — e.g. "10:05 AM IST" / "11:00 AM IST".
     *  Defaults to "10:00 IST" (legacy). */
    cutoffLabel?: string;
  } = {},
): Promise<number> {
  if (!(await isEmailEnabled("missed_attendance"))) {
    console.log("[missed-attendance] HR late summary skipped — disabled in admin toggles");
    return 0;
  }
  const today = istTodayDateOnly();
  const dow = new Date(today).getUTCDay();
  if (dow === 0 || dow === 6) return 0;

  // Optional (floater) holidays stay working days — only full holidays
  // suppress the digest (2026-07-22).
  const holidayHit = await prisma.holidayCalendar.findFirst({ where: { date: today, NOT: { type: "optional" } } });
  if (holidayHit) return 0;

  // Fallback IST cutoff — used for any user without a UserShift row.
  // Per-shift cutoffs (computed below from Shift.startTime + Shift.
  // breakMinutes) take precedence so each employee is judged against
  // their own grace window, not a flat org-wide cutoff. The brand-
  // default cutoff stays as the safety net.
  const defaultCutoffIst = istTimeOnDate(today, opts.lateCutoffHour ?? 10, opts.lateCutoffMin ?? 0);

  const [users, todays, leaves, userShifts] = await Promise.all([
    // Exclude exited employees whose isActive was never flipped (past
    // last-working-day exit) so leavers stop appearing in the absent roster.
    prisma.user.findMany({
      where: {
        isActive: true,
        NOT: { employeeExit: { lastWorkingDay: { lt: today } } },
      },
      select: {
        id: true, name: true, email: true, managerId: true,
        employeeProfile: { select: { department: true, businessUnit: true } },
      },
    }),
    prisma.attendance.findMany({
      where: { date: today },
      select: { userId: true, clockIn: true },
    }),
    prisma.leaveApplication.findMany({
      where: {
        status:   { notIn: ["rejected", "cancelled"] },
        fromDate: { lte: today },
        toDate:   { gte: today },
      },
      select: { userId: true },
    }),
    // Each user's assigned shift — drives the per-user late cutoff.
    // breakMinutes is repurposed as grace in this codebase (see
    // src/app/dashboard/hr/attendance/page.tsx#L668), matching the
    // user-facing LATE chip rule on the attendance page.
    prisma.userShift.findMany({
      select: {
        userId: true,
        shift:  { select: { startTime: true, breakMinutes: true } },
      },
    }),
  ]);

  // userId → personal "late after" IST instant for `today`. Users
  // without a UserShift row aren't in the map and fall back to
  // defaultCutoffIst below.
  const userCutoffByUser = new Map<number, Date>();
  for (const us of userShifts) {
    const st = us.shift?.startTime;
    if (!st) continue;
    const [hh, mm] = String(st).split(":").map((n) => Number(n) || 0);
    const grace = Number.isFinite(us.shift?.breakMinutes) ? Number(us.shift!.breakMinutes) : 0;
    const cutoff = istTimeOnDate(today, hh, mm + grace);
    userCutoffByUser.set(us.userId, cutoff);
  }

  const attByUser  = new Map(todays.map((a) => [a.userId, a]));
  const onLeaveIds = new Set(leaves.map((l) => l.userId));
  const excluded   = reminderExclusionSet();
  // Skip anyone whose Attendance toggle is OFF — they're "off the books"
  // for attendance (CEO + developers default OFF). HR shouldn't be told
  // the CEO is absent.
  const policies = await getPoliciesByUser(users.map((u) => u.id));

  type Row = {
    userId: number; managerId: number | null; businessUnit: string;
    name: string; department: string | null; status: "absent" | "late";
    clockIn: Date | null;
  };
  const absent: Row[] = [];
  const late:   Row[] = [];

  // Bucket NULL businessUnit as NB Media — matches the parent-brand
  // fallback used everywhere else.
  const buOf = (u: typeof users[number]): string => u.employeeProfile?.businessUnit || "NB Media";

  for (const u of users) {
    if (!u.email || excluded.has(u.email.toLowerCase())) continue;
    if (onLeaveIds.has(u.id)) continue;
    if (policies.get(u.id)?.attendanceEnabled === false) continue;
    // Brand filter — when opts.brand is set, skip employees of other
    // brands so the roster only contains the brand we're sending to.
    if (opts.brand && buOf(u) !== opts.brand) continue;
    const rec = attByUser.get(u.id);
    if (!rec?.clockIn) {
      absent.push({ userId: u.id, managerId: u.managerId, businessUnit: buOf(u), name: u.name, department: u.employeeProfile?.department ?? null, status: "absent", clockIn: null });
      continue;
    }
    // Per-shift late cutoff — only flagged when this user's clock-in
    // is past THEIR shift's start + grace (breakMinutes). Falls back
    // to the brand default for users with no assigned shift.
    const cutoff = userCutoffByUser.get(u.id) ?? defaultCutoffIst;
    if (rec.clockIn.getTime() > cutoff.getTime()) {
      late.push({ userId: u.id, managerId: u.managerId, businessUnit: buOf(u), name: u.name, department: u.employeeProfile?.department ?? null, status: "late", clockIn: rec.clockIn });
    }
  }

  if (absent.length === 0 && late.length === 0) return 0;

  absent.sort((a, b) => a.name.localeCompare(b.name));
  late.sort((a, b) => (a.clockIn!.getTime() - b.clockIn!.getTime()));

  // Recipients: Special Access + HR Manager (role).
  // EXCLUDED: the CEO (top-level NOT — the CEO/owner account also carries
  // role="admin"), who instead gets a separate digest of ONLY their own
  // direct reports below. Also excluded: role=admin alone, orgLevel=
  // "hr_manager" alone (HR-team members are role=member). Developer
  // accounts are conditional on the "Notify developers" toggle.
  //
  // Each recipient gets a BRAND-FILTERED digest — NB Media HR sees only
  // NB Media employees, YT Labs HR sees only YT Labs. Mirrors the
  // brand-CEO digest below. Recipients without a businessUnit default
  // to NB Media (parent brand).
  const recipients = await prisma.user.findMany({
    where: {
      isActive: true,
      orgLevel: { not: "ceo" },
      OR: [
        { orgLevel: "special_access" },
        { role:     "hr_manager" },
        ...(await devEmailRecipientsClause()),
      ],
    },
    select: {
      email: true, name: true, orgLevel: true, role: true,
      employeeProfile: { select: { businessUnit: true } },
    },
  });
  // Per-role email-toggle filter (Admin → Emails Automation →
  // "Recipients by role"). Drops anyone whose role override for
  // missed_attendance is OFF.
  const { rolesForUser, isEmailEnabledForRoles } = await import("@/lib/email/toggles");
  const filteredRecipients: typeof recipients = [];
  for (const r of recipients) {
    if (!r.email) continue;
    const roles = rolesForUser({ orgLevel: r.orgLevel, role: r.role });
    if (await isEmailEnabledForRoles("missed_attendance", roles)) filteredRecipients.push(r);
  }

  // Per-brand denominator helper — reused for HR-recipient + CEO digests.
  const brandTotals = (brand: string) => {
    const candidates = users.filter((u) =>
      buOf(u) === brand && !!u.email && !excluded.has(u.email!.toLowerCase()) && !onLeaveIds.has(u.id),
    ).length;
    const onLeave = users.filter((u) => buOf(u) === brand && onLeaveIds.has(u.id)).length;
    return { candidates, onLeave };
  };

  let sent = 0;
  for (const r of filteredRecipients) {
    // Recipient's brand drives the roster filter. Default to NB Media
    // (parent brand) when no businessUnit is set — covers developers /
    // role=admin accounts without an EmployeeProfile.businessUnit.
    const brand = r.employeeProfile?.businessUnit || "NB Media";
    // When the caller specified a brand, only send to recipients of
    // that brand — skip everyone else so the NB Media 10:10 fire
    // doesn't email YT Labs HR, and vice versa.
    if (opts.brand && brand !== opts.brand) continue;
    const brandAbsent = absent.filter((row) => row.businessUnit === brand);
    const brandLate   = late.filter((row)   => row.businessUnit === brand);
    if (brandAbsent.length === 0 && brandLate.length === 0) continue;
    const { candidates, onLeave } = brandTotals(brand);
    const brandContent = hrLateSummaryEmail({
      today,
      absent: brandAbsent,
      late:   brandLate,
      totals: {
        absent:  brandAbsent.length,
        late:    brandLate.length,
        onTime:  Math.max(0, candidates - brandAbsent.length - brandLate.length),
        onLeave,
      },
      fireTimeLabel: opts.fireTimeLabel,
      cutoffLabel:   opts.cutoffLabel,
    });
    try {
      await sendEmail({ to: r.email!, content: brandContent });
      sent++;
    } catch (e) {
      console.error(`[hr-late-summary] ${r.email}:`, e);
    }
  }

  // CEO digest — brand-scoped: each CEO sees their full brand's
  // late/absent roster (not just their direct reports). Kunal gets
  // every YT Labs employee's status, Nikit gets every NB Media one.
  // Still skipped when the brand's roster is all-present that day.
  //
  // This loop is the DIRECT-MANAGER exemption equivalent — always
  // sent regardless of the per-role "ceo" toggle, because the toggle
  // silences only the ORG-WIDE blanket fan-out, not the brand-CEO's
  // signal about their own brand.
  const ceos = await prisma.user.findMany({
    where:  { isActive: true, orgLevel: "ceo" },
    select: {
      id: true, email: true,
      employeeProfile: { select: { businessUnit: true } },
    },
  });
  for (const ceo of ceos) {
    if (!ceo.email) continue;
    const ceoBrand = ceo.employeeProfile?.businessUnit || "NB Media";
    // Brand-scoped fire: NB Media 10:10 only emails Nikit, YT Labs
    // 11:15 only emails Kunal.
    if (opts.brand && ceoBrand !== opts.brand) continue;
    const ceoAbsent = absent.filter((r) => r.businessUnit === ceoBrand);
    const ceoLate   = late.filter((r) => r.businessUnit === ceoBrand);
    if (ceoAbsent.length === 0 && ceoLate.length === 0) continue;
    const { candidates: ceoCandidates, onLeave: ceoOnLeave } = brandTotals(ceoBrand);
    const ceoOnTime = Math.max(0, ceoCandidates - ceoAbsent.length - ceoLate.length);
    const ceoContent = hrLateSummaryEmail({
      today,
      absent: ceoAbsent,
      late:   ceoLate,
      totals: { absent: ceoAbsent.length, late: ceoLate.length, onTime: ceoOnTime, onLeave: ceoOnLeave },
      fireTimeLabel: opts.fireTimeLabel,
      cutoffLabel:   opts.cutoffLabel,
    });
    try {
      await sendEmail({ to: ceo.email, content: ceoContent });
      sent++;
    } catch (e) {
      console.error(`[hr-late-summary] CEO ${ceo.email}:`, e);
    }
  }

  if (recipients.length === 0 && ceos.length === 0) {
    console.warn("[hr-late-summary] No recipients found — nothing sent.");
  }
  return sent > 0 ? 1 : 0;
}

/**
 * Find users who clocked in today but haven't clocked out, and email
 * each of them. Skips weekends/holidays implicitly (no clock-in row).
 */
export async function sendMissedClockOutReminders(): Promise<number> {
  if (!(await isEmailEnabled("missed_attendance"))) {
    console.log("[missed-attendance] clock-out reminders skipped — disabled in admin toggles");
    return 0;
  }
  const today = istTodayDateOnly();

  const rows = await prisma.attendance.findMany({
    where: {
      date:     today,
      clockIn:  { not: null },
      clockOut: null,
    },
    include: {
      user: { select: { id: true, name: true, email: true, isActive: true } },
    },
  });

  const excluded = reminderExclusionSet();
  const policies = await getPoliciesByUser(rows.map((r) => r.userId));
  let sent = 0;
  for (const r of rows) {
    if (!r.user?.isActive || !r.user?.email) continue;
    if (excluded.has(r.user.email.toLowerCase())) continue;
    if (policies.get(r.userId)?.attendanceEnabled === false) continue;
    try {
      const content = attendanceReminderEmail({ userName: r.user.name, kind: "clock-out" });
      await sendEmail({ to: r.user.email, content });
      sent++;
    } catch (e) {
      console.error(`[missed-clockout] ${r.user.email}:`, e);
    }
  }
  return sent;
}

// ─────────────────────────────────────────────────────────────────────
//  HR-summary trigger times — derived from the Shift table
// ─────────────────────────────────────────────────────────────────────

export type SummaryTrigger = { hour: number; minute: number; label: string };

/** Minutes after a brand's grace window closes before the digest fires —
 *  gives stragglers' punches time to land so the roster isn't a near-miss
 *  snapshot (e.g. a 10:12 clock-in emailed as "absent" at 10:10). */
const SUMMARY_FIRE_BUFFER_MIN = 10;

/** Re-read the Shift table at most this often. HR editing a shift's start
 *  time or grace moves the trigger on the next refresh — no restart. */
const TRIGGER_CACHE_MS = 5 * 60 * 1000;
let triggerCache: { at: number; value: { nb: SummaryTrigger; yt: SummaryTrigger } } | null = null;

function istTimeLabel(hour: number, minute: number): string {
  const h12 = ((hour + 11) % 12) + 1;
  return `${h12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"} IST`;
}

/**
 * Per-brand HR-summary fire time: the LATEST grace-window end (startTime +
 * breakMinutes-as-grace, matching the clock-in late rule) among the brand's
 * shifts that have at least one active user, plus a 10-minute buffer. So the
 * digest always fires after every employee of that brand has had their full
 * grace window — and follows automatically when HR edits a shift template.
 *
 * Null-brand shifts bucket under NB Media (parent-brand convention). A brand
 * with no assigned shifts falls back to the legacy fixed times (NB 10:10,
 * YT 11:15).
 */
export async function resolveHrSummaryTriggers(): Promise<{ nb: SummaryTrigger; yt: SummaryTrigger }> {
  if (triggerCache && Date.now() - triggerCache.at < TRIGGER_CACHE_MS) return triggerCache.value;

  const shifts = await prisma.shift.findMany({
    where: { userShifts: { some: { user: { isActive: true } } } },
    select: { brand: true, startTime: true, breakMinutes: true },
  });

  const triggerFor = (brand: "NB Media" | "YT Labs", fallbackMin: number): SummaryTrigger => {
    let latestGraceEnd: number | null = null;
    for (const s of shifts) {
      if ((s.brand || "NB Media") !== brand) continue;
      const [hh, mm] = String(s.startTime).split(":").map((n) => Number(n) || 0);
      const grace = Number.isFinite(s.breakMinutes) ? Number(s.breakMinutes) : 15;
      const end = hh * 60 + mm + grace;
      if (latestGraceEnd === null || end > latestGraceEnd) latestGraceEnd = end;
    }
    const total = latestGraceEnd === null ? fallbackMin : latestGraceEnd + SUMMARY_FIRE_BUFFER_MIN;
    const hour = Math.floor(total / 60) % 24;
    const minute = total % 60;
    return { hour, minute, label: istTimeLabel(hour, minute) };
  };

  const value = {
    nb: triggerFor("NB Media", 10 * 60 + 10),
    yt: triggerFor("YT Labs", 11 * 60 + 15),
  };
  triggerCache = { at: Date.now(), value };
  return value;
}
