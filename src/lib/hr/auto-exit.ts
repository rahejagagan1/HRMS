// Auto-finalise offboarding exits whose notice period has ended.
//
// HR sets each exit's lastWorkingDay in the offboarding pipeline; the exit
// then sits in "in_progress" (clearance underway) while the employee serves
// their notice. This sweep flips the exit to "exited" once that last working
// day has passed (IST) and deactivates the user account — the exact side
// effect HR's manual "Exited" toggle performs in PATCH /api/hr/exits/[id].
// Wired as the `auto_exit` cron so it happens automatically instead of
// requiring HR to remember to move the stage.

import prisma from "@/lib/prisma";
import { istTodayDateOnly } from "@/lib/ist-date";

export async function finaliseDueExits(): Promise<void> {
  // IST calendar day as YYYY-MM-DD. We flip when lastWorkingDay is strictly
  // before today, i.e. the day AFTER the last working day — the employee
  // works their full final day and is "off the books" the next morning
  // (matches the +1-day grace the search/profile "Exited" badge uses).
  const todayStr = istTodayDateOnly().toISOString().slice(0, 10);

  const due = await prisma.$queryRawUnsafe<Array<{ id: number; userId: number }>>(
    `SELECT id, "userId"
       FROM "EmployeeExit"
      WHERE status IN ('in_progress', 'under_review')
        AND "lastWorkingDay" IS NOT NULL
        AND "lastWorkingDay" < $1::date`,
    todayStr,
  );
  if (due.length === 0) return;

  let done = 0;
  for (const row of due) {
    try {
      // Same transaction shape as the manual toggle: flip status +
      // deactivate the account so the exit row and User.isActive never
      // drift. Guarded on the non-final status so a concurrent manual
      // change can't be clobbered.
      await prisma.$transaction([
        prisma.$executeRawUnsafe(
          `UPDATE "EmployeeExit"
              SET status = 'exited', "updatedAt" = now()
            WHERE id = $1 AND status IN ('in_progress', 'under_review')`,
          row.id,
        ),
        prisma.$executeRawUnsafe(
          `UPDATE "User" SET "isActive" = false WHERE id = $1`,
          row.userId,
        ),
      ]);
      done++;
    } catch (e) {
      console.error(`[auto-exit] failed to finalise exit ${row.id} (user ${row.userId})`, e);
    }
  }
  console.log(`[auto-exit] finalised ${done}/${due.length} due exit(s) as of ${todayStr} IST`);
}
