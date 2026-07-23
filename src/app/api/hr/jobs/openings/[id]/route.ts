// PATCH / DELETE a single JobOpening. Used by the Hiring → Openings tab
// to toggle Open/Closed, edit details, and remove old roles.
//
// Delete is RESTRICT-protected by the FK from JobApplication — if any
// applications exist for the role we surface a friendly error instead
// of letting Postgres error out.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// RBAC-designation-driven (policy 2026-07-14): MANAGE_HIRING is the hiring-
// console permission. Legacy expression kept only as the fallback for
// sessions without resolved permissions.
import { can, hasResolvedPermissions } from "@/lib/permissions/can";
function canManageHiring(session: any): boolean {
  const u = session?.user as any;
  if (!u) return false;
  if (hasResolvedPermissions(u)) return can(u, "MANAGE_HIRING");
  return u.orgLevel === "ceo" || u.orgLevel === "hr_manager" || u.role === "admin" || u.isDeveloper === true;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManageHiring(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const body = await req.json();

    // Build the SET clause dynamically — only patch fields the caller sent.
    const sets: string[] = [];
    const args: any[] = [];
    let i = 1;
    if (body.title       !== undefined) { sets.push(`title = $${i++}`);       args.push(String(body.title).trim()); }
    if (body.department  !== undefined) { sets.push(`department = $${i++}`);  args.push(body.department || null); }
    if (body.location    !== undefined) { sets.push(`location = $${i++}`);    args.push(body.location || null); }
    if (body.description !== undefined) { sets.push(`description = $${i++}`); args.push(body.description || null); }
    if (body.isOpen      !== undefined) { sets.push(`"isOpen" = $${i++}`);    args.push(!!body.isOpen); }
    if (sets.length === 0) return NextResponse.json({ ok: true });
    sets.push(`"updatedAt" = now()`);
    args.push(id);
    await prisma.$executeRawUnsafe(
      `UPDATE "JobOpening" SET ${sets.join(", ")} WHERE id = $${i}`,
      ...args,
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[PATCH /api/hr/jobs/openings/:id] failed:", e);
    return NextResponse.json({ error: e?.message || "Save failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManageHiring(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const used = await prisma.$queryRawUnsafe<Array<{ c: number }>>(
      `SELECT COUNT(*)::int AS c FROM "JobApplication" WHERE "jobOpeningId" = $1`,
      id,
    );
    if (used[0]?.c > 0) {
      return NextResponse.json(
        { error: "Cannot delete — applications already exist for this role. Mark it Closed instead." },
        { status: 409 },
      );
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "JobOpening" WHERE id = $1`, id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[DELETE /api/hr/jobs/openings/:id] failed:", e);
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
