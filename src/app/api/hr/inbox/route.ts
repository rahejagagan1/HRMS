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

    // Status filter differs per view. Archive = genuinely DECIDED items from
    // the last 90 days. The action view carries BOTH approval stages:
    //   pending            = L1, waiting on the reporting manager
    //   partially_approved = L2, manager done, waiting on the final approver
    // partially_approved used to be filed under "archive", so an L1-approved
    // request vanished from the action queue and sat in a tab labelled
    // "resolved" — the final approver was never shown the very requests
    // waiting on them (207 org-wide when this was found). The Approvals panel
    // (/api/hr/approvals) always counted both, so the two surfaces disagreed.
    // The action view returns decided rows too (last 90 days) so the page can
    // offer a status filter — "Pending" stays the default, but an approver can
    // switch to Approved / Rejected / All without leaving the tab. Filtering
    // happens client-side; the payload stays one round-trip.
    const statusFilter =
      view === "archive"
        ? { status: { in: ["approved", "rejected"] }, updatedAt: { gte: ninetyDaysAgo } }
        : {
            OR: [
              { status: { in: ["pending", "partially_approved"] } },
              { status: { in: ["approved", "rejected"] }, updatedAt: { gte: ninetyDaysAgo } },
            ],
          };
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
