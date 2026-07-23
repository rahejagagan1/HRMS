// Sweeps every active employee on a PIP whose pipEndDate is within the next
// 7 days AND who hasn't been reminded for THIS end date, and emails brand HR
// + the employee's reporting manager, then stamps pipReminderSentAt.
//
// Re-arm: pipReminderSentAt is cleared whenever pipEndDate changes (HR edit
// or an approved extension), so the reminder re-arms cleanly.
// Raw SQL throughout — pip* columns lag the typed client.

import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email/sender";
import { pipEndingReminderEmail } from "@/lib/email/templates";
import { isDryRun } from "@/lib/email/transport";
import { isEmailEnabled, devEmailRecipientsClause, rolesForUser, isEmailEnabledForRoles } from "@/lib/email/toggles";

const REMINDER_LEAD_DAYS = 7;

type DueRow = {
  userId: number;
  employeeId: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  pipStartedAt: Date | null;
  pipEndDate: Date;
  pipReason: string | null;
  department: string | null;
  businessUnit: string | null;
  managerId: number | null;
  managerName: string | null;
  managerEmail: string | null;
  userName: string | null;
};

export async function sendPipEndingReminders(): Promise<number> {
  if (!(await isEmailEnabled("pip_reminders"))) {
    console.log("[pip-reminders] skipped — disabled in admin toggles");
    return 0;
  }

  const upper = new Date(Date.now() + REMINDER_LEAD_DAYS * 24 * 60 * 60 * 1000);

  const due = await prisma.$queryRawUnsafe<DueRow[]>(
    `SELECT u.id AS "userId",
            ep."employeeId", ep."firstName", ep."middleName", ep."lastName",
            ep."pipStartedAt", ep."pipEndDate", ep."pipReason",
            ep."department", ep."businessUnit",
            u."managerId", m.name AS "managerName", m.email AS "managerEmail",
            u.name AS "userName"
       FROM "EmployeeProfile" ep
       JOIN "User" u ON u.id = ep."userId"
       LEFT JOIN "User" m ON m.id = u."managerId"
      WHERE u."isActive" = true
        AND ep."pipStartedAt" IS NOT NULL
        AND ep."pipEndDate" IS NOT NULL
        AND ep."pipEndDate" >= NOW()
        AND ep."pipEndDate" <= $1
        AND ep."pipReminderSentAt" IS NULL
      ORDER BY ep."pipEndDate" ASC`,
    upper,
  );
  if (due.length === 0) return 0;

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

  const filteredHR = [] as typeof hrRecipients;
  for (const r of hrRecipients) {
    if (!r.email) continue;
    const roles = rolesForUser({ orgLevel: r.orgLevel, role: r.role });
    if (await isEmailEnabledForRoles("pip_reminders", roles)) filteredHR.push(r);
  }

  let processed = 0;
  for (const row of due) {
    const fullName = [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" ").trim()
      || row.userName || `User #${row.userId}`;
    const daysRemaining = Math.max(0, Math.ceil((row.pipEndDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));

    const empBrand = row.businessUnit || "NB Media";
    const brandedHR = filteredHR.filter((h) => (h.employeeProfile?.businessUnit || "NB Media") === empBrand);
    const recipients = new Map<string, { name: string | null; email: string }>();
    for (const h of brandedHR) if (h.email) recipients.set(h.email.toLowerCase(), { name: h.name, email: h.email });
    if (row.managerEmail) recipients.set(row.managerEmail.toLowerCase(), { name: row.managerName, email: row.managerEmail });
    if (recipients.size === 0) {
      console.warn(`[pip-reminders] no recipients for user #${row.userId} (${fullName}) — skipping`);
      continue;
    }

    let anySent = false;
    for (const r of recipients.values()) {
      try {
        await sendEmail({
          to: r.email,
          content: pipEndingReminderEmail({
            recipientName:  r.name ?? null,
            employeeName:   fullName,
            employeeId:     row.employeeId,
            pipStartedAt:   row.pipStartedAt,
            pipEndDate:     row.pipEndDate,
            daysRemaining,
            managerName:    row.managerName,
            department:     row.department,
            reason:         row.pipReason,
            employeeUserId: row.userId,
          }),
        });
        anySent = true;
      } catch (e) {
        console.warn(`[pip-reminders] mail failed: ${r.email}`, e);
      }
    }

    if (anySent && !isDryRun()) {
      await prisma.$executeRawUnsafe(
        `UPDATE "EmployeeProfile" SET "pipReminderSentAt" = NOW() WHERE "userId" = $1`,
        row.userId,
      );
    }
    if (anySent) processed++;
  }
  return processed;
}
