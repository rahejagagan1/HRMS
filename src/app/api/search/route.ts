import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, isHRAdmin, serverError } from "@/lib/api-auth";
import { isDeveloperEmail } from "@/lib/hr/notification-policy";

export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=<term>&limit=<n>
 *
 * Master search. Fans out across Employees, Cases, Leaves, Expenses,
 * Attendance (WFH + OnDuty + Regularization combined), and Notifications
 * in parallel. Permissions mirror the rest of the HR module:
 *
 *   • Admins (CEO / HR-manager / developer) → see everything.
 *   • Managers → their own rows + their direct reports'.
 *   • Employees → only their own rows.
 *   • Employees and Cases are visible to everyone (directory-style).
 *   • Notifications are always scoped to the caller.
 *
 * Response shape:
 *   { q, total, employees, cases, leaves, expenses, attendance, notifications }
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const isAdmin = isHRAdmin(user);

  try {
    const { searchParams } = new URL(req.url);
    const q     = (searchParams.get("q") || "").trim();
    const limit = Math.min(parseInt(searchParams.get("limit") || "5", 10) || 5, 10);

    if (q.length < 2) {
      return NextResponse.json({
        q, total: 0,
        employees: [], cases: [], leaves: [], expenses: [], attendance: [], notifications: [],
      });
    }

    const contains = { contains: q, mode: "insensitive" as const };

    // Visibility filter for owned-by-user records — admin sees all, manager sees
    // their team + self, regular user sees only self.
    const ownershipWhere = isAdmin
      ? {}
      : { OR: [{ userId: myId }, { user: { managerId: myId } }] };

    // Developer invisibility: developer accounts (DEVELOPER_EMAILS env)
    // are hidden from everyone *except other developers*. Even the CEO
    // can't search up a developer. The viewer is excluded from this gate
    // (so a developer searching for themselves still finds themselves).
    const viewerIsDeveloper = isDeveloperEmail(user?.email ?? null);
    const devEmails = (process.env.DEVELOPER_EMAILS || "")
      .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const hideDevEmails = !viewerIsDeveloper && devEmails.length > 0 ? devEmails : [];

    const [employees, cases, leaves, expenses, wfh, onDuty, regs, notifications] = await Promise.all([
      // ── Employees ────────────────────────────────────────────────
      prisma.user.findMany({
        where: {
          // Include inactive (offboarded) employees too — HR often searches for
          // a past employee. `isActive` is returned so the UI can flag them.
          OR: [{ name: contains }, { email: contains }],
          ...(hideDevEmails.length > 0 ? { NOT: { email: { in: hideDevEmails } } } : {}),
        },
        select: { id: true, name: true, email: true, role: true, orgLevel: true, profilePictureUrl: true, teamCapsule: true, isActive: true },
        take: limit,
        // Active first, then by name — so current employees stay at the top.
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
      }),

      // ── Cases ────────────────────────────────────────────────────
      prisma.case.findMany({
        where: {
          OR: [{ name: contains }, { clickupTaskId: contains }, { channel: contains }],
        },
        select: { id: true, name: true, clickupTaskId: true, status: true, channel: true },
        take: limit,
        orderBy: { dateCreated: "desc" },
      }),

      // ── Leaves ───────────────────────────────────────────────────
      prisma.leaveApplication.findMany({
        where: {
          AND: [
            ownershipWhere,
            { OR: [{ reason: contains }, { user: { name: contains } }, { leaveType: { name: contains } }] },
          ],
        },
        include: {
          user:      { select: { id: true, name: true, profilePictureUrl: true } },
          leaveType: { select: { name: true, code: true } },
        },
        take: limit,
        orderBy: { appliedAt: "desc" },
      }),

      // ── Expenses ─────────────────────────────────────────────────
      prisma.expense.findMany({
        where: {
          AND: [
            ownershipWhere,
            { OR: [{ title: contains }, { description: contains }, { category: contains }, { user: { name: contains } }] },
          ],
        },
        include: { user: { select: { id: true, name: true, profilePictureUrl: true } } },
        take: limit,
        orderBy: { createdAt: "desc" },
      }),

      // ── WFH ──────────────────────────────────────────────────────
      prisma.wFHRequest.findMany({
        where: {
          AND: [ownershipWhere, { OR: [{ reason: contains }, { user: { name: contains } }] }],
        },
        include: { user: { select: { id: true, name: true, profilePictureUrl: true } } },
        take: limit,
        orderBy: { createdAt: "desc" },
      }),

      // ── On-Duty ──────────────────────────────────────────────────
      prisma.onDutyRequest.findMany({
        where: {
          AND: [
            ownershipWhere,
            { OR: [{ purpose: contains }, { location: contains }, { user: { name: contains } }] },
          ],
        },
        include: { user: { select: { id: true, name: true, profilePictureUrl: true } } },
        take: limit,
        orderBy: { createdAt: "desc" },
      }),

      // ── Regularization ───────────────────────────────────────────
      prisma.attendanceRegularization.findMany({
        where: {
          AND: [ownershipWhere, { OR: [{ reason: contains }, { user: { name: contains } }] }],
        },
        include: { user: { select: { id: true, name: true, profilePictureUrl: true } } },
        take: limit,
        orderBy: { createdAt: "desc" },
      }),

      // ── Notifications (always self) ──────────────────────────────
      prisma.notification.findMany({
        where: {
          userId: myId,
          OR: [{ title: contains }, { body: contains }],
        },
        select: { id: true, title: true, body: true, type: true, linkUrl: true, createdAt: true, isRead: true },
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // Merge the three attendance-shaped entities into one flat list, tagged
    // with their kind so the UI can render the right icon/label.
    const attendance = [
      ...wfh.map((x: any)    => ({ ...x, kind: "wfh"        as const })),
      ...onDuty.map((x: any) => ({ ...x, kind: "on_duty"    as const })),
      ...regs.map((x: any)   => ({ ...x, kind: "regularize" as const })),
    ]
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, limit);

    const total = employees.length + cases.length + leaves.length + expenses.length + attendance.length + notifications.length;

    return NextResponse.json({
      q, total,
      employees, cases, leaves, expenses, attendance, notifications,
    });
  } catch (e) {
    return serverError(e, "GET /api/search");
  }
}
