// Reminds leaving employees to complete their Exit Survey ~2 days before
// their last working day via BOTH channels (same as the weekly pulse /
// monthly survey): an in-app bell notification (with a "Complete exit
// survey" CTA) AND an email. Once per exit (stamped surveyReminderSentAt);
// skips anyone who already submitted.
//
// The bell notification always fires; the email is additionally gated by
// the exit_survey_reminders email toggle (Admin → Emails Automation).
import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email/sender";
import { exitSurveyReminderEmail } from "@/lib/email/templates";
import { isDryRun } from "@/lib/email/transport";
import { isEmailEnabled } from "@/lib/email/toggles";
import { listExitsNeedingReminder, markReminderSent } from "@/lib/hr/exit-survey";

const SURVEY_URL = "/dashboard/hr/exit-survey";

export async function sendExitSurveyReminders(): Promise<number> {
  const targets = await listExitsNeedingReminder();
  if (targets.length === 0) return 0;

  const emailOn = await isEmailEnabled("exit_survey_reminders");

  let processed = 0;
  for (const t of targets) {
    const daysRemaining = Math.max(
      0,
      Math.ceil((new Date(`${t.lastWorkingDay}T00:00:00Z`).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    );
    const whenText = daysRemaining <= 0 ? "today" : daysRemaining === 1 ? "tomorrow" : `in ${daysRemaining} days`;

    // 1) In-app bell notification (always) — clickable CTA → the form.
    try {
      await prisma.notification.createMany({
        data: [{
          userId: t.userId,
          type: "exit_survey",
          title: "Complete your Exit Survey",
          body: `Your last working day is ${whenText}. Please complete your exit survey before you clock out on your final day.`,
          linkUrl: SURVEY_URL,
        }],
      });
    } catch (e) {
      console.warn(`[exit-survey-reminders] notification failed for user #${t.userId}`, e);
    }

    // 2) Email (gated by the toggle).
    if (emailOn && t.email) {
      try {
        await sendEmail({
          to: t.email,
          content: exitSurveyReminderEmail({ employeeName: t.name, lastWorkingDay: t.lastWorkingDay, daysRemaining }),
        });
      } catch (e) {
        console.warn(`[exit-survey-reminders] mail failed: ${t.email}`, e);
      }
    }

    if (!isDryRun()) await markReminderSent(t.exitId);
    processed++;
  }
  return processed;
}
