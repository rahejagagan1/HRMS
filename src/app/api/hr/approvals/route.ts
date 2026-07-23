import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { serializeBigInt } from "@/lib/utils";
import { parseYearMonth, istCalendarMonthRange } from "@/lib/ist-date";
import { can, hasResolvedPermissions } from "@/lib/permissions/can";
import { brandScopeUserWhere } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

// GET /api/hr/approvals?tab=leave|regularize|wfh|on_duty|comp_off
//
// Scope:
//  - CEO / HR manager / developer: every pending request across the org.
//  - Manager (has direct reports): requests from their own team only.
//  - Everyone else: 403.
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;

    // RBAC-designation-driven (policy 2026-07-14): APPROVE_ALL_REQUESTS is
    // the L2/final-approver permission (its catalog entry replaces the old
    // isFinalApprover role check). Legacy orgLevel/role expression kept only
    // as the fallback for sessions without resolved permissions.
    const isFinalApprover = hasResolvedPermissions(self)
      ? can(self, "APPROVE_ALL_REQUESTS")
      : (self.orgLevel === "ceo" ||
         self.isDeveloper ||
         self.orgLevel === "hr_manager" ||
         self.orgLevel === "special_access" ||
         self.role === "admin" ||
         self.role === "hr_manager");

    // Final approvers see everything — they don't need a DB row to view.
    // Everyone else must resolve to a User id so we can scope to their team.
    let myId: number | null = null;
    let isManager = false;
    if (!isFinalApprover) {
      myId = await resolveUserId(session);
      if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
      const reportCount = await prisma.user.count({ where: { managerId: myId, isActive: true } });
      isManager = reportCount > 0;
      if (!isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const tab   = (searchParams.get("tab") || "leave").toLowerCase();
    // scope:
    //   - "pending" — only actionable rows (pending + partially_approved).
    //   - "active"  — pending + partially_approved + approved. Used to
    //                surface upcoming/already-approved requests in the
    //                same view, with rejected/cancelled rows filtered out.
    //   - "all"     — every status (history / audit trail).
    const scope = (searchParams.get("scope") || "pending").toLowerCase();
    // Month filter ("YYYY-MM") — when present, narrows each tab's query to
    // requests SUBMITTED within that IST calendar month. Filters on
    // appliedAt for leave (matches the "Applied · …" stamp in the UI),
    // createdAt for everything else. Unparseable / missing → no filter.
    const ymRaw = searchParams.get("month");
    const ym    = parseYearMonth(ymRaw);
    const monthRange = ym ? istCalendarMonthRange(ym.year, ym.month) : null;
    const leaveMonth   = monthRange ? { appliedAt: monthRange } : {};
    const createdMonth = monthRange ? { createdAt: monthRange } : {};

    // Brand filter (NB Media / YT Labs) — narrows every list to that
    // brand's employees so the tab badge counts on the ApprovalsPanel
    // match the rows the user actually sees. Slug form mirrors what
    // the HR Dashboard sidebar flyout emits. Treats NULL businessUnit
    // as "NB Media" (parent-brand default) so legacy rows still
    // surface on the NB scope.
    const brandRaw = (searchParams.get("brand") || "").toLowerCase();
    const brand: "NB Media" | "YT Labs" | null =
      brandRaw === "yt-labs" || brandRaw === "yt"   ? "YT Labs" :
      brandRaw === "nb-media" || brandRaw === "nb"  ? "NB Media" :
      null;

    // Combine team + brand filters into ONE `user` clause. Spreading
    // two separate `{ user: ... }` objects into a `where` would have
    // the later one clobber the earlier — managers were silently
    // losing their team scope as soon as a brand was passed. AND-ing
    // the sub-clauses keeps both predicates active.
    const userClauses: any[] = [];
    if (!isFinalApprover) userClauses.push({ managerId: myId! });
    // Org-wide brand isolation (2026-07-15): without VIEW_ALL_BRANDS the
    // caller's queue only ever contains their OWN brand's employees,
    // whatever ?brand= says. All-brands viewers pass through untouched.
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

    const selectUser = { id: true, name: true, email: true, profilePictureUrl: true, teamCapsule: true, role: true };
    // `businessUnit` is needed by the UI so HR can split the approvals
    // list into NB Media vs YT Labs tabs (each manager sees their brand
    // by default; the founder sees both via the "All" tab).
    const selectProfile = { department: true, designation: true, workLocation: true, employeeId: true, businessUnit: true };

    const includeUser = {
      user: { select: { ...selectUser, employeeProfile: { select: selectProfile } } },
      approver: { select: { id: true, name: true } },
    };

    // Status filter — "all" shows the full history for audit; "active" adds
    // "approved" to the actionable list so upcoming-approved leaves are
    // visible alongside pending ones; "pending" shows only actionable rows.
    const statusFilter = (pendingStatuses: string[]) => {
      if (scope === "all")    return {};
      if (scope === "active") return { status: { in: [...pendingStatuses, "approved"] } };
      return { status: { in: pendingStatuses } };
    };

    if (tab === "leave") {
      const rows = await prisma.leaveApplication.findMany({
        where: {
          ...statusFilter(["pending", "partially_approved"]),
          ...teamWhere,
          ...leaveMonth,
        },
        include: {
          leaveType: true,
          ...includeUser,
          finalApprover: { select: { id: true, name: true } },
          // POC = the person the applicant named to cover for them while
          // they're out (shown in the approvals list). pocUserId/workStatus
          // are scalar columns already returned; this adds the POC's name.
          poc: { select: { id: true, name: true, profilePictureUrl: true } },
        },
        orderBy: { appliedAt: "desc" },
        take: 300,
      });

      // Count badge: total pending leaves the viewer can still act on.
      const pendingForViewer = rows.filter((r) => {
        if (r.status === "pending") {
          // Managers can act on their team's pending; CEO / HR can also step in.
          return isManager || isFinalApprover;
        }
        if (r.status === "partially_approved") {
          return isFinalApprover;
        }
        return false;
      }).length;

      return NextResponse.json(serializeBigInt({ items: rows, count: pendingForViewer }));
    }

    if (tab === "regularize") {
      // Regularization is HR-admin-only — managers don't see this queue at
      // all (they can't approve, so showing them empty pending rows is just
      // noise). Final approvers see everything.
      if (!isFinalApprover) {
        return NextResponse.json(serializeBigInt({ items: [], count: 0 }));
      }
      const rows = await prisma.attendanceRegularization.findMany({
        where: { ...statusFilter(["pending", "partially_approved"]), ...teamWhere, ...createdMonth },
        include: includeUser,
        orderBy: { createdAt: "desc" },
        take: 300,
      });
      return NextResponse.json(serializeBigInt({ items: rows, count: rows.length }));
    }

    if (tab === "wfh") {
      // "WFH / OD" tab combines both request types — they're workflow-identical.
      // Both flow through L1 (manager) → L2 (HR/CEO/Dev), so include
      // partially_approved so final approvers see stage-2 items.
      const [wfhRows, odRows] = await Promise.all([
        prisma.wFHRequest.findMany({
          where: { ...statusFilter(["pending", "partially_approved"]), ...teamWhere, ...createdMonth },
          include: includeUser,
          orderBy: { createdAt: "desc" },
          take: 300,
        }),
        prisma.onDutyRequest.findMany({
          where: { ...statusFilter(["pending", "partially_approved"]), ...teamWhere, ...createdMonth },
          include: includeUser,
          orderBy: { createdAt: "desc" },
          take: 300,
        }),
      ]);
      const items = [
        ...wfhRows.map((r) => ({ ...r, _kind: "wfh" as const })),
        ...odRows.map((r)  => ({ ...r, _kind: "on_duty" as const })),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return NextResponse.json(serializeBigInt({ items, count: items.length }));
    }

    if (tab === "comp_off") {
      // Comp-off also runs the L1 → L2 flow now — include partially_approved.
      const rows = await prisma.compOffRequest.findMany({
        where: { ...statusFilter(["pending", "partially_approved"]), ...teamWhere, ...createdMonth },
        include: includeUser,
        orderBy: { createdAt: "desc" },
        take: 300,
      });
      return NextResponse.json(serializeBigInt({ items: rows, count: rows.length }));
    }

    // Other tabs (leave_encashment, half_day, shift_weekly_off) don't have
    // backing tables yet — return empty + surface a consistent shape.
    return NextResponse.json({ items: [], count: 0 });
  } catch (e) { return serverError(e, "GET /api/hr/approvals"); }
}
