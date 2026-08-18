import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isHRAdmin, serverError } from "@/lib/api-auth";
import { canViewDoorEntryLog } from "@/lib/access";
import { istTodayDateOnly } from "@/lib/ist-date";
import { dayBars } from "@/lib/hr/day-rules";
import { shortLeaveDayState, resolveShortLeaveDayStatus, isShortLeaveReason } from "@/lib/hr/short-leave";

// GET /api/hr/attendance?userId=X&month=2026-04
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const self = session!.user as any;
    const { searchParams } = new URL(req.url);
    const isAdmin = isHRAdmin(self);

    // Resolve dbId — fallback to DB lookup by email if session doesn't have it
    let myDbId = self.dbId;
    if (!myDbId && self.email) {
      const dbUser = await prisma.user.findUnique({ where: { email: self.email }, select: { id: true } });
      myDbId = dbUser?.id;
    }
    if (!myDbId) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const targetUserId = isAdmin
      ? parseInt(searchParams.get("userId") || String(myDbId))
      : myDbId;

    // Door-entry log (every biometric scan / mid-day re-entry). Privileged
    // viewers (managers / HR / CEO / devs) may see it for anyone; and EVERY
    // employee may see it for their OWN record (targetUserId === myDbId), so a
    // person's self-service attendance shows the same punch log HR sees. A
    // non-admin's targetUserId is always forced to self above, so this never
    // exposes another person's log.
    const canSeeDoor = canViewDoorEntryLog(self) || targetUserId === myDbId;

    const month = searchParams.get("month");
    const fromStr = searchParams.get("from");  // YYYY-MM-DD (inclusive)
    const toStr   = searchParams.get("to");    // YYYY-MM-DD (inclusive)
    let fromDate: Date, toDate: Date;
    if (fromStr && toStr) {
      fromDate = new Date(`${fromStr}T00:00:00.000Z`);
      toDate   = new Date(`${toStr}T00:00:00.000Z`);
    } else if (month) {
      const [y, m] = month.split("-").map(Number);
      fromDate = new Date(Date.UTC(y, m - 1, 1));
      toDate   = new Date(Date.UTC(y, m, 0));
    } else {
      const today = istTodayDateOnly();
      const [y, m] = [today.getUTCFullYear(), today.getUTCMonth()];
      fromDate = new Date(Date.UTC(y, m, 1));
      toDate   = new Date(Date.UTC(y, m + 1, 0));
    }

    // The viewer's shift (with the sat* columns day-rules needs) so status is
    // re-derived against the SHIFT's own full/half bars (Saturday-aware) — never
    // a hardcoded 9h/4.5h. Raw SQL so a stale generated client can't hide sat*.
    const dayShiftRows = await prisma.$queryRawUnsafe<Array<{ startTime: string | null; endTime: string | null; breakMinutes: number | null; satStartTime: string | null; satEndTime: string | null; satGraceMinutes: number | null }>>(
      `SELECT s."startTime", s."endTime", s."breakMinutes", s."satStartTime", s."satEndTime", s."satGraceMinutes"
         FROM "UserShift" us JOIN "Shift" s ON s.id = us."shiftId" WHERE us."userId" = $1`,
      targetUserId,
    ).catch(() => [] as any[]);
    const dayShift = dayShiftRows[0] ?? null;

    const records = await prisma.attendance.findMany({
      where: { userId: targetUserId, date: { gte: fromDate, lte: toDate } },
      orderBy: { date: "asc" },
    });

    // Short-leave applications overlapping the page. A short leave excuses
    // 2h per slot, so the day's required bar drops by that much — without
    // this, re-derivation below judged a completed reduced day (e.g. 7h of a
    // 9h shift with an approved 2h short leave) against the FULL bar and
    // displayed "Half Day" for a day that carries no penalty at all.
    const slRows = await prisma.leaveApplication.findMany({
      where: { userId: targetUserId, fromDate: { lte: toDate }, toDate: { gte: fromDate } },
      select: { fromDate: true, toDate: true, reason: true, status: true },
    });
    const ymdKey = (d: Date) => new Date(d).toISOString().slice(0, 10);
    const slByDate = new Map<string, Array<{ reason: string | null; status: string }>>();
    for (const l of slRows) {
      if (!isShortLeaveReason(l.reason)) continue;
      // Short leave is always a single date, but walk the range defensively.
      const cur = new Date(Date.UTC(l.fromDate.getUTCFullYear(), l.fromDate.getUTCMonth(), l.fromDate.getUTCDate()));
      const stop = new Date(Date.UTC(l.toDate.getUTCFullYear(), l.toDate.getUTCMonth(), l.toDate.getUTCDate()));
      while (cur.getTime() <= stop.getTime()) {
        const k = ymdKey(cur);
        const arr = slByDate.get(k) ?? [];
        arr.push({ reason: l.reason, status: l.status });
        slByDate.set(k, arr);
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    // Attach the sessions[] array to each record so the UI can render
    // multi-session days. One round-trip — fetch all sessions for the
    // page's records in a single query, then bucket by attendanceId.
    const recordIds = records.map((r) => r.id);
    // clockInLocation / clockOutLocation are JSON-stringified geo blobs
    // (same format as Attendance.location). Per-session so multi-session
    // days can show where each individual punch happened, not just the
    // last clock-in for the whole day.
    type SessRow = { id: number; attendanceId: number; clockIn: Date; clockOut: Date | null; clockInLocation: string | null; clockOutLocation: string | null };
    const sessions = recordIds.length
      ? await prisma.$queryRawUnsafe<SessRow[]>(
          `SELECT id, "attendanceId", "clockIn", "clockOut", "clockInLocation", "clockOutLocation"
             FROM "AttendanceSession"
            WHERE "attendanceId" = ANY($1::int[])
            ORDER BY "clockIn" ASC`,
          recordIds,
        )
      : [];
    const sessionsByAttendance = new Map<number, SessRow[]>();
    for (const s of sessions) {
      if (!sessionsByAttendance.has(s.attendanceId)) sessionsByAttendance.set(s.attendanceId, []);
      sessionsByAttendance.get(s.attendanceId)!.push(s);
    }
    // Re-sum totalMinutes (and re-derive status) from the session rows on
    // read — defensive against drift that happens when ops scripts edit a
    // session's clockIn/clockOut directly without recomputing the parent
    // Attendance row. The clock-out API does this server-side at write
    // time, but historic data and out-of-band edits can leave the parent
    // stale; matching the writer's math here keeps the UI honest.
    //
    // Open sessions (no clockOut) are skipped — that's "live time" the
    // client renders on top of the stored snapshot, not committed work.
    function rederive(sess: SessRow[], existingStatus: string, recDate: Date): { totalMinutes: number; status: string } {
      let secs = 0;
      for (const s of sess) {
        if (!s.clockOut) continue;
        secs += Math.max(0, Math.floor((s.clockOut.getTime() - s.clockIn.getTime()) / 1000));
      }
      const totalMinutes = Math.floor(secs / 60);
      // Status is derived only for clock-based statuses. Leave (on_leave,
      // weekly_off, holiday, absent) statuses are preserved — those aren't
      // about how much was worked.
      const isClockStatus = existingStatus === "present"
        || existingStatus === "late"
        || existingStatus === "half_day"
        || existingStatus === "missed_clock_out";
      if (!isClockStatus) return { totalMinutes, status: existingStatus };
      // Full/half bars come from the employee's SHIFT (Saturday-aware, via the
      // shared day-rules) — NOT a hardcoded 9h/4.5h. This is what a short
      // Saturday needs: a completed 6h Saturday reads as present, not half-day.
      const { full, half } = dayBars(recDate, dayShift);
      // Short-leave days go through the SAME shared resolver clock-out and
      // auto-LOP use, so a page can never disagree with the payslip: a live
      // short leave lowers the bar by 2h/slot (completed → full day), and a
      // rejected one prices the [bar−2h, bar) band at ¼ day.
      const slDay = slByDate.get(ymdKey(recDate));
      if (slDay?.length) {
        const st = shortLeaveDayState(slDay);
        return {
          totalMinutes,
          status: resolveShortLeaveDayStatus({
            worked: totalMinutes, fullBar: full, halfBar: half,
            activeMin: st.activeMin, rejectedMin: st.rejectedMin, prevStatus: existingStatus,
          }),
        };
      }
      let status = existingStatus;
      if      (totalMinutes >= full) status = existingStatus === "late" ? "late" : "present";
      else if (totalMinutes >= half) status = "half_day";
      return { totalMinutes, status };
    }

    // Door-entry audit — every mid-day door-open / re-entry scan. Gated to
    // managers / HR / CEO / devs (regular employees never receive it, so it
    // can't leak client-side). Queried by userId + scannedAt — NOT attendanceId,
    // because the day's first scan logs with a null attendanceId — and bucketed
    // by IST calendar date so it lines up with each attendance row's `date`.
    const istDateKey = (d: Date) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const doorByDate = new Map<string, Array<{ scannedAt: Date; source: string }>>();
    if (canSeeDoor) {
      // fromDate / toDate are UTC-midnight stamps of the first / last IST days
      // in range. A scan's UTC instant can land up to 5.5h on either side of
      // its IST calendar day, so widen the SQL window a full day on each side
      // (and through today, so today's entries show even while browsing a past
      // month). istDateKey below is the source of truth for which day each
      // entry attaches to — over-fetched days bucket to dates with no record
      // and are ignored — so this guarantees no boundary entry is dropped.
      const doorLo = new Date(fromDate.getTime() - 24 * 3600 * 1000);
      const doorHi = new Date(Math.max(toDate.getTime(), Date.now()) + 24 * 3600 * 1000);
      const doorRows = await prisma.$queryRawUnsafe<Array<{ scannedAt: Date; source: string }>>(
        `SELECT "scannedAt", "source" FROM "DoorEntry" WHERE "userId" = $1 AND "scannedAt" >= $2 AND "scannedAt" < $3 ORDER BY "scannedAt" ASC`,
        targetUserId, doorLo, doorHi,
      );
      for (const d of doorRows) {
        const k = istDateKey(d.scannedAt);
        if (!doorByDate.has(k)) doorByDate.set(k, []);
        doorByDate.get(k)!.push({ scannedAt: d.scannedAt, source: d.source });
      }
    }

    const recordsWithSessions = records.map((r) => {
      const sess = sessionsByAttendance.get(r.id) ?? [];
      const fixed = rederive(sess, r.status, r.date);
      const base = { ...r, totalMinutes: fixed.totalMinutes, status: fixed.status, sessions: sess };
      return canSeeDoor ? { ...base, doorEntries: doorByDate.get(istDateKey(r.date)) ?? [] } : base;
    });

    // Summary rolls up the re-derived status (not the stale DB column) so
    // the cards above the table match what each row actually shows.
    const summary = { present: 0, absent: 0, late: 0, halfDay: 0, onLeave: 0, totalOvertimeMinutes: 0 };
    for (const r of recordsWithSessions) {
      if (r.status === "present") summary.present++;
      else if (r.status === "absent") summary.absent++;
      else if (r.status === "late") { summary.late++; summary.present++; }
      else if (r.status === "half_day") summary.halfDay++;
      else if (r.status === "on_leave") summary.onLeave++;
      summary.totalOvertimeMinutes += r.overtimeMinutes;
    }

    const today = istTodayDateOnly();
    const [todayRecord, odToday, userShift] = await Promise.all([
      prisma.attendance.findUnique({
        where: { userId_date: { userId: targetUserId, date: today } },
      }),
      // Surfaced to the UI so the home + attendance pages can keep the
      // clock-in / clock-out buttons enabled on mobile when the viewer
      // has an On-Duty covering today. Pending counts — mirrors the
      // server bypass in the clock-in / clock-out POST handlers (an
      // OD in any status that isn't rejected/cancelled unlocks mobile).
      prisma.onDutyRequest.findFirst({
        where: {
          userId: targetUserId,
          date: today,
          status: { notIn: ["rejected", "cancelled"] },
        },
        select: { id: true },
      }),
      // The viewer's assigned shift — drives the Timings widget, the
      // shift-progress bar, "time left", AND the absent / weekly-off synthesis
      // (working-day decision). Raw SQL so the saturday* columns work before
      // `prisma generate` picks them up.
      prisma.$queryRawUnsafe<Array<{ effectiveFrom: Date; startTime: string; endTime: string; breakMinutes: number; workDays: unknown; saturdayPolicy: string; saturdayWeeks: number[]; shiftCreatedAt: Date }>>(
        `SELECT us."effectiveFrom", s."startTime", s."endTime", s."breakMinutes", s."workDays", s."saturdayPolicy", s."saturdayWeeks", s."createdAt" AS "shiftCreatedAt"
           FROM "UserShift" us JOIN "Shift" s ON s.id = us."shiftId" WHERE us."userId" = $1`,
        targetUserId,
      ),
    ]);
    const usRow = Array.isArray(userShift) ? userShift[0] : null;
    let todayRecordWithSessions: any = todayRecord;
    if (todayRecord) {
      // Today's record may not be in the requested range (e.g. when the
      // user is browsing a past month) so fetch its sessions separately.
      const todaySessions = await prisma.$queryRawUnsafe<SessRow[]>(
        `SELECT id, "attendanceId", "clockIn", "clockOut", "clockInLocation", "clockOutLocation"
           FROM "AttendanceSession"
          WHERE "attendanceId" = $1
          ORDER BY "clockIn" ASC`,
        todayRecord.id,
      );
      const fixed = rederive(todaySessions, todayRecord.status, todayRecord.date);
      todayRecordWithSessions = {
        ...todayRecord,
        totalMinutes: fixed.totalMinutes,
        status: fixed.status,
        sessions: todaySessions,
        ...(canSeeDoor ? { doorEntries: doorByDate.get(istDateKey(todayRecord.date)) ?? [] } : {}),
      };
    }

    return NextResponse.json({
      records: recordsWithSessions,
      summary,
      todayRecord: todayRecordWithSessions,
      // True when any non-rejected/cancelled OD record exists for
      // today — that's what unlocks the mobile clock-in/out bypass.
      // Old name `hasApprovedOdToday` is kept as an alias so any
      // unreleased client code still works during the deploy window.
      hasOdToday: !!odToday,
      hasApprovedOdToday: !!odToday,
      // Assigned shift (null = none → page falls back to the 9–18 default /
      // Mon–Fri working days).
      shift: usRow ? {
        startTime: usRow.startTime, endTime: usRow.endTime, breakMinutes: usRow.breakMinutes,
        workDays: usRow.workDays, saturdayPolicy: usRow.saturdayPolicy, saturdayWeeks: usRow.saturdayWeeks,
        // Shift-level anchor for the alternate-Saturday phase (uniform across
        // all users on the shift). The client passes this to isWorkingDay.
        createdAt: usRow.shiftCreatedAt,
      } : null,
      shiftEffectiveFrom: usRow?.effectiveFrom ?? null,
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/attendance");
  }
}
