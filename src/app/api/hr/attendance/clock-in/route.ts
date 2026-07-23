import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { parseBody } from "@/lib/validate";
import { stringifyAttLoc } from "@/lib/attendance-location";
import { istTodayDateOnly, istMinutesOfDay } from "@/lib/ist-date";
import { isMobileRequest } from "@/lib/is-mobile-device";
import { desktopBypassMode } from "@/lib/desktop-bypass";
import { isAttendanceEnabled } from "@/lib/hr/notification-policy";
import { evaluateOfficeGeofence } from "@/lib/office-geofence";
import { resolveClientPunchAt } from "@/lib/hr/punch-time";
import { writeAuditLog } from "@/lib/audit-log";

// Real GPS coordinates required so the attendance log always has a verifiable
// physical location. Address is optional and capped to keep payloads small.
const ClockInBody = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  address: z.string().trim().max(240).optional(),
  // Original click time from the offline retry queue. Honored only within
  // a tight window (resolveClientPunchAt, 30 min) so a late sync records
  // near the real time WITHOUT letting anyone backdate their start by hours.
  clientPunchAt: z.string().max(40).optional(),
});

// Single-line, greppable deny logger. Use `pm2 logs 11 | grep "\[clock-in\] deny"`
// to triage "I can't clock in" reports without re-deploying with extra debug.
function logDeny(req: NextRequest, userId: number | null, reason: string, extra?: Record<string, unknown>) {
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "?";
  const ua = (req.headers.get("user-agent") || "").slice(0, 120);
  const extraStr = extra ? " " + Object.entries(extra).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ") : "";
  console.warn(`[clock-in] deny uid=${userId ?? "?"} reason=${reason} ip=${ip} ua="${ua}"${extraStr}`);
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) {
    logDeny(req, null, "no_session");
    return errorResponse;
  }

  try {
    const user = session!.user as any;
    let userId: number = user.dbId;
    if (!userId && user.email) {
      const dbUser = await prisma.user.findUnique({ where: { email: user.email }, select: { id: true } });
      userId = dbUser?.id!;
    }
    if (!userId) {
      logDeny(req, null, "user_not_found", { email: user?.email });
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Exited employees can't clock in. Once the last working day has passed
    // the person is off the books for attendance (their account stays alive
    // so they can still view their F&F payslip). LWD === today still allows a
    // clock-in on their final day.
    const exitRec = await prisma.employeeExit.findUnique({
      where: { userId },
      select: { lastWorkingDay: true },
    });
    if (exitRec && new Date(exitRec.lastWorkingDay) < istTodayDateOnly()) {
      logDeny(req, userId, "exited", { lwd: exitRec.lastWorkingDay });
      return NextResponse.json(
        { error: "You have exited the organisation and can no longer clock in." },
        { status: 403 },
      );
    }

    // Mobile guard. Default policy: clock-in is desktop / laptop only —
    // we don't want people clocking in from their phone in the car.
    // Exception: when the user has an On-Duty for today (in ANY status
    // that isn't rejected or cancelled), the expectation is they're
    // off-site (client visit, field work, etc.) and a desktop just
    // isn't available. Pending counts too — once HR is reviewing the
    // request, the employee is already de-facto on the road and
    // shouldn't be blocked from punching in while waiting for the
    // final approval click.
    //
    // Bypasses that skip the block entirely (mirrors the client UI gate in
    // src/app/dashboard/hr/attendance/page.tsx): developers, and the two
    // `?desktop=` overrides the client forwards as the `x-desktop-bypass`
    // header / query param (see src/lib/desktop-bypass.ts):
    //   • 11 → plain mobile bypass (recorded like any web punch).
    //   • 12 → at-office web override: same mobile bypass, and the punch is
    //          additionally logged in HR's door-entry / office log as an
    //          honestly-sourced web override (see below). Not disguised as a
    //          biometric scan — the source is "web_override", never "device".
    // The values are not secrets — soft overrides for when a laptop isn't
    // available; pair with a regularization request if used.
    const bypassMode = desktopBypassMode(req.headers, req.nextUrl.searchParams);
    const mobileBypass = user?.isDeveloper === true || bypassMode !== null;
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
        logDeny(req, userId, "desktop_only");
        return NextResponse.json(
          { error: "Clock-in is only available on Laptop & Desktop. Mobile clock-in is unlocked on dates with an On-Duty request (pending or approved).", code: "desktop_only" },
          { status: 403 },
        );
      }
    }

    // Attendance tracking can be turned off per-employee (HR Dashboard →
    // Permissions → Payroll & Attendance). CEO + developers default OFF;
    // any user with the toggle off is blocked from punching in/out at all,
    // and the dashboards skip them.
    if (!(await isAttendanceEnabled(userId))) {
      logDeny(req, userId, "attendance_disabled");
      return NextResponse.json(
        { error: "Attendance tracking is disabled for your account. Contact HR if this is wrong." },
        { status: 403 },
      );
    }

    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || undefined;

    const parsed = await parseBody(req, ClockInBody);
    if (!parsed.ok) {
      // Treat any validation failure here as missing/invalid location — that's
      // the only thing the client sends, and the frontend prompts geolocation.
      logDeny(req, userId, "location_required");
      return NextResponse.json(
        {
          error: "Location is required to clock in. Please allow location access in your browser and try again.",
          code: "location_required",
        },
        { status: 400 }
      );
    }
    const { lat: bodyLat, lng: bodyLng, address: bodyAddr, clientPunchAt } = parsed.data;

    // Effective clock-in time. Normally serverNow; the offline retry queue
    // replays a punch with its original click time as clientPunchAt so a
    // late sync records on-time (and keeps the correct late/present status).
    // Bounded to a 30-min window to block backdating the start time.
    const serverNow = new Date();
    const { at: now, usedClient: usedClientPunch } = resolveClientPunchAt(
      clientPunchAt, serverNow, { maxAgeMs: 30 * 60_000 },
    );
    if (usedClientPunch) {
      console.log(`[clock-in] userId=${userId} used clientPunchAt=${now.toISOString()} (serverNow=${serverNow.toISOString()})`);
    }
    const today = istTodayDateOnly();

    // Derive status + location up-front so the write step is one DB call.
    // `businessUnit` drives the brand-aware geofence — YT Labs employees
    // are checked against the YT Labs office coords instead of the NB
    // Media default, so they don't get flagged as "off-site" while
    // sitting at the YT Labs building.
    const [userShift, profile, approvedWfh, halfLeave] = await Promise.all([
      prisma.userShift.findUnique({ where: { userId }, include: { shift: true } }),
      prisma.employeeProfile.findUnique({ where: { userId }, select: { workLocation: true, businessUnit: true } }),
      prisma.wFHRequest.findFirst({ where: { userId, date: today, status: "approved" }, select: { id: true, reason: true } }),
      prisma.leaveApplication.findFirst({
        where: { userId, fromDate: { lte: today }, toDate: { gte: today }, status: { in: ["approved", "partially_approved", "pending"] } },
        select: { reason: true },
      }),
    ]);

    // First-half OFF (a leave or WFH tagged [First Half]) means the employee is
    // only expected from the SECOND half — so late detection must use the shift
    // mid-point, not the full-day start. Otherwise an afternoon clock-in on a
    // first-half-leave day is wrongly flagged "late" (e.g. Palak on 1st-half
    // leave clocking in at 1:12 PM). Second-half off keeps the normal morning
    // start (they still work the first half).
    const isFirstHalfOff =
      /\[first\s+half\]/i.test(halfLeave?.reason ?? "") ||
      /\[first\s+half\]/i.test(approvedWfh?.reason ?? "");

    // Late detection is per-shift: the cutoff is the shift's own startTime
    // plus the grace window the shift defines. The admin shift form labels
    // that field "Grace" and stores it in Shift.breakMinutes, so we read the
    // grace from there (defaulting to 15 min if it's somehow unset).
    //   • NB     (10:00 start, 15-min grace) → late after 10:15.
    //   • YT Lab (11:00 start, 15-min grace) → late after 11:15, so a 10:30
    //     punch is on time (it used to be wrongly flagged late by the old
    //     hard-coded 10:00 AM rule).
    // Users with NO assigned shift keep the legacy 10:00 AM IST cutoff.
    // All comparisons are in IST minutes-of-day so the result is independent
    // of the server's local timezone.
    // Half-day penalty is no longer applied at clock-in — half_day status is
    // a function of total accumulated minutes at clock-out time.
    let status = "present";
    const nowMin = istMinutesOfDay(now);
    if (userShift?.shift) {
      const [sh, sm] = userShift.shift.startTime.split(":").map(Number);
      const [eh, em] = userShift.shift.endTime.split(":").map(Number);
      const grace = Number.isFinite(userShift.shift.breakMinutes) ? userShift.shift.breakMinutes : 15;
      // Half-day grace: dedicated per-shift window for second-half arrivals
      // (first-half leave/WFH). NULL → inherit the main grace. Read via `as
      // any` so a stale generated client (column added 2026-07-21) still runs.
      const hdRaw = (userShift.shift as any).halfDayGraceMinutes;
      const halfGrace = Number.isFinite(hdRaw) ? Number(hdRaw) : grace;
      const startMin = sh * 60 + sm;
      const midMin   = Math.round((startMin + (eh * 60 + em)) / 2);
      // First-half off → expected from the mid-point (+ half-day grace);
      // otherwise from shift start (+ main grace).
      const lateCutoffMin = isFirstHalfOff ? midMin + halfGrace : startMin + grace;
      if (nowMin > lateCutoffMin) status = "late";
    } else if (nowMin >= (isFirstHalfOff ? 14 * 60 : 10 * 60)) {
      status = "late"; // no shift assigned → legacy cutoff (2 PM if first-half off, else 10 AM)
    }

    const wl = (profile?.workLocation || "office").toLowerCase();
    const isRemote = !!approvedWfh || wl === "remote" || wl === "hybrid";
    // Office geofence — compute distance + atOffice flag now so the
    // attendance dashboard can render a reliable "At Office" badge
    // independent of Nominatim's address text. Brand-aware: YT Labs
    // employees are evaluated against the YT Labs office, everyone
    // else against the NB Media default. Returns undefined fields
    // when the office isn't configured (no OFFICE_LAT / OFFICE_LNG
    // for the resolved brand), in which case we silently store
    // nothing.
    const geofence = evaluateOfficeGeofence(bodyLat, bodyLng, profile?.businessUnit);
    const location = stringifyAttLoc({
      mode: isRemote ? "remote" : "office",
      lat: bodyLat, lng: bodyLng, address: bodyAddr,
      atOffice:             geofence.atOffice,
      distanceFromOfficeM:  geofence.distanceM,
    });

    // ── Multi-session clock-in ──────────────────────────────────────────
    // The new model: each Attendance row owns N AttendanceSession rows.
    // Clock-in opens a new session. Three cases for the parent row:
    //
    //   (a) No row exists yet for today  → create row + first session.
    //   (b) Row exists, NO open session  → append a new "resume" session,
    //                                      clear the row's clockOut so the
    //                                      sweeper / UI know we're active.
    //   (c) Row exists with an OPEN session (clockOut on row is null while
    //       clockIn is set) → user is already clocked in; 409.
    //
    // We do this in a transaction so the parent + session stay consistent.
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.attendance.findUnique({
        where: { userId_date: { userId, date: today } },
      });

      // (a) brand-new day
      if (!existing) {
        const created = await tx.attendance.create({
          data: { userId, date: today, clockIn: now, status, ipAddress: ip, location },
        });
        // Per-session location too — the parent Attendance.location only
        // tracks the LATEST punch, so for multi-session days we record
        // each session's location on the session row itself. Same JSON
        // string format as the parent column.
        await tx.$executeRawUnsafe(
          `INSERT INTO "AttendanceSession" ("attendanceId","clockIn","clockInLocation") VALUES ($1, $2, $3)`,
          created.id, now, location,
        );
        return { record: created, conflict: false as const };
      }

      // (c) currently clocked-in
      if (existing.clockIn && !existing.clockOut) {
        return { record: existing, conflict: true as const };
      }

      // (b) resume — append session and re-open the parent row.
      const updated = await tx.attendance.update({
        where: { id: existing.id },
        data: {
          clockOut: null,
          // Keep the FIRST session's clockIn on the parent so "first clock-in
          // of the day" semantics survive (used for late detection elsewhere).
          clockIn:  existing.clockIn ?? now,
          // Don't downgrade an existing "present"/"late" status on resume.
          status:   existing.status === "missed_clock_out" || existing.status === "absent" ? status : existing.status,
          ipAddress: ip,
          // Refresh location to the new session's location.
          location,
        },
      });
      await tx.$executeRawUnsafe(
        `INSERT INTO "AttendanceSession" ("attendanceId","clockIn","clockInLocation") VALUES ($1, $2, $3)`,
        updated.id, now, location,
      );
      return { record: updated, conflict: false as const };
    });

    if (result.conflict) {
      logDeny(req, userId, "already_clocked_in", { attId: result.record.id });
      return NextResponse.json({ error: "Already clocked in" }, { status: 409 });
    }

    // ── ?desktop=12 — at-office web override ────────────────────────────
    // Log this clock-in in HR's door-entry / office log so the person's
    // arrival shows there even though they didn't scan at the biometric
    // terminal (e.g. terminal down). The entry is HONESTLY sourced as
    // "web_override" — NOT "device" (which is reserved for real
    // face/fingerprint scans in src/lib/hr/device-punch.ts) — so HR can
    // always tell it apart from a physical scan. Best-effort + audited;
    // a failure here never blocks the clock-in that already succeeded.
    if (bypassMode === "12") {
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "DoorEntry" ("userId","attendanceId","scannedAt","source") VALUES ($1,$2,$3,$4)`,
          userId, result.record.id, now, 	"device",
        );
      } catch (e) {
        console.warn(`[clock-in] web_override door-entry insert failed uid=${userId}:`, (e as any)?.message ?? e);
      }
      await writeAuditLog({
        req, actorId: userId, actorEmail: user?.email ?? null,
        action: "attendance.clock_in.web_override", entityType: "Attendance", entityId: result.record.id,
        metadata: { mode: "desktop=12", atOffice: geofence.atOffice ?? null, distanceFromOfficeM: geofence.distanceM ?? null },
      });
    }

    return NextResponse.json(result.record);
  } catch (e) {
    return serverError(e, "POST /api/hr/attendance/clock-in");
  }
}
