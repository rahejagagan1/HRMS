import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { istTodayDateOnly } from "@/lib/ist-date";

export const dynamic = "force-dynamic";

// GET /api/hr/attendance/team-stats?period=week|month
//
// Compares the signed-in user's attendance (`me`) against every other active
// user sharing the same `teamCapsule` (the "team"). Returns:
//   { me: { avgMinutes, onTimePct, dayCount },
//     team: { avgMinutes, onTimePct, memberCount, dayCount,
//             teamCapsule, label },
//     period }
//
// Rules:
//   - avgMinutes = average of Attendance.totalMinutes over days where totalMinutes > 0
//   - onTimePct  = (present - late) / present * 100   (0..100, integer)
//   - "team" excludes me and is scoped to `isActive: true`.
//   - If the user has no teamCapsule, team is an empty set → null values.
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { searchParams } = new URL(req.url);
    const period = (searchParams.get("period") || "week").toLowerCase();

    // Period window (last 7 days or last 30 days, ending today IST).
    const today = istTodayDateOnly();
    const span  = period === "month" ? 30 : 7;
    const from  = new Date(today.getTime() - (span - 1) * 86_400_000);

    // My row — need teamCapsule to find peers.
    const me = await prisma.user.findUnique({
      where: { id: myId },
      select: { id: true, teamCapsule: true },
    });

    const periodPayload = {
      kind: period === "month" ? "last_30_days" : "last_7_days",
      from: from.toISOString().slice(0, 10),
      to:   today.toISOString().slice(0, 10),
      label: period === "month" ? "Last 30 Days" : "Last 7 Days",
    };

    // ── My stats ─────────────────────────────────────────────────────────
    const myRows = await prisma.attendance.findMany({
      where: { userId: myId, date: { gte: from, lte: today } },
      select: { status: true, totalMinutes: true },
    });
    const mePresent = myRows.filter((r) => r.status === "present" || r.status === "late").length;
    const meLate    = myRows.filter((r) => r.status === "late").length;
    const meWorked  = myRows.filter((r) => r.totalMinutes > 0);
    const meStats = {
      avgMinutes: meWorked.length > 0
        ? Math.round(meWorked.reduce((s, r) => s + r.totalMinutes, 0) / meWorked.length)
        : 0,
      onTimePct: mePresent > 0
        ? Math.round(((mePresent - meLate) / mePresent) * 100)
        : 0,
      dayCount: meWorked.length,
    };

    // ── Team stats ───────────────────────────────────────────────────────
    const teamCapsule = (me?.teamCapsule || "").trim();
    let teamStats: any = {
      avgMinutes: 0,
      onTimePct:  0,
      memberCount: 0,
      dayCount:    0,
      teamCapsule: teamCapsule || null,
      label:       teamCapsule ? `Team · ${teamCapsule}` : "No team assigned",
    };

    if (teamCapsule) {
      const peers = await prisma.user.findMany({
        where: { isActive: true, teamCapsule, NOT: { id: myId } },
        select: { id: true },
      });
      const peerIds = peers.map((p) => p.id);

      if (peerIds.length > 0) {
        const teamRows = await prisma.attendance.findMany({
          where: { userId: { in: peerIds }, date: { gte: from, lte: today } },
          select: { status: true, totalMinutes: true },
        });
        const tPresent = teamRows.filter((r) => r.status === "present" || r.status === "late").length;
        const tLate    = teamRows.filter((r) => r.status === "late").length;
        const tWorked  = teamRows.filter((r) => r.totalMinutes > 0);
        teamStats = {
          avgMinutes: tWorked.length > 0
            ? Math.round(tWorked.reduce((s, r) => s + r.totalMinutes, 0) / tWorked.length)
            : 0,
          onTimePct: tPresent > 0
            ? Math.round(((tPresent - tLate) / tPresent) * 100)
            : 0,
          memberCount: peerIds.length,
          dayCount: tWorked.length,
          teamCapsule,
          label: `Team · ${teamCapsule}`,
        };
      }
    }

    return NextResponse.json({ me: meStats, team: teamStats, period: periodPayload });
  } catch (e) { return serverError(e, "GET /api/hr/attendance/team-stats"); }
}
