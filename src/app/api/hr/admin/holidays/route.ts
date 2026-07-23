import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isHRAdmin, serverError } from "@/lib/api-auth";
import { istTodayDateOnly } from "@/lib/ist-date";

export const dynamic = "force-dynamic";

// Holidays editor is available to admin, CEO, HR manager, and developer.
// Regular employees can still read via GET for the widget.
async function requireCalendarEditor() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return { session: null, errorResponse };
  const user = session!.user as any;
  const canEdit = isHRAdmin(user);
  if (!canEdit) {
    return {
      session: null,
      errorResponse: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session, errorResponse: null };
}

// GET /api/hr/admin/holidays?year=2026 — open to every signed-in user.
export async function GET(req: NextRequest) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const { searchParams } = new URL(req.url);
    const year = parseInt(searchParams.get("year") || String(istTodayDateOnly().getUTCFullYear()), 10);
    const holidays = await prisma.holidayCalendar.findMany({
      where: { year },
      orderBy: { date: "asc" },
    });
    return NextResponse.json(holidays);
  } catch (e) { return serverError(e, "GET /api/hr/admin/holidays"); }
}

// POST /api/hr/admin/holidays — HR admin only.
export async function POST(req: NextRequest) {
  const { errorResponse } = await requireCalendarEditor();
  if (errorResponse) return errorResponse;
  try {
    const { name, date, type } = await req.json();
    if (!name || !date) return NextResponse.json({ error: "name and date required" }, { status: 400 });
    const d = new Date(date);
    if (isNaN(d.getTime())) return NextResponse.json({ error: "invalid date" }, { status: 400 });
    const holiday = await prisma.holidayCalendar.upsert({
      where: { year_date: { year: d.getUTCFullYear(), date: d } },
      create: { name, date: d, year: d.getUTCFullYear(), type: type || "public" },
      update: { name, type: type || "public" },
    });
    return NextResponse.json(holiday, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/admin/holidays"); }
}

// PUT /api/hr/admin/holidays — edit an existing holiday by id.
export async function PUT(req: NextRequest) {
  const { errorResponse } = await requireCalendarEditor();
  if (errorResponse) return errorResponse;
  try {
    const { id, name, date, type } = await req.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const data: any = {};
    if (name) data.name = name;
    if (type) data.type = type;
    if (date) {
      const d = new Date(date);
      if (isNaN(d.getTime())) return NextResponse.json({ error: "invalid date" }, { status: 400 });
      data.date = d;
      data.year = d.getUTCFullYear();
    }
    const holiday = await prisma.holidayCalendar.update({ where: { id }, data });
    return NextResponse.json(holiday);
  } catch (e) { return serverError(e, "PUT /api/hr/admin/holidays"); }
}

export async function DELETE(req: NextRequest) {
  const { errorResponse } = await requireCalendarEditor();
  if (errorResponse) return errorResponse;
  try {
    const { searchParams } = new URL(req.url);
    const id = parseInt(searchParams.get("id") || "0");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await prisma.holidayCalendar.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) { return serverError(e, "DELETE /api/hr/admin/holidays"); }
}
