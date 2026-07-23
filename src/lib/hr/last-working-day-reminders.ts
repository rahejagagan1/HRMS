// Daily sweep: emails the offboarding stakeholders when an employee's last
// working day is TODAY (IST), so leadership knows the person is off the books
// as of today. Wired into the cron registry as "last_day_reminders" (Admin →
// Crons), run daily by the internal scheduler.
//
// Deduped by the date itself — lastWorkingDay == today is true on exactly one
// calendar day and the scheduler runs this once per day, so no per-row stamp
// is needed. status != "exited" skips anyone already fully offboarded.
import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email/sender";
import { lastWorkingDayReminderEmail } from "@/lib/email/templates";
import { exitStakeholderEmails } from "@/lib/notifications";
import { istTodayDateOnly } from "@/lib/ist-date";

export async function sendLastWorkingDayReminders(): Promise<number> {
  const today = istTodayDateOnly();
  const exits = await prisma.employeeExit.findMany({
    where: { lastWorkingDay: today, status: { not: "exited" } },
    select: {
      exitType: true,
      lastWorkingDay: true,
      reason: true,
      user: {
        select: {
          id: true, name: true, managerId: true,
          employeeProfile: { select: { employeeId: true, designation: true } },
        },
      },
    },
  });

  let sent = 0;
  for (const ex of exits) {
    try {
      const recipients = await exitStakeholderEmails({
        id: ex.user.id,
        managerId: ex.user.managerId,
      });
      if (recipients.length === 0) continue;
      await sendEmail({
        to: recipients,
        content: lastWorkingDayReminderEmail({
          name:           ex.user.name,
          employeeId:     ex.user.employeeProfile?.employeeId ?? null,
          designation:    ex.user.employeeProfile?.designation ?? null,
          exitType:       ex.exitType,
          lastWorkingDay: ex.lastWorkingDay,
          reason:         ex.reason,
        }),
      });
      sent++;
    } catch (e) {
      console.warn(`[last-day-reminders] failed for user #${ex.user.id}`, e);
    }
  }
  return sent;
}
