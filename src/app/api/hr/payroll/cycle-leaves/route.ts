// GET /api/hr/payroll/cycle-leaves?month=N&year=YYYY
//
// Returns every LeaveApplication whose date range overlaps the given
// calendar month, in any non-final status (pending, partially_approved,
// approved). Used by Run Payroll page Step 1 sub-step "Leave Applied"
// so HR can approve / reject leaves before processing payroll.
//
// HR-admin only.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";
import { resolveBrandScope } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

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

    // Overlap rule: an application's [fromDate, toDate] overlaps the
    // month [monthStart, monthEnd) iff fromDate < monthEnd AND toDate >= monthStart.
    // Brand-scope: filter by the caller's brand unless allowlisted.
    const scope = resolveBrandScope(session!.user, searchParams.get("brand"));
    if (!scope.allBrands && !scope.brand) return NextResponse.json({ items: [] });

    const apps = await prisma.leaveApplication.findMany({
      where: {
        fromDate: { lt: monthEnd },
        toDate:   { gte: monthStart },
        status:   { in: ["pending", "partially_approved", "approved"] },
        ...(scope.allBrands ? {} : {
          user: { employeeProfile: { businessUnit: scope.brand! } },
        }),
      },
      include: {
        user: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
        leaveType: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
        finalApprover: { select: { id: true, name: true } },
      },
      orderBy: [{ status: "asc" }, { fromDate: "asc" }],
    });

    return NextResponse.json({
      items: apps.map((a: any) => ({
        id: a.id,
        userId: a.userId,
        userName: a.user?.name,
        userRole: a.user?.role,
        leaveTypeId: a.leaveTypeId,
        leaveTypeName: a.leaveType?.name,
        fromDate: a.fromDate,
        toDate: a.toDate,
        totalDays: a.totalDays,
        reason: a.reason,
        status: a.status,
        approverName: a.finalApprover?.name ?? a.approver?.name ?? null,
        appliedAt: a.appliedAt,
      })),
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/payroll/cycle-leaves");
  }
}
