// PIP (Performance Improvement Plan) review workflow — mirrors the probation
// review flow. ~14 days before pipEndDate (or for any open-ended active plan)
// the manager sees the report in My Team → PIP Reviews, leaves feedback, and
// picks one recommendation — extend / pass / end. That creates a PENDING
// PerformancePlanReview and notifies HR. HR approves or rejects:
//   • extend → push pipEndDate (re-arms reminders)
//   • pass   → clear the plan (pipStartedAt/pipEndDate = NULL → ON PIP badge drops)
//   • end    → deactivate the user (isActive = false)
//
// Raw SQL throughout — the typed client lags the table + pip* columns.

import prisma from "@/lib/prisma";
import { userIdsWithPermission } from "@/lib/permissions/resolve-permissions";

export const REVIEW_WINDOW_DAYS = 14;
export type Recommendation = "extend" | "pass" | "end";
const VALID_MONTHS = [1, 3, 6];

function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}
function daysUntil(d: Date | string | null): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
}

// Brand scope for the HR dashboard's per-brand sub-views (mirrors the
// probation lib). "YT Labs" exact; "NB Media" = not-YT-Labs (incl. null);
// all/none = no filter. Fixed literals only — safe to inline.
function brandFilterSql(brand: string | null | undefined, ep = "ep"): string {
  if (brand === "YT Labs") return ` AND ${ep}."businessUnit" = 'YT Labs'`;
  if (brand === "NB Media") return ` AND (${ep}."businessUnit" IS DISTINCT FROM 'YT Labs')`;
  return "";
}

// RBAC-designation-driven (policy 2026-07-14): fans out to MANAGE_HR
// designation-holders (CEO/special_access designations excluded); legacy
// rows kept as a fallback for users without designations.
async function hrRecipientIds(): Promise<number[]> {
  const [byPerm, legacy] = await Promise.all([
    userIdsWithPermission("MANAGE_HR", { excludeDesignationKeys: ["ceo", "ceo_yt_labs", "special_access"] }),
    prisma.$queryRawUnsafe<{ id: number }[]>(
      `SELECT id FROM "User"
        WHERE "isActive" = true AND ("orgLevel" = 'special_access' OR role = 'hr_manager')`,
    ),
  ]);
  return Array.from(new Set([...byPerm, ...legacy.map((r) => r.id)]));
}

async function notify(userIds: number[], title: string, body: string, linkUrl: string): Promise<boolean> {
  const ids = Array.from(new Set(userIds)).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return false;
  try {
    await prisma.notification.createMany({
      data: ids.map((userId) => ({ userId, type: "performance_plan_review", title, body, linkUrl })),
    });
    return true;
  } catch (e) {
    console.warn("[pip-review] notify failed:", (e as any)?.message);
    return false;
  }
}

// Window predicate shared by the manager list + count: on an active plan,
// and either open-ended or ending within the review window (and not long past).
const WINDOW_SQL = `
  ep."pipStartedAt" IS NOT NULL
  AND (
    ep."pipEndDate" IS NULL
    OR (ep."pipEndDate" >= (NOW() - INTERVAL '60 days')
        AND ep."pipEndDate" <= (NOW() + ($WINDOW$::int * INTERVAL '1 day')))
  )`;

// ── Manager view: their reports on a PIP that's ending / open ────────
export async function listManagerPipReviews(managerId: number): Promise<any[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.id AS "userId", u.name,
            ep."employeeId", ep.designation, ep."pipEndDate", ep."pipReason",
            r.id AS "reviewId", r.recommendation, r.status AS "reviewStatus",
            r."extendMonths", r."proposedEndDate", r.feedback, r."hrNote", r."createdAt" AS "reviewCreatedAt"
       FROM "User" u
       JOIN "EmployeeProfile" ep ON ep."userId" = u.id
       LEFT JOIN LATERAL (
         SELECT * FROM "PerformancePlanReview" pr
          WHERE pr."employeeUserId" = u.id
          ORDER BY pr.id DESC LIMIT 1
       ) r ON true
      WHERE u."isActive" = true
        AND u."managerId" = $1
        AND ${WINDOW_SQL.replace("$WINDOW$", "$2")}
      ORDER BY ep."pipEndDate" ASC NULLS LAST`,
    managerId, REVIEW_WINDOW_DAYS,
  );
  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    employeeId: r.employeeId ?? null,
    designation: r.designation ?? null,
    pipEndDate: r.pipEndDate ? new Date(r.pipEndDate).toISOString() : null,
    pipReason: r.pipReason ?? null,
    daysRemaining: daysUntil(r.pipEndDate),
    review: r.reviewId
      ? {
          id: r.reviewId,
          recommendation: r.recommendation,
          status: r.reviewStatus,
          extendMonths: r.extendMonths ?? null,
          proposedEndDate: r.proposedEndDate ? new Date(r.proposedEndDate).toISOString() : null,
          feedback: r.feedback,
          hrNote: r.hrNote ?? null,
          createdAt: new Date(r.reviewCreatedAt).toISOString(),
        }
      : null,
  }));
}

export async function pendingManagerPipCount(managerId: number): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(
    `SELECT COUNT(*)::int AS count
       FROM "User" u
       JOIN "EmployeeProfile" ep ON ep."userId" = u.id
      WHERE u."isActive" = true AND u."managerId" = $1
        AND ${WINDOW_SQL.replace("$WINDOW$", "$2")}
        AND NOT EXISTS (
          SELECT 1 FROM "PerformancePlanReview" pr
           WHERE pr."employeeUserId" = u.id AND pr.status = 'pending'
        )`,
    managerId, REVIEW_WINDOW_DAYS,
  );
  return rows[0]?.count ?? 0;
}

// ── HR view: pending recommendations awaiting approval ───────────────
export async function listPendingHrPipReviews(brand?: string | null): Promise<any[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT pr.id, pr."employeeUserId", pr."managerId", pr.recommendation,
            pr."extendMonths", pr."proposedEndDate", pr.feedback, pr."createdAt",
            e.name AS "employeeName", e."profilePictureUrl", ep."employeeId", ep.designation, ep."pipEndDate",
            m.name AS "managerName"
       FROM "PerformancePlanReview" pr
       JOIN "User" e ON e.id = pr."employeeUserId"
       LEFT JOIN "EmployeeProfile" ep ON ep."userId" = pr."employeeUserId"
       LEFT JOIN "User" m ON m.id = pr."managerId"
      WHERE pr.status = 'pending'${brandFilterSql(brand)}
      ORDER BY pr."createdAt" ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    employeeUserId: r.employeeUserId,
    employeeName: r.employeeName,
    profilePictureUrl: r.profilePictureUrl ?? null,
    employeeId: r.employeeId ?? null,
    designation: r.designation ?? null,
    managerId: r.managerId,
    managerName: r.managerName ?? null,
    recommendation: r.recommendation as Recommendation,
    extendMonths: r.extendMonths ?? null,
    proposedEndDate: r.proposedEndDate ? new Date(r.proposedEndDate).toISOString() : null,
    pipEndDate: r.pipEndDate ? new Date(r.pipEndDate).toISOString() : null,
    daysRemaining: daysUntil(r.pipEndDate),
    feedback: r.feedback,
    createdAt: new Date(r.createdAt).toISOString(),
  }));
}

export async function listManagerPipHistory(managerId: number): Promise<any[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT pr.id, pr."employeeUserId", pr.recommendation, pr."extendMonths", pr."proposedEndDate",
            pr.feedback, pr.status, pr."hrNote", pr."decidedAt",
            e.name AS "employeeName", ep.designation, ep."employeeId"
       FROM "PerformancePlanReview" pr
       JOIN "User" e ON e.id = pr."employeeUserId"
       LEFT JOIN "EmployeeProfile" ep ON ep."userId" = pr."employeeUserId"
      WHERE pr."managerId" = $1 AND pr.status IN ('approved','rejected')
      ORDER BY COALESCE(pr."decidedAt", pr."createdAt") DESC LIMIT 50`, managerId);
  return rows.map((r) => ({
    id: r.id, employeeUserId: r.employeeUserId, employeeName: r.employeeName,
    employeeId: r.employeeId ?? null, designation: r.designation ?? null,
    recommendation: r.recommendation as Recommendation, extendMonths: r.extendMonths ?? null,
    proposedEndDate: r.proposedEndDate ? new Date(r.proposedEndDate).toISOString() : null,
    status: r.status, feedback: r.feedback, hrNote: r.hrNote ?? null,
    decidedAt: r.decidedAt ? new Date(r.decidedAt).toISOString() : null,
  }));
}

export async function listHrPipHistory(brand?: string | null): Promise<any[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT pr.id, pr."employeeUserId", pr.recommendation, pr."extendMonths", pr."proposedEndDate",
            pr.feedback, pr.status, pr."hrNote", pr."decidedAt",
            e.name AS "employeeName", e."isActive" AS "employeeActive",
            ep.designation, ep."employeeId", ep."pipStartedAt",
            m.name AS "managerName", d.name AS "deciderName"
       FROM "PerformancePlanReview" pr
       JOIN "User" e ON e.id = pr."employeeUserId"
       LEFT JOIN "EmployeeProfile" ep ON ep."userId" = pr."employeeUserId"
       LEFT JOIN "User" m ON m.id = pr."managerId"
       LEFT JOIN "User" d ON d.id = pr."decidedById"
      WHERE pr.status IN ('approved','rejected')${brandFilterSql(brand)}
      ORDER BY COALESCE(pr."decidedAt", pr."createdAt") DESC LIMIT 100`);
  return rows.map((r) => ({
    id: r.id, employeeUserId: r.employeeUserId, employeeName: r.employeeName,
    employeeActive: r.employeeActive, employeeId: r.employeeId ?? null, designation: r.designation ?? null,
    managerName: r.managerName ?? null, deciderName: r.deciderName ?? null,
    recommendation: r.recommendation as Recommendation, extendMonths: r.extendMonths ?? null,
    proposedEndDate: r.proposedEndDate ? new Date(r.proposedEndDate).toISOString() : null,
    status: r.status, feedback: r.feedback, hrNote: r.hrNote ?? null,
    decidedAt: r.decidedAt ? new Date(r.decidedAt).toISOString() : null,
    onPlan: !!r.pipStartedAt,
  }));
}

// ── Full roster of everyone currently on a PIP (HR visibility) ──────
export async function listOnPipEmployees(brand?: string | null): Promise<any[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.id AS "userId", u.name,
            ep.designation, COALESCE(ep."businessUnit", 'NB Media') AS "businessUnit",
            ep."pipStartedAt", ep."pipEndDate", ep."pipReason",
            m.name AS "managerName", rb.name AS "reportedByName",
            (SELECT pr.status FROM "PerformancePlanReview" pr WHERE pr."employeeUserId" = u.id ORDER BY pr.id DESC LIMIT 1) AS "lastReviewStatus"
       FROM "EmployeeProfile" ep
       JOIN "User" u ON u.id = ep."userId"
       LEFT JOIN "User" m ON m.id = u."managerId"
       LEFT JOIN "User" rb ON rb.id = ep."pipReportedById"
      WHERE u."isActive" = true
        AND ep."pipStartedAt" IS NOT NULL
        AND (ep."pipEndDate" IS NULL OR ep."pipEndDate" >= CURRENT_DATE)${brandFilterSql(brand)}
      ORDER BY ep."pipEndDate" ASC NULLS LAST`);
  return rows.map((r) => ({
    userId: r.userId, name: r.name,
    designation: r.designation ?? null, businessUnit: r.businessUnit,
    managerName: r.managerName ?? null, reportedByName: r.reportedByName ?? null,
    pipStartedAt: r.pipStartedAt ? new Date(r.pipStartedAt).toISOString() : null,
    pipEndDate: r.pipEndDate ? new Date(r.pipEndDate).toISOString() : null,
    daysRemaining: daysUntil(r.pipEndDate),
    pipReason: r.pipReason ?? null,
    lastReviewStatus: r.lastReviewStatus ?? null,
  }));
}

// ── Manager submits a recommendation ─────────────────────────────────
export async function submitPipReview(params: {
  employeeUserId: number;
  managerId: number;
  recommendation: Recommendation;
  extendMonths?: number | null;
  proposedEndDate?: string | null;
  feedback: string;
}): Promise<{ id: number }> {
  const { employeeUserId, managerId, recommendation } = params;
  const feedback = (params.feedback ?? "").trim();
  if (!["extend", "pass", "end"].includes(recommendation)) throw new Error("Invalid recommendation");
  if (!feedback) throw new Error("Feedback is required");
  if (!Number.isInteger(managerId) || managerId <= 0) throw new Error("Employee has no reporting manager");

  const empRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.name, u."isActive", ep."pipStartedAt"
       FROM "User" u LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
      WHERE u.id = $1`, employeeUserId);
  const emp = empRows[0];
  if (!emp) throw new Error("Employee not found");
  if (emp.isActive === false) throw new Error("Employee is not active");
  if (!emp.pipStartedAt) throw new Error("Employee is not on a performance plan");

  let extendMonths: number | null = null;
  let proposedEndDate: string | null = null;
  if (recommendation === "extend") {
    if (params.proposedEndDate) {
      const d = new Date(params.proposedEndDate);
      if (Number.isNaN(d.getTime())) throw new Error("Invalid extension date");
      if (d.getTime() <= Date.now()) throw new Error("Extension date must be in the future");
      proposedEndDate = params.proposedEndDate;
    } else if (params.extendMonths && VALID_MONTHS.includes(Number(params.extendMonths))) {
      extendMonths = Number(params.extendMonths);
    } else {
      throw new Error("Pick how long to extend (1 / 3 / 6 months or a custom date)");
    }
  }

  const id = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`DELETE FROM "PerformancePlanReview" WHERE "employeeUserId" = $1 AND status = 'pending'`, employeeUserId);
    const ins = await tx.$queryRawUnsafe<{ id: number }[]>(
      `INSERT INTO "PerformancePlanReview"
         ("employeeUserId","managerId","recommendation","extendMonths","proposedEndDate","feedback","status","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW())
       RETURNING id`,
      employeeUserId, managerId, recommendation, extendMonths, proposedEndDate, feedback);
    return ins[0]?.id as number;
  });

  const label = recommendation === "extend" ? "extend the plan" : recommendation === "pass" ? "mark as passed" : "end employment";
  await notify(
    await hrRecipientIds(),
    `PIP review: ${emp.name ?? `User #${employeeUserId}`}`,
    `Reporting manager recommends to ${label}. Review it on the HR dashboard.`,
    "/dashboard/hr/home",
  );
  return { id };
}

// ── HR decides ───────────────────────────────────────────────────────
export async function decidePipReview(params: {
  reviewId: number;
  hrUserId: number;
  decision: "approve" | "reject";
  hrNote?: string | null;
}): Promise<{ ok: true }> {
  const { reviewId, hrUserId, decision } = params;
  const hrNote = (params.hrNote ?? "").trim() || null;

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT pr.*, ep."pipEndDate"
       FROM "PerformancePlanReview" pr
       LEFT JOIN "EmployeeProfile" ep ON ep."userId" = pr."employeeUserId"
      WHERE pr.id = $1`,
    reviewId,
  );
  const r = rows[0];
  if (!r) throw new Error("Review not found");
  if (r.status !== "pending") throw new Error("This review was already decided");
  const employeeUserId = r.employeeUserId as number;

  if (decision === "approve") {
    if (r.recommendation === "extend") {
      const base = r.pipEndDate ? new Date(r.pipEndDate) : new Date();
      const newEnd = r.proposedEndDate ? new Date(r.proposedEndDate) : addMonths(base, Number(r.extendMonths) || 1);
      await prisma.$executeRawUnsafe(
        `UPDATE "EmployeeProfile"
            SET "pipEndDate" = $2, "pipReminderSentAt" = NULL, "pipManagerNotifiedAt" = NULL
          WHERE "userId" = $1`,
        employeeUserId, newEnd,
      );
    } else if (r.recommendation === "pass") {
      // Cleared the plan — ON PIP badge drops.
      await prisma.$executeRawUnsafe(
        `UPDATE "EmployeeProfile"
            SET "pipStartedAt" = NULL, "pipEndDate" = NULL,
                "pipReminderSentAt" = NULL, "pipManagerNotifiedAt" = NULL
          WHERE "userId" = $1`,
        employeeUserId,
      );
    } else if (r.recommendation === "end") {
      await prisma.$executeRawUnsafe(`UPDATE "User" SET "isActive" = false WHERE id = $1`, employeeUserId);
    } else {
      throw new Error(`Unknown recommendation: ${r.recommendation}`);
    }
  }

  await prisma.$executeRawUnsafe(
    `UPDATE "PerformancePlanReview"
        SET status = $2, "decidedById" = $3, "decidedAt" = NOW(), "hrNote" = $4, "updatedAt" = NOW()
      WHERE id = $1`,
    reviewId, decision === "approve" ? "approved" : "rejected", hrUserId, hrNote,
  );

  const emp = await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM "User" WHERE id = $1`, employeeUserId);
  const verb = decision === "approve" ? "approved" : "sent back";
  await notify(
    [r.managerId as number],
    `PIP review ${verb}: ${emp[0]?.name ?? `User #${employeeUserId}`}`,
    decision === "approve"
      ? "HR approved your recommendation and applied it."
      : `HR sent your recommendation back${hrNote ? `: ${hrNote}` : "."}`,
    "/dashboard/hr/my-team/pip",
  );
  return { ok: true };
}

// ── Cron: in-app nudge to reporting managers (dedupe pipManagerNotifiedAt) ──
export async function sweepPipManagerNotifications(): Promise<number> {
  const due = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.id AS "userId", u.name, u."managerId"
       FROM "User" u
       JOIN "EmployeeProfile" ep ON ep."userId" = u.id
      WHERE u."isActive" = true
        AND u."managerId" IS NOT NULL
        AND ep."pipStartedAt" IS NOT NULL
        AND ep."pipManagerNotifiedAt" IS NULL
        AND ep."pipEndDate" IS NOT NULL
        AND ep."pipEndDate" >= (NOW() - INTERVAL '60 days')
        AND ep."pipEndDate" <= (NOW() + ($1::int * INTERVAL '1 day'))`,
    REVIEW_WINDOW_DAYS,
  );
  let processed = 0;
  for (const row of due) {
    const sent = await notify(
      [row.managerId],
      `PIP review due: ${row.name}`,
      "Their performance plan is ending soon — leave feedback and recommend extend / pass / end in My Team → PIP Reviews.",
      "/dashboard/hr/my-team/pip",
    );
    if (sent) {
      await prisma.$executeRawUnsafe(
        `UPDATE "EmployeeProfile" SET "pipManagerNotifiedAt" = NOW() WHERE "userId" = $1`,
        row.userId,
      );
      processed++;
    }
  }
  return processed;
}
