import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isHRAdmin, serverError } from "@/lib/api-auth";
import { serializeBigInt } from "@/lib/utils";
import { istTodayDateOnly } from "@/lib/ist-date";
import { getBrandScope } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

// GET /api/hr/admin/attendance-month-summary?month=YYYY-MM
// Computes the month's working days (calendar days − weekends − holidays),
// then per employee: Present (days with clock-in), On Leave, Late, Half-day,
// Absent (= working days − present − on leave, clamped ≥ 0).
// Gated to admin / CEO / HR manager / developer.
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const self = session!.user as any;
  if (!isHRAdmin(self)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month"); // YYYY-MM
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "Missing or invalid 'month' (expected YYYY-MM)" }, { status: 400 });
    }
    const [y, m] = month.split("-").map(Number);
    const fromDate = new Date(Date.UTC(y, m - 1, 1));
    const toDate   = new Date(Date.UTC(y, m, 1));
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

    // ── Build the working-day set for this month ──
    // Weekends = Sat(6) + Sun(0). Holidays come from HolidayCalendar (type
    // "public" | "company" only — optional holidays still count as working days).
    const holidaysRaw = await prisma.holidayCalendar.findMany({
      where: {
        date: { gte: fromDate, lt: toDate },
        type: { in: ["public", "company"] },
      },
      select: { date: true },
    });
    const holidaySet = new Set(holidaysRaw.map((h) => h.date.toISOString().slice(0, 10)));

    // Split into "all working days in the month" and "working days elapsed" —
    // the latter drives the live attendance % so it isn't diluted by future days.
    // Use IST "today" so the elapsed count flips at IST midnight, not UTC.
    const nowKey = istTodayDateOnly().toISOString().slice(0, 10);
    let workingDays = 0;
    let workingDaysElapsed = 0;
    let weekendDays = 0;
    let holidayDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(Date.UTC(y, m - 1, d));
      const dow = dt.getUTCDay();              // 0 = Sun, 6 = Sat
      const key = dt.toISOString().slice(0, 10);
      if (dow === 0 || dow === 6) { weekendDays++; continue; }
      if (holidaySet.has(key))    { holidayDays++; continue; }
      workingDays++;
      if (key <= nowKey) workingDaysElapsed++;
    }

    // ── Users + their attendance rows for the month ──
    // Brand-scope: NB Media HR Manager sees only NB Media users
    // unless they're allowlisted for cross-brand. Closes the leak
    // where the admin attendance dashboard mixed brands.
    const scope = getBrandScope(self);
    if (!scope.allBrands && !scope.brand) {
      return NextResponse.json({ users: [], workingDays, workingDaysElapsed, weekendDays, holidayDays, daysInMonth });
    }
    const usersRaw = await prisma.user.findMany({
      where: {
        isActive: true,
        ...(scope.allBrands ? {} : { employeeProfile: { businessUnit: scope.brand! } }),
      },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, email: true, role: true, orgLevel: true,
        teamCapsule: true, profilePictureUrl: true,
        employeeProfile: { select: { department: true, designation: true, employeeId: true } },
      },
    });
    // Exclude employees who exited BEFORE this month (last working day earlier
    // than the 1st) — they have no attendance to show. Someone who exited
    // during/after the month still worked part of it, so they remain listed.
    const exitedRows = await prisma.employeeExit.findMany({
      where: { lastWorkingDay: { lt: fromDate } },
      select: { userId: true },
    });
    const exitedIds = new Set(exitedRows.map((e) => e.userId));
    const users = usersRaw.filter((u) => !exitedIds.has(u.id));

    const att = await prisma.attendance.findMany({
      where: { date: { gte: fromDate, lt: toDate } },
      select: { userId: true, date: true, status: true, clockIn: true, totalMinutes: true },
    });

    // Per-user counters — every tile is a raw row count, no derived math.
    type Agg = { present: number; onLeave: number; absent: number; late: number; halfDay: number; totalMinutes: number };
    const byUser = new Map<number, Agg>();
    for (const r of att) {
      const a = byUser.get(r.userId) ?? { present: 0, onLeave: 0, absent: 0, late: 0, halfDay: 0, totalMinutes: 0 };
      // Skip weekend/holiday rows — they're not working days
      const dow = r.date.getUTCDay();
      const key = r.date.toISOString().slice(0, 10);
      const isNonWorking = dow === 0 || dow === 6 || holidaySet.has(key);
      if (isNonWorking) {
        byUser.set(r.userId, a);
        continue;
      }
      if (r.clockIn)               a.present += 1;
      if (r.status === "on_leave") a.onLeave += 1;
      if (r.status === "absent")   a.absent  += 1;
      if (r.status === "late")     a.late    += 1;
      if (r.status === "half_day") a.halfDay += 1;
      a.totalMinutes += r.totalMinutes ?? 0;
      byUser.set(r.userId, a);
    }

    const rows = users.map((u) => {
      const a = byUser.get(u.id) ?? { present: 0, onLeave: 0, absent: 0, late: 0, halfDay: 0, totalMinutes: 0 };
      return {
        id:           u.id,
        name:         u.name,
        email:        u.email,
        role:         u.role,
        orgLevel:     u.orgLevel,
        profilePictureUrl: u.profilePictureUrl,
        teamCapsule:  u.teamCapsule,
        employeeId:   u.employeeProfile?.employeeId  ?? null,
        designation:  u.employeeProfile?.designation ?? null,
        department:   u.employeeProfile?.department  ?? null,
        presentDays:  a.present,
        onLeaveDays:  a.onLeave,
        lateDays:     a.late,
        halfDayDays:  a.halfDay,
        absentDays:   a.absent,
        avgHours:     a.present > 0 ? +(a.totalMinutes / a.present / 60).toFixed(1) : 0,
      };
    });

    return NextResponse.json(serializeBigInt({
      month,
      workingDays,
      workingDaysElapsed,
      weekendDays,
      holidayDays,
      daysInMonth,
      employeeCount: users.length,
      rows,
    }));
  } catch (e) { return serverError(e, "GET /api/hr/admin/attendance-month-summary"); }
}
