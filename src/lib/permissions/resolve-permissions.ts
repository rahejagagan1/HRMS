// Loads a user's effective permissions from their designation's grants.
// Used by the auth session callback to attach `session.user.permissions`, which
// `can()` then checks.
//
// Before the RBAC migration is applied the tables don't exist. To avoid spamming
// failing queries (and prisma error logs) on every request, we probe ONCE via
// information_schema (which never errors) and cache readiness. Concurrent callers
// share a single in-flight probe. The cache resets on server restart — which is
// required after the migration anyway.

import prisma from "@/lib/prisma";
import { Permission } from "./catalog";

let readyProbe: Promise<boolean> | null = null;

/** True once the RBAC tables exist. Cached; probes information_schema so it
 *  never throws (no error log) even pre-migration. */
function rbacReady(): Promise<boolean> {
  if (readyProbe) return readyProbe;
  readyProbe = prisma
    .$queryRawUnsafe<{ ok: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables WHERE table_name = 'Designation'
       ) AS "ok"`
    )
    .then((rows) => rows?.[0]?.ok === true)
    .catch(() => {
      // Unexpected/transient failure — don't cache, allow a retry next call.
      readyProbe = null;
      return false;
    });
  return readyProbe;
}

async function rawPerms(whereClause: string, arg: string | number): Promise<Permission[]> {
  if (!(await rbacReady())) return [];
  try {
    const rows = await prisma.$queryRawUnsafe<{ key: string }[]>(
      `SELECT pm."key" AS "key"
       FROM "User" u
       JOIN "Designation" dg            ON dg."id" = u."designationId"
       JOIN "DesignationPermission" dp  ON dp."designationId" = dg."id"
       JOIN "Permission" pm             ON pm."id" = dp."permissionId"
       WHERE ${whereClause}`,
      arg
    );
    return rows.map((r) => r.key as Permission);
  } catch {
    return [];
  }
}

/** Permissions for the user with this email (used by the auth session callback).
 *  Case-insensitive so a record stored with a stray capital still resolves. */
export function getPermissionsByEmail(email: string): Promise<Permission[]> {
  return rawPerms(`LOWER(u."email") = LOWER($1)`, email);
}

/** Permissions for a user id (used by server code that has the numeric id). */
export function getPermissionsForUserId(userId: number): Promise<Permission[]> {
  return rawPerms(`u."id" = $1`, userId);
}

/**
 * Active user ids whose DESIGNATION grants the given permission — the
 * designation-driven replacement for role/orgLevel recipient lookups
 * (notification fan-outs, manager pickers, brand HR routing).
 * `excludeDesignationKeys` drops tiers that hold the permission but must
 * not be in the recipient set (e.g. CEO designations for L2 fan-outs).
 */
export async function userIdsWithPermission(
  perm: Permission,
  opts?: { excludeDesignationKeys?: string[] },
): Promise<number[]> {
  if (!(await rbacReady())) return [];
  const excl = opts?.excludeDesignationKeys ?? [];
  try {
    const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
      `SELECT DISTINCT u."id"
         FROM "User" u
         JOIN "Designation" dg           ON dg."id" = u."designationId"
         JOIN "DesignationPermission" dp ON dp."designationId" = dg."id"
         JOIN "Permission" pm            ON pm."id" = dp."permissionId"
        WHERE u."isActive" = true
          AND pm."key" = $1
          ${excl.length ? `AND dg."key" <> ALL($2::text[])` : ""}`,
      ...(excl.length ? [perm, excl] : [perm]),
    );
    return rows.map((r) => Number(r.id));
  } catch {
    return [];
  }
}

/** True if the user's designation has any report grant — either a per-owner
 *  grant (DesignationReportAccess) OR a report-template assignment
 *  (DesignationReportTemplate). Lets `canSeeReports` open the hub for a
 *  designation that has report grants but no blanket VIEW_REPORTS. Boolean only
 *  (no cookie bloat); the actual owner ids / templates are fetched per-page from
 *  /api/user/report-access. */
export async function hasDesignationReportGrantsByEmail(email: string): Promise<boolean> {
  if (!(await rbacReady())) return false;
  try {
    const rows = await prisma.$queryRawUnsafe<{ ok: boolean }[]>(
      `SELECT (
         EXISTS (
           SELECT 1 FROM "User" u
           JOIN "DesignationReportAccess" dra ON dra."designationId" = u."designationId"
           WHERE LOWER(u."email") = LOWER($1)
         )
         OR EXISTS (
           SELECT 1 FROM "User" u
           JOIN "DesignationReportTemplate" drt ON drt."designationId" = u."designationId"
           WHERE LOWER(u."email") = LOWER($1)
         )
       ) AS "ok"`,
      email
    );
    return rows?.[0]?.ok === true;
  } catch {
    return false;
  }
}

/** Scorecard function for the user with this email (auth session callback). */
export async function getScorecardFunctionByEmail(email: string): Promise<string | null> {
  if (!(await rbacReady())) return null;
  try {
    const rows = await prisma.$queryRawUnsafe<{ scorecardFunction: string | null }[]>(
      `SELECT dg."scorecardFunction" AS "scorecardFunction"
       FROM "User" u JOIN "Designation" dg ON dg."id" = u."designationId"
       WHERE LOWER(u."email") = LOWER($1)`,
      email
    );
    return rows[0]?.scorecardFunction ?? null;
  } catch {
    return null;
  }
}

/** The user's scorecard function (writer/editor/qa/researcher/manager) from
 *  their designation, or null. Replaces `role`-based branching in the rating /
 *  report / KPI engine once those are migrated. */
export async function getScorecardFunction(userId: number): Promise<string | null> {
  if (!(await rbacReady())) return null;
  try {
    const rows = await prisma.$queryRawUnsafe<{ scorecardFunction: string | null }[]>(
      `SELECT dg."scorecardFunction" AS "scorecardFunction"
       FROM "User" u JOIN "Designation" dg ON dg."id" = u."designationId"
       WHERE u."id" = $1`,
      userId
    );
    return rows[0]?.scorecardFunction ?? null;
  } catch {
    return null;
  }
}
