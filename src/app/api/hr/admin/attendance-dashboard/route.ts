import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isHRAdmin, serverError } from "@/lib/api-auth";
import { istTodayDateOnly, istMinutesOfDay } from "@/lib/ist-date";
import { parseAttLoc } from "@/lib/attendance-location";
import { serializeBigInt } from "@/lib/utils";
import { getPoliciesByUser } from "@/lib/hr/notification-policy";
import { evaluateOfficeGeofence } from "@/lib/office-geofence";
import { getBrandScope } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

// GET /api/hr/admin/attendance-dashboard
// Returns today's attendance snapshot for every active employee along with
// their department / team capsule (for the filter dropdowns). Access is
// limited to admin / CEO / HR manager / developer — everyone else gets 403.
export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const self = session!.user as any;
  if (!isHRAdmin(self)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const today = istTodayDateOnly();

    const scope = getBrandScope(self);
    if (!scope.allBrands && !scope.brand) {
      return NextResponse.json({ users: [], date: today.toISOString().slice(0, 10) });
    }
    const usersAll = await prisma.user.findMany({
      where: {
        isActive: true,
        ...(scope.allBrands ? {} : { employeeProfile: { businessUnit: scope.brand! } }),
      },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, email: true, role: true, orgLevel: true,
        teamCapsule: true, profilePictureUrl: true,
        // Multi-brand: businessUnit lets the UI split the attendance
        // dashboard into NB Media vs YT Labs tabs.
        employeeProfile: { select: { department: true, designation: true, employeeId: true, workLocation: true, attendanceCaptureScheme: true, businessUnit: true } },
      },
    });
    // Exclude anyone whose last working day has already passed — they've
    // exited and shouldn't appear in attendance, even if their isActive flag
    // wasn't flipped (e.g. an exit left in "cleared" status). LWD === today
    // still counts as working (their final day), so only strictly-past LWDs
    // are dropped. Their account stays alive so they can still see their F&F
    // payslip; they just fall off the attendance surfaces.
    const exitedRows = await prisma.employeeExit.findMany({
      where: { lastWorkingDay: { lt: today } },
      select: { userId: true },
    });
    const exitedIds = new Set(exitedRows.map((e) => e.userId));

    // Drop anyone whose Attendance toggle is OFF — they're "off the
    // books" for attendance (CEO + developers default OFF). The whole
    // dashboard, counts and rows, simply pretends they don't exist.
    const policies = await getPoliciesByUser(usersAll.map((u) => u.id));
    const users = usersAll.filter((u) =>
      policies.get(u.id)?.attendanceEnabled !== false && !exitedIds.has(u.id));

    const todayRows = await prisma.attendance.findMany({
      where: { date: today },
      select: {
        userId: true, status: true, clockIn: true, clockOut: true,
        totalMinutes: true, location: true,
      },
    });
    const byUser = new Map(todayRows.map((r) => [r.userId, r]));

    // Each user's shift drives the "late" cutoff (shift.startTime +
    // shift.breakMinutes). Stored Attendance.status only reflects the
    // computed status at CLOCK-IN time — if HR later edits the row
    // (regularization, manual fix), the stored "present"/"late"
    // diverges from the truth. We pull the user's shift here so the
    // dashboard can re-derive `late` from the CURRENT clockIn timestamp
    // and surface a fresh, always-accurate badge. Users with no shift
    // fall back to a hardcoded 10:00 IST cutoff (matches clock-in's
    // legacy rule).
    const userShifts = await prisma.userShift.findMany({
      where:   { userId: { in: users.map((u) => u.id) } },
      include: { shift: { select: { startTime: true, endTime: true, breakMinutes: true } } },
    });
    const shiftByUser = new Map(userShifts.map((us) => [us.userId, us.shift]));
    function lateCutoffMinForUser(userId: number): number {
      const s = shiftByUser.get(userId);
      const firstHalfOff = firstHalfOffIds.has(userId);
      if (!s) return firstHalfOff ? 14 * 60 : 10 * 60; // no shift → 2 PM if first-half off, else 10 AM
      const [sh, sm] = String(s.startTime).split(":").map((n) => Number(n) || 0);
      const [eh, em] = String(s.endTime).split(":").map((n) => Number(n) || 0);
      const grace = Number.isFinite(s.breakMinutes) ? s.breakMinutes : 15;
      const startMin = sh * 60 + sm;
      const midMin   = Math.round((startMin + (eh * 60 + em)) / 2);
      return (firstHalfOff ? midMin : startMin) + grace;
    }

    // Anyone with a LeaveApplication that covers today, in any status that
    // isn't rejected/cancelled, counts as "on_leave" even when there's no
    // synthesised Attendance row yet. Mirrors /api/hr/attendance/board so
    // the HR Dashboard agrees with the HR Home page's On Leave list.
    const leaveTodayRows = await prisma.leaveApplication.findMany({
      where: {
        fromDate: { lte: today },
        toDate:   { gte: today },
        status:   { notIn: ["rejected", "cancelled"] },
      },
      select: { userId: true, reason: true },
    });
    const onLeaveIds = new Set<number>(leaveTodayRows.map((r) => r.userId));

    // Anyone with a WFH request for today (any non-final status). Mirrors
    // /api/hr/attendance/board. Tracked as its OWN tab on the dashboard —
    // a WFH applicant shows up under WFH regardless of whether their
    // clock-in was tagged office or remote, while the Remote Clock-in tab
    // remains a pure "GPS said remote" view.
    const wfhTodayRows = await prisma.wFHRequest.findMany({
      where: { date: today, status: { notIn: ["rejected", "cancelled"] } },
      select: { userId: true, reason: true },
    });
    const wfhTodayIds = new Set<number>(wfhTodayRows.map((r) => r.userId));

    // First-half OFF (a [First Half] leave or WFH covers today) → the employee
    // is only expected from the afternoon, so late detection uses the shift
    // mid-point, not the morning start. Otherwise a valid afternoon clock-in on
    // a first-half-leave day is wrongly flagged "late" (e.g. Palak, 1:12 PM).
    const firstHalfOffIds = new Set<number>();
    for (const r of leaveTodayRows) if (/\[first\s+half\]/i.test(r.reason ?? "")) firstHalfOffIds.add(r.userId);
    for (const r of wfhTodayRows)   if (/\[first\s+half\]/i.test(r.reason ?? "")) firstHalfOffIds.add(r.userId);

    const rows = users.map((u) => {
      const rec = byUser.get(u.id) ?? null;
      const loc = rec ? parseAttLoc(rec.location) : null;
      const mode = loc?.mode ?? null; // "office" | "remote" | null
      // Status priority — on_leave > wfh > hybrid/remote (classification) >
      // office/remote (derived) > absent.
      //   on_leave    approved leave covering today (or an explicit
      //               Attendance.status="on_leave" override) wins over
      //               everything so an approved half-day still shows in
      //               the On Leave list.
      //   wfh         the person applied for WFH today AND has actually
      //               clocked in — their authorised state is WFH, so the
      //               pill should say "WFH" instead of mode-derived.
      //               WFH applicants who haven't clocked in stay
      //               "absent" so HR can still see they haven't started.
      //   hybrid      workLocation OR captureScheme is hybrid — clocked
      //               in from anywhere is normal for them. The pill
      //               reads "Hybrid" so HR doesn't read 6.6km off-site
      //               as a discrepancy on a worker whose pattern allows
      //               either location.
      //   remote      workLocation OR captureScheme is remote — same
      //               idea: their authorised pattern is to work remote,
      //               so the pill reads "Remote" as their classification,
      //               not because the geofence flagged them.
      //   office/remote (derived) — for people classified as office, we
      //               derive from clock-in mode + geofence: a clock-in
      //               km away from the office flips to "Remote" so the
      //               row stops contradicting its own off-site badge.
      const profileWl = (u.employeeProfile?.workLocation ?? "").toLowerCase();
      const profileCs = ((u.employeeProfile as any)?.attendanceCaptureScheme ?? "").toLowerCase();
      const profileBu = (u.employeeProfile as any)?.businessUnit ?? null;
      const isClassifiedRemote = profileWl === "remote" || profileCs === "remote";
      const isClassifiedHybrid = profileWl === "hybrid" || profileCs === "hybrid";

      // Re-evaluate the office geofence against the employee's
      // businessUnit so YT Labs employees are checked against the
      // YT Labs office instead of the NB Media default — old rows
      // were stored with atOffice=false (everyone was measured
      // against NB Media) and the dashboard's "off-site flagged"
      // banner kept lighting them up. When the stored row carries
      // lat/lng we can recompute on read; when it doesn't (older
      // punches predating the location capture) we fall back to
      // the stored atOffice/distance.
      const recomputed = (typeof loc?.lat === "number" && typeof loc?.lng === "number")
        ? evaluateOfficeGeofence(loc.lat, loc.lng, profileBu)
        : null;
      const effAtOffice    = recomputed?.configured ? recomputed.atOffice    : (loc?.atOffice            ?? null);
      const effDistance    = recomputed?.configured ? recomputed.distanceM   : (loc?.distanceFromOfficeM ?? null);
      const atOfficeStrictFalse = effAtOffice === false;
      const isWfhToday          = wfhTodayIds.has(u.id);
      const status =
        rec?.status === "on_leave" || onLeaveIds.has(u.id) ? "on_leave" :
        rec?.clockIn && isWfhToday ? "wfh" :
        rec?.clockIn && isClassifiedHybrid ? "hybrid" :
        rec?.clockIn && isClassifiedRemote ? "remote" :
        rec?.clockIn ? ((mode === "remote" || atOfficeStrictFalse) ? "remote" : "office") :
        "absent";
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
        workLocation: u.employeeProfile?.workLocation ?? null,
        businessUnit: (u.employeeProfile as any)?.businessUnit ?? null,
        // Capture scheme is the OPERATIONAL flavour of where this user
        // is supposed to punch in from. Often "Remote" even when
        // workLocation is left at the default "office" — we use both
        // signals when deciding whether to flag an off-site clock-in.
        attendanceCaptureScheme: (u.employeeProfile as any)?.attendanceCaptureScheme ?? null,
        clockIn:      rec?.clockIn  ?? null,
        clockOut:     rec?.clockOut ?? null,
        totalMinutes: rec?.totalMinutes ?? 0,
        // rawStatus = the live derived value so the UI's `· LATE`
        // chip always reflects the CURRENT clockIn vs the employee's
        // shift cutoff (shift.startTime + shift.breakMinutes). The
        // stored Attendance.status is preserved for absent/on-leave
        // signal but late/present is recomputed on read — that way
        // a regularization that moves the clockIn before/after the
        // grace immediately updates the badge without a separate
        // status backfill.
        rawStatus: (() => {
          // No clock-in row → keep the stored value (which is
          // "absent" / "on_leave" / etc.).
          if (!rec?.clockIn) return rec?.status ?? "absent";
          // on_leave overrides everything else.
          if (rec.status === "on_leave") return "on_leave";
          const clockMin    = istMinutesOfDay(new Date(rec.clockIn));
          const cutoffMin   = lateCutoffMinForUser(u.id);
          return clockMin > cutoffMin ? "late" : "present";
        })(),
        locationAddress: loc?.address ?? null,
        locationMode:    mode,
        locationLat:     loc?.lat   ?? null,
        locationLng:     loc?.lng   ?? null,
        // Office-geofence — re-evaluated at READ time using the
        // employee's businessUnit (see recomputed/effAtOffice above)
        // so YT Labs employees are checked against the YT Labs
        // office instead of the NB Media default. Falls back to
        // the value stored at clock-in time when lat/lng is missing
        // on the row.
        atOffice:             effAtOffice,
        distanceFromOfficeM:  effDistance,
        status, // derived: on_leave | wfh | hybrid | remote | office | absent
        wfhToday: isWfhToday,
      };
    });

    const counts = {
      total:        rows.length,
      // "Working today" — anyone who's clocked in regardless of mode.
      // WFH / Hybrid applicants who clocked in count here too.
      present:      rows.filter((r) => r.status === "office" || r.status === "remote" || r.status === "hybrid" || r.status === "wfh").length,
      office:       rows.filter((r) => r.status === "office").length,
      remote:       rows.filter((r) => r.status === "remote").length,
      hybrid:       rows.filter((r) => r.status === "hybrid").length,
      // Intent count — everyone who applied for WFH today. Used for the
      // WFH tab badge so the number matches the rows the tab will show
      // (the tab filter is gated on the wfhToday flag, not status, so
      // a WFH applicant who hasn't clocked in remains visible).
      wfh:          rows.filter((r) => r.wfhToday).length,
      // Status count — WFH applicants who actually clocked in. Used by
      // the donut so the segments add up to total without overlap with
      // the absent slice.
      wfhWorking:   rows.filter((r) => r.status === "wfh").length,
      onLeave:      rows.filter((r) => r.status === "on_leave").length,
      notClockedIn: rows.filter((r) => r.status === "absent").length,
      late:         rows.filter((r) => r.rawStatus === "late").length,
    };

    return NextResponse.json(serializeBigInt({ rows, counts, date: today.toISOString().slice(0, 10) }), {
      headers: { "Cache-Control": "no-store, must-revalidate" },
    });
  } catch (e) { return serverError(e, "GET /api/hr/admin/attendance-dashboard"); }
}
