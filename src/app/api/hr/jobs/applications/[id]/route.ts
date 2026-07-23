// PATCH a single JobApplication — used by the Hiring inbox to move
// candidates through the workflow (status) and add private HR notes.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

const STATUS_VALUES = new Set(["new", "reviewed", "shortlisted", "interviewing", "rejected", "hired"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const body = await req.json();

    const sets: string[] = [];
    const args: any[] = [];
    let i = 1;
    if (body.status !== undefined) {
      const s = String(body.status);
      if (!STATUS_VALUES.has(s)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      sets.push(`status = $${i++}`);
      args.push(s);
    }
    if (body.hrNotes !== undefined) {
      sets.push(`"hrNotes" = $${i++}`);
      args.push(body.hrNotes || null);
    }
    if (sets.length === 0) return NextResponse.json({ ok: true });
    sets.push(`"updatedAt" = now()`);
    args.push(id);
    await prisma.$executeRawUnsafe(
      `UPDATE "JobApplication" SET ${sets.join(", ")} WHERE id = $${i}`,
      ...args,
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[PATCH /api/hr/jobs/applications/:id] failed:", e);
    return NextResponse.json({ error: e?.message || "Save failed" }, { status: 500 });
  }
}
