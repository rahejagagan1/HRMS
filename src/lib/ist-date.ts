// IST-anchored date helpers.
//
// The Attendance.date column is a Postgres `@db.Date` (calendar day, no time).
// Using `new Date(y, m, d)` on a server in UTC lands a morning-IST clock-in on
// the previous calendar day, which is wrong for an Indian HR app. Always key
// attendance off the IST wall-clock day.

/** Returns the IST calendar day as UTC midnight — safe for Prisma @db.Date. */
export function istTodayDateOnly(): Date {
  return istDateOnlyFrom(new Date());
}

/** Returns the IST calendar day for the given instant, as UTC midnight. */
export function istDateOnlyFrom(instant: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

/** Hour of day (0..23) in IST for the given instant. */
export function istHour(instant: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false,
  }).format(instant);
  return parseInt(h, 10);
}

/**
 * Minutes since midnight (0..1439) in IST for the given instant.
 * Used for shift-relative comparisons (e.g. late = past shift start + grace)
 * without depending on the server's local timezone.
 */
export function istMinutesOfDay(instant: Date): number {
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(instant); // "HH:MM"
  const [h, m] = hm.split(":").map((n) => parseInt(n, 10));
  return h * 60 + m;
}

/**
 * First and last UTC-midnight dates (inclusive) of the IST calendar month
 * containing `dateOnly` — suitable for a Prisma `gte / lte` range on a
 * `@db.Date` column. Keys like `date` in `AttendanceRegularization` are
 * already stored as UTC-midnight of the IST day, so no timezone math is
 * needed beyond reading the UTC year/month off the given date.
 */
export function istMonthRange(dateOnly: Date): { start: Date; end: Date } {
  const y = dateOnly.getUTCFullYear();
  const m = dateOnly.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end   = new Date(Date.UTC(y, m + 1, 0)); // last day of month
  return { start, end };
}

/**
 * Parse "YYYY-MM" into a numeric { year, month1Based } pair. Returns null
 * for unparseable / out-of-range input — callers should treat null as
 * "no month filter".
 */
export function parseYearMonth(s: string | null | undefined): { year: number; month: number } | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (!m) return null;
  const year  = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/**
 * UTC `{ gte, lt }` range that covers a full IST calendar month — suitable
 * for filtering a `DateTime` column (e.g., `appliedAt`, `createdAt`) by the
 * month it was submitted IN INDIA, without leaking server timezone.
 *
 * Example: istCalendarMonthRange(2026, 6) returns
 *   { gte: 2026-05-31T18:30:00.000Z, lt: 2026-06-30T18:30:00.000Z }
 * because June 2026 IST starts at 5:30 PM UTC on May 31.
 */
export function istCalendarMonthRange(year: number, month1Based: number): { gte: Date; lt: Date } {
  const IST_OFFSET_MS = 330 * 60 * 1000; // +5:30
  const gte = new Date(Date.UTC(year, month1Based - 1, 1, 0, 0, 0) - IST_OFFSET_MS);
  const lt  = new Date(Date.UTC(year, month1Based,     1, 0, 0, 0) - IST_OFFSET_MS);
  return { gte, lt };
}

/**
 * Build a precise UTC `Date` for a given HH:MM on the IST calendar day that
 * `dateOnly` represents (which is stored as UTC-midnight of that IST day).
 *
 * Example: `istTimeOnDate(reg.date, 10, 0)` → 10:00 AM IST on that date.
 * IST is UTC+5:30, so we subtract 330 minutes to land on the matching UTC instant.
 */
export function istTimeOnDate(dateOnly: Date, hourIst: number, minuteIst: number): Date {
  const IST_OFFSET_MIN = 330; // +5:30
  const base = new Date(dateOnly).setUTCHours(0, 0, 0, 0);
  const offsetMs = (hourIst * 60 + minuteIst - IST_OFFSET_MIN) * 60 * 1000;
  return new Date(base + offsetMs);
}
