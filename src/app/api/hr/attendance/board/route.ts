import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { istTodayDateOnly } from "@/lib/ist-date";
import { getPoliciesByUser } from "@/lib/hr/notification-policy";

// Live board — must never be cached (statuses change through the day, and a
// stale copy shows wrong late/present/leave badges even after the data changes).
export const dynamic = "force-dynamic";

// GET /api/hr/attendance/board — today's team attendance board
export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const today = istTodayDateOnly();

    const allActive = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, profilePictureUrl: true, role: true,
        // businessUnit comes through the employee profile and lets
        // the HR home page brand-scope the "On Leave Today" and
        // "Working Remotely" lists per viewer. NULL bucket = NB Media
        // (parent-brand default, matches the rest of the app).
        employeeProfile: { select: { businessUnit: true } },
      },
      orderBy: { name: "asc" },
    });
    // Exclude anyone whose last working day has passed — they've exited and
    // fall off the attendance board (their account stays for payslip access).
    const exitedRows = await prisma.employeeExit.findMany({
      where: { lastWorkingDay: { lt: today } },
      select: { userId: true },
    });
    const exitedIds = new Set(exitedRows.map((e) => e.userId));

    // Filter out attendance-disabled users (CEO + developers default OFF;
    // HR can override via the toggles page). They don't appear on the
    // home page's attendance lists or in the counts.
    const policies = await getPoliciesByUser(allActive.map((u) => u.id));
    const allUsers = allActive.filter((u) =>
      policies.get(u.id)?.attendanceEnabled !== false && !exitedIds.has(u.id));

    const todayRecords = await prisma.attendance.findMany({
      where: { date: today },
      select: { userId: true, status: true, clockIn: true, clockOut: true, totalMinutes: true, location: true },
    });

    const recordMap = new Map(todayRecords.map((r) => [r.userId, r]));

    // Anyone who's *applied* for WFH today — we treat any non-final status as
    // "WFH today" so the home page can list them as Working Remotely without
    // waiting for manager approval. Excludes rejected / cancelled requests.
    const wfhTodayRows = await prisma.wFHRequest.findMany({
      where: {
        date: today,
        status: { notIn: ["rejected", "cancelled"] },
      },
      select: { userId: true, reason: true },
      orderBy: { createdAt: "desc" }, // newest request wins for the half-day kind
    });
    const wfhTodayIds = new Set(wfhTodayRows.map((r) => r.userId));

    // Per-user WFH half-day kind for the "Working Remotely" badge. Uses the
    // SAME [First Half]/[Second Half]/[Half Day] markers the leave form writes —
    // the WFH form stamps them into the reason too. (no marker → full)
    const wfhKindByUser = new Map<number, "full" | "first_half" | "second_half">();
    for (const r of wfhTodayRows) {
      if (wfhKindByUser.has(r.userId)) continue; // newest (first) row wins
      const reason = r.reason || "";
      let kind: "full" | "first_half" | "second_half" = "full";
      if      (/\[First Half\]/i.test(reason))  kind = "first_half";
      else if (/\[Second Half\]/i.test(reason)) kind = "second_half";
      else if (/\[Half Day\]/i.test(reason))    kind = "first_half"; // legacy
      wfhKindByUser.set(r.userId, kind);
    }

    // Anyone with a leave application that *covers* today, in any status that
    // isn't rejected/cancelled. Mirrors the WFH treatment so the On Leave list
    // reflects intent even before approval lands.
    const leaveTodayRows = await prisma.leaveApplication.findMany({
      where: {
        fromDate: { lte: today },
        toDate:   { gte: today },
        status:   { notIn: ["rejected", "cancelled"] },
      },
      select: { userId: true, reason: true },
      orderBy: { appliedAt: "desc" },
    });
    const leaveTodayIds = new Set(leaveTodayRows.map((r) => r.userId));

    // Per-user leave kind for the home-page badge: "full" | "first_half" |
    // "second_half". Derived from markers in the reason string written by the
    // leave form. Convention:
    //   [First Half]  ... → first_half
    //   [Second Half] ... → second_half
    //   [Half Day]    ... → first_half  (legacy — pre-split half-day requests)
    //   (no marker)       → full
    type LeaveKind = "full" | "first_half" | "second_half";
    const leaveKindByUser = new Map<number, LeaveKind>();
    for (const r of leaveTodayRows) {
      if (leaveKindByUser.has(r.userId)) continue; // first (newest) row wins
      const reason = r.reason || "";
      let kind: LeaveKind = "full";
      if      (/\[First Half\]/i.test(reason))  kind = "first_half";
      else if (/\[Second Half\]/i.test(reason)) kind = "second_half";
      else if (/\[Half Day\]/i.test(reason))    kind = "first_half"; // legacy
      leaveKindByUser.set(r.userId, kind);
    }

    const board = allUsers.map((u) => {
      const rec = recordMap.get(u.id);
      const { employeeProfile, ...rest } = u;
      return {
        ...rest,
        status: rec?.status || "absent",
        clockIn: rec?.clockIn || null, clockOut: rec?.clockOut || null,
        totalMinutes: rec?.totalMinutes || 0,
        location: rec?.location ?? null,
        wfhToday:   wfhTodayIds.has(u.id),
        wfhKind:    wfhKindByUser.get(u.id) ?? null,
        leaveToday: leaveTodayIds.has(u.id),
        leaveKind:  leaveKindByUser.get(u.id) ?? null,
        // Brand for client-side filtering. Bucket NULL as NB Media
        // (parent-brand default).
        businessUnit: employeeProfile?.businessUnit || "NB Media",
      };
    });

    const counts = {
      present: board.filter((u) => u.status === "present" || u.status === "late").length,
      absent: board.filter((u) => u.status === "absent").length,
      late: board.filter((u) => u.status === "late").length,
      onLeave: board.filter((u) => u.status === "on_leave").length,
      total: allUsers.length,
    };

    return NextResponse.json({ board, counts, date: today }, {
      headers: { "Cache-Control": "no-store, must-revalidate" },
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/attendance/board");
  }
}
