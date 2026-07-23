import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { parseYearMonth, istCalendarMonthRange } from "@/lib/ist-date";
import { can, hasResolvedPermissions } from "@/lib/permissions/can";
import { brandScopeUserWhere } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

// GET /api/hr/approvals/summary?month=YYYY-MM
// Returns pending counts per approvals tab so the HR Dashboard left-rail
// badge and the ApprovalsPanel sub-tab badges share one query.
//
// Scope rules match /api/hr/approvals:
//  • CEO / HR manager / developer / admin → every pending request org-wide.
//  • Manager (has direct reports)          → their team only.
//  • Everyone else                         → forbidden.
//
// Optional `month=YYYY-MM` narrows counts to requests SUBMITTED within
// that IST calendar month (appliedAt for leave, createdAt elsewhere) —
// matches the ApprovalsPanel month filter so the sub-tab badges and the
// underlying table reflect the same window.
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    // RBAC-designation-driven (policy 2026-07-14): APPROVE_ALL_REQUESTS is
    // the L2/final-approver permission. Legacy expression kept only as the
    // fallback for sessions without resolved permissions.
    const isFinalApprover = hasResolvedPermissions(self)
      ? can(self, "APPROVE_ALL_REQUESTS")
      : (self.orgLevel === "ceo" ||
         self.isDeveloper ||
         self.orgLevel === "hr_manager" ||
         self.orgLevel === "special_access" ||
         self.role === "admin" ||
         self.role === "hr_manager");

    let myId: number | null = null;
    if (!isFinalApprover) {
      myId = await resolveUserId(session);
      if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
      const reports = await prisma.user.count({ where: { managerId: myId, isActive: true } });
      if (reports === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Open-status filter: every request type now uses the L1 → L2 flow,
    // except regularization (HR-admin-only, single-stage). For non-leave
    // request types, both pending (awaiting L1) and partially_approved
    // (awaiting L2) count toward the inbox badge.
    const openTwoStage = { status: { in: ["pending", "partially_approved"] } };

    // Optional month + brand filters — same parsing rules as
    // /api/hr/approvals (which the ApprovalsPanel calls in parallel).
    // Without the brand filter, the tab badges showed org-wide counts
    // even when the panel itself was scoped to one brand — the user
    // saw "LEAVE 26" while the table rendered only the YT Labs subset.
    const { searchParams } = new URL(req.url);
    const ym = parseYearMonth(searchParams.get("month"));
    const monthRange = ym ? istCalendarMonthRange(ym.year, ym.month) : null;
    const leaveMonth   = monthRange ? { appliedAt: monthRange } : {};
    const createdMonth = monthRange ? { createdAt: monthRange } : {};

    const brandRaw = (searchParams.get("brand") || "").toLowerCase();
    const brand: "NB Media" | "YT Labs" | null =
      brandRaw === "yt-labs" || brandRaw === "yt"   ? "YT Labs" :
      brandRaw === "nb-media" || brandRaw === "nb"  ? "NB Media" :
      null;

    // Combine team + brand into a single `user` clause via AND so the
    // brand filter doesn't clobber a manager's team scope.
    const userClauses: any[] = [];
    if (!isFinalApprover) userClauses.push({ managerId: myId! });
    // Org-wide brand isolation (2026-07-15) — matches /api/hr/approvals so
    // the badge counts agree with the rows the caller can actually see.
    const viewerClamp = brandScopeUserWhere(self);
    if (Object.keys(viewerClamp).length) userClauses.push(viewerClamp);
    if (brand === "YT Labs") {
      userClauses.push({ employeeProfile: { businessUnit: "YT Labs" } });
    } else if (brand === "NB Media") {
      userClauses.push({ OR: [
        { employeeProfile: { businessUnit: "NB Media" } },
        { employeeProfile: { businessUnit: null } },
        { employeeProfile: null },
      ] });
    }
    const teamWhere: any =
      userClauses.length === 0 ? {} :
      userClauses.length === 1 ? { user: userClauses[0] } :
      { user: { AND: userClauses } };

    const [leaveCount, regCount, wfhCount, odCount, compOffCount] = await Promise.all([
      prisma.leaveApplication.count({
        where: { ...openTwoStage, ...teamWhere, ...leaveMonth },
      }),
      // Regularization is HR-admin-only — managers don't see it in their
      // count at all. Final approvers see every open row. Brand scope
      // still applies for final approvers.
      isFinalApprover
        ? prisma.attendanceRegularization.count({ where: { ...openTwoStage, ...teamWhere, ...createdMonth } })
        : Promise.resolve(0),
      prisma.wFHRequest.count({
        where: { ...openTwoStage, ...teamWhere, ...createdMonth },
      }),
      prisma.onDutyRequest.count({
        where: { ...openTwoStage, ...teamWhere, ...createdMonth },
      }),
      prisma.compOffRequest.count({
        where: { ...openTwoStage, ...teamWhere, ...createdMonth },
      }),
    ]);

    const wfhTotal = wfhCount + odCount; // WFH / OD tab combines both.

    return NextResponse.json({
      byTab: {
        leave:            leaveCount,
        leave_encashment: 0,
        comp_off:         compOffCount,
        regularize:       regCount,
        wfh:              wfhTotal,
        half_day:         0,
        shift_weekly_off: 0,
      },
      total: leaveCount + regCount + wfhTotal + compOffCount,
    });
  } catch (e) { return serverError(e, "GET /api/hr/approvals/summary"); }
}
