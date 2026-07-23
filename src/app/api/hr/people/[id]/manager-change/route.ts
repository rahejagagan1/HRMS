import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { istTodayDateOnly } from "@/lib/ist-date";
import {
  getPendingManagerChange,
  scheduleManagerChange,
  cancelPendingManagerChange,
} from "@/lib/hr/manager-changes";

export const dynamic = "force-dynamic";

// Same gate as the People PUT route (canEditOthers): editing someone
// else's reporting line is HR ops + admins only. RBAC-designation-driven
// (policy 2026-07-14) via the shared isHRAdmin (MANAGE_HR).
import { isHRAdmin } from "@/lib/access";
function canEditOthers(session: any): boolean {
  return isHRAdmin(session?.user);
}

function parseUserId(idParam: string): number | null {
  const id = parseInt(idParam, 10);
  // Nullable-FK rule: integer && > 0 (Number.isFinite(0) traps).
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET — the employee's pending scheduled change (or null).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canEditOthers(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await params;
    const userId = parseUserId(id);
    if (userId == null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const pending = await getPendingManagerChange(userId);
    return NextResponse.json({ pending });
  } catch (e) {
    return serverError(e, "GET /api/hr/people/[id]/manager-change");
  }
}

// POST — schedule (or reschedule) a future reporting-manager change.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canEditOthers(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await params;
    const userId = parseUserId(id);
    if (userId == null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const newManagerId = Number(body?.newManagerId);
    const effectiveDate = String(body?.effectiveDate ?? "").trim();
    const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

    if (!Number.isInteger(newManagerId) || newManagerId <= 0)
      return NextResponse.json({ error: "Pick a new reporting manager." }, { status: 400 });
    if (newManagerId === userId)
      return NextResponse.json({ error: "An employee can't report to themselves." }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate))
      return NextResponse.json({ error: "Pick a valid effective date." }, { status: 400 });

    // Future-only. A "change it now" should use the normal Reporting
    // Manager dropdown; this control is for a date down the line.
    const today = istTodayDateOnly();
    const eff = new Date(`${effectiveDate}T00:00:00.000Z`);
    if (Number.isNaN(eff.getTime()) || eff.getTime() <= today.getTime())
      return NextResponse.json({ error: "Effective date must be in the future." }, { status: 400 });

    const mgr = await prisma.user.findFirst({ where: { id: newManagerId, isActive: true }, select: { id: true } });
    if (!mgr) return NextResponse.json({ error: "That manager isn't an active employee." }, { status: 400 });
    const emp = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!emp) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

    const createdBy = await resolveUserId(session);
    const pending = await scheduleManagerChange({ userId, newManagerId, effectiveDate, createdBy, note });
    return NextResponse.json({ ok: true, pending });
  } catch (e) {
    return serverError(e, "POST /api/hr/people/[id]/manager-change");
  }
}

// DELETE — cancel the pending change.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canEditOthers(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await params;
    const userId = parseUserId(id);
    if (userId == null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const cancelled = await cancelPendingManagerChange(userId);
    return NextResponse.json({ ok: true, cancelled });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/people/[id]/manager-change");
  }
}
