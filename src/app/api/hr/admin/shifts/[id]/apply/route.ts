import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { istTodayDateOnly } from "@/lib/ist-date";

export const dynamic = "force-dynamic";
type Params = Promise<{ id: string }>;

// POST /api/hr/admin/shifts/[id]/apply
// Body: { scope: "all" | "nb_media" | "yt_labs" | "specific", userIds?: number[], effectiveFrom?: string }
//
// Assigns this shift to a set of active employees by upserting their single
// UserShift row (userId is @unique → re-applying reassigns). Only affects
// FUTURE working-day decisions; no past attendance is recomputed.
export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user as any)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id: idRaw } = await params;
    const shiftId = parseInt(idRaw);
    if (isNaN(shiftId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const scope = String(body?.scope ?? "");
    const validScopes = ["all", "nb_media", "yt_labs", "specific"];
    if (!validScopes.includes(scope)) {
      return NextResponse.json({ error: "scope must be one of all | nb_media | yt_labs | specific" }, { status: 400 });
    }

    const shift = await prisma.shift.findUnique({ where: { id: shiftId }, select: { id: true } });
    if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });

    const effectiveFrom = body?.effectiveFrom ? new Date(body.effectiveFrom) : istTodayDateOnly();
    if (isNaN(effectiveFrom.getTime())) {
      return NextResponse.json({ error: "Invalid effectiveFrom" }, { status: 400 });
    }

    // ── Resolve the target active users for the chosen scope ──
    let where: any = { isActive: true };
    if (scope === "yt_labs") {
      where.employeeProfile = { businessUnit: "YT Labs" };
    } else if (scope === "nb_media") {
      // NB Media is the default bucket — legacy rows with no businessUnit
      // (or no profile) count as NB Media, matching the admin grid.
      where.OR = [
        { employeeProfile: { businessUnit: "NB Media" } },
        { employeeProfile: { is: { businessUnit: null } } },
        { employeeProfile: { is: null } },
      ];
    } else if (scope === "specific") {
      const ids = Array.isArray(body?.userIds)
        ? body.userIds.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n))
        : [];
      if (ids.length === 0) return NextResponse.json({ error: "userIds required for scope=specific" }, { status: 400 });
      where.id = { in: ids };
    }

    const targets = await prisma.user.findMany({ where, select: { id: true } });
    if (targets.length === 0) {
      return NextResponse.json({ ok: true, scope, applied: 0, created: 0, reassigned: 0 });
    }
    const targetIds = targets.map((u) => u.id);

    // Split created vs reassigned for an informative confirmation message.
    const existing = await prisma.userShift.findMany({
      where: { userId: { in: targetIds } }, select: { userId: true },
    });
    const existingIds = new Set(existing.map((r) => r.userId));

    for (const userId of targetIds) {
      await prisma.userShift.upsert({
        where: { userId },
        create: { userId, shiftId, effectiveFrom },
        update: { shiftId, effectiveFrom },
      });
    }

    const reassigned = targetIds.filter((id) => existingIds.has(id)).length;
    return NextResponse.json({
      ok: true,
      scope,
      applied: targetIds.length,
      created: targetIds.length - reassigned,
      reassigned,
    });
  } catch (e) { return serverError(e, "POST /api/hr/admin/shifts/[id]/apply"); }
}
