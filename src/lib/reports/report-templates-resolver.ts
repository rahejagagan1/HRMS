// Server-only resolver: which report templates a user is responsible for, from
// their designation's DesignationReportTemplate assignments. Designation FIRST,
// with the legacy name/role-derived format as the fallback so nothing breaks for
// users whose designation has no template assignment yet.
//
// Kept OUT of manager-report-format.ts on purpose — that module is imported by
// client components (REPORT_TEMPLATES), so it must stay free of `prisma`.

import prisma from "@/lib/prisma";
import {
  getManagerReportFormat,
  isManagerReportEligible,
  REPORT_TEMPLATE_IDS,
  type ManagerReportFormat,
  type ManagerReportIdentity,
} from "./manager-report-format";

let ready: Promise<boolean> | null = null;
function tableReady(): Promise<boolean> {
  if (ready) return ready;
  ready = prisma
    .$queryRawUnsafe<{ ok: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables WHERE table_name = 'DesignationReportTemplate'
       ) AS "ok"`
    )
    .then((r) => r?.[0]?.ok === true)
    .catch(() => { ready = null; return false; });
  return ready;
}

async function templatesWhere(whereClause: string, arg: string | number): Promise<ManagerReportFormat[]> {
  if (!(await tableReady())) return [];
  try {
    const rows = await prisma.$queryRawUnsafe<{ template: string }[]>(
      `SELECT DISTINCT drt."template"
       FROM "User" u
       JOIN "DesignationReportTemplate" drt ON drt."designationId" = u."designationId"
       WHERE ${whereClause}`,
      arg
    );
    const set = new Set(rows.map((r) => r.template));
    // Return in the canonical REPORT_TEMPLATES order.
    return REPORT_TEMPLATE_IDS.filter((t) => set.has(t));
  } catch {
    return [];
  }
}

/** Report templates assigned to this user's designation (canonical order). */
export function getReportTemplatesForUser(userId: number): Promise<ManagerReportFormat[]> {
  return templatesWhere(`u."id" = $1`, userId);
}

/** Same, by email. */
export function getReportTemplatesForEmail(email: string): Promise<ManagerReportFormat[]> {
  return templatesWhere(`u."email" = $1`, email);
}

/** The templates a user FILLS: their designation's assigned templates if any,
 *  else the single legacy-derived format. Always returns at least one. */
export async function resolveManagerReportFormats(
  userId: number,
  fallback: ManagerReportIdentity
): Promise<ManagerReportFormat[]> {
  const assigned = await getReportTemplatesForUser(userId);
  return assigned.length ? assigned : [getManagerReportFormat(fallback)];
}

/** Eligible to fill if the designation assigns any template, else the legacy rule. */
export async function isManagerReportEligibleResolved(
  userId: number,
  fallback: ManagerReportIdentity
): Promise<boolean> {
  const assigned = await getReportTemplatesForUser(userId);
  return assigned.length > 0 || isManagerReportEligible(fallback);
}
