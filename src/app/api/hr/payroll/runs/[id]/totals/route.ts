import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";

// GET /api/hr/payroll/runs/[id]/totals
//
// Aggregate payslip totals for the Keka-style "Run Payroll" stats card.
// Returns four headline numbers:
//   • totalPayrollCost    — sum of grossEarnings (employer view)
//   • employeeDeposit     — sum of netPay (what hits employee bank accts)
//   • totalDeductions     — sum of totalDeductions (tax, PF, PT)
//   • totalContributions  — sum of pfEmployee (employee-side PF contribution)
// Plus a payslipCount so the UI can drive its "X/N employees" badge.
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: idRaw } = await params;
    const runId = parseInt(idRaw);
    if (!Number.isFinite(runId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    // Optional brand scope so the Run Payroll stats split per brand instead of
    // always summing the whole org. Semantics match hr-brand-scope.brandOf:
    //   YT Labs  → businessUnit = "YT Labs"
    //   NB Media → everything else (incl. null / legacy / no profile)
    const brand = new URL(req.url).searchParams.get("brand");
    const brandWhere =
      brand === "YT Labs"  ? { user: { employeeProfile: { businessUnit: "YT Labs" } } }
    : brand === "NB Media" ? { user: { NOT: { employeeProfile: { businessUnit: "YT Labs" } } } }
    : {};

    const agg = await prisma.payslip.aggregate({
      where: { payrollRunId: runId, ...brandWhere },
      _sum: {
        grossEarnings:   true,
        totalDeductions: true,
        netPay:          true,
        pfEmployee:      true,
      },
      _count: { _all: true },
    });

    return NextResponse.json({
      runId,
      month: run.month,
      year: run.year,
      status: run.status,
      payslipCount:        agg._count._all,
      totalPayrollCost:    Number(agg._sum.grossEarnings   ?? 0),
      employeeDeposit:     Number(agg._sum.netPay          ?? 0),
      totalDeductions:     Number(agg._sum.totalDeductions ?? 0),
      totalContributions:  Number(agg._sum.pfEmployee      ?? 0),
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/payroll/runs/[id]/totals");
  }
}
