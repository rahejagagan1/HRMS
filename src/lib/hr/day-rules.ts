// ─────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for the per-day attendance rules that decide
// pay and lateness (2026-07-29). Born from a week of bugs that all had
// the same shape: the same rule re-implemented in several files, drifting
// apart one edit at a time (status lists missing partially_approved,
// half-day markers parsed with slightly different regexes, late cutoffs
// ignoring first-half leave, 540-minute bars hardcoded after Saturday
// hours became configurable).
//
// Pure module — no Prisma, no React — so server routes, crons, and client
// pages can all import it. Callers fetch the raw facts; THIS file owns
// the interpretation.
// ─────────────────────────────────────────────────────────────────────

/** Request statuses that are still awaiting a decision. */
export const OPEN_REQUEST_STATUSES = ["pending", "partially_approved"] as const;

/** Request statuses that occupy a slot / protect a day: open + approved.
 *  Use for quota counting, duplicate-date guards, and LOP protection —
 *  forgetting `partially_approved` here caused four separate bugs. */
export const ACTIVE_REQUEST_STATUSES = ["pending", "partially_approved", "approved"] as const;

export function isOpenStatus(s: string | null | undefined): boolean {
  return (OPEN_REQUEST_STATUSES as readonly string[]).includes(String(s ?? ""));
}
export function isActiveStatus(s: string | null | undefined): boolean {
  return (ACTIVE_REQUEST_STATUSES as readonly string[]).includes(String(s ?? ""));
}

// ── Half-day markers ─────────────────────────────────────────────────
// Half-day leaves / WFH carry a marker in the reason text. ONE regex set,
// used everywhere.
export const FIRST_HALF_RE  = /\[first\s+half\]/i;
export const SECOND_HALF_RE = /\[second\s+half\]/i;
export const HALF_MARKER_RE = /^\s*\[(Half Day|First Half|Second Half)\]/i;

export type HalfSide = "first" | "second" | null;

/** Which half a request's reason marks — null for full-day requests. */
export function halfOf(reason: string | null | undefined): HalfSide {
  const s = String(reason ?? "");
  if (FIRST_HALF_RE.test(s)) return "first";
  if (SECOND_HALF_RE.test(s)) return "second";
  return null;
}

/** True when the reason carries any half-day marker (incl. bare [Half Day]). */
export function isHalfDayReason(reason: string | null | undefined): boolean {
  return HALF_MARKER_RE.test(String(reason ?? ""));
}

// ── Shift timing ─────────────────────────────────────────────────────

/** The shift fields these rules need — both a Prisma row and an API JSON
 *  payload satisfy it. All optional so stale clients can't break callers. */
export type DayShift = {
  startTime?: string | null;
  endTime?: string | null;
  breakMinutes?: number | null;
  satStartTime?: string | null;
  satEndTime?: string | null;
  satGraceMinutes?: number | null;
} | null | undefined;

/** "HH:MM" → minutes-of-day, or null when unparseable. */
export function hmToMin(t: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Legacy defaults for users with no shift assigned. */
const DEFAULT_START_MIN = 10 * 60; // 10:00 IST
const DEFAULT_END_MIN   = 19 * 60; // 19:00 IST
const DEFAULT_GRACE_MIN = 15;
export const DEFAULT_FULL_DAY_MIN = 540; // 9h
export const DEFAULT_HALF_DAY_MIN = 270; // 4.5h

/**
 * The effective timings for a given calendar date: weekday hours normally,
 * the shift's Saturday-specific hours/grace when the date is a Saturday and
 * they're defined. `date` must be the UTC-midnight IST calendar day used
 * across the app.
 */
export function shiftTimesFor(date: Date, shift: DayShift): {
  startMin: number; endMin: number; graceMin: number; midMin: number;
} {
  const isSat = date.getUTCDay() === 6;
  const satStart = isSat ? hmToMin(shift?.satStartTime) : null;
  const satEnd   = isSat ? hmToMin(shift?.satEndTime) : null;
  const useSat   = satStart !== null && satEnd !== null && satEnd > satStart;

  const startMin = useSat ? satStart! : (hmToMin(shift?.startTime) ?? DEFAULT_START_MIN);
  const endMin   = useSat ? satEnd!   : (hmToMin(shift?.endTime)   ?? DEFAULT_END_MIN);
  const mainGrace = Number.isFinite(shift?.breakMinutes as number) ? Number(shift!.breakMinutes) : DEFAULT_GRACE_MIN;
  const graceMin = useSat && Number.isFinite(shift?.satGraceMinutes as number)
    ? Number(shift!.satGraceMinutes)
    : mainGrace;
  return { startMin, endMin, graceMin, midMin: Math.round((startMin + endMin) / 2) };
}

/**
 * Required working minutes for the date: full day = the day's shift length
 * on Saturdays with their own hours, else the standard 9h; half = half of
 * full. This is the bar clock-out statuses and auto-LOP judge against.
 */
export function dayBars(date: Date, shift: DayShift): { full: number; half: number } {
  const isSat = date.getUTCDay() === 6;
  if (isSat) {
    const s = hmToMin(shift?.satStartTime), e = hmToMin(shift?.satEndTime);
    if (s !== null && e !== null && e > s) return { full: e - s, half: Math.round((e - s) / 2) };
  }
  return { full: DEFAULT_FULL_DAY_MIN, half: DEFAULT_HALF_DAY_MIN };
}

// ── Working-day resolution (shift-driven) ────────────────────────────
// Whether a given calendar date is a WORKING day for a shift — the single
// place that reads a shift's workDays + Saturday policy so reminders, crons,
// and pages never re-implement (and drift on) "is today a work day?". Shifts
// can change any time, so callers pass the LIVE shift row; this stays pure.

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Shift fields needed to decide if a date is a working day. Loose types so
 *  a Prisma row or an API payload both satisfy it (workDays is JSON). */
export type WorkingDayShift = {
  workDays?: unknown;                 // e.g. ["Mon","Tue","Wed","Thu","Fri","Sat"]
  saturdayPolicy?: string | null;     // "all" | "alternate" | "weeks" | "dates"
  saturdayWeeks?: number[] | null;    // for "weeks": [1,3] = 1st & 3rd Saturday
  saturdayDates?: string[] | null;    // for "dates": ["YYYY-MM-DD", …]
} | null | undefined;

/** Normalise a shift.workDays JSON value into a Set of "Mon".."Sun". */
function workDaySet(workDays: unknown): Set<string> {
  let arr: unknown[] = [];
  if (Array.isArray(workDays)) arr = workDays;
  else if (typeof workDays === "string") { try { arr = JSON.parse(workDays); } catch { arr = []; } }
  const map: Record<string, string> = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };
  const s = new Set<string>();
  for (const d of arr) {
    const name = map[String(d).trim().toLowerCase().slice(0, 3)];
    if (name) s.add(name);
  }
  return s;
}

/**
 * True when `date` (UTC-midnight of the IST calendar day) is a WORKING day
 * for the given shift.
 *   • No shift assigned          → legacy default: Mon–Fri work, weekend off.
 *   • Weekday not in workDays     → off.
 *   • Mon–Fri (or a Sunday HR put in workDays) → working.
 *   • Saturday                    → honour saturdayPolicy:
 *       - "all"       every Saturday works
 *       - "weeks"     only week-of-month ordinals in saturdayWeeks
 *       - "dates"     only the exact dates in saturdayDates
 *       - "alternate" every other Saturday, anchored at the user's shift
 *                     start (pass opts.alternateAnchor = UserShift.effectiveFrom);
 *                     without an anchor it fails OPEN (treated as working).
 */
export function isWorkingDayForShift(
  date: Date,
  shift: WorkingDayShift,
  opts?: { alternateAnchor?: Date | string | null },
): boolean {
  const dow = date.getUTCDay(); // 0=Sun … 6=Sat (IST, since date is UTC-midnight of the IST day)
  if (!shift || shift.workDays == null) return dow >= 1 && dow <= 5;

  const days = workDaySet(shift.workDays);
  if (!days.has(DOW_NAMES[dow])) return false;
  if (dow !== 6) return true; // weekday (or an explicit Sunday) that's in workDays

  // Saturday — apply the policy.
  switch (String(shift.saturdayPolicy ?? "all")) {
    case "all":
      return true;
    case "weeks":
      return (shift.saturdayWeeks ?? []).includes(Math.ceil(date.getUTCDate() / 7));
    case "dates":
      return (shift.saturdayDates ?? []).includes(date.toISOString().slice(0, 10));
    case "alternate": {
      if (!opts?.alternateAnchor) return true; // no anchor → fail open (working)
      const a = new Date(opts.alternateAnchor);
      // Saturday of the anchor's week (its apply-week Saturday, which works).
      const anchorSat = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()));
      anchorSat.setUTCDate(anchorSat.getUTCDate() + ((6 - anchorSat.getUTCDay() + 7) % 7));
      const weeks = Math.round((date.getTime() - anchorSat.getTime()) / (7 * 24 * 60 * 60 * 1000));
      return weeks % 2 === 0; // apply-week Sat works, then every other
    }
    default:
      return true;
  }
}

/**
 * The IST minute-of-day AFTER which a first clock-in counts late.
 *   • Normal day        → shift start + grace.
 *   • First-half off    → shift mid-point + grace (only expected from the
 *                         second half; leave/WFH covers the morning).
 *   • Morning short leave → shift start + excused minutes + grace.
 * Priority: first-half off wins over short leave (a bigger excusal).
 */
export function lateCutoffMinFor(
  date: Date,
  shift: DayShift,
  opts?: { firstHalfOff?: boolean; morningShortLeaveMinutes?: number },
): number {
  const { startMin, graceMin, midMin } = shiftTimesFor(date, shift);
  if (opts?.firstHalfOff) return midMin + graceMin;
  if (opts?.morningShortLeaveMinutes && opts.morningShortLeaveMinutes > 0) {
    return startMin + opts.morningShortLeaveMinutes + graceMin;
  }
  return startMin + graceMin;
}
