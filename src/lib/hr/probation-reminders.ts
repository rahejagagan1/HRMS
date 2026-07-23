// Sweeps every active employee whose probationEndDate is within the
// next 7 days AND who hasn't already had the reminder sent for THIS
// end-date. For each one, emails HR (special_access + role=hr_manager
// + devs if dev_emails is on) PLUS the employee's reporting manager,
// then stamps probationReminderSentAt = NOW().
//
// Re-arm rule: probationReminderSentAt gets cleared automatically by
// the People PATCH route whenever HR edits probationEndDate, so an
// extension naturally re-arms the reminder for the new end date.
// (See src/app/api/hr/people/[id]/route.ts.)
//
// Idempotent: running the cron multiple times in a 24h window is a
// no-op for already-reminded rows. Raw SQL throughout so this works
// without a fresh prisma generate cycle.

import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email/sender";
import { probationEndingReminderEmail } from "@/lib/email/templates";
import { isDryRun } from "@/lib/email/transport";
import { isEmailEnabled, devEmailRecipientsClause, rolesForUser, isEmailEnabledForRoles } from "@/lib/email/toggles";
import { notExitedSql } from "@/lib/hr/probation-review";

// Reminder milestones: HR + the reporting manager get a heads-up when
// probation ends in exactly 14, 7, and 1 day(s). Each fires once (same-day
// dedupe via probationReminderSentAt), so an employee gets up to three nudges
// as the date approaches. Keep these here so tuning the cadence is one-line.
const REMINDER_MILESTONES = [14, 7, 1];

type DueRow = {
  userId: number;
  employeeId: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  joiningDate: Date | null;
  probationEndDate: Date;
  department: string | null;
  businessUnit: string | null;
  managerId: number | null;
  managerName: string | null;
  managerEmail: string | null;
  userName: string | null;
  userEmail: string | null;
};

export async function sendProbationEndingReminders(): Promise<number> {
  if (!(await isEmailEnabled("probation_reminders"))) {
    console.log("[probation-reminders] skipped — disabled in admin toggles");
    return 0;
  }

  // Fire when the probation end date is EXACTLY one of the milestones away
  // (14 / 7 / 1 day). Same-day dedupe: only send if we haven't already stamped
  // a reminder today, so the daily cron never double-sends within a milestone —
  // yet each distinct milestone day (which are separate calendar days) still
  // gets its own nudge. probationReminderSentAt is cleared whenever HR edits
  // the end date, so an extension re-arms all three milestones cleanly.
  const milestoneList = REMINDER_MILESTONES.join(", "); // e.g. "14, 7, 1"

  const due = await prisma.$queryRawUnsafe<DueRow[]>(
    `SELECT u.id AS "userId",
            ep."employeeId",
            ep."firstName", ep."middleName", ep."lastName",
            ep."joiningDate",
            ep."probationEndDate",
            ep."department", ep."businessUnit",
            u."managerId",
            m.name  AS "managerName",
            m.email AS "managerEmail",
            u.name  AS "userName",
            u.email AS "userEmail"
       FROM "EmployeeProfile" ep
       JOIN "User" u ON u.id = ep."userId"
       LEFT JOIN "User" m ON m.id = u."managerId"
      WHERE u."isActive" = true
        AND ep."probationEndDate" IS NOT NULL
        AND ep."probationConfirmedAt" IS NULL
        AND (ep."probationEndDate"::date - CURRENT_DATE) IN (${milestoneList})
        AND (ep."probationReminderSentAt" IS NULL OR ep."probationReminderSentAt"::date < CURRENT_DATE)${notExitedSql()}
      ORDER BY ep."probationEndDate" ASC`,
  );
  if (due.length === 0) return 0;

  // HR + admin recipients shared across all rows. Brand-scope the
  // CEO equivalent — each affected employee's brand-CEO gets a copy.
  // Note: this reminder isn't a CEO-direct concern usually, but keep
  // the routing consistent with the violation reminders so HR can
  // tell the whole admin chain saw it.
  const hrRecipients = await prisma.user.findMany({
    where: {
      isActive: true,
      orgLevel: { not: "ceo" },
      OR: [
        { orgLevel: { in: ["special_access"] } },
        { role: "hr_manager" },
        ...(await devEmailRecipientsClause()),
      ],
    },
    select: { id: true, name: true, email: true, orgLevel: true, role: true, employeeProfile: { select: { businessUnit: true } } },
  });

  // Per-role toggle filter — drop recipients whose role override for
  // probation_reminders is OFF.
  const filteredHR = [] as typeof hrRecipients;
  for (const r of hrRecipients) {
    if (!r.email) continue;
    const roles = rolesForUser({ orgLevel: r.orgLevel, role: r.role });
    if (await isEmailEnabledForRoles("probation_reminders", roles)) filteredHR.push(r);
  }

  let processed = 0;
  for (const row of due) {
    const fullName = [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" ").trim()
      || row.userName
      || `User #${row.userId}`;

    const daysRemaining = Math.max(
      0,
      Math.ceil((row.probationEndDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    );

    // Recipients for THIS row: brand-scoped HR + the affected
    // employee's reporting manager (deduped by email so a manager
    // who's also HR doesn't get two copies).
    const empBrand = row.businessUnit || "NB Media";
    const brandedHR = filteredHR.filter((h) => (h.employeeProfile?.businessUnit || "NB Media") === empBrand);
    const recipients = new Map<string, { name: string | null; email: string }>();
    for (const h of brandedHR) {
      if (h.email) recipients.set(h.email.toLowerCase(), { name: h.name, email: h.email });
    }
    if (row.managerEmail) {
      recipients.set(row.managerEmail.toLowerCase(), { name: row.managerName, email: row.managerEmail });
    }
    if (recipients.size === 0) {
      console.warn(`[probation-reminders] no recipients for user #${row.userId} (${fullName}) — skipping`);
      continue;
    }

    let anySent = false;
    for (const r of recipients.values()) {
      try {
        await sendEmail({
          to: r.email,
          content: probationEndingReminderEmail({
            recipientName:    r.name ?? null,
            employeeName:     fullName,
            employeeId:       row.employeeId,
            joiningDate:      row.joiningDate,
            probationEndDate: row.probationEndDate,
            daysRemaining,
            managerName:      row.managerName,
            department:       row.department,
            employeeUserId:   row.userId,
          }),
        });
        anySent = true;
      } catch (e) {
        console.warn(`[probation-reminders] mail failed: ${r.email}`, e);
      }
    }

    // Stamp only if at least one email actually went out — partial
    // sends still count (the cron's purpose is "the system tried";
    // re-sending would spam the recipients who DID get it).
    if (anySent && !isDryRun()) {
      await prisma.$executeRawUnsafe(
        `UPDATE "EmployeeProfile" SET "probationReminderSentAt" = NOW() WHERE "userId" = $1`,
        row.userId,
      );
    }
    if (anySent) processed++;
  }
  return processed;
}
