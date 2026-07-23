/**
 * Weekly manager report periods: **Monday–Sunday** calendar weeks (7 days).
 *
 * A week is assigned to the calendar month in which **≥4** of those 7 days fall
 * (majority month). Example: Mon Mar 23–Sun Mar 29 → March; Mon Mar 30–Sun Apr 5
 * → April (5 days in April, 2 in March).
 *
 * Week indices within a month are **1..N** (typically 4–5), ordered by Monday date.
 *
 * Note: Existing `WeeklyReport` rows were created under older period rules; their
 * `week` numbers may not match these date ranges for historical data.
 */

const MONTH_SHORT = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export type WeeklyReportPeriod = { weekStart: Date; weekEnd: Date };

/** Monday 00:00:00 local for the week that contains this calendar day. */
export function startOfMondayWeekContaining(year: number, monthIndex: number, day: number): Date {
    const d = new Date(year, monthIndex, day, 0, 0, 0, 0);
    const offsetFromMonday = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offsetFromMonday);
    return d;
}

function endOfSundayWeek(weekStartMonday: Date): Date {
    const e = new Date(weekStartMonday);
    e.setDate(e.getDate() + 6);
    e.setHours(23, 59, 59, 999);
    return e;
}

/** Calendar month (year + 0-based month) that owns this Mon–Sun week (≥4 of 7 days). */
export function getOwningMonthForWeek(weekStartMonday: Date): { year: number; monthIndex: number } {
    const tallies = new Map<string, number>();
    for (let i = 0; i < 7; i++) {
        const d = new Date(weekStartMonday);
        d.setDate(weekStartMonday.getDate() + i);
        const key = `${d.getFullYear()}\t${d.getMonth()}`;
        tallies.set(key, (tallies.get(key) ?? 0) + 1);
    }
    let bestY = weekStartMonday.getFullYear();
    let bestM = weekStartMonday.getMonth();
    let bestCount = -1;
    for (const [k, c] of tallies) {
        if (c > bestCount) {
            bestCount = c;
            const [ys, ms] = k.split("\t").map(Number);
            bestY = ys;
            bestM = ms;
        }
    }
    return { year: bestY, monthIndex: bestM };
}

/**
 * All Mon–Sun weeks that belong to `year`/`monthIndex`, in order (week 1 = earliest Monday).
 */
export function listWeeklyPeriodsForMonth(year: number, monthIndex: number): WeeklyReportPeriod[] {
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    const seenMonday = new Set<number>();
    const periods: WeeklyReportPeriod[] = [];

    for (let day = 1; day <= lastDay; day++) {
        const monday = startOfMondayWeekContaining(year, monthIndex, day);
        const t = monday.getTime();
        if (seenMonday.has(t)) continue;
        seenMonday.add(t);

        const owner = getOwningMonthForWeek(monday);
        if (owner.year !== year || owner.monthIndex !== monthIndex) continue;

        periods.push({
            weekStart: new Date(monday),
            weekEnd: endOfSundayWeek(monday),
        });
    }

    periods.sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());
    return periods;
}

export function countWeeksInReportMonth(year: number, monthIndex: number): number {
    return listWeeklyPeriodsForMonth(year, monthIndex).length;
}

/** Inclusive datetime range for `dateDone` filters, or `null` if `week` is out of range. */
export function getWeeklyReportPeriod(
    year: number,
    monthIndex: number,
    week: number,
): WeeklyReportPeriod | null {
    const periods = listWeeklyPeriodsForMonth(year, monthIndex);
    const i = week - 1;
    if (i < 0 || i >= periods.length) return null;
    return periods[i];
}

/** UI label e.g. "Mar 23 – Mar 29" (may span months). */
export function formatWeeklyReportPeriodLabel(year: number, monthIndex: number, week: number): string {
    const p = getWeeklyReportPeriod(year, monthIndex, week);
    if (!p) return "";
    const fmt = (d: Date) => `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
    return `${fmt(p.weekStart)} – ${fmt(p.weekEnd)}`;
}

/** Reporting period for "today" (sync jobs): owning month + 1-based week index. */
export function resolveWeeklyReportPeriodForDate(d: Date): { year: number; monthIndex: number; week: number } {
    const y = d.getFullYear();
    const m = d.getMonth();
    const day = d.getDate();
    const monday = startOfMondayWeekContaining(y, m, day);
    const owner = getOwningMonthForWeek(monday);
    const periods = listWeeklyPeriodsForMonth(owner.year, owner.monthIndex);
    const t = monday.getTime();
    const idx = periods.findIndex((p) => p.weekStart.getTime() === t);
    if (idx < 0) {
        console.error("weekly-period: owning month missing expected Monday week", {
            monday: monday.toISOString(),
            owner,
        });
        return { year: owner.year, monthIndex: owner.monthIndex, week: 1 };
    }
    return { year: owner.year, monthIndex: owner.monthIndex, week: idx + 1 };
}
