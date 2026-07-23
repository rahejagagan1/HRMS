import prisma from "@/lib/prisma";
import { istTodayDateOnly } from "@/lib/ist-date";

/**
 * Sweep any Attendance row from a past day that has clockIn but no clockOut.
 * Marks status = "missed_clock_out" so:
 *   • the frontend stops live-ticking the elapsed-time counter on stale rows
 *   • the user sees a clear "regularize this day" signal
 *   • payroll/audit reports can filter these out or require a regularization
 *
 * Idempotent — re-running has zero effect on already-flagged rows (they're
 * excluded by the `status: { notIn: [...] }` guard). Safe to call every hour
 * from the internal scheduler and/or from an external cron.
 *
 * Returns the number of rows that were updated by this call.
 */
export async function closeMissedClockOuts(): Promise<number> {
  const today = istTodayDateOnly();
  const { count } = await prisma.attendance.updateMany({
    where: {
      date:     { lt: today },
      clockIn:  { not: null },
      clockOut: null,
      // Don't overwrite already-settled statuses (leave, holiday, weekend,
      // a previous sweep's missed_clock_out mark, or a LOP penalty the
      // auto-LOP job already applied to an unregularized missed clock-out —
      // otherwise the sweep would flip half_day_lop / lop back to
      // missed_clock_out on the next run).
      status: { notIn: ["missed_clock_out", "on_leave", "weekend", "holiday", "lop", "half_day_lop"] },
    },
    data: { status: "missed_clock_out" },
  });
  return count;
}
