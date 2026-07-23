import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";
import { resolveBrandScope } from "@/lib/hr/brand-scope";
import { readBrandStatus, brandOfBusinessUnit } from "@/lib/hr/payroll-run-status";
import { pickStructureForMonth } from "@/lib/hr/salary-periods";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const isAdmin = canViewSalary(user);

  const { searchParams } = new URL(req.url);
  const userId = isAdmin && searchParams.get("userId")
    ? parseInt(searchParams.get("userId")!)
    : user.dbId;
  // Admin-only: ?runId= scopes the result to a single payroll run — used
  // by the "Run Payroll" page's Pre-Payroll Check panel to enumerate
  // every payslip in a cycle (not just one employee's). Non-admins'
  // requests are still constrained to their own userId regardless.
  const runIdParam = isAdmin && searchParams.get("runId")
    ? parseInt(searchParams.get("runId")!)
    : null;

  try {
    // Brand-scope: even an admin who passes canViewSalary should
    // see only same-brand payslips unless they're allowlisted for
    // cross-brand. Closes the leak where YT Labs CEO could fetch
    // a NB Media-only PayrollRun's payslips by runId.
    const scope = resolveBrandScope(user, searchParams.get("brand"));
    if (isAdmin && !scope.allBrands && !scope.brand) {
      return NextResponse.json([]);
    }
    const brandFilter = !isAdmin || scope.allBrands
      ? {}
      : { user: { employeeProfile: { businessUnit: scope.brand! } } };

    // Non-admin: only payslips whose parent PayrollRun has been marked
    // 'paid' FOR THE EMPLOYEE'S BRAND are visible. Lock + finance-confirm is
    // a manual two-step, so the employee shouldn't see a payslip until the
    // second step is done — and a run is shared by both brands, so the check
    // is per-brand (marking NB Media paid must not reveal YT Labs slips).
    // Admins always see everything (including drafts) for review.
    const payslips = await prisma.payslip.findMany({
      where: {
        ...(runIdParam ? { payrollRunId: runIdParam } : { userId }),
        ...brandFilter,
      },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: {
        payrollRun: { select: { id: true, status: true, brandStatus: true } },
        salaryStructure: { select: {
          ctc: true, basic: true, hra: true, dearnessAllowance: true, conveyanceAllowance: true,
          medicalAllowance: true, specialAllowance: true, pfEmployee: true, salaryType: true, effectiveFrom: true,
        } },
        user: { select: { id: true, name: true, email: true, employeeProfile: { select: { businessUnit: true } } } },
      },
    });

    // Per-brand "paid" gate for non-admins (admins bypass — they review drafts).
    const visiblePayslips = isAdmin ? payslips : payslips.filter((p) => {
      const brand = brandOfBusinessUnit((p.user as any)?.employeeProfile?.businessUnit);
      return readBrandStatus(p.payrollRun as any, brand).status === "paid";
    });

    // Attach adhoc PAYMENT line items (reimbursements, travel, arrears, etc.)
    // per payslip so the slip can itemise them by type instead of absorbing
    // them into base earnings. Bonuses are itemised separately via
    // EmployeeBonus; adhoc deductions are handled in the deductions column.
    const uids = Array.from(new Set(visiblePayslips.map((p) => p.userId)));
    const adhoc = uids.length
      ? await prisma.$queryRawUnsafe<{ userId: number; month: number; year: number; type: string | null; amount: string }[]>(
          `SELECT "userId", month, year, type, SUM(amount)::text AS amount
             FROM "AdhocLineItem"
            WHERE kind = 'payment' AND "userId" = ANY($1::int[])
            GROUP BY "userId", month, year, type`,
          uids,
        )
      : [];
    const adhocKey = (u: number, m: number, y: number) => `${u}:${m}:${y}`;
    const adhocMap = new Map<string, { type: string; amount: number }[]>();
    for (const a of adhoc) {
      const k = adhocKey(a.userId, a.month, a.year);
      const arr = adhocMap.get(k) ?? [];
      arr.push({ type: a.type || "Other", amount: parseFloat(a.amount) });
      adhocMap.set(k, arr);
    }

    // Month-effective salary structure per payslip: a past month must show the
    // salary that applied THEN, not a later revision. When the current structure
    // took effect after a payslip's month, swap in the SalaryStructureHistory
    // row whose window covered that month (Gagan: May shows his old ₹35k rate,
    // not the ₹50k that started in June).
    const history = uids.length
      ? await prisma.salaryStructureHistory.findMany({ where: { userId: { in: uids } } })
      : [];
    const histByUser = new Map<number, typeof history>();
    for (const h of history) {
      const arr = histByUser.get(h.userId) ?? [];
      arr.push(h);
      histByUser.set(h.userId, arr);
    }

    const withAdhoc = visiblePayslips.map((p) => ({
      ...p,
      salaryStructure: pickStructureForMonth(
        p.salaryStructure as any,
        (histByUser.get(p.userId) ?? []) as any[],
        p.year,
        p.month,
      ) ?? p.salaryStructure,
      adhocPayments: adhocMap.get(adhocKey(p.userId, p.month, p.year)) ?? [],
    }));
    return NextResponse.json(withAdhoc);
  } catch (e) { return serverError(e, "GET /api/hr/payroll/payslips"); }
}
