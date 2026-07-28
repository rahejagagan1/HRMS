import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireHRAdmin, serverError } from "@/lib/api-auth";
import { getBrandScope } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

// Parse + validate the Saturday rule from a request body.
//   saturdayPolicy: "all" | "alternate" | "weeks" | "dates"
//   saturdayWeeks:  ints 1-5 (only meaningful for "weeks")
//   saturdayDates:  "YYYY-MM-DD" strings (only meaningful for "dates" —
//                   the hand-picked working Saturdays, 2026-07-24)
function parseSaturday(body: any): { policy: string; weeks: number[]; dates: string[] } {
  const policy = ["all", "alternate", "weeks", "dates"].includes(String(body?.saturdayPolicy))
    ? String(body.saturdayPolicy) : "all";
  const raw: number[] = Array.isArray(body?.saturdayWeeks)
    ? (body.saturdayWeeks as any[]).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5)
    : [];
  const weeks = Array.from(new Set(raw)).sort((a, b) => a - b);
  // Strict YYYY-MM-DD only — this is also what makes the ARRAY literal in
  // setSaturday injection-safe.
  const rawDates: string[] = Array.isArray(body?.saturdayDates)
    ? (body.saturdayDates as any[]).map((d) => String(d)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    : [];
  const dates = Array.from(new Set(rawDates)).sort();
  return {
    policy,
    weeks: policy === "weeks" ? weeks : [],
    dates: policy === "dates" ? dates : [],
  };
}

// Postgres int[] literal from a validated (integer-only) array — injection-safe.
function weeksLiteral(weeks: number[]): string {
  return weeks.length ? `ARRAY[${weeks.join(",")}]::int[]` : `ARRAY[]::int[]`;
}

// Postgres text[] literal from regex-validated YYYY-MM-DD strings — safe.
function datesLiteral(dates: string[]): string {
  return dates.length ? `ARRAY[${dates.map((d) => `'${d}'`).join(",")}]::text[]` : `ARRAY[]::text[]`;
}

// The saturday* columns are read/written via raw SQL so this route keeps
// working even before `prisma generate` picks up the new columns.
async function setSaturday(shiftId: number, policy: string, weeks: number[], dates: string[] = []) {
  await prisma.$executeRawUnsafe(
    `UPDATE "Shift" SET "saturdayPolicy" = $1, "saturdayWeeks" = ${weeksLiteral(weeks)}, "saturdayDates" = ${datesLiteral(dates)} WHERE id = $2`,
    policy, shiftId,
  );
}

// Half-day grace (minutes past the shift mid-point before a second-half
// arrival counts as late). Parsed from the request body; "" / null / absent
// all mean "inherit breakMinutes" and store NULL. Written via raw SQL for the
// same stale-prisma-client reason as the saturday columns.
//   returns: { set: boolean; value: number | null; error?: string }
function parseHalfDayGrace(body: any): { set: boolean; value: number | null; error?: string } {
  if (!("halfDayGraceMinutes" in (body ?? {}))) return { set: false, value: null };
  const raw = body.halfDayGraceMinutes;
  if (raw === null || raw === undefined || raw === "") return { set: true, value: null };
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { set: false, value: null, error: "halfDayGraceMinutes must be a non-negative integer" };
  }
  return { set: true, value: parsed };
}

async function setHalfDayGrace(shiftId: number, value: number | null) {
  // ::int cast so a NULL parameter has an unambiguous type for Postgres.
  await prisma.$executeRawUnsafe(
    `UPDATE "Shift" SET "halfDayGraceMinutes" = $1::int WHERE id = $2`,
    value, shiftId,
  );
}

// Saturday-specific hours + grace (2026-07-24). All-null = Saturday runs the
// weekday hours. Sent by the form as satStartTime/satEndTime ("HH:MM") and
// satGraceMinutes ("" = inherit breakMinutes → NULL). Raw SQL for the same
// stale-prisma-client reason as the other new columns.
function parseSatHours(body: any): {
  set: boolean; start: string | null; end: string | null; grace: number | null; error?: string;
} {
  if (!("satStartTime" in (body ?? {})) && !("satEndTime" in (body ?? {})) && !("satGraceMinutes" in (body ?? {}))) {
    return { set: false, start: null, end: null, grace: null };
  }
  const hm = (v: any): string | null => {
    if (v === null || v === undefined || v === "") return null;
    return /^\d{1,2}:\d{2}$/.test(String(v)) ? String(v) : "__bad__";
  };
  const start = hm(body.satStartTime);
  const end   = hm(body.satEndTime);
  if (start === "__bad__" || end === "__bad__") {
    return { set: false, start: null, end: null, grace: null, error: "satStartTime/satEndTime must be HH:MM" };
  }
  // Both-or-neither: a lone start/end can't define a Saturday day length.
  if ((start === null) !== (end === null)) {
    return { set: false, start: null, end: null, grace: null, error: "Saturday hours need BOTH start and end time" };
  }
  let grace: number | null = null;
  const rawG = body.satGraceMinutes;
  if (rawG !== null && rawG !== undefined && rawG !== "") {
    const parsed = Number.parseInt(String(rawG), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { set: false, start: null, end: null, grace: null, error: "satGraceMinutes must be a non-negative integer" };
    }
    grace = parsed;
  }
  return { set: true, start, end, grace };
}

async function setSatHours(shiftId: number, start: string | null, end: string | null, grace: number | null) {
  await prisma.$executeRawUnsafe(
    `UPDATE "Shift" SET "satStartTime" = $1, "satEndTime" = $2, "satGraceMinutes" = $3::int WHERE id = $4`,
    start, end, grace, shiftId,
  );
}

export async function GET(req: NextRequest) {
  // HR-admin only — this is the admin shift template manager. The
  // employee-facing path (their own assigned shift) goes through
  // /api/hr/me/shift, which stays open to any logged-in user.
  const { session, errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;
  try {
    // Brand filter: URL-driven for ALL-BRANDS viewers (developer /
    // VIEW_ALL_BRANDS holders), but clamped to the caller's own brand for
    // everyone else — org-wide brand isolation (2026-07-15) supersedes the
    // earlier "cross-brand browsing is intentional" rule: an NB Media HR
    // Manager only ever sees NB Media shifts (plus legacy NULL-brand rows).
    const url = new URL(req.url);
    const rawBrand = (url.searchParams.get("brand") || "").trim();
    const requested =
      rawBrand === "NB Media" || rawBrand === "nb_media" || rawBrand === "nb-media" ? "NB Media" :
      rawBrand === "YT Labs"  || rawBrand === "yt_labs"  || rawBrand === "yt-labs"  ? "YT Labs"  :
      null;
    const scope = getBrandScope(session!.user);
    const brand = scope.allBrands ? requested : ((scope.brand as "NB Media" | "YT Labs" | null) ?? "NB Media");
    let shifts: any;
    if (brand) {
      shifts = await prisma.$queryRawUnsafe(
        `SELECT * FROM "Shift"
          WHERE brand = $1 OR brand IS NULL
          ORDER BY name ASC`,
        brand,
      );
    } else {
      shifts = await prisma.$queryRawUnsafe(
        `SELECT * FROM "Shift" ORDER BY name ASC`,
      );
    }
    return NextResponse.json(shifts);
  } catch (e) { return serverError(e, "GET /api/hr/admin/shifts"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    // Frontend uses gracePeriodMinutes / workingDays; the Shift model
    // stores breakMinutes / workDays. Accept either alias.
    const { name, startTime, endTime } = body;
    const rawBreak = body.breakMinutes ?? body.gracePeriodMinutes ?? 60;
    const breakMinutes = Number.parseInt(String(rawBreak), 10);
    if (!Number.isFinite(breakMinutes)) {
      return NextResponse.json({ error: "breakMinutes must be an integer" }, { status: 400 });
    }
    const workDays = body.workDays ?? body.workingDays ?? ["Mon", "Tue", "Wed", "Thu", "Fri"];
    if (!name || !startTime || !endTime) return NextResponse.json({ error: "name, startTime, endTime required" }, { status: 400 });
    const { policy, weeks, dates } = parseSaturday(body);

    // Brand auto-tag: client may pass body.brand explicitly (allowed
    // for super-admins). Otherwise default to the creator's brand —
    // an NB Media HR Manager creating a new shift implicitly stamps
    // it NB Media so it won't show up for YT Labs HR.
    const scope = getBrandScope(session!.user);
    const explicitBrand =
      body.brand === "NB Media" || body.brand === "YT Labs" ? body.brand : null;
    const brand = scope.allBrands ? (explicitBrand ?? null) : (scope.brand ?? null);

    const hdGrace = parseHalfDayGrace(body);
    if (hdGrace.error) return NextResponse.json({ error: hdGrace.error }, { status: 400 });
    const satHours = parseSatHours(body);
    if (satHours.error) return NextResponse.json({ error: satHours.error }, { status: 400 });

    const shift = await prisma.shift.create({
      data: { name, startTime, endTime, breakMinutes, workDays },
    });
    await setSaturday(shift.id, policy, weeks, dates);
    if (hdGrace.set) await setHalfDayGrace(shift.id, hdGrace.value);
    if (satHours.set) await setSatHours(shift.id, satHours.start, satHours.end, satHours.grace);
    if (brand) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Shift" SET brand = $1 WHERE id = $2`,
        brand, shift.id,
      );
    }
    return NextResponse.json({ ...shift, saturdayPolicy: policy, saturdayWeeks: weeks, saturdayDates: dates, halfDayGraceMinutes: hdGrace.set ? hdGrace.value : null, brand }, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/admin/shifts"); }
}

export async function PUT(req: NextRequest) {
  const { errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    const { id, name, startTime, endTime } = body;
    const shiftId = parseInt(id);
    const rawBreak = body.breakMinutes ?? body.gracePeriodMinutes;
    // PUT is a partial update — only coerce + send breakMinutes when the
    // caller actually supplied it. An undefined Prisma field is a no-op.
    let breakMinutes: number | undefined = undefined;
    if (rawBreak !== undefined && rawBreak !== null && rawBreak !== "") {
      const parsed = Number.parseInt(String(rawBreak), 10);
      if (!Number.isFinite(parsed)) {
        return NextResponse.json({ error: "breakMinutes must be an integer" }, { status: 400 });
      }
      breakMinutes = parsed;
    }
    const workDays = body.workDays ?? body.workingDays;
    const hdGrace = parseHalfDayGrace(body);
    if (hdGrace.error) return NextResponse.json({ error: hdGrace.error }, { status: 400 });
    const satHours = parseSatHours(body);
    if (satHours.error) return NextResponse.json({ error: satHours.error }, { status: 400 });
    const shift = await prisma.shift.update({
      where: { id: shiftId },
      data: { name, startTime, endTime, breakMinutes, workDays },
    });
    if (hdGrace.set) await setHalfDayGrace(shiftId, hdGrace.value);
    if (satHours.set) await setSatHours(shiftId, satHours.start, satHours.end, satHours.grace);
    const hdEcho = hdGrace.set ? { halfDayGraceMinutes: hdGrace.value } : {};
    // Update the Saturday rule whenever it was supplied (the form always sends it).
    if (body.saturdayPolicy !== undefined || body.saturdayWeeks !== undefined || body.saturdayDates !== undefined) {
      const { policy, weeks, dates } = parseSaturday(body);
      await setSaturday(shiftId, policy, weeks, dates);
      return NextResponse.json({ ...shift, saturdayPolicy: policy, saturdayWeeks: weeks, saturdayDates: dates, ...hdEcho });
    }
    return NextResponse.json({ ...shift, ...hdEcho });
  } catch (e) { return serverError(e, "PUT /api/hr/admin/shifts"); }
}
