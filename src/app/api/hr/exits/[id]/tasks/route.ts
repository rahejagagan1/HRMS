// HR-side offboarding — ExitTask endpoints (the clearance checklist).
//
//   GET  /api/hr/exits/:id/tasks  → all tasks for an exit
//   POST /api/hr/exits/:id/tasks  → add a new task
//
// Each task has a category that maps to one of Keka's clearance panes
// (finance / tasks / it / admin) so the drawer can group them visually
// without a separate config table.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

// Use canonical isHRAdmin helper instead of inline copy.
const canManage = (session: any) => isHRAdmin(session?.user);

const CATEGORIES = new Set(["finance", "tasks", "it", "admin"]);
const STATUSES = new Set(["pending", "in_progress", "done"]);

type TaskRow = {
  id: number; exitId: number; category: string; title: string;
  description: string | null; assigneeId: number | null;
  assigneeName: string | null; assigneePicture: string | null;
  status: string; dueDate: Date | null; completedAt: Date | null;
  createdAt: Date; updatedAt: Date;
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const rows = await prisma.$queryRawUnsafe<TaskRow[]>(
      `SELECT t.id, t."exitId", t.category, t.title, t.description,
              t."assigneeId",
              u.name AS "assigneeName",
              u."profilePictureUrl" AS "assigneePicture",
              t.status, t."dueDate", t."completedAt",
              t."createdAt", t."updatedAt"
         FROM "ExitTask" t
    LEFT JOIN "User" u ON u.id = t."assigneeId"
        WHERE t."exitId" = $1
        ORDER BY t."createdAt" ASC`,
      id,
    );
    return NextResponse.json(rows);
  } catch (e: any) {
    console.error("[GET /api/hr/exits/:id/tasks] failed:", e);
    return NextResponse.json({ error: "Could not load tasks" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await req.json();
    const category = CATEGORIES.has(String(body?.category)) ? String(body.category) : "tasks";
    const title = String(body?.title || "").trim().slice(0, 200);
    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    const description = body?.description ? String(body.description) : null;
    // Coerce defensively: Number(null) === 0 and Number.isFinite(0) === true,
    // so an unassigned create would otherwise write assigneeId=0 and fail the FK.
    const assigneeId = Number.isInteger(Number(body?.assigneeId)) && Number(body?.assigneeId) > 0 ? Number(body.assigneeId) : null;
    const dueDate = body?.dueDate ? new Date(body.dueDate) : null;
    const status = STATUSES.has(String(body?.status)) ? String(body.status) : "pending";

    // Confirm exit exists.
    const exists = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT id FROM "EmployeeExit" WHERE id = $1`, id,
    );
    if (exists.length === 0) return NextResponse.json({ error: "Exit not found" }, { status: 404 });

    const created = await prisma.$queryRawUnsafe<TaskRow[]>(
      `INSERT INTO "ExitTask" ("exitId", category, title, description, "assigneeId", "dueDate", status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, "exitId", category, title, description, "assigneeId",
                 NULL::text AS "assigneeName",
                 NULL::text AS "assigneePicture",
                 status, "dueDate", "completedAt", "createdAt", "updatedAt"`,
      id, category, title, description, assigneeId, dueDate, status,
    );

    if (created[0] && assigneeId) {
      const u = await prisma.user.findUnique({
        where: { id: assigneeId },
        select: { name: true, profilePictureUrl: true },
      });
      created[0].assigneeName = u?.name ?? null;
      created[0].assigneePicture = u?.profilePictureUrl ?? null;
    }

    return NextResponse.json(created[0]);
  } catch (e: any) {
    console.error("[POST /api/hr/exits/:id/tasks] failed:", e);
    return NextResponse.json({ error: e?.message || "Save failed" }, { status: 500 });
  }
}
