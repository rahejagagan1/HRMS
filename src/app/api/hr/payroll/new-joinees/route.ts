// GET /api/hr/payroll/new-joinees?month=N&year=YYYY
//
// Lists every active employee whose EmployeeProfile.joiningDate falls
// in the given calendar month. Returns enough fields for the Run Payroll
// page Step 2 New Joinees table: HRM number, name, joining date,
// pro-rated unit count, monthly salary, and the current Pay Action
// (defaults to "Process as salary").
//
// HR-admin only.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";
import { resolveBrandScope } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const month = parseInt(searchParams.get("month") ?? "");
    const year  = parseInt(searchParams.get("year") ?? "");
    if (!Number.isFinite(month) || month < 0 || month > 11) {
      return NextResponse.json({ error: "Bad month" }, { status: 400 });
    }
    if (!Number.isFinite(year)) {
      return NextResponse.json({ error: "Bad year" }, { status: 400 });
    }

    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd   = new Date(Date.UTC(year, month + 1, 1));
    const calendarDays = daysInMonth(year, month);

    // Brand-scope: scope to caller's businessUnit unless they're a
    // developer or in the cross-brand allowlist. A YT Labs CEO
    // (canViewSalary) shouldn't see NB Media joiner salary data.
    const scope = resolveBrandScope(session!.user, searchParams.get("brand"));
    if (!scope.allBrands && !scope.brand) {
      // Caller has no brand set + isn't allowlisted — fail closed.
      return NextResponse.json({ items: [] });
    }

    // EmployeeProfile.joiningDate is the source of truth for DOJ.
    const profiles = await prisma.employeeProfile.findMany({
      where: {
        joiningDate: { gte: monthStart, lt: monthEnd },
        user: { isActive: true },
        ...(scope.allBrands ? {} : { businessUnit: scope.brand! }),
      },
      include: {
        user: {
          select: { id: true, name: true, isActive: true, salaryStructure: { select: { ctc: true, basic: true, salaryType: true } } },
        },
      },
    });

    // Also check SalaryHold to see if this joinee already has a pay-action set.
    const userIds = profiles.map((p) => p.user!.id);
    const holds = userIds.length
      ? await prisma.$queryRawUnsafe<{ userId: number; kind: string; payAction: string | null }[]>(
          `SELECT "userId", kind, "payAction" FROM "SalaryHold"
            WHERE month = $1 AND year = $2 AND "userId" = ANY($3::int[])`,
          month, year, userIds,
        )
      : [];
    const holdMap = new Map(holds.map((h) => [h.userId, h]));

    return NextResponse.json({
      items: profiles.map((p) => {
        const u = p.user!;
        const doj = p.joiningDate!;
        // Units worked in the month = calendar days from DOJ to month-end (inclusive).
        const dojDay = doj.getUTCDate();
        const unitsWorked = Math.max(0, calendarDays - dojDay + 1);
        // Monthly salary = ctc / 12, pro-rated by units / calendar.
        const annual = parseFloat(u.salaryStructure?.ctc?.toString() ?? "0") || 0;
        const monthlyFull = annual / 12;
        const monthlyProRated = Math.round((monthlyFull * unitsWorked) / calendarDays);
        const hold = holdMap.get(u.id);
        const payAction =
          hold?.kind === "processing" ? "Hold salary processing this month" :
          hold?.kind === "payout"     ? "Hold salary payout this month"     :
                                        "Process as salary";
        return {
          userId:        u.id,
          employeeId:    p.employeeId,
          name:          u.name,
          joiningDate:   doj,
          unitsWorked,
          monthlyAmount: monthlyProRated,
          payAction,
        };
      }),
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/payroll/new-joinees");
  }
}
