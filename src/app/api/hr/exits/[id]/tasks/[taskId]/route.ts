// PATCH / DELETE a single ExitTask.
//
//   PATCH  → edit title, description, assignee, due date, status
//   DELETE → drop the task entirely
//
// Marking a task `done` stamps completedAt (and clears it on reopen).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// RBAC-designation-driven (policy 2026-07-14): shared isHRAdmin resolves
// MANAGE_HR from the caller's designation. Replaced a local legacy copy.
import { isHRAdmin } from "@/lib/access";
function canManage(session: any): boolean {
  return isHRAdmin(session?.user);
}

const CATEGORIES = new Set(["finance", "tasks", "it", "admin"]);
const STATUSES = new Set(["pending", "in_progress", "done"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam, taskId: tParam } = await params;
    const id = parseInt(idParam);
    const taskId = parseInt(tParam);
    if (!Number.isFinite(id) || !Number.isFinite(taskId))
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await req.json();

    const sets: string[] = [];
    const args: any[] = [];
    let i = 1;

    if (body.title !== undefined) {
      const title = String(body.title || "").trim().slice(0, 200);
      if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
      sets.push(`title = $${i++}`); args.push(title);
    }
    if (body.description !== undefined) {
      sets.push(`description = $${i++}`);
      args.push(body.description ? String(body.description) : null);
    }
    if (body.assigneeId !== undefined) {
      // Coerce defensively: Number(null) === 0 and Number.isFinite(0) === true,
      // so an unassign would otherwise write assigneeId=0 and fail the FK.
      const aid = Number.isInteger(Number(body.assigneeId)) && Number(body.assigneeId) > 0 ? Number(body.assigneeId) : null;
      sets.push(`"assigneeId" = $${i++}`); args.push(aid);
    }
    if (body.dueDate !== undefined) {
      sets.push(`"dueDate" = $${i++}`);
      args.push(body.dueDate ? new Date(body.dueDate) : null);
    }
    if (body.category !== undefined) {
      if (!CATEGORIES.has(String(body.category)))
        return NextResponse.json({ error: "Invalid category" }, { status: 400 });
      sets.push(`category = $${i++}`); args.push(String(body.category));
    }
    if (body.status !== undefined) {
      if (!STATUSES.has(String(body.status)))
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      sets.push(`status = $${i++}`); args.push(String(body.status));
      // completedAt mirrors the status flip so the drawer can sort by it.
      if (body.status === "done") {
        sets.push(`"completedAt" = now()`);
      } else {
        sets.push(`"completedAt" = NULL`);
      }
    }
    if (sets.length === 0) return NextResponse.json({ ok: true });
    sets.push(`"updatedAt" = now()`);
    args.push(taskId, id);

    await prisma.$executeRawUnsafe(
      `UPDATE "ExitTask" SET ${sets.join(", ")} WHERE id = $${i++} AND "exitId" = $${i}`,
      ...args,
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[PATCH /api/hr/exits/:id/tasks/:taskId] failed:", e);
    return NextResponse.json({ error: e?.message || "Save failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam, taskId: tParam } = await params;
    const id = parseInt(idParam);
    const taskId = parseInt(tParam);
    if (!Number.isFinite(id) || !Number.isFinite(taskId))
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    await prisma.$executeRawUnsafe(
      `DELETE FROM "ExitTask" WHERE id = $1 AND "exitId" = $2`, taskId, id,
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[DELETE /api/hr/exits/:id/tasks/:taskId] failed:", e);
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
