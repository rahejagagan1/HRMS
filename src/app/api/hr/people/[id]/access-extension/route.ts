import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

// POST /api/hr/people/:id/access-extension
//   { days: number, reason?: string }  → grant login access for `days` days
//        from today (accessExtendedUntil = start-of-today + days, inclusive).
//   { days: 0 }  → clear the extension (revoke immediately).
//
// HR-admin only. Lets an exited / deactivated employee keep signing in for a
// short grace window the HR department controls (2026-07-28).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Only HR can grant login access." }, { status: 403 });
  }
  try {
    const { id: idRaw } = await params;
    const userId = parseInt(idRaw, 10);
    if (!Number.isFinite(userId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const days = Number(body?.days);
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      return NextResponse.json({ error: "Days must be between 0 and 365." }, { status: 400 });
    }
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 300) : null;

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // days = 0 → clear the grant. Otherwise access ends at end of (today + days):
    // store start-of-today + days so today counts as day 1 of the window.
    let until: Date | null = null;
    if (days > 0) {
      until = new Date(); until.setUTCHours(0, 0, 0, 0);
      until.setUTCDate(until.getUTCDate() + days);
    }
    // Raw SQL — the generated Prisma client can lag on the new column.
    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "accessExtendedUntil" = $1 WHERE id = $2`,
      until, userId,
    );

    const actorId = await resolveUserId(session);
    await writeAuditLog({
      action: days > 0 ? "user.access_extension_grant" : "user.access_extension_clear",
      entityType: "User", entityId: userId, actorId,
      metadata: { days, until: until ? until.toISOString().slice(0, 10) : null, reason },
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      accessExtendedUntil: until ? until.toISOString() : null,
      until: until ? until.toISOString().slice(0, 10) : null,
    });
  } catch (e) { return serverError(e, "POST /api/hr/people/[id]/access-extension"); }
}
