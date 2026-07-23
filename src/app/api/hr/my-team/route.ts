import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { istTodayDateOnly, istMonthRange } from "@/lib/ist-date";
import { serializeBigInt } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Period = "today" | "week" | "month";

/**
 * Resolve the date range (UTC-midnight of the IST calendar boundaries)
 * for the requested period. Today = single day. Week = Monday→Sunday of
 * the current IST week. Month = current IST month via istMonthRange.
 */
function rangeFor(period: Period, today: Date): { from: Date; to: Date } {
  if (period === "today") return { from: today, to: today };
  if (period === "month") {
    const { start, end } = istMonthRange(today);
    return { from: start, to: end };
  }
  // Week: Monday → Sunday of the current IST week.
  // today is UTC-midnight of an IST calendar day, so getUTCDay() gives the
  // IST weekday number (0=Sun..6=Sat). We shift back to the prior Monday.
  const dow = today.getUTCDay();
  const offsetToMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - offsetToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: monday, to: sunday };
}

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const { searchParams } = new URL(req.url);
    const periodRaw = (searchParams.get("period") || "today").toLowerCase();
    const period: Period = periodRaw === "week" ? "week" : periodRaw === "month" ? "month" : "today";

    const today = istTodayDateOnly();
    const year  = today.getUTCFullYear();
    const { from, to } = rangeFor(period, today);

    // ── Resolve who's "in my team" ──────────────────────────────────────
    // Managers see their direct reports (existing behavior).
    // Non-managers see their PEERS (other people under the same manager)
    // PLUS the manager themselves, so a regular employee can still answer
    // "is anyone in my team on leave today?" and "what time did Riya
    // clock in?" without elevated permissions.
    const me = await prisma.user.findUnique({
      where: { id: myId },
      select: { id: true, managerId: true },
    });

    let memberIds: number[] = [];
    let scope: "manager" | "peer" | "solo" = "solo";

    const directReports = await prisma.user.findMany({
      where: { managerId: myId, isActive: true },
      select: { id: true },
    });

    if (directReports.length > 0) {
      scope = "manager";
      memberIds = directReports.map((u) => u.id);
    } else if (me?.managerId) {
      scope = "peer";
      const peers = await prisma.user.findMany({
        where: {
          isActive: true,
          OR: [
            { managerId: me.managerId },     // siblings
            { id: me.managerId },             // the manager themselves
          ],
          NOT: { id: myId },                  // exclude the viewer
        },
        select: { id: true },
      });
      memberIds = peers.map((u) => u.id);
    }

    if (memberIds.length === 0) {
      return NextResponse.json({
        scope, period,
        range: { from: from.toISOString(), to: to.toISOString() },
        onLeaveToday: [],
        members: [],
      });
    }

    // ── Fan-out: pull member details + period attendance + pending leaves ──
    const [members, attendances, pendingLeaves, balances, goals, leavesToday] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: memberIds } },
        select: {
          id: true, name: true, profilePictureUrl: true, role: true,
          employeeProfile: { select: { designation: true, department: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.attendance.findMany({
        where: { userId: { in: memberIds }, date: { gte: from, lte: to } },
        select: { userId: true, date: true, clockIn: true, clockOut: true, status: true, totalMinutes: true },
        orderBy: { date: "asc" },
      }),
      prisma.leaveApplication.findMany({
        where: { userId: { in: memberIds }, status: "pending" },
        select: {
          id: true, userId: true, fromDate: true, toDate: true, totalDays: true,
          leaveType: { select: { name: true } },
        },
        orderBy: { appliedAt: "desc" },
      }),
      prisma.leaveBalance.findMany({
        where: { userId: { in: memberIds }, year },
        select: {
          userId: true, totalDays: true, usedDays: true, pendingDays: true,
          leaveType: { select: { name: true } },
        },
      }),
      prisma.goal.findMany({
        where: { ownerId: { in: memberIds }, status: { not: "completed" } },
        select: { id: true, ownerId: true, title: true, progress: true, status: true },
        take: 200,
      }),
      // ── On-leave-today summary (separate from pending applications) ──
      // Anything covering today AND already in an "approved" or "pending"
      // state — gives the viewer one place to check who's out.
      prisma.leaveApplication.findMany({
        where: {
          userId: { in: memberIds },
          status:   { notIn: ["rejected", "cancelled"] },
          fromDate: { lte: today },
          toDate:   { gte: today },
        },
        select: {
          id: true, userId: true, status: true, fromDate: true, toDate: true, totalDays: true,
          leaveType: { select: { name: true } },
        },
      }),
    ]);

    const memberById = new Map(members.map((u) => [u.id, u]));

    // Group rows by userId so the UI can read each member's slice O(1).
    const byUser = <T extends { userId: number }>(rows: T[]) => {
      const m = new Map<number, T[]>();
      for (const r of rows) {
        const arr = m.get(r.userId) ?? [];
        arr.push(r);
        m.set(r.userId, arr);
      }
      return m;
    };
    const attByUser   = byUser(attendances);
    const leaveByUser = byUser(pendingLeaves);
    const balByUser   = byUser(balances);
    // Goal is owned via ownerId (not userId), so its grouping helper is bespoke.
    const goalByOwner = (() => {
      const m = new Map<number, typeof goals>();
      for (const g of goals) {
        const arr = m.get(g.ownerId) ?? [];
        arr.push(g);
        m.set(g.ownerId, arr);
      }
      return m;
    })();

    const enrichedMembers = members.map((m) => ({
      ...m,
      attendances:        attByUser.get(m.id)   ?? [],
      leaveApplications:  leaveByUser.get(m.id) ?? [],
      leaveBalances:      balByUser.get(m.id)   ?? [],
      goals:              goalByOwner.get(m.id) ?? [],
    }));

    const onLeaveToday = leavesToday.map((l) => {
      const u = memberById.get(l.userId);
      return {
        id: l.id,
        userId: l.userId,
        name: u?.name ?? "—",
        profilePictureUrl: u?.profilePictureUrl ?? null,
        leaveType: l.leaveType?.name ?? null,
        status: l.status,
        fromDate: l.fromDate,
        toDate:   l.toDate,
        totalDays: l.totalDays,
      };
    });

    return NextResponse.json(serializeBigInt({
      scope, period,
      range: { from: from.toISOString(), to: to.toISOString() },
      onLeaveToday,
      members: enrichedMembers,
    }));
  } catch (e) { return serverError(e, "GET /api/hr/my-team"); }
}
