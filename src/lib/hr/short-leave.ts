// Short Leave — a 2-hour leave that costs a quarter-day (0.25) of Casual
// Leave. Design (2026-07-24, agreed with Gagan):
//   • Always drawn from CL only.
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
/** The leave-type code short leave always draws from. */
export const SHORT_LEAVE_TYPE_CODE = "CL";
/** Minimum day length (the shift's full bar, minutes) for a short leave to
 *  be allowed — at least 2h of real work must remain after the 2h excuse.
 *  Blocks e.g. a 2–3h Saturday, allows the 6h Saturday (needs 4h worked). */
export const MIN_SHORT_LEAVE_BAR_MIN = 240;
/** Attendance status for the ¼-day short-leave penalty (rejected short leave
 *  worked ≥ bar−2h but < bar, or a missed clock-out on a short-leave day). */
export const SHORT_LOP_STATUS = "short_lop";
/** LOP days the short_lop status charges in payroll. */
export const SHORT_LOP_DAYS = 0.25;

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
//   • Missed clock-out on a day with ANY short-leave application (even a
//     rejected one) → ¼ day instead of the standard ½ (priced in auto-LOP +
//     lop-integrity, not here).
//   • CL once approved stays spent regardless of the day's outcome.

/** Aggregate a day's short-leave applications into excuse minutes.
 *  `active` = pending / partially_approved / approved (an undecided request
 *  is honoured provisionally — the decision handlers re-settle the day). */
export function shortLeaveDayState(rows: Array<{ reason: string | null; status: string }>): {
  appliedAny: boolean; activeMin: number; rejectedMin: number;
} {
  let activeMin = 0, rejectedMin = 0, appliedAny = false;
  for (const r of rows) {
    if (!isShortLeaveReason(r.reason)) continue;
    appliedAny = true;
    if (["pending", "partially_approved", "approved"].includes(r.status)) activeMin += SHORT_LEAVE_MINUTES;
    else if (r.status === "rejected") rejectedMin += SHORT_LEAVE_MINUTES;
  }
  return { appliedAny, activeMin, rejectedMin };
}

/** Status a clocked-out short-leave day should carry. `prevStatus` is kept
 *  for the full-bar case (preserves "late") and the under-half fallthrough. */
export function resolveShortLeaveDayStatus(opts: {
  worked: number; fullBar: number; halfBar: number;
  activeMin: number; rejectedMin: number; prevStatus: string;
}): string {
  const { worked, fullBar, halfBar, activeMin, rejectedMin, prevStatus } = opts;
  if (worked >= fullBar) return prevStatus === "late" ? "late" : "present";
  if (activeMin > 0 && worked >= fullBar - activeMin) {
    return prevStatus === "late" ? "late" : "present"; // excused full day
  }
  if (rejectedMin > 0 && worked >= fullBar - activeMin - rejectedMin) {
    return SHORT_LOP_STATUS; // rejected concession band → ¼ day
  }
  if (worked + activeMin >= halfBar) return "half_day";
  return prevStatus; // under half bar — same fallthrough as a normal day
}
