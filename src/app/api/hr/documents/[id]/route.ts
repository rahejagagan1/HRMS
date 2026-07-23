// DELETE /api/hr/documents/:id — remove a document row + its blob.
// Auth: HR admin OR the document's owner (employees can clear their
// own missed uploads). Hard delete; assignment history isn't tracked
// for documents in the way it is for assets.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

// RBAC-designation-driven (policy 2026-07-14): shared isHRAdmin resolves
// MANAGE_HR from the caller's designation. Replaced a local legacy copy.
import { isHRAdmin } from "@/lib/access";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const { id } = await params;
    const docId = Number(id);
    if (!Number.isInteger(docId) || docId <= 0) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }
    const myId = await resolveUserId(session);
    const self = session!.user as any;
    const row = (await prisma.$queryRawUnsafe<any[]>(
      `SELECT "userId" FROM "EmployeeDocument" WHERE id = $1`, docId,
    ))[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (row.userId !== myId && !isHRAdmin(self)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "EmployeeDocument" WHERE id = $1`, docId);
    return NextResponse.json({ ok: true });
  } catch (e) { return serverError(e, "DELETE /api/hr/documents/[id]"); }
}
