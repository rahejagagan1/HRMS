import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { parseBody } from "@/lib/validate";
import { stringifyAttLoc } from "@/lib/attendance-location";
import { istTodayDateOnly } from "@/lib/ist-date";
import { isMobileRequest } from "@/lib/is-mobile-device";
import { desktopBypassMode } from "@/lib/desktop-bypass";
import { isAttendanceEnabled } from "@/lib/hr/notification-policy";
import { isAfterSendTime, getWeekKey } from "@/lib/hr/pulse-week";
import { resolveClientPunchAt } from "@/lib/hr/punch-time";
import { isExitSurveyDue } from "@/lib/hr/exit-survey";

// Same shape as the clock-in body. Optional here because legacy
// callers (cron sweeper, integration tests, anyone POSTing an empty
// body) still need to work — clock-out without location is allowed,
// the field just stays NULL on the session row.
// `clientPunchAt` is the moment the user actually clicked, sent by the
// offline retry queue so a late-synced punch records at the real time
// (bounded server-side by resolveClientPunchAt — see that helper).
const ClockOutBody = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  address: z.string().trim().max(240).optional(),
  clientPunchAt: z.string().max(40).optional(),
}).partial();

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const user = session!.user as any;
    let userId: number = user.dbId;
    if (!userId && user.email) {
      const dbUser = await prisma.user.findUnique({ where: { email: user.email }, select: { id: true } });
      userId = dbUser?.id!;
    }
    if (!userId) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // ── Weekly Pulse gate ──────────────────────────────────────
    // On Fridays from 10:30 IST onwards, every employee must submit
    // this week's Pulse before clocking out. Skip for developers
    // (they own the dashboard plumbing and shouldn't be locked out
    // when testing) and for any future system / cron clock-out
    // callers that pass a special header.
    const isSystemCaller =
      req.headers.get("x-system-clockout") === "1" || user?.isDeveloper === true;
    if (!isSystemCaller && isAfterSendTime()) {
      const weekKey = getWeekKey();
      const submitted = await prisma.$queryRawUnsafe<any[]>(
        `SELECT 1 FROM "PulseResponse"
          WHERE "userId" = $1 AND "weekKey" = $2 LIMIT 1`,
        userId, weekKey,
      );
      if (submitted.length === 0) {
        return NextResponse.json({
          error: "Submit this week's Pulse before clocking out.",
          reason: "pulse_required",
          pulseUrl: "/dashboard/hr/pulse",
        }, { status: 403 });
      }
    }

    // ── Exit-survey gate ───────────────────────────────────────
    // A leaving employee (filed exit, last working day within the
    // survey window) must submit their Exit Survey before clocking
    // out. Same hard-block pattern as the Pulse gate above.
    if (!isSystemCaller && (await isExitSurveyDue(userId))) {
      return NextResponse.json({
        error: "Please complete your Exit Survey before clocking out.",
        reason: "exit_survey_required",
        exitSurveyUrl: "/dashboard/hr/exit-survey",
      }, { status: 403 });
    }

    // Mobile guard, mirrors clock-in: blocked by default, allowed when
    // ANY non-dismissed On-Duty record covers today. Pending counts —
    // a user already off-site shouldn't be locked out of clock-out
    // just because HR hasn't clicked Approve yet. Same bypasses as
    // clock-in: developers and the `?desktop=13` / `?desktop=12`
    // overrides (forwarded as the x-desktop-bypass header / query param)
    // skip the block entirely. (The office-log door entry is a clock-IN
    // concern only, so 11 and 12 behave identically on clock-out.)
    const mobileBypass =
      user?.isDeveloper === true ||
      desktopBypassMode(req.headers, req.nextUrl.searchParams) !== null;
    if (isMobileRequest(req.headers) && !mobileBypass) {
      const today = istTodayDateOnly();
      const odForToday = await prisma.onDutyRequest.findFirst({
        where: {
          userId,
          date: today,
          status: { notIn: ["rejected", "cancelled"] },
        },
        select: { id: true },
      });
      if (!odForToday) {
        return NextResponse.json(
          { error: "Clock-out is only available on Laptop & Desktop. Mobile clock-out is unlocked on dates with an On-Duty request (pending or approved).", code: "desktop_only" },
          { status: 403 },
        );
      }
    }
    if (!(await isAttendanceEnabled(userId))) {
      return NextResponse.json(
        { error: "Attendance tracking is disabled for your account. Contact HR if this is wrong." },
        { status: 403 },
      );
    }
    const serverNow = new Date();
    const today = istTodayDateOnly();

    // Try to parse a location body. If absent / invalid we still
    // proceed with a NULL clockOutLocation rather than rejecting —
    // forcing geolocation on clock-out would strand users with an
    // open session if their browser permission lapsed mid-day.
    // Also pull `clientPunchAt` (offline-queue original click time).
    let clockOutLocation: string | null = null;
    let clientPunchAt: string | undefined;
    try {
      const parsed = await parseBody(req, ClockOutBody);
      if (parsed.ok) {
        clientPunchAt = parsed.data.clientPunchAt;
        if (parsed.data.lat != null && parsed.data.lng != null) {
          clockOutLocation = stringifyAttLoc({
            mode: null,
            lat: parsed.data.lat,
            lng: parsed.data.lng,
            address: parsed.data.address,
          });
        }
      }
    } catch {
      // Empty body or non-JSON body — that's fine, just no location.
    }

    // ── Multi-session clock-out ─────────────────────────────────────────
    // Find today's row + currently-open session, close that session, then
    // recompute the parent row's totalMinutes from the SUM of every closed
    // session. Done in a transaction so the row + session stay coherent.
    type SessRow = { id: number; clockIn: Date; clockOut: Date | null };
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.attendance.findUnique({
        where: { userId_date: { userId, date: today } },
      });
      if (!existing?.clockIn) return { kind: "not_clocked_in" as const };
      // Already-closed parent row → no open session to close.
      if (existing.clockOut) return { kind: "already_clocked_out" as const };

      // Most-recent open session for this Attendance row.
      const open = await tx.$queryRawUnsafe<SessRow[]>(
        `SELECT id, "clockIn", "clockOut" FROM "AttendanceSession"
          WHERE "attendanceId" = $1 AND "clockOut" IS NULL
          ORDER BY "clockIn" DESC LIMIT 1`,
        existing.id,
      );
      if (open.length === 0) {
        // Defensive: parent says we're clocked-in but no open session.
        // Treat as "already clocked out" — should be rare, only happens
        // for legacy rows pre-migration that lost their session.
        return { kind: "already_clocked_out" as const };
      }
      const openSession = open[0];

      // Effective clock-out time. Normally serverNow; when the offline
      // queue replays a punch it sends the ORIGINAL click time as
      // clientPunchAt so a late sync doesn't inflate hours. Bounded to
      // [clockIn, serverNow] within the same IST day (resolveClientPunchAt).
      const { at: punchAt, usedClient } = resolveClientPunchAt(clientPunchAt, serverNow, { floor: existing.clockIn });
      if (usedClient) {
        console.log(`[clock-out] userId=${userId} used clientPunchAt=${punchAt.toISOString()} (serverNow=${serverNow.toISOString()})`);
      }

      // Close the open session — also stamp clockOutLocation if the
      // client captured geolocation for this punch. Null is fine
      // (legacy clients / browsers without geo permission).
      await tx.$executeRawUnsafe(
        `UPDATE "AttendanceSession" SET "clockOut" = $1, "clockOutLocation" = $2 WHERE id = $3`,
        punchAt, clockOutLocation, openSession.id,
      );

      // Recompute total from ALL closed sessions (including the one we
      // just closed). This is the source of truth for the day's hours.
      const sumRows = await tx.$queryRawUnsafe<Array<{ totalSeconds: number }>>(
        `SELECT COALESCE(EXTRACT(EPOCH FROM SUM("clockOut" - "clockIn")), 0)::int AS "totalSeconds"
           FROM "AttendanceSession"
          WHERE "attendanceId" = $1 AND "clockOut" IS NOT NULL`,
        existing.id,
      );
      const totalMinutes = Math.floor((sumRows[0]?.totalSeconds ?? 0) / 60);

      // Strict 9-hour shift: must accumulate 540 minutes for a full day.
      // ≥ 4.5h (270 min) but < 9h → half_day. "late" is preserved when the
      // employee still completed the full 9h.
      let status = existing.status;
      if (totalMinutes >= 540) status = existing.status === "late" ? "late" : "present";
      else if (totalMinutes >= 270) status = "half_day";
      const overtimeMinutes = Math.max(0, totalMinutes - 540);

      // Update parent row. clockOut on the row tracks the LAST session's
      // clockOut so the existing missed-clockout sweeper / UI keep working
      // (parent.clockOut null → still active or never closed).
      const updated = await tx.attendance.update({
        where: { id: existing.id },
        data: { clockOut: punchAt, totalMinutes, status, overtimeMinutes },
      });
      return { kind: "ok" as const, record: updated };
    });

    if (result.kind === "not_clocked_in") {
      return NextResponse.json({ error: "You haven't clocked in today" }, { status: 400 });
    }
    if (result.kind === "already_clocked_out") {
      return NextResponse.json({ error: "Already clocked out" }, { status: 409 });
    }
    return NextResponse.json(result.record);
  } catch (e) {
    return serverError(e, "POST /api/hr/attendance/clock-out");
  }
}
