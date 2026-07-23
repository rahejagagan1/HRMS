import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET /api/hr/me/shift — the caller's own shift work-rule + anchor.
//
// Used by the leave form's day-count preview so the "N days" badge matches
// the server's countWorkingDays() exactly: an alternate-Saturday (NB) shift
// counts a worked Saturday, a 5-day (YT) shift does not. Returns
// { shift: null, effectiveFrom: null } when the user has no shift assigned —
// the client then falls back to the Mon–Fri default.
//
// Raw SQL so the saturdayPolicy / saturdayWeeks columns come back even if the
// generated Prisma client predates them (same reason the admin shifts route
// reads via raw SQL).
export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const rows = await prisma.$queryRawUnsafe<Array<{
      workDays: unknown;
      saturdayPolicy: string | null;
      saturdayWeeks: number[] | null;
      startTime: string | null;
      breakMinutes: number | null;
      effectiveFrom: Date;
      shiftCreatedAt: Date;
    }>>(
      // startTime + breakMinutes feed the late-clock-in cutoff on the
      // attendance history page (HH:MM + grace). Without these fields
      // the page used to fall back to a hardcoded 10:00 IST rule, which
      // wrongly flagged YT Labs employees (11:00 start) and any NB
      // Media punch inside the 5-min grace window as LATE.
      `SELECT s."workDays", s."saturdayPolicy", s."saturdayWeeks",
              s."startTime", s."breakMinutes", us."effectiveFrom",
              s."createdAt" AS "shiftCreatedAt"
         FROM "UserShift" us
         JOIN "Shift" s ON s.id = us."shiftId"
        WHERE us."userId" = $1
        LIMIT 1`,
      myId,
    );

    if (rows.length === 0) return NextResponse.json({ shift: null, effectiveFrom: null });
    const r = rows[0];
    return NextResponse.json({
      shift: {
        workDays:       r.workDays,
        saturdayPolicy: r.saturdayPolicy,
        saturdayWeeks:  r.saturdayWeeks,
        startTime:      r.startTime,
        breakMinutes:   r.breakMinutes,
        // Shift-level anchor for alternate-Saturday phase — see isWorkingDay.
        createdAt:      r.shiftCreatedAt,
      },
      effectiveFrom: r.effectiveFrom,
    });
  } catch (e) { return serverError(e, "GET /api/hr/me/shift"); }
}
