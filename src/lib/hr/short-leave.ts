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
