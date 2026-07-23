// Effective-dated reporting-manager changes.
//
// HR schedules a future reporting manager for an employee from the
// Edit Profile → Job & Work section. A row sits in
// "ManagerChangeSchedule" (status='pending') until its effectiveDate
// (an IST calendar day) arrives, at which point the daily
// `reporting_manager_changes` cron flips User.managerId, marks the row
// 'applied', and notifies the employee + new manager + brand HR.
//
// Raw SQL throughout: the typed Prisma client lags behind new
// tables/columns on the dev + VPS boxes (Windows DLL lock blocks
// `prisma generate`) — same pattern as probation-reminders /
// inlineManager. One pending change per employee: scheduling a new one
// supersedes (cancels) any existing pending row.

import prisma from "@/lib/prisma";
import { istTodayDateOnly } from "@/lib/ist-date";
import { sendEmail } from "@/lib/email/sender";
import { managerChangeAppliedEmail } from "@/lib/email/templates";

export type PendingManagerChange = {
  id: number;
  userId: number;
  newManagerId: number;
  newManagerName: string | null;
  effectiveDate: string; // YYYY-MM-DD
  note: string | null;
  createdAt: string;
};

/** The single pending change for an employee (earliest effective), or null. */
export async function getPendingManagerChange(userId: number): Promise<PendingManagerChange | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT mcs.id, mcs."userId", mcs."newManagerId",
              m.name AS "newManagerName",
              to_char(mcs."effectiveDate", 'YYYY-MM-DD') AS "effectiveDate",
              mcs.note,
              to_char(mcs."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS') AS "createdAt"
         FROM "ManagerChangeSchedule" mcs
         LEFT JOIN "User" m ON m.id = mcs."newManagerId"
        WHERE mcs."userId" = $1 AND mcs.status = 'pending'
        ORDER BY mcs."effectiveDate" ASC
        LIMIT 1`,
      userId,
    );
    return rows[0] ?? null;
  } catch (e) {
    console.warn("[manager-changes] getPending failed (table missing?):", e);
    return null;
  }
}

/**
 * Schedule (or reschedule) a future manager change. Supersedes any
 * existing pending row for this employee (one-pending-at-a-time).
 * Returns the freshly-created pending row.
 */
export async function scheduleManagerChange(args: {
  userId: number;
  newManagerId: number;
  effectiveDate: string; // YYYY-MM-DD (IST calendar day)
  createdBy: number | null;
  note?: string | null;
}): Promise<PendingManagerChange | null> {
  await prisma.$executeRawUnsafe(
    `UPDATE "ManagerChangeSchedule" SET status = 'cancelled'
      WHERE "userId" = $1 AND status = 'pending'`,
    args.userId,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ManagerChangeSchedule"
       ("userId", "newManagerId", "effectiveDate", "status", "note", "createdBy", "createdAt")
     VALUES ($1, $2, $3::date, 'pending', $4, $5, NOW())`,
    args.userId, args.newManagerId, args.effectiveDate, args.note ?? null, args.createdBy,
  );
  return getPendingManagerChange(args.userId);
}

/** Cancel the pending change for an employee. Returns rows affected. */
export async function cancelPendingManagerChange(userId: number): Promise<number> {
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "ManagerChangeSchedule" SET status = 'cancelled'
      WHERE "userId" = $1 AND status = 'pending'`,
    userId,
  );
  return Number(n) || 0;
}

type DueRow = {
  id: number;
  userId: number;
  newManagerId: number;
  userName: string | null;
  userEmail: string | null;
  employeeId: string | null;
  businessUnit: string | null;
  oldManagerName: string | null;
  newManagerName: string | null;
  newManagerEmail: string | null;
  effectiveDate: string;
};

/**
 * Cron runner: apply every pending change whose effectiveDate has
 * arrived (IST). Idempotent — the status flip to 'applied' is guarded on
 * status='pending', so a second run the same day is a no-op and
 * concurrent runs can't double-apply.
 */
export async function applyDueManagerChanges(): Promise<number> {
  const today = istTodayDateOnly();
  let due: DueRow[] = [];
  try {
    due = await prisma.$queryRawUnsafe<DueRow[]>(
      `SELECT mcs.id, mcs."userId", mcs."newManagerId",
              to_char(mcs."effectiveDate", 'YYYY-MM-DD') AS "effectiveDate",
              u.name  AS "userName", u.email AS "userEmail",
              ep."employeeId", ep."businessUnit",
              om.name AS "oldManagerName",
              nm.name AS "newManagerName", nm.email AS "newManagerEmail"
         FROM "ManagerChangeSchedule" mcs
         JOIN "User" u ON u.id = mcs."userId"
         LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
         LEFT JOIN "User" om ON om.id = u."managerId"
         LEFT JOIN "User" nm ON nm.id = mcs."newManagerId"
        WHERE mcs.status = 'pending'
          AND mcs."effectiveDate" <= $1
          AND u."isActive" = true
        ORDER BY mcs."effectiveDate" ASC`,
      today,
    );
  } catch (e) {
    console.warn("[manager-changes] due lookup failed (table missing?):", e);
    return 0;
  }
  if (due.length === 0) return 0;

  let applied = 0;
  for (const row of due) {
    try {
      // Claim the row first (guarded on still-pending). If 0 rows are
      // updated, another run already applied it — skip.
      const claimed = await prisma.$executeRawUnsafe(
        `UPDATE "ManagerChangeSchedule"
            SET status = 'applied', "appliedAt" = NOW()
          WHERE id = $1 AND status = 'pending'`,
        row.id,
      );
      if (!Number(claimed)) continue;
      await prisma.$executeRawUnsafe(
        `UPDATE "User" SET "managerId" = $1 WHERE id = $2`,
        row.newManagerId, row.userId,
      );
      applied++;
    } catch (e) {
      console.warn(`[manager-changes] apply failed for row #${row.id}:`, e);
      continue;
    }

    // Notify — best-effort; never blocks/undoes the applied change.
    try {
      await notifyManagerChangeApplied(row);
    } catch (e) {
      console.warn(`[manager-changes] notify failed for row #${row.id}:`, e);
    }
  }
  return applied;
}

async function notifyManagerChangeApplied(row: DueRow): Promise<void> {
  const empBrand = row.businessUnit || "NB Media";

  // Brand HR: orgLevel hr_manager / special_access OR role hr_manager.
  // Selected broadly then brand-filtered in JS (mirrors the
  // probation-reminders recipient pattern).
  const hrAll = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [
        { orgLevel: { in: ["hr_manager", "special_access"] } },
        { role: "hr_manager" },
      ],
    },
    select: { name: true, email: true, employeeProfile: { select: { businessUnit: true } } },
  });
  const hr = hrAll.filter((h) => (h.employeeProfile?.businessUnit || "NB Media") === empBrand);

  // Dedup by lowercased email so a manager who's also HR gets one copy.
  const recipients = new Map<string, { name: string | null; email: string }>();
  if (row.userEmail)       recipients.set(row.userEmail.toLowerCase(),       { name: row.userName,       email: row.userEmail });
  if (row.newManagerEmail) recipients.set(row.newManagerEmail.toLowerCase(), { name: row.newManagerName, email: row.newManagerEmail });
  for (const h of hr) if (h.email) recipients.set(h.email.toLowerCase(), { name: h.name, email: h.email });

  for (const r of recipients.values()) {
    try {
      await sendEmail({
        to: r.email,
        content: managerChangeAppliedEmail({
          recipientName:  r.name,
          employeeName:   row.userName ?? `User #${row.userId}`,
          employeeId:     row.employeeId,
          oldManagerName: row.oldManagerName,
          newManagerName: row.newManagerName ?? `User #${row.newManagerId}`,
          effectiveDate:  row.effectiveDate,
          employeeUserId: row.userId,
        }),
      });
    } catch (e) {
      console.warn(`[manager-changes] mail failed: ${r.email}`, e);
    }
  }
}
