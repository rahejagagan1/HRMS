// Probation review workflow.
//
// Flow: ~14 days before an employee's probationEndDate the daily cron pings
// their reporting manager (in-app notification + the My Team → Probation
// Reviews tab). The manager records a recommendation — extend / confirm as
// full-time / end employment — plus required feedback. That creates a
// PENDING ProbationReview and notifies HR. HR approves or rejects from the
// dashboard; approval APPLIES the action:
//   • extend  → push probationEndDate (re-arms reminders)
//   • confirm → stamp probationConfirmedAt + auto-generate the Probation
//               Confirmation letter into the employee's Documents
//   • end     → deactivate the user (isActive = false)
//
// Raw SQL throughout — the typed Prisma client lags the ProbationReview
// table + the new EmployeeProfile columns.

import prisma from "@/lib/prisma";
import { userIdsWithPermission } from "@/lib/permissions/resolve-permissions";
import { renderLetterHtml, wrapLetterPreviewHtml } from "@/lib/hr/letter-render";
import { htmlToPdf } from "@/lib/hr/html-to-pdf";

// How far ahead the manager sees an upcoming probation in their tab. Wider
// than the 7-day reminder email so managers have lead time to decide.
export const REVIEW_WINDOW_DAYS = 14;

export type Recommendation = "extend" | "confirm" | "end";
const VALID_MONTHS = [1, 3, 6];

function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}

function daysUntil(d: Date | string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Math.ceil((t - Date.now()) / 86_400_000);
}

// Brand scope for the HR dashboard's per-brand sub-views. "YT Labs" is an
// exact match; "NB Media" is everything-not-YT-Labs (incl. null / legacy);
// anything else (all / none) applies no filter. Fixed literals only — safe
// to inline into the raw query.
export function brandFilterSql(brand: string | null | undefined, ep = "ep"): string {
  if (brand === "YT Labs") return ` AND ${ep}."businessUnit" = 'YT Labs'`;
  if (brand === "NB Media") return ` AND (${ep}."businessUnit" IS DISTINCT FROM 'YT Labs')`;
  return "";
}

// SQL guard shared by every probation list / sweep: excludes employees who
// are effectively gone even though isActive hasn't been flipped yet — an
// exit record finalised (exited / legacy offboarded) OR whose last working
// day has already passed. Matches the "Exited" badge rule used across the
// UI, so someone shown as Exited can never simultaneously sit in a
// probation queue. `u` = alias of the "User" table in the outer query.
// Fixed literal SQL only — safe to inline into raw queries.
export function notExitedSql(u = "u"): string {
  return ` AND NOT EXISTS (
        SELECT 1 FROM "EmployeeExit" ex
         WHERE ex."userId" = ${u}.id
           AND (ex.status IN ('exited','offboarded')
                OR ex."lastWorkingDay"::date < CURRENT_DATE)
      )`;
}

// ── Recipient lookups ───────────────────────────────────────────────
// RBAC-designation-driven (policy 2026-07-14): the HR decision queue fans
// out to MANAGE_HR designation-holders (CEO designations excluded — the CEO
// isn't an HR probation decider). Legacy special_access / role=hr_manager
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
      data: ids.map((userId) => ({ userId, type: "probation_review", title, body, linkUrl })),
    });
    return true;
  } catch (e) {
    console.warn("[probation-review] notify failed:", (e as any)?.message);
    return false;
  }
}

// ── Manager view: their reports whose probation is ending ────────────
export type ManagerReviewRow = {
  userId: number;
  name: string;
  employeeId: string | null;
  designation: string | null;
  probationEndDate: string | null;
  daysRemaining: number | null;
  review: null | {
    id: number;
    recommendation: Recommendation;
    status: "pending" | "approved" | "rejected";
    extendMonths: number | null;
    proposedEndDate: string | null;
    feedback: string;
    hrNote: string | null;
    createdAt: string;
  };
};

export async function listManagerProbationReviews(managerId: number): Promise<ManagerReviewRow[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.id AS "userId", u.name,
            ep."employeeId", ep.designation, ep."probationEndDate",
            r.id AS "reviewId", r.recommendation, r.status AS "reviewStatus",
            r."extendMonths", r."proposedEndDate", r.feedback, r."hrNote", r."createdAt" AS "reviewCreatedAt"
       FROM "User" u
       JOIN "EmployeeProfile" ep ON ep."userId" = u.id
       LEFT JOIN LATERAL (
         SELECT * FROM "ProbationReview" pr
          WHERE pr."employeeUserId" = u.id
          ORDER BY pr.id DESC LIMIT 1
       ) r ON true
      WHERE u."isActive" = true
        AND u."managerId" = $1
        AND ep."probationEndDate" IS NOT NULL
        AND ep."probationConfirmedAt" IS NULL
        AND ep."probationEndDate" >= (NOW() - INTERVAL '60 days')
        AND ep."probationEndDate" <= (NOW() + ($2::int * INTERVAL '1 day'))${notExitedSql()}
      ORDER BY ep."probationEndDate" ASC`,
    managerId, REVIEW_WINDOW_DAYS,
  );
  return rows.map((r) => ({
    userId:           r.userId,
    name:             r.name,
    employeeId:       r.employeeId ?? null,
    designation:      r.designation ?? null,
    probationEndDate: r.probationEndDate ? new Date(r.probationEndDate).toISOString() : null,
    daysRemaining:    daysUntil(r.probationEndDate),
    review: r.reviewId
      ? {
          id:              r.reviewId,
          recommendation:  r.recommendation,
          status:          r.reviewStatus,
          extendMonths:    r.extendMonths ?? null,
          proposedEndDate: r.proposedEndDate ? new Date(r.proposedEndDate).toISOString() : null,
          feedback:        r.feedback,
          hrNote:          r.hrNote ?? null,
          createdAt:       new Date(r.reviewCreatedAt).toISOString(),
        }
      : null,
  }));
}

// Count needing the manager's action (in window, no pending/approved review
// yet). Drives the sidebar badge.
export async function pendingManagerReviewCount(managerId: number): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(
    `SELECT COUNT(*)::int AS count
       FROM "User" u
       JOIN "EmployeeProfile" ep ON ep."userId" = u.id
      WHERE u."isActive" = true AND u."managerId" = $1
        AND ep."probationEndDate" IS NOT NULL
        AND ep."probationConfirmedAt" IS NULL
        AND ep."probationEndDate" >= (NOW() - INTERVAL '60 days')
        AND ep."probationEndDate" <= (NOW() + ($2::int * INTERVAL '1 day'))${notExitedSql()}
        AND NOT EXISTS (
          SELECT 1 FROM "ProbationReview" pr
           WHERE pr."employeeUserId" = u.id AND pr.status = 'pending'
        )`,
    managerId, REVIEW_WINDOW_DAYS,
  );
  return rows[0]?.count ?? 0;
}

// ── HR view: pending recommendations awaiting approval ───────────────
export async function listPendingHrReviews(brand?: string | null): Promise<any[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT pr.id, pr."employeeUserId", pr."managerId", pr.recommendation,
            pr."extendMonths", pr."proposedEndDate", pr.feedback, pr."createdAt",
            e.name AS "employeeName", e."profilePictureUrl", ep."employeeId", ep.designation, ep."probationEndDate",
            m.name AS "managerName"
       FROM "ProbationReview" pr
       JOIN "User" e ON e.id = pr."employeeUserId"
       LEFT JOIN "EmployeeProfile" ep ON ep."userId" = pr."employeeUserId"
       LEFT JOIN "User" m ON m.id = pr."managerId"
      WHERE pr.status = 'pending'
        AND e."isActive" = true${notExitedSql("e")}${brandFilterSql(brand)}
      ORDER BY pr."createdAt" ASC`,
  );
  return rows.map((r) => ({
    id:               r.id,
    employeeUserId:   r.employeeUserId,
    employeeName:     r.employeeName,
    profilePictureUrl: r.profilePictureUrl ?? null,
    employeeId:       r.employeeId ?? null,
    designation:      r.designation ?? null,
    managerId:        r.managerId,
    managerName:      r.managerName ?? null,
    recommendation:   r.recommendation as Recommendation,
    extendMonths:     r.extendMonths ?? null,
    proposedEndDate:  r.proposedEndDate ? new Date(r.proposedEndDate).toISOString() : null,
    probationEndDate: r.probationEndDate ? new Date(r.probationEndDate).toISOString() : null,
    daysRemaining:    daysUntil(r.probationEndDate),
    feedback:         r.feedback,
    createdAt:        new Date(r.createdAt).toISOString(),
  }));
}

// ── History (decided reviews — for tracking) ─────────────────────────
export async function listManagerHistory(managerId: number): Promise<any[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT pr.id, pr."employeeUserId", pr.recommendation, pr."extendMonths", pr."proposedEndDate",
            pr.feedback, pr.status, pr."hrNote", pr."decidedAt",
            e.name AS "employeeName", ep.designation, ep."employeeId"
       FROM "ProbationReview" pr
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

export async function listHrHistory(brand?: string | null): Promise<any[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT pr.id, pr."employeeUserId", pr.recommendation, pr."extendMonths", pr."proposedEndDate",
            pr.feedback, pr.status, pr."hrNote", pr."decidedAt",
            e.name AS "employeeName", e."isActive" AS "employeeActive",
            ep.designation, ep."employeeId", ep."probationConfirmedAt", ep."probationEndDate",
            m.name AS "managerName", d.name AS "deciderName"
       FROM "ProbationReview" pr
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
    isConfirmed: !!r.probationConfirmedAt,
    probationEndDate: r.probationEndDate ? new Date(r.probationEndDate).toISOString() : null,
  }));
}

// ── Full roster of everyone currently on probation (HR visibility) ──
export async function listOnProbationEmployees(brand?: string | null): Promise<any[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.id AS "userId", u.name, u.email,
            ep.designation, COALESCE(ep."businessUnit", 'NB Media') AS "businessUnit",
            ep."joiningDate", ep."probationEndDate",
            m.name AS "managerName",
            (SELECT pr.status FROM "ProbationReview" pr WHERE pr."employeeUserId" = u.id ORDER BY pr.id DESC LIMIT 1) AS "lastReviewStatus"
       FROM "EmployeeProfile" ep
       JOIN "User" u ON u.id = ep."userId"
       LEFT JOIN "User" m ON m.id = u."managerId"
      WHERE u."isActive" = true
        AND ep."probationEndDate" IS NOT NULL
        AND ep."probationConfirmedAt" IS NULL
        AND ep."probationEndDate" >= CURRENT_DATE${notExitedSql()}${brandFilterSql(brand)}
      ORDER BY ep."probationEndDate" ASC`);
  return rows.map((r) => ({
    userId: r.userId, name: r.name, email: r.email,
    designation: r.designation ?? null, businessUnit: r.businessUnit,
    managerName: r.managerName ?? null,
    joiningDate: r.joiningDate ? new Date(r.joiningDate).toISOString() : null,
    probationEndDate: r.probationEndDate ? new Date(r.probationEndDate).toISOString() : null,
    daysRemaining: daysUntil(r.probationEndDate),
    lastReviewStatus: r.lastReviewStatus ?? null,
  }));
}

// ── HR reverts an employee back to probation (un-confirm / un-end) ───
export async function revertToProbation(params: { employeeUserId: number; hrUserId: number; newEndDate: string }): Promise<{ ok: true }> {
  const { employeeUserId, newEndDate } = params;
  const d = new Date(newEndDate);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid probation end date");
  if (d.getTime() <= Date.now()) throw new Error("Probation end date must be in the future");
  const emp = await prisma.$queryRawUnsafe<any[]>(`SELECT id, "managerId", name FROM "User" WHERE id = $1`, employeeUserId);
  if (!emp[0]) throw new Error("Employee not found");

  await prisma.$executeRawUnsafe(
    `UPDATE "EmployeeProfile"
        SET "probationConfirmedAt" = NULL, "probationConfirmedById" = NULL,
            "probationEndDate" = $2, "probationReminderSentAt" = NULL, "probationManagerNotifiedAt" = NULL
      WHERE "userId" = $1`, employeeUserId, d);
  // Reverting also reactivates someone whose probation review had ended them.
  await prisma.$executeRawUnsafe(`UPDATE "User" SET "isActive" = true WHERE id = $1`, employeeUserId);

  if (emp[0].managerId) {
    await notify([emp[0].managerId], `Probation reopened: ${emp[0].name}`,
      `HR reverted ${emp[0].name} back to probation (ends ${d.toISOString().slice(0, 10)}). They'll show in your Probation Reviews again.`,
      "/dashboard/hr/my-team/probation");
  }
  return { ok: true };
}

// ── Manager submits a recommendation ─────────────────────────────────
export async function submitProbationReview(params: {
  employeeUserId: number;
  managerId: number;
  recommendation: Recommendation;
  extendMonths?: number | null;
  proposedEndDate?: string | null;
  feedback: string;
}): Promise<{ id: number }> {
  const { employeeUserId, managerId, recommendation } = params;
  const feedback = (params.feedback ?? "").trim();
  if (!["extend", "confirm", "end"].includes(recommendation)) throw new Error("Invalid recommendation");
  if (!feedback) throw new Error("Feedback is required");
  if (!Number.isInteger(managerId) || managerId <= 0) throw new Error("Employee has no reporting manager");

  // Validate the employee is genuinely an OPEN probation case — guards
  // HR/leadership on-behalf submits against phantom ids, already-confirmed,
  // never-on-probation, or inactive employees (any of which would otherwise
  // create a junk/destructive pending review).
  const empRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.name, u."isActive", ep."probationEndDate", ep."probationConfirmedAt"
       FROM "User" u LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
      WHERE u.id = $1`, employeeUserId);
  const emp = empRows[0];
  if (!emp) throw new Error("Employee not found");
  if (emp.isActive === false) throw new Error("Employee is not active");
  if (!emp.probationEndDate) throw new Error("Employee is not on probation");
  if (emp.probationConfirmedAt) throw new Error("Probation already confirmed");

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

  // Atomic replace: delete any prior pending review then insert, in one tx.
  // The partial unique index (one pending per employee) also blocks a
  // concurrent racer, so two parallel submits can't leave two pending rows.
  const id = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`DELETE FROM "ProbationReview" WHERE "employeeUserId" = $1 AND status = 'pending'`, employeeUserId);
    const ins = await tx.$queryRawUnsafe<{ id: number }[]>(
      `INSERT INTO "ProbationReview"
         ("employeeUserId","managerId","recommendation","extendMonths","proposedEndDate","feedback","status","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW())
       RETURNING id`,
      employeeUserId, managerId, recommendation, extendMonths, proposedEndDate, feedback);
    return ins[0]?.id as number;
  });

  // Notify HR (in-app).
  const label = recommendation === "extend" ? "extend probation" : recommendation === "confirm" ? "confirm as full-time" : "end employment";
  await notify(
    await hrRecipientIds(),
    `Probation review: ${emp.name ?? `User #${employeeUserId}`}`,
    `Reporting manager recommends to ${label}. Review it on the HR dashboard.`,
    "/dashboard/hr/home",
  );
  return { id };
}

// ── HR decides (approve applies the action / reject sends it back) ───
export async function decideProbationReview(params: {
  reviewId: number;
  hrUserId: number;
  decision: "approve" | "reject";
  hrNote?: string | null;
}): Promise<{ ok: true }> {
  const { reviewId, hrUserId, decision } = params;
  const hrNote = (params.hrNote ?? "").trim() || null;

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT pr.*, ep."probationEndDate", ep."joiningDate"
       FROM "ProbationReview" pr
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
      const base = r.probationEndDate ? new Date(r.probationEndDate) : new Date();
      const newEnd = r.proposedEndDate ? new Date(r.proposedEndDate) : addMonths(base, Number(r.extendMonths) || 1);
      await prisma.$executeRawUnsafe(
        `UPDATE "EmployeeProfile"
            SET "probationEndDate" = $2,
                "probationReminderSentAt" = NULL,
                "probationManagerNotifiedAt" = NULL
          WHERE "userId" = $1`,
        employeeUserId, newEnd,
      );
    } else if (r.recommendation === "confirm") {
      await prisma.$executeRawUnsafe(
        `UPDATE "EmployeeProfile"
            SET "probationConfirmedAt" = NOW(), "probationConfirmedById" = $2
          WHERE "userId" = $1`,
        employeeUserId, hrUserId,
      );
      // Best-effort: drop the Probation Confirmation letter into Documents.
      await generateProbationConfirmationLetter(employeeUserId, hrUserId).catch((e) =>
        console.warn("[probation-review] confirmation letter failed:", (e as any)?.message));
    } else if (r.recommendation === "end") {
      await prisma.$executeRawUnsafe(`UPDATE "User" SET "isActive" = false WHERE id = $1`, employeeUserId);
    } else {
      throw new Error(`Unknown recommendation: ${r.recommendation}`);
    }
  }

  await prisma.$executeRawUnsafe(
    `UPDATE "ProbationReview"
        SET status = $2, "decidedById" = $3, "decidedAt" = NOW(), "hrNote" = $4, "updatedAt" = NOW()
      WHERE id = $1`,
    reviewId, decision === "approve" ? "approved" : "rejected", hrUserId, hrNote,
  );

  // Notify the manager of the outcome (in-app).
  const emp = await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM "User" WHERE id = $1`, employeeUserId);
  const verb = decision === "approve" ? "approved" : "sent back";
  await notify(
    [r.managerId as number],
    `Probation review ${verb}: ${emp[0]?.name ?? `User #${employeeUserId}`}`,
    decision === "approve"
      ? "HR approved your recommendation and applied it."
      : `HR sent your recommendation back${hrNote ? `: ${hrNote}` : "."}`,
    "/dashboard/hr/my-team/probation",
  );
  return { ok: true };
}

// ── Auto-generate the Probation Confirmation letter into Documents ───
async function generateProbationConfirmationLetter(employeeId: number, uploadedById: number): Promise<void> {
  const brandRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COALESCE(p."businessUnit", 'NB Media') AS bu FROM "EmployeeProfile" p WHERE p."userId" = $1 LIMIT 1`,
    employeeId,
  );
  const brand = brandRows[0]?.bu || "NB Media";
  const tplRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, title, "bodyHtml", "businessUnit"
       FROM "LetterTemplate"
      WHERE key = 'probation_confirmation'
        AND ("businessUnit" = $1 OR "businessUnit" IS NULL) AND "isActive" = true
      ORDER BY CASE WHEN "businessUnit" = $1 THEN 0 ELSE 1 END LIMIT 1`,
    brand,
  );
  const tpl = tplRows[0];
  if (!tpl) { console.warn("[probation-review] no probation_confirmation template for", brand); return; }

  const { html } = await renderLetterHtml(tpl.bodyHtml, { employeeId, customFields: {} });
  const fullHtml = await wrapLetterPreviewHtml(html, tpl.title, tpl.businessUnit);
  const pdfBytes = await htmlToPdf(fullHtml); // throws if Chromium unavailable — caller catches
  if (!pdfBytes) return;

  const fileName = `${String(tpl.title).replace(/[^A-Za-z0-9]+/g, "-")}-${employeeId}.pdf`;
  const inserted = await prisma.$queryRawUnsafe<any[]>(
    `INSERT INTO "EmployeeDocument"
       ("userId","category","fileName","fileUrl","fileBlob","fileMime","uploadedById","isVerified","createdAt")
     VALUES ($1,'employee_letter',$2,'',$3::bytea,'application/pdf',$4,false,NOW())
     RETURNING id`,
    employeeId, fileName, pdfBytes, uploadedById,
  );
  const docId = inserted[0]?.id;
  if (docId) {
    await prisma.$executeRawUnsafe(
      `UPDATE "EmployeeDocument" SET "fileUrl" = $1 WHERE id = $2`,
      `/api/hr/documents/${docId}/file`, docId,
    );
  }
}

// ── Cron: push the in-app nudge to reporting managers ────────────────
// Mirrors the email-reminder dedupe: stamps probationManagerNotifiedAt so a
// manager is pinged once per probation window (cleared on an extension).
export async function sweepProbationManagerNotifications(): Promise<number> {
  const due = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.id AS "userId", u.name, u."managerId"
       FROM "User" u
       JOIN "EmployeeProfile" ep ON ep."userId" = u.id
      WHERE u."isActive" = true
        AND u."managerId" IS NOT NULL
        AND ep."probationEndDate" IS NOT NULL
        AND ep."probationConfirmedAt" IS NULL
        AND ep."probationManagerNotifiedAt" IS NULL
        AND ep."probationEndDate" >= (NOW() - INTERVAL '60 days')
        AND ep."probationEndDate" <= (NOW() + ($1::int * INTERVAL '1 day'))${notExitedSql()}`,
    REVIEW_WINDOW_DAYS,
  );
  let processed = 0;
  for (const row of due) {
    const sent = await notify(
      [row.managerId],
      `Probation review due: ${row.name}`,
      "Their probation is ending soon — leave feedback and recommend extend / confirm / end in My Team → Probation Reviews.",
      "/dashboard/hr/my-team/probation",
    );
    // Only stamp the dedupe column when the nudge actually persisted —
    // otherwise the manager would be silently skipped for this whole window.
    if (sent) {
      await prisma.$executeRawUnsafe(
        `UPDATE "EmployeeProfile" SET "probationManagerNotifiedAt" = NOW() WHERE "userId" = $1`,
        row.userId,
      );
      processed++;
    }
  }
  return processed;
}
