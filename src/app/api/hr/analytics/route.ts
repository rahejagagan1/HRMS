import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { istTodayDateOnly } from "@/lib/ist-date";

// HR-admin only — org-wide headcount + new-joiners + exits + per-
// department breakdowns. Previously open to every authenticated
// employee (any intern could see leadership-only org metrics).
export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    // Anchor month boundaries to the IST calendar so newJoiners / exits
    // don't shift around UTC midnight (which is 05:30 IST). Pulling year/
    // month off the IST "today" gives the right month name everywhere.
    const todayIst = istTodayDateOnly();
    const y = todayIst.getUTCFullYear();
    const m = todayIst.getUTCMonth();
    const thisMonth = new Date(Date.UTC(y, m,     1));
    const lastMonth = new Date(Date.UTC(y, m - 1, 1));

    const [totalEmployees, activeEmployees, newJoiners, exits, attendanceToday, pendingLeaves, openTickets, totalAssets, assignedAssets] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.employeeProfile.count({ where: { joiningDate: { gte: thisMonth } } }),
      prisma.user.count({ where: { isActive: false, updatedAt: { gte: thisMonth } } }),
      prisma.attendance.groupBy({ by: ["status"], where: { date: todayIst }, _count: true }),
      prisma.leaveApplication.count({ where: { status: "pending" } }),
      prisma.ticket.count({ where: { status: { in: ["open", "in_progress"] } } }),
      prisma.asset.count(),
      prisma.asset.count({ where: { status: "assigned" } }),
    ]);

    const attendanceMap: Record<string, number> = {};
    attendanceToday.forEach((r) => { attendanceMap[r.status] = r._count; });

    const deptBreakdown = await prisma.employeeProfile.groupBy({ by: ["department"], _count: true });
    const typeBreakdown = await prisma.employeeProfile.groupBy({ by: ["employmentType"], _count: true });

    return NextResponse.json({
      workforce: { totalEmployees, activeEmployees, newJoiners, exits },
      attendance: { present: (attendanceMap.present || 0) + (attendanceMap.late || 0), absent: attendanceMap.absent || 0, late: attendanceMap.late || 0, onLeave: attendanceMap.on_leave || 0 },
      leaves: { pendingApprovals: pendingLeaves },
      tickets: { open: openTickets },
      assets: { total: totalAssets, assigned: assignedAssets, available: totalAssets - assignedAssets },
      departments: deptBreakdown.filter((d) => d.department).map((d) => ({ name: d.department, count: d._count })),
      employmentTypes: typeBreakdown.map((t) => ({ type: t.employmentType, count: t._count })),
    });
  } catch (e) { return serverError(e, "GET /api/hr/analytics"); }
}
