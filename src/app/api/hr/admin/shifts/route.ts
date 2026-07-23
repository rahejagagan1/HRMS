import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireHRAdmin, serverError } from "@/lib/api-auth";
import { getBrandScope } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

// Parse + validate the alternate-Saturday rule from a request body.
//   saturdayPolicy: "all" | "alternate" | "weeks"
//   saturdayWeeks:  ints 1-5 (only meaningful for "weeks")
function parseSaturday(body: any): { policy: string; weeks: number[] } {
  const policy = ["all", "alternate", "weeks"].includes(String(body?.saturdayPolicy))
    ? String(body.saturdayPolicy) : "all";
  const raw: number[] = Array.isArray(body?.saturdayWeeks)
    ? (body.saturdayWeeks as any[]).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5)
    : [];
  const weeks = Array.from(new Set(raw)).sort((a, b) => a - b);
  return { policy, weeks: policy === "weeks" ? weeks : [] };
}

// Postgres int[] literal from a validated (integer-only) array — injection-safe.
function weeksLiteral(weeks: number[]): string {
  return weeks.length ? `ARRAY[${weeks.join(",")}]::int[]` : `ARRAY[]::int[]`;
}

// The saturday* columns are read/written via raw SQL so this route keeps
// working even before `prisma generate` picks up the new columns.
async function setSaturday(shiftId: number, policy: string, weeks: number[]) {
  await prisma.$executeRawUnsafe(
    `UPDATE "Shift" SET "saturdayPolicy" = $1, "saturdayWeeks" = ${weeksLiteral(weeks)} WHERE id = $2`,
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
    const { policy, weeks } = parseSaturday(body);

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

    const shift = await prisma.shift.create({
      data: { name, startTime, endTime, breakMinutes, workDays },
    });
    await setSaturday(shift.id, policy, weeks);
    if (hdGrace.set) await setHalfDayGrace(shift.id, hdGrace.value);
    if (brand) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Shift" SET brand = $1 WHERE id = $2`,
        brand, shift.id,
      );
    }
    return NextResponse.json({ ...shift, saturdayPolicy: policy, saturdayWeeks: weeks, halfDayGraceMinutes: hdGrace.set ? hdGrace.value : null, brand }, { status: 201 });
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
    const shift = await prisma.shift.update({
      where: { id: shiftId },
      data: { name, startTime, endTime, breakMinutes, workDays },
    });
    if (hdGrace.set) await setHalfDayGrace(shiftId, hdGrace.value);
    const hdEcho = hdGrace.set ? { halfDayGraceMinutes: hdGrace.value } : {};
    // Update the Saturday rule whenever it was supplied (the form always sends it).
    if (body.saturdayPolicy !== undefined || body.saturdayWeeks !== undefined) {
      const { policy, weeks } = parseSaturday(body);
      await setSaturday(shiftId, policy, weeks);
      return NextResponse.json({ ...shift, saturdayPolicy: policy, saturdayWeeks: weeks, ...hdEcho });
    }
    return NextResponse.json({ ...shift, ...hdEcho });
  } catch (e) { return serverError(e, "PUT /api/hr/admin/shifts"); }
}
