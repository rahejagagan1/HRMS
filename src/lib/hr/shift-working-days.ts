// Single source of truth for "is this date a working day for this shift?".
//
// A shift's `workDays` is a JSON array of day-name labels ("Mon".."Sun").
// Saturday is special — `saturdayPolicy` decides which Saturdays work when
// "Sat" is in `workDays`:
//   • "all"       → every Saturday works (default / back-compat).
//   • "alternate" → every OTHER Saturday. The phase is a property of the
//                   SHIFT, not the user: it is anchored at the shift's own
//                   `createdAt` (when the alternate policy was set up) so
//                   every employee on the shift shares the SAME working
//                   Saturdays regardless of when they were onboarded. The
//                   Saturday of the anchor week works, the next is off, then
//                   works, … continuously, ignoring month boundaries and
//                   5-Saturday months. (A per-user `anchor` is still accepted
//                   as a fallback for callers that don't load the shift's
//                   createdAt, but createdAt takes precedence.)
//   • "weeks"     → only the week-of-month ordinals in `saturdayWeeks`
//                   (1..5; e.g. [1,3] = 1st & 3rd Saturday).
//
// Pure module (no Prisma / no DB) so both server routes and client
// components can import it. Holidays are handled separately by callers — a
// holiday always takes precedence over a working day.

// Indexed by Date#getUTCDay(): 0 = Sunday … 6 = Saturday.
export const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Minimal shift shape both a Prisma `select` and an API JSON payload satisfy. */
export type ShiftWorkRule = {
  workDays: unknown;            // expected: array of "Mon".."Sun"; validated defensively
  saturdayPolicy?: string | null;   // "all" | "alternate" | "weeks"
  saturdayWeeks?: number[] | null;
  // Shift-level anchor for the "alternate" Saturday phase. When present it
  // is used INSTEAD of the per-user `anchor` arg so the pattern is uniform
  // across everyone on the shift. Set this to the Shift row's createdAt.
  createdAt?: Date | string | null;
} | null | undefined;

const DAY_MS = 86_400_000;
function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Week-of-month ordinal of a (UTC) date: 1 for days 1–7, … 5 for 29–31. */
export function saturdayOrdinal(date: Date): number {
  return Math.ceil(date.getUTCDate() / 7);
}

/**
 * For "alternate" Saturday shifts: is `date` (a Saturday) a working one?
 * Phase is set by `anchor` — the Saturday in the anchor's week (first Saturday
 * on/after the anchor date) is "week 0" and WORKS; even week-offsets work,
 * odd are off. Continuous across months, so 5-Saturday months never desync it.
 */
export function alternateSaturdayWorking(date: Date, anchor: Date): boolean {
  const a = utcMidnight(anchor);
  const anchorDow = new Date(a).getUTCDay();
  const daysToSat = (6 - anchorDow + 7) % 7;       // 0 when the anchor is itself a Saturday
  const anchorSat = a + daysToSat * DAY_MS;
  const weeks = Math.round((utcMidnight(date) - anchorSat) / (7 * DAY_MS));
  return (((weeks % 2) + 2) % 2) === 0;            // even offset (incl. negatives) → working
}

/**
 * True when `date` is a working day for `shift`.
 *
 *   • shift null/undefined → Mon–Fri (legacy default; no shift assigned).
 *   • day-name not in workDays → false.
 *   • Saturday → governed by saturdayPolicy (see module header). `anchor`
 *     (UserShift.effectiveFrom) is required for "alternate"; if absent we fall
 *     back to treating every Saturday as working.
 *   • otherwise → true.
 *
 * Does NOT consider holidays; callers subtract those.
 */
export function isWorkingDay(date: Date, shift: ShiftWorkRule, anchor?: Date | null): boolean {
  const dow = date.getUTCDay();

  // No shift assigned → default Mon–Fri.
  if (!shift) return dow !== 0 && dow !== 6;

  const label = DOW_NAMES[dow];
  const workDays = Array.isArray(shift.workDays) ? (shift.workDays as unknown[]) : [];
  if (!workDays.includes(label)) return false;

  if (dow === 6) {
    const policy = shift.saturdayPolicy ?? "all";
    if (policy === "alternate") {
      // Prefer the SHIFT-level anchor (createdAt) so the phase is the same
      // for every user on the shift; fall back to the per-user `anchor`
      // only when the shift's createdAt wasn't loaded by the caller.
      const phaseAnchor = shift.createdAt ? new Date(shift.createdAt) : anchor;
      return phaseAnchor ? alternateSaturdayWorking(date, phaseAnchor) : true;
    }
    if (policy === "weeks") {
      const weeks = shift.saturdayWeeks;
      if (Array.isArray(weeks) && weeks.length > 0) return weeks.includes(saturdayOrdinal(date));
      return true; // empty list → every Saturday works
    }
    return true; // "all"
  }
  return true;
}
