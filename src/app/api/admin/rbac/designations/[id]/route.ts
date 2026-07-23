// PATCH  /api/admin/rbac/designations/[id]  → update label / scorecardFunction / isActive / permission grants
// DELETE /api/admin/rbac/designations/[id]  → delete (non-system, zero users only)

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { canManageDesignations, syncGrants, syncReportGrants, syncReportTemplates } from "@/lib/permissions/designation-admin";

export const dynamic = "force-dynamic";

// GET /api/admin/rbac/designations/[id] → the users currently on this designation.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageDesignations(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = parseInt((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const users = await prisma.$queryRawUnsafe<{ id: number; name: string; email: string; isActive: boolean; businessUnit: string | null }[]>(
    `SELECT u."id", u."name", u."email", u."isActive", ep."businessUnit"
       FROM "User" u
       LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u."id"
      WHERE u."designationId" = $1
      ORDER BY u."isActive" DESC, u."name"`,
    id
  );
  return NextResponse.json({ users });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageDesignations(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = parseInt((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const actorId = (session.user as { dbId?: number }).dbId ?? null;

  const sets: string[] = [];
  const args: unknown[] = [];
  let i = 1;
  if (typeof body.label === "string" && body.label.trim()) {
    sets.push(`"label" = $${i++}`); args.push(body.label.trim());
  }
  if ("scorecardFunction" in body) {
    sets.push(`"scorecardFunction" = $${i++}`);
    args.push(body.scorecardFunction ? String(body.scorecardFunction) : null);
  }
  if (typeof body.isActive === "boolean") {
    sets.push(`"isActive" = $${i++}`); args.push(body.isActive);
  }
  if (typeof body.businessUnit === "string" && body.businessUnit.trim()) {
    sets.push(`"businessUnit" = $${i++}`); args.push(body.businessUnit.trim());
  }
  if (sets.length) {
    sets.push(`"updatedAt" = NOW()`);
    args.push(id);
    await prisma.$executeRawUnsafe(`UPDATE "Designation" SET ${sets.join(", ")} WHERE "id" = $${i}`, ...args);
  }

  if (Array.isArray(body.permissionKeys)) {
    await syncGrants(id, body.permissionKeys.map(String), actorId);
  }

  // Only touch report grants when the key is present, so a partial PATCH
  // (e.g. just toggling isActive) doesn't wipe a designation's report access.
  if (Array.isArray(body.reportOwnerIds)) {
    await syncReportGrants(id, body.reportOwnerIds.map(Number), actorId);
  }
  if (Array.isArray(body.reportTemplates)) {
    await syncReportTemplates(id, body.reportTemplates.map(String), actorId);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageDesignations(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = parseInt((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const rows = await prisma.$queryRawUnsafe<{ userCount: number }[]>(
    `SELECT (SELECT count(*)::int FROM "User" u WHERE u."designationId" = d."id") AS "userCount"
     FROM "Designation" d WHERE d."id" = $1`,
    id
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The only hard block: a designation with users assigned can't be deleted —
  // that would strip those users' access. Built-in designations CAN be deleted
  // when empty (they're recreated by the seed/self-heal on the next sync).
  if (Number(rows[0].userCount) > 0) {
    return NextResponse.json(
      { error: `Reassign the ${rows[0].userCount} user(s) on this designation first, then delete.` },
      { status: 409 }
    );
  }
  // DesignationPermission rows cascade on delete.
  await prisma.$executeRawUnsafe(`DELETE FROM "Designation" WHERE "id" = $1`, id);
  return NextResponse.json({ ok: true });
}
