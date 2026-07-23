// Per-job screening questions — list + create + bulk reorder.
//
//   GET    /api/hr/hiring/jobs/[id]/questions
//   POST   /api/hr/hiring/jobs/[id]/questions      { text, type?, options?, required? }
//   PATCH  /api/hr/hiring/jobs/[id]/questions      { order: number[] }   — reorder
//
// Per-question PATCH / DELETE live in ./[questionId]/route.ts.
//
// Soft-fails when the JobOpeningQuestion table is missing (migration
// not yet applied on a dev DB) — returns an empty list so the page
// renders the empty state rather than crashing.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set([
  "short_text", "long_text", "yes_no", "multiple_choice", "number", "date", "file",
]);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const jobId = parseInt(idParam, 10);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "Bad job id" }, { status: 400 });
    }

    let rows: any[] = [];
    try {
      rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, text, type, options, required, "sortOrder", "createdAt", "updatedAt"
           FROM "JobOpeningQuestion"
          WHERE "jobOpeningId" = $1
          ORDER BY "sortOrder" ASC, id ASC`,
        jobId,
      );
    } catch (e: any) {
      const msg = String(e?.meta?.message || e?.message || "");
      if (!/does not exist|42P01/i.test(msg)) throw e;
    }
    return NextResponse.json({ questions: rows });
  } catch (e) {
    return serverError(e, "GET /api/hr/hiring/jobs/[id]/questions");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id: idParam } = await params;
    const jobId = parseInt(idParam, 10);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "Bad job id" }, { status: 400 });
    }

    const body = await req.json();
    const text = String(body?.text ?? "").trim();
    if (!text) return NextResponse.json({ error: "Question text required" }, { status: 400 });

    const type = ALLOWED_TYPES.has(body?.type) ? body.type : "short_text";
    const required = body?.required === true;
    const options =
      Array.isArray(body?.options) && body.options.length
        ? JSON.stringify(body.options.map((o: any) => String(o).trim()).filter(Boolean))
        : null;

    // Append to the end — next sortOrder = current max + 10.
    const maxRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(MAX("sortOrder"), 0) AS m
         FROM "JobOpeningQuestion" WHERE "jobOpeningId" = $1`,
      jobId,
    );
    const nextSort = Number(maxRows[0]?.m ?? 0) + 10;

    const inserted = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO "JobOpeningQuestion"
        ("jobOpeningId", "text", "type", "options", "required", "sortOrder")
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING id, text, type, options, required, "sortOrder", "createdAt", "updatedAt"`,
      jobId, text, type, options, required, nextSort,
    );
    return NextResponse.json({ question: inserted[0] }, { status: 201 });
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/jobs/[id]/questions");
  }
}

/** Bulk reorder. Body: { order: number[] } — array of question IDs in
 *  the new display order. Re-assigns sortOrder = (index + 1) * 10. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id: idParam } = await params;
    const jobId = parseInt(idParam, 10);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "Bad job id" }, { status: 400 });
    }

    const body = await req.json();
    if (!Array.isArray(body?.order)) {
      return NextResponse.json({ error: "order array required" }, { status: 400 });
    }
    const ids: number[] = body.order
      .map((x: any) => Number(x))
      .filter((n: number) => Number.isInteger(n) && n > 0);

    // Sanity-check: only update questions that actually belong to
    // this job — prevents a malicious caller from re-sorting another
    // job's questions by passing their IDs.
    const owned = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM "JobOpeningQuestion" WHERE "jobOpeningId" = $1`,
      jobId,
    );
    const ownedIds = new Set(owned.map((r) => Number(r.id)));

    await prisma.$transaction(async (tx) => {
      let order = 10;
      for (const id of ids) {
        if (!ownedIds.has(id)) continue;
        await tx.$executeRawUnsafe(
          `UPDATE "JobOpeningQuestion" SET "sortOrder" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
          order, id,
        );
        order += 10;
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "PATCH /api/hr/hiring/jobs/[id]/questions");
  }
}
