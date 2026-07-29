import prisma from "@/lib/prisma";
import { istTodayDateOnly } from "@/lib/ist-date";

/**
 * True once an employee's exit last working day has PASSED (strictly before
 * today, IST). On the last working day itself this is false — they still work
 * that day. Used to stop attendance recording after exit, independent of any
 * HR-granted login grace window (that grace is for handover access, not for
 * clocking in/out).
 */
export async function isPastLastWorkingDay(userId: number): Promise<boolean> {
  try {
    const exit = await prisma.employeeExit.findFirst({
      where: { userId },
      select: { lastWorkingDay: true },
    });
    const lwd = exit?.lastWorkingDay;
    if (!lwd) return false;
    return new Date(lwd).getTime() < istTodayDateOnly().getTime();
  } catch {
    return false; // never block attendance on a DB hiccup
  }
}
