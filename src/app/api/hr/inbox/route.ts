import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError, isHRAdmin } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/inbox
 *
 * Query params:
 *   view=pending   (default) → items awaiting approval
 *   view=archive            → recently resolved items (approved / rejected)
 *                             from the last 90 days, newest first
 *
 * Travel was removed — the product no longer surfaces travel in the inbox.
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user  = session!.user as any;
  const myId  = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
  // RBAC-designation-driven (policy 2026-07-14) — shared isHRAdmin resolves
  // MANAGE_HR from the caller's designation.
  const isAdmin = isHRAdmin(user);

  try {
    const { searchParams } = new URL(req.url);
    const view = searchParams.get("view") === "archive" ? "archive" : "pending";

    const teamFilter = isAdmin ? {} : { user: { managerId: myId } };
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Status filter differs per view. Archive looks at decided items updated
    // within the last 90 days; pending is the classic approvals inbox.
    const statusFilter =
      view === "archive"
        ? { status: { in: ["approved", "rejected", "partially_approved"] }, updatedAt: { gte: ninetyDaysAgo } }
        : { status: "pending" };
    const orderBy = view === "archive" ? { updatedAt: "desc" as const } : { createdAt: "desc" as const };

    const userSelect = { select: { id: true, name: true, profilePictureUrl: true } };

    const [leaves, expenses, regs, wfh, onDuty, compOff] = await Promise.all([
      prisma.leaveApplication.findMany({
        where: { ...statusFilter, ...teamFilter },
        include: { user: userSelect, leaveType: { select: { name: true } } },
        orderBy: view === "archive" ? { updatedAt: "desc" } : { appliedAt: "desc" },
        take: 30,
      }),
      prisma.expense.findMany({
        where: { ...statusFilter, ...teamFilter },
        include: { user: userSelect },
        orderBy, take: 30,
      }),
      prisma.attendanceRegularization.findMany({
        where: { ...statusFilter, ...teamFilter },
        include: { user: userSelect },
        orderBy, take: 30,
      }),
      prisma.wFHRequest.findMany({
        where: { ...statusFilter, ...teamFilter },
        include: { user: userSelect },
        orderBy, take: 30,
      }),
      prisma.onDutyRequest.findMany({
        where: { ...statusFilter, ...teamFilter },
        include: { user: userSelect },
        orderBy, take: 30,
      }),
      prisma.compOffRequest.findMany({
        where: { ...statusFilter, ...teamFilter },
        include: { user: userSelect },
        orderBy, take: 30,
      }),
    ]);

    return NextResponse.json({
      view,
      leaves,
      expenses,
      regularizations: regs,
      wfh,
      onDuty,
      compOff,
      total: leaves.length + expenses.length + regs.length + wfh.length + onDuty.length + compOff.length,
    });
  } catch (e) { return serverError(e, "GET /api/hr/inbox"); }
}
