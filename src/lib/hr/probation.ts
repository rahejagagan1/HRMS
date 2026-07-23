// Probation window — the SINGLE source of truth for a new hire's probation.
//
// Policy (confirmed with HR): EVERY new joiner — regular and intern alike — is
// on probation for the first PROBATION_MONTHS months from their joining date.
// HR can extend it manually afterwards (Edit Profile / the reminder emails'
// one-click links). The intern-vs-regular difference is a LEAVE concern (CL
// accrual), handled separately in the leave/conversion logic — not here.
//
// Used by both onboarding paths (/api/users, /api/hr/employees) and the
// one-time backfill so the computed dates never drift between entry points.

export const PROBATION_MONTHS = 3;

// Calendar-month add with end-of-month clamping so e.g. 30 Nov + 3 months
// lands on 28/29 Feb, not an overflowed early-March date.
export function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  const day = x.getDate();
  x.setMonth(x.getMonth() + months);
  if (x.getDate() < day) x.setDate(0); // overflowed → clamp to last day of target month
  return x;
}

// Given a joining date (falls back to today when missing/invalid), returns the
// probation start (= joining) and end (= joining + PROBATION_MONTHS months).
export function probationWindow(joining: Date | null | undefined): { start: Date; end: Date } {
  const start = joining && !Number.isNaN(joining.getTime()) ? new Date(joining) : new Date();
  return { start, end: addMonths(start, PROBATION_MONTHS) };
}
