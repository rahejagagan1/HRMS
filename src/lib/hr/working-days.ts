import prisma from "@/lib/prisma";
import { isWorkingDay, type ShiftWorkRule } from "@/lib/hr/shift-working-days";

/**
 * Count the working days between `from` and `to` inclusive, excluding
 * non-working days and full (public/company) HolidayCalendar rows in that
 * window. OPTIONAL (floater) holidays count as working days — they're
 * exactly the dates Floater Leave is applied on, so excluding them zeroed
 * out those requests with "all non-working days" (bug fixed 2026-07-22).
 * Same semantic as the attendance-month-summary working-day set.
 *
 * `shift` (optional) decides which days are working. When omitted/null the
 * legacy Mon–Fri rule applies (every existing 2-arg caller keeps today's
 * behaviour). When a shift is passed, its workDays + alternate-Saturday rule
 * (saturdayWeeks) drive the count — see {@link isWorkingDay}.
 *
 * All arithmetic is UTC-based:
 *   • the leave form posts dates as "YYYY-MM-DD" → parsed as UTC midnight,
 *   • Prisma returns @db.Date columns as UTC-midnight Date objects,
 *   • the server may run in UTC or IST — using getUTCDay() / setUTCDate()
 *     gives the same answer either way and prevents off-by-one weekend
 *     bugs when crossing TZ boundaries.
 */
export async function countWorkingDays(from: Date, to: Date, shift?: ShiftWorkRule, anchor?: Date | null): Promise<number> {
  const isoKey = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

  const holidays = await prisma.holidayCalendar.findMany({
    where: { date: { gte: from, lte: to }, NOT: { type: "optional" } },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => isoKey(h.date)));

  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end =          Date.UTC(to.getUTCFullYear(),   to.getUTCMonth(),   to.getUTCDate());

  let count = 0;
  while (cur.getTime() <= end) {
    if (isWorkingDay(cur, shift ?? null, anchor ?? null) && !holidaySet.has(isoKey(cur))) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}
