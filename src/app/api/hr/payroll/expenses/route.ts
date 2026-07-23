// GET /api/hr/payroll/expenses?month=N&year=YYYY
// POST /api/hr/payroll/expenses/[id]/pay  (in the [id] route)
//
// Lists approved Expense rows whose expenseDate falls inside the cycle
// month and have not yet been paid. Backs Run Payroll Step 4 sub-step 2
// (Expenses). HR-admin only.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";
import { resolveBrandScope } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

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
    const monthEnd   = new Date(Date.UTC(year, month + 1, 0));

    const scope = resolveBrandScope(session!.user, searchParams.get("brand"));
    if (!scope.allBrands && !scope.brand) return NextResponse.json({ items: [] });
    const brandClause = scope.allBrands ? "" : ` AND ep."businessUnit" = $3`;
    type ExpenseRow = {
      id: number; userId: number; userName: string; employeeId: string | null;
      title: string; category: string; amount: string; expenseDate: Date; status: string;
    };
    const sql = `SELECT e.id, e."userId", u.name AS "userName", ep."employeeId",
                        e.title, e.category, e.amount::text AS amount, e."expenseDate", e.status
                   FROM "Expense" e
                   JOIN "User" u ON u.id = e."userId"
              LEFT JOIN "EmployeeProfile" ep ON ep."userId" = e."userId"
                  WHERE e."expenseDate" >= $1 AND e."expenseDate" <= $2
                    AND e.status IN ('approved','pending')
                    ${brandClause}
                  ORDER BY e."expenseDate" DESC`;
    const items = scope.allBrands
      ? await prisma.$queryRawUnsafe<ExpenseRow[]>(sql, monthStart, monthEnd)
      : await prisma.$queryRawUnsafe<ExpenseRow[]>(sql, monthStart, monthEnd, scope.brand);
    return NextResponse.json({ items });
  } catch (e) { return serverError(e, "GET /api/hr/payroll/expenses"); }
}
