// Per-job screening questions — update + delete one.
//
//   PATCH  /api/hr/hiring/jobs/[id]/questions/[questionId]
//          body: { text?, type?, options?, required? }
//   DELETE /api/hr/hiring/jobs/[id]/questions/[questionId]
//
// Both verify the question belongs to the parent job before mutating.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set([
  "short_text", "long_text", "yes_no", "multiple_choice", "number", "date", "file",
]);

async function ownerCheck(jobId: number, questionId: number): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id FROM "JobOpeningQuestion" WHERE "id" = $1 AND "jobOpeningId" = $2`,
    questionId, jobId,
  );
  return rows.length > 0;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; questionId: string }> },
) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id: idParam, questionId: qParam } = await params;
    const jobId = parseInt(idParam, 10);
    const qId   = parseInt(qParam, 10);
    if (!Number.isInteger(jobId) || jobId <= 0) return NextResponse.json({ error: "Bad job id" }, { status: 400 });
    if (!Number.isInteger(qId)   || qId   <= 0) return NextResponse.json({ error: "Bad question id" }, { status: 400 });
    if (!(await ownerCheck(jobId, qId))) {
      return NextResponse.json({ error: "Question not found for this job" }, { status: 404 });
    }

    const body = await req.json();
    const set: string[] = [];
    const args: any[] = [];

    if (typeof body?.text === "string") {
      const v = body.text.trim();
      if (!v) return NextResponse.json({ error: "Text cannot be empty" }, { status: 400 });
      args.push(v); set.push(`"text" = $${args.length}`);
    }
    if (typeof body?.type === "string") {
      if (!ALLOWED_TYPES.has(body.type)) {
        return NextResponse.json({ error: `Unsupported type. Allowed: ${[...ALLOWED_TYPES].join(", ")}` }, { status: 400 });
      }
      args.push(body.type); set.push(`"type" = $${args.length}`);
    }
    if ("options" in body) {
      const v =
        Array.isArray(body.options) && body.options.length
          ? JSON.stringify(body.options.map((o: any) => String(o).trim()).filter(Boolean))
          : null;
      args.push(v); set.push(`"options" = $${args.length}::jsonb`);
    }
    if (typeof body?.required === "boolean") {
      args.push(body.required); set.push(`"required" = $${args.length}`);
    }
    if (set.length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    args.push(qId);
    const updated = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE "JobOpeningQuestion" SET ${set.join(", ")}, "updatedAt" = NOW()
        WHERE "id" = $${args.length}
       RETURNING id, text, type, options, required, "sortOrder", "createdAt", "updatedAt"`,
      ...args,
    );
    return NextResponse.json({ question: updated[0] });
  } catch (e) {
    return serverError(e, "PATCH /api/hr/hiring/jobs/[id]/questions/[questionId]");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; questionId: string }> },
) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id: idParam, questionId: qParam } = await params;
    const jobId = parseInt(idParam, 10);
    const qId   = parseInt(qParam, 10);
    if (!Number.isInteger(jobId) || jobId <= 0) return NextResponse.json({ error: "Bad job id" }, { status: 400 });
    if (!Number.isInteger(qId)   || qId   <= 0) return NextResponse.json({ error: "Bad question id" }, { status: 400 });
    if (!(await ownerCheck(jobId, qId))) {
      return NextResponse.json({ error: "Question not found for this job" }, { status: 404 });
    }

    await prisma.$executeRawUnsafe(
      `DELETE FROM "JobOpeningQuestion" WHERE "id" = $1`, qId,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/hiring/jobs/[id]/questions/[questionId]");
  }
}
