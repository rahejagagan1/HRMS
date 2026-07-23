// GET /api/hr/payroll/salary-revisions?month=N&year=YYYY
//
// Lists SalaryStructure changes EFFECTIVE in the cycle month (by
// after.effectiveFrom, not by when the edit was entered), used by Run
// Payroll Step 3 sub-step 2 (Salary Revisions). Source of truth is
// AuditLog rows with entityType='SalaryStructure' (we don't keep a
// separate history table — the audit log carries before/after blobs).
//
// HR-admin only.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";
import { resolveBrandScope } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

type Row = {
  id: number;
  userId: number;
  userName: string;
  employeeId: string | null;
  oldCtc: string | null;
  newCtc: string | null;
  effectiveDate: Date | null;
  changedAt: Date;
  actorName: string | null;
};

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { searchParams } = new URL(req.url);
    const month = parseInt(searchParams.get("month") ?? "");
    const year  = parseInt(searchParams.get("year")  ?? "");
    if (!Number.isFinite(month) || month < 0 || month > 11)
      return NextResponse.json({ error: "Bad month" }, { status: 400 });
    if (!Number.isFinite(year))
      return NextResponse.json({ error: "Bad year" }, { status: 400 });

    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd   = new Date(Date.UTC(year, month + 1, 1));

    // The salary-structure write path (src/app/api/hr/people/[id]/salary
    // -structure/...) audits with action LIKE 'hr.salary_structure%' and
    // entityType='SalaryStructure'. We pull only update/create rows whose
    // `after.ctc` differs from `before.ctc` (so unchanged-CTC patches
    // don't pollute the list).
    //
    // Cycle membership is by EFFECTIVE DATE (after.effectiveFrom in the month),
    // NOT by when the edit was entered (al.createdAt). A raise effective 9-Jun
    // belongs to the June cycle even if HR keyed it in on 2-Jul. Because
    // effective-date filtering can match several historical re-saves for the
    // same employee (each audited), DISTINCT ON keeps only that employee's
    // most recent edit among the rows effective in the month.
    const scope = resolveBrandScope(session!.user, searchParams.get("brand"));
    if (!scope.allBrands && !scope.brand) return NextResponse.json({ items: [] });

    const brandClause = scope.allBrands ? "" : ` AND ep."businessUnit" = $3`;
    const sql = `SELECT * FROM (
                   SELECT DISTINCT ON ((al.after->>'userId')::int)
                          al.id,
                          (al.after->>'userId')::int                AS "userId",
                          u.name                                    AS "userName",
                          ep."employeeId",
                          (al.before->>'ctc')                       AS "oldCtc",
                          (al.after->>'ctc')                        AS "newCtc",
                          NULLIF(al.after->>'effectiveFrom','')::timestamp AS "effectiveDate",
                          al."createdAt"                            AS "changedAt",
                          actor.name                                AS "actorName"
                     FROM "AuditLog" al
                     LEFT JOIN "User" u ON u.id = (al.after->>'userId')::int
                     LEFT JOIN "EmployeeProfile" ep ON ep."userId" = (al.after->>'userId')::int
                     LEFT JOIN "User" actor ON actor.id = al."actorId"
                    WHERE al."entityType" = 'SalaryStructure'
                      AND NULLIF(al.after->>'effectiveFrom','')::timestamp >= $1
                      AND NULLIF(al.after->>'effectiveFrom','')::timestamp <  $2
                      AND (al.before IS NULL OR (al.before->>'ctc') IS DISTINCT FROM (al.after->>'ctc'))
                      ${brandClause}
                    ORDER BY (al.after->>'userId')::int, al."createdAt" DESC
                 ) t
                 ORDER BY t."effectiveDate" DESC, t."changedAt" DESC`;
    const rows = scope.allBrands
      ? await prisma.$queryRawUnsafe<Row[]>(sql, monthStart, monthEnd)
      : await prisma.$queryRawUnsafe<Row[]>(sql, monthStart, monthEnd, scope.brand);
    return NextResponse.json({ items: rows });
  } catch (e) { return serverError(e, "GET /api/hr/payroll/salary-revisions"); }
}
