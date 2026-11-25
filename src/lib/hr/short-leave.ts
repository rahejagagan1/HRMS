// Short Leave — a 2-hour leave that costs a quarter-day (0.25) of leave.
// Design (2026-07-24, agreed with Gagan):
//   • Drawn from CL, SL or LWP only (SHORT_LEAVE_TYPE_CODES, admin decision
//     2026-11-03). LWP docks 0.25 day in payroll — see unpaidLeaveDayWeight.
//   • Two slots per day: "morning" (first 2h of the shift) or "evening"
//     (last 2h of the shift). Both use the EMPLOYEE'S OWN shift times, so
//     the excused window is per-org and per-person, never hardcoded.
//   • Max 2 per calendar month, per person.
//   • 2 hours are EXCUSED in attendance: the day's required minutes drop by
//     120 per approved short leave, and a morning short leave shifts the
//     late cutoff by +2h (plus the shift's own grace).
//   • Needs ≥ 0.25 CL, and a shift assigned — else blocked at apply time.
//
// Storage reuses the leave marker convention (like [First Half]/[Second
// Half]): the LeaveApplication is a normal CL row with totalDays = 0.25 and
// its reason prefixed "[Short Leave - Morning]" / "[Short Leave - Evening]".
// No new column — the marker is the source of truth, parsed by this module
// so every consumer (apply route, auto-LOP, clock-in late check, UI) agrees.

export type ShortLeaveSlot = "morning" | "evening";

/** A short leave = quarter day of CL. */
export const SHORT_LEAVE_DAYS = 0.25;
/** Excused working time per short leave, in minutes (2 hours). */
export const SHORT_LEAVE_MINUTES = 120;
/** Max short leaves a person may take in one calendar month. */
export const SHORT_LEAVE_MONTHLY_CAP = 2;
/** Leave types a short leave may draw from. */
export const SHORT_LEAVE_TYPE_CODES = ["CL", "SL", "LWP"];
export const isShortLeaveType = (code: string | null | undefined) =>
  SHORT_LEAVE_TYPE_CODES.includes(String(code ?? "").toUpperCase());
export const SHORT_LEAVE_TYPE_ERROR = "Short leave can only be taken as Casual Leave, Sick Leave or Leave Without Pay.";
/** Minimum day length (the shift's full bar, minutes) for a short leave to
 *  be allowed — at least 2h of real work must remain after the 2h excuse.
 *  Blocks e.g. a 2–3h Saturday, allows the 6h Saturday (needs 4h worked). */
export const MIN_SHORT_LEAVE_BAR_MIN = 240;
/** Attendance status for the ¼-day short-leave penalty (rejected short leave
 *  worked ≥ bar−2h but < bar, or a missed clock-out on a short-leave day). */
export const SHORT_LOP_STATUS = "short_lop";
/** LOP days the short_lop status charges in payroll. */
export const SHORT_LOP_DAYS = 0.25;

/** LWP "used" days the auto-LOP job already charged for an attendance row.
 *  ONE rule for both sides of the counter: auto-LOP charges only the
 *  difference when it re-prices a day (full → half → ¼), and lop-lwp refunds
 *  exactly this when the day is later covered. A ¼ day stamped at clock-out
 *  (rejected short leave) never touched the counter, hence the note check. */
export function lwpChargedFor(row: { status: string; notes: string | null } | null | undefined): number {
  if (row?.status === "lop") return 1;
  if (row?.status === "half_day_lop") return 0.5;
  if (row?.status === SHORT_LOP_STATUS && /^Auto-marked quarter-day LOP/i.test(row.notes ?? "")) return SHORT_LOP_DAYS;
  return 0;
}

const MARKER_RE = /\[\s*short\s*leave\s*[-–:]?\s*(morning|evening)?\s*\]/i;

/** True when a reason string carries the short-leave marker. */
export function isShortLeaveReason(reason: string | null | undefined): boolean {
  return MARKER_RE.test(String(reason ?? ""));
}

/** The slot encoded in a short-leave reason, or null when not a short leave
 *  (or the marker omitted the slot — treated as morning by callers if needed). */
export function shortLeaveSlot(reason: string | null | undefined): ShortLeaveSlot | null {
  const m = MARKER_RE.exec(String(reason ?? ""));
  if (!m) return null;
  const s = (m[1] ?? "").toLowerCase();
  return s === "evening" ? "evening" : s === "morning" ? "morning" : null;
}

/** Build the reason string the apply flow stores. */
export function buildShortLeaveReason(slot: ShortLeaveSlot, note: string): string {
  const label = slot === "evening" ? "Evening" : "Morning";
  return `[Short Leave - ${label}] ${note}`.trim();
}

/** "HH:MM" → minutes past midnight, or null when unparseable. */
export function shiftTimeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t).trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

/**
 * Total minutes to knock off a day's required working time given the short
 * leaves approved for that day. 120 per slot; a morning + evening pair = 240.
 * `reasons` = the reason strings of the day's protected leave rows.
 */
export function shortLeaveExcuseMinutes(reasons: Array<string | null | undefined>): number {
  let mins = 0;
  for (const r of reasons) if (isShortLeaveReason(r)) mins += SHORT_LEAVE_MINUTES;
  return mins;
}

// ── Day-level short-leave state + status pricing ─────────────────────────
// The SINGLE decision table for what a short-leave day's attendance status
// should be, shared by clock-out (live stamping), the leave approve/reject
// handlers (post-day re-settle) and auto-LOP — so a page, the payslip and
// the pre-check can never disagree. Agreed rules (2026-08-04, Gagan):
//   • A short leave lowers the day's required bar by 2h per slot.
//   • Applied + approved + worked ≥ (bar − excuse)     → full day, no penalty.
//   • Applied + REJECTED + worked ≥ (bar − excuse)     → ¼-day penalty
//     (short_lop) — they followed process, softer than the 0.5 half day.
//   • Below the reduced bar the normal bands apply with the approved excuse
//     credited: (worked + approved excuse) ≥ half bar → half_day, else the
//     row keeps its prior status (absent handling stays auto-LOP's job).
//   • Missed clock-out: ½ day like any day (HR, 2026-11-25, from 1 Nov —
//     replaced the old ¼ for any short-leave application), capped at ¼ on
//     a half + short combo day, where not coming at all costs only ¼.
//     Priced in auto-LOP + lop-integrity, not here.
//   • CL once approved stays spent regardless of the day's outcome.

const LIVE_STATUSES = ["pending", "partially_approved", "approved"];
const HALF_MARKER_RE = /^\s*\[(Half Day|First Half|Second Half)\]/i;

/** Aggregate a day's leave applications into short-leave excuse minutes.
 *  `rows` = EVERY leave on the date (any status) — non-short rows only feed
 *  `halfLeaveActive`. `active` = pending / partially_approved / approved (an
 *  undecided request is honoured provisionally — the decision handlers
 *  re-settle the day). */
export function shortLeaveDayState(rows: Array<{ reason: string | null; status: string }>): {
  appliedAny: boolean; activeMin: number; rejectedMin: number;
  /** Minutes from live MORNING slots only — shifts the late cutoff. */
  morningActiveMin: number;
  /** A live half-day leave also sits on the date (half + short combo). */
  halfLeaveActive: boolean;
} {
  let activeMin = 0, rejectedMin = 0, morningActiveMin = 0, appliedAny = false, halfLeaveActive = false;
  for (const r of rows) {
    if (!isShortLeaveReason(r.reason)) {
      if (HALF_MARKER_RE.test(String(r.reason ?? "")) && LIVE_STATUSES.includes(r.status)) halfLeaveActive = true;
      continue;
    }
    appliedAny = true;
    if (LIVE_STATUSES.includes(r.status)) {
      activeMin += SHORT_LEAVE_MINUTES;
      if (shortLeaveSlot(r.reason) === "morning") morningActiveMin += SHORT_LEAVE_MINUTES;
    } else if (r.status === "rejected") rejectedMin += SHORT_LEAVE_MINUTES;
  }
  return { appliedAny, activeMin, rejectedMin, morningActiveMin, halfLeaveActive };
}

/** Status a clocked-out short-leave day should carry. `prevStatus` is kept
 *  for the full-bar case (preserves "late") and the under-half fallthrough.
 *  `halfLeave` (half + short combo, HR 2026-11-25): a live half-day leave
 *  pays the other half, so the bar is the WORKING half (minus the excuse);
 *  meeting it reads `half_day` — the status a plain half-leave day gets, which
 *  payroll excuses against the leave. Falling short is left to auto-LOP. */
export function resolveShortLeaveDayStatus(opts: {
  worked: number; fullBar: number; halfBar: number;
  activeMin: number; rejectedMin: number; prevStatus: string;
  halfLeave?: boolean;
}): string {
  const { worked, fullBar, halfBar, activeMin, rejectedMin, prevStatus, halfLeave = false } = opts;
  const kept = prevStatus === "late" ? "late" : "present";
  if (worked >= fullBar) return kept;
  const bar = halfLeave ? halfBar : fullBar;
  if (worked >= bar - activeMin) return halfLeave ? "half_day" : kept; // excused (reduced) day done
  if (rejectedMin > 0 && worked >= bar - activeMin - rejectedMin) {
    return SHORT_LOP_STATUS; // rejected concession band → ¼ day
  }
  if (halfLeave) return prevStatus; // working half short → auto-LOP prices it
  if (worked + activeMin >= halfBar) return "half_day";
  return prevStatus; // under half bar — same fallthrough as a normal day
}

/** Auto-LOP verdict for a HALF-day-leave day (the other half is worked), past
 *  the grace window. Short-leave minutes in the working half lower its bar.
 *    met          → no charge
 *    short_lop    → half + LIVE short leave, the hours between them not
 *                   worked (or not recorded — a missed clock-out costs the
 *                   same ¼, never more than not coming): HR, 2026-11-25
 *    half_day_lop → plain half-day leave (a rejected short leave grants
 *                   nothing), working half not completed or clock-out missed */
export function halfLeaveDayVerdict(o: {
  worked: number; halfBar: number; liveSlMin: number; rejectedSlMin: number;
}): "met" | "short_lop" | "half_day_lop" {
  if (o.worked >= o.halfBar - o.liveSlMin - o.rejectedSlMin) return "met";
  if (o.liveSlMin > 0) return "short_lop";
  return "half_day_lop";
}

// ── Same-day booking compatibility (apply + edit share it) ───────────────
// A single-day booking occupies one segment of the date. Two bookings may
// share a date only when their segments don't overlap:
//   • First Half + Second Half            (the two halves)
//   • Morning + Evening short leave       (the two 2h slots)
//   • First Half + Evening short leave    (HR, 2026-11-25)
//   • Second Half + Morning short leave   (HR, 2026-11-25)
// Checked pairwise, so a triple that overlaps anywhere (First Half + Morning
// + Evening) is still blocked. Generic [Half Day] has no side → full.
export type LeaveSegment = "full" | "first" | "second" | "sl-morning" | "sl-evening";

export function leaveSegment(reason: string | null | undefined): LeaveSegment {
  if (isShortLeaveReason(reason)) return shortLeaveSlot(reason) === "evening" ? "sl-evening" : "sl-morning";
  const m = /^\s*\[(First Half|Second Half)\]/i.exec(String(reason ?? ""));
  if (m) return /first/i.test(m[1]) ? "first" : "second";
  return "full";
}

const SAME_DAY_PAIRS = new Set(["first|second", "sl-morning|sl-evening", "first|sl-evening", "second|sl-morning"]);
/** Half + short combos are allowed on dates from here on (HR, 2026-11-25).
 *  The ONE gate for the whole combo rule set: earlier dates keep the old
 *  block, so no pre-November day can ever carry a combo — and every
 *  downstream rule (¼ LOP, reduced working half) keys off a combo existing. */
export const HALF_SHORT_COMBO_FROM = "2026-11-01";
type Booking = { fromDate: Date | string; toDate: Date | string; reason: string | null };
const ymdOf = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/** Why `next` can't be booked beside the subject's LIVE leaves that overlap
 *  its range (caller queries them), or null when it can. `halfBarMin` = the
 *  date's half-day bar (null = no shift): a half + short combo must leave
 *  ≥ 2h of real work in the working half — MIN_SHORT_LEAVE_BAR_MIN's rule. */
export function sameDayLeaveConflict(next: Booking, live: Booking[], halfBarMin: number | null): string | null {
  const nSeg = leaveSegment(next.reason);
  const day = ymdOf(next.fromDate);
  const single = day === ymdOf(next.toDate);
  let halfWithShort = false;
  for (const o of live) {
    const oSeg = leaveSegment(o.reason);
    const halfShort = nSeg.startsWith("sl-") !== oSeg.startsWith("sl-");
    const fits = single && ymdOf(o.fromDate) === day && ymdOf(o.toDate) === day
      && (SAME_DAY_PAIRS.has(`${nSeg}|${oSeg}`) || SAME_DAY_PAIRS.has(`${oSeg}|${nSeg}`))
      && !(halfShort && day < HALF_SHORT_COMBO_FROM);
    if (!fits) return isShortLeaveReason(next.reason) ? "You already have leave booked for this slot / day." : "Overlapping leave exists";
    if (halfShort) halfWithShort = true;
  }
  if (halfWithShort && halfBarMin !== null && halfBarMin < MIN_SHORT_LEAVE_BAR_MIN) {
    return `A half-day leave plus a 2-hour short leave needs a ${MIN_SHORT_LEAVE_BAR_MIN / 60}h+ working half — this day's half is only ${Math.round(halfBarMin / 60 * 10) / 10}h.`;
  }
  return null;
}

// ── Unpaid-leave pricing (payroll) ───────────────────────────────────────
// ONE rule for how many LOP days a working day of an approved unpaid leave
// docks, shared by payroll/generate, payroll/attendance-summary and the exit
// F&F calc. It used to be copy-pasted in all three and only knew full/half
// days, so a short leave filed as LWP was charged a full day (Oct 2026).
// A new partial-day leave shape must be priced HERE.
type LeaveSpan = { fromDate: Date | string; toDate: Date | string; reason: string | null; totalDays: unknown };

/** Single-date [Half Day]/[First Half]/[Second Half] leave of ≤ 0.5 days. */
export function isHalfDayLeave(lv: LeaveSpan): boolean {
  return HALF_MARKER_RE.test(String(lv.reason ?? ""))
    && Number(lv.totalDays) <= 0.5
    && new Date(lv.fromDate).getTime() === new Date(lv.toDate).getTime();
}

/** LOP days one working day of an unpaid leave docks: short 0.25, half 0.5, else 1. */
export function unpaidLeaveDayWeight(lv: LeaveSpan): number {
  if (isShortLeaveReason(lv.reason)) return SHORT_LEAVE_DAYS;
  return isHalfDayLeave(lv) ? 0.5 : 1;
}
