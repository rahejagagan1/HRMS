/**
 * Monthly reporting window used for rating calculations and Section-3 case
 * counts across the monthly report.
 *
 * A case counts for month M when its role subtask (Scripting/Editing/Video QA1)
 * was marked done between:
 *   - windowStart: 4th of month M, 00:00:00 UTC
 *   - windowEnd:   3rd of month M+1, 23:59:59.999 UTC
 *
 * This is a non-overlapping "billing cycle" — subtasks finished on day 1–3 of
 * a calendar month belong to the PREVIOUS month's report.
 *
 * Keep this separate from `monthStart` (day 1 of month M) which is still used
 * as the primary key for MonthlyRating rows.
 */
export function getMonthlyReportWindow(
    year: number,
    monthIndex: number
): { windowStart: Date; windowEnd: Date } {
    const windowStart = new Date(Date.UTC(year, monthIndex, 4, 0, 0, 0, 0));
    const nextYear = monthIndex === 11 ? year + 1 : year;
    const nextMonth = (monthIndex + 1) % 12;
    const windowEnd = new Date(Date.UTC(nextYear, nextMonth, 3, 23, 59, 59, 999));
    return { windowStart, windowEnd };
}

/** Derive the window from any Date whose calendar month is the target month. */
export function getMonthlyReportWindowFromDate(d: Date): { windowStart: Date; windowEnd: Date } {
    return getMonthlyReportWindow(d.getUTCFullYear(), d.getUTCMonth());
}
