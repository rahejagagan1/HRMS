// GET /api/hr/payroll/exits?month=N&year=YYYY
//
// Two-bucket response used by Run Payroll Step 2 sub-step 2 (Exit Process)
// and sub-step 3 (Full & Final).
//   thisMonth: EmployeeExit rows whose lastWorkingDay is inside the cycle
//   alreadyExited: rows whose lastWorkingDay is earlier than the cycle
//                  and finalSettlementDone is still false.
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
  designation: string | null;
  department: string | null;
  exitType: string;
  resignationDate: Date;
  lastWorkingDay: Date;
  noticePeriodDays: number;
  status: string;
  assetsReturned: boolean;
  documentsHandled: boolean;
  finalSettlementDone: boolean;
  exitInterviewDone: boolean;
  ctc: string | null;
};

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { searchParams } = new URL(req.url);
    const month = parseInt(searchParams.get("month") ?? "");
    const year  = parseInt(searchParams.get("year")  ?? "");
    if (!Number.isFinite(month) || month < 0 || month > 11) {
      return NextResponse.json({ error: "Bad month" }, { status: 400 });
    }
    if (!Number.isFinite(year)) {
      return NextResponse.json({ error: "Bad year" }, { status: 400 });
    }
    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd   = new Date(Date.UTC(year, month + 1, 0));

    const scope = resolveBrandScope(session!.user, searchParams.get("brand"));
    if (!scope.allBrands && !scope.brand) return NextResponse.json({ thisMonth: [], alreadyExited: [] });

    const brandClause = scope.allBrands ? "" : `WHERE ep."businessUnit" = $1`;
    const sql = `SELECT e.id, e."userId", u.name AS "userName",
                        ep."employeeId", ep.designation, ep.department,
                        e."exitType", e."resignationDate", e."lastWorkingDay",
                        e."noticePeriodDays", e.status,
                        e."assetsReturned", e."documentsHandled",
                        e."finalSettlementDone", e."exitInterviewDone",
                        ss.ctc::text AS ctc
                   FROM "EmployeeExit" e
                   JOIN "User" u ON u.id = e."userId"
              LEFT JOIN "EmployeeProfile" ep ON ep."userId" = e."userId"
              LEFT JOIN "SalaryStructure" ss ON ss."userId" = e."userId"
                  ${brandClause}
                  ORDER BY e."lastWorkingDay" DESC`;
    const rows = scope.allBrands
      ? await prisma.$queryRawUnsafe<Row[]>(sql)
      : await prisma.$queryRawUnsafe<Row[]>(sql, scope.brand);

    const thisMonth: Row[] = [];
    const alreadyExited: Row[] = [];
    for (const r of rows) {
      const lwd = new Date(r.lastWorkingDay);
      if (lwd >= monthStart && lwd <= monthEnd) thisMonth.push(r);
      else if (lwd < monthStart && !r.finalSettlementDone) alreadyExited.push(r);
    }
    return NextResponse.json({ thisMonth, alreadyExited });
  } catch (e) { return serverError(e, "GET /api/hr/payroll/exits"); }
}
