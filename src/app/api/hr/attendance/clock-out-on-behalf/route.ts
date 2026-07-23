import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { parseBody } from "@/lib/validate";
import { istTodayDateOnly } from "@/lib/ist-date";
import { isGaganDeveloper } from "@/lib/gagan-dev";

// Clock a user OUT on their behalf for a given day. Restricted to the single
// developer account (Gagan) — see src/lib/gagan-dev. The button that calls this
// is only rendered for that same account, but this endpoint enforces it
// independently: a hidden button is not a security boundary.
//
// Mirrors the per-user clock-out transaction in ../clock-out/route.ts: close
// the day's open session at the effective time, re-derive totalMinutes from the
// sum of all closed sessions, and reset status/overtime under the strict 9h
// rule. No Pulse / exit-survey / mobile gates apply — those guard an employee
// clocking THEMSELVES out, not an admin override.
const Body = z.object({
  userId: z.number().int().positive(),
  // Target day (YYYY-MM-DD, IST). Defaults to today.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Effective clock-out instant (ISO). Defaults to now. Bounded server-side to
  // [clockIn, now] so it can never predate the clock-in or land in the future.
  clockOutAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const caller = session!.user as any;
    // HARD GATE: only Gagan's developer account, by email. Not isDeveloper,
    // not orgLevel, not role — this one specific person.
    if (!isGaganDeveloper(caller?.email)) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const parsed = await parseBody(req, Body);
    if (!parsed.ok) return parsed.error;
    const body = parsed.data;

    const targetUserId = body.userId;
    const date = body.date ? new Date(`${body.date}T00:00:00.000Z`) : istTodayDateOnly();
    const now = new Date();
    const requestedOut = body.clockOutAt ? new Date(body.clockOutAt) : now;

    type SessRow = { id: number; clockIn: Date; clockOut: Date | null };
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.attendance.findUnique({
        where: { userId_date: { userId: targetUserId, date } },
      });
      if (!existing) return { kind: "no_record" as const };
      if (!existing.clockIn) return { kind: "not_clocked_in" as const };
      if (existing.clockOut) return { kind: "already_clocked_out" as const };

      // Most-recent open session for this Attendance row.
      const open = await tx.$queryRawUnsafe<SessRow[]>(
        `SELECT id, "clockIn", "clockOut" FROM "AttendanceSession"
          WHERE "attendanceId" = $1 AND "clockOut" IS NULL
          ORDER BY "clockIn" DESC LIMIT 1`,
        existing.id,
      );
      if (open.length === 0) return { kind: "already_clocked_out" as const };
      const openSession = open[0];

      // Bound the effective clock-out to [session clockIn, now]: never before
      // the punch-in, never in the future.
      const floorMs = new Date(openSession.clockIn).getTime();
      let effMs = requestedOut.getTime();
      if (Number.isNaN(effMs) || effMs > now.getTime()) effMs = now.getTime();
      if (effMs < floorMs) effMs = floorMs;
      const punchAt = new Date(effMs);

      await tx.$executeRawUnsafe(
        `UPDATE "AttendanceSession" SET "clockOut" = $1 WHERE id = $2`,
        punchAt, openSession.id,
      );

      // Re-derive the day's total from ALL closed sessions.
      const sumRows = await tx.$queryRawUnsafe<Array<{ totalSeconds: number }>>(
        `SELECT COALESCE(EXTRACT(EPOCH FROM SUM("clockOut" - "clockIn")), 0)::int AS "totalSeconds"
           FROM "AttendanceSession"
          WHERE "attendanceId" = $1 AND "clockOut" IS NOT NULL`,
        existing.id,
      );
      const totalMinutes = Math.floor((sumRows[0]?.totalSeconds ?? 0) / 60);

      // Strict 9-hour shift (same thresholds as the self clock-out route):
      // ≥540 → present (late preserved), ≥270 → half_day, else keep.
      let status = existing.status;
      if (totalMinutes >= 540) status = existing.status === "late" ? "late" : "present";
      else if (totalMinutes >= 270) status = "half_day";
      const overtimeMinutes = Math.max(0, totalMinutes - 540);

      // Write exactly the same fields a self clock-out would — no note, no
      // marker — so the resulting record is indistinguishable from the user
      // having clocked themselves out.
      const updated = await tx.attendance.update({
        where: { id: existing.id },
        data: { clockOut: punchAt, totalMinutes, status, overtimeMinutes },
      });
      return { kind: "ok" as const, record: updated };
    });

    if (result.kind === "no_record") {
      return NextResponse.json({ error: "No attendance record for that day" }, { status: 404 });
    }
    if (result.kind === "not_clocked_in") {
      return NextResponse.json({ error: "User hasn't clocked in that day" }, { status: 400 });
    }
    if (result.kind === "already_clocked_out") {
      return NextResponse.json({ error: "Already clocked out" }, { status: 409 });
    }

    return NextResponse.json(result.record);
  } catch (e) {
    return serverError(e, "POST /api/hr/attendance/clock-out-on-behalf");
  }
}
