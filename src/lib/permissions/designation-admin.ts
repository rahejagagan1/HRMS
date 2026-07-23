// Server helpers for the designation admin UI. Raw SQL so they work before the
// typed client knows the new models. Grant edits are authoritative: the posted
// permission set fully replaces the designation's grants.

import prisma from "@/lib/prisma";
import { ALL_PERMISSIONS, Permission } from "./catalog";
import { REPORT_TEMPLATE_IDS } from "@/lib/reports/manager-report-format";

/** Who may open/use the Designation admin screen: the HR Manager + top admins.
 *  (Mirrors isFullHRAdmin in src/lib/access.ts so it works pre-gate-refactor.) */
export function canManageDesignations(session: unknown): boolean {
  const u = (session as { user?: Record<string, unknown> } | null)?.user;
  if (!u) return false;
  return (
    u.isDeveloper === true ||
    u.orgLevel === "ceo" ||
    u.orgLevel === "special_access" ||
    u.role === "admin" ||
    u.role === "hr_manager"
  );
}

/** Replace a designation's permission grants with exactly `permissionKeys`
 *  (filtered to real catalog keys). Records `grantedBy` for the audit trail. */
export async function syncGrants(
  designationId: number,
  permissionKeys: string[],
  actorId: number | null
): Promise<void> {
  const valid = [...new Set(permissionKeys.filter((k) => ALL_PERMISSIONS.includes(k as Permission)))];
  await prisma.$executeRawUnsafe(
    `DELETE FROM "DesignationPermission" WHERE "designationId" = $1`,
    designationId
  );
  for (const key of valid) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DesignationPermission" ("designationId","permissionId","grantedBy","createdAt")
       SELECT $1, pm."id", $3, NOW() FROM "Permission" pm WHERE pm."key" = $2`,
      designationId, key, actorId
    );
  }
}

/** Replace a designation's report-view grants with exactly `ownerIds` (the
 *  report-owner / manager User ids whose reports this designation may view).
 *  Mirrors `syncGrants`: authoritative delete-then-insert. Records `grantedBy`. */
export async function syncReportGrants(
  designationId: number,
  ownerIds: number[],
  actorId: number | null
): Promise<void> {
  const ids = [...new Set(ownerIds.map(Number).filter(Number.isFinite))];
  await prisma.$executeRawUnsafe(
    `DELETE FROM "DesignationReportAccess" WHERE "designationId" = $1`,
    designationId
  );
  for (const managerId of ids) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DesignationReportAccess" ("designationId","managerId","grantedBy","createdAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT ("designationId","managerId") DO NOTHING`,
      designationId, managerId, actorId
    );
  }
}

/** Replace a designation's report-TEMPLATE grants with exactly `templates`
 *  (filtered to the 4 valid template ids). A designation may fill/view multiple
 *  templates. Authoritative delete-then-insert, mirroring syncReportGrants. */
export async function syncReportTemplates(
  designationId: number,
  templates: string[],
  actorId: number | null
): Promise<void> {
  const valid = [...new Set(templates.filter((t) => REPORT_TEMPLATE_IDS.includes(t as never)))];
  await prisma.$executeRawUnsafe(
    `DELETE FROM "DesignationReportTemplate" WHERE "designationId" = $1`,
    designationId
  );
  for (const template of valid) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DesignationReportTemplate" ("designationId","template","grantedBy","createdAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT ("designationId","template") DO NOTHING`,
      designationId, template, actorId
    );
  }
}

/** Slugify a label into a stable designation key. */
export function toDesignationKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
