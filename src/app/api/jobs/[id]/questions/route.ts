// Public — screening questions for a published job opening.
//
// Used by the public /jobs/apply page to render the per-job
// screening section configured under Hiring Setup → Application Form.
// No auth: applicants reach this page before logging in. We only
// expose questions for jobs in status='published' so HR's drafts
// don't leak.
//
// Soft-fails to an empty array when the JobOpeningQuestion table
// isn't migrated yet (older deployments), so the apply form just
// renders without the screening block instead of erroring out.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idParam } = await params;
    const jobId = parseInt(idParam, 10);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "Bad job id" }, { status: 400 });
    }

    // Verify the job exists AND is currently accepting applications.
    // Same gate the apply route enforces — keeps draft / on_hold /
    // closed JDs from leaking their question set publicly.
    const jobRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM "JobOpening"
        WHERE id = $1
          AND "status" = 'published'
          AND ("closesAt" IS NULL OR "closesAt" > NOW())
        LIMIT 1`,
      jobId,
    );
    if (jobRows.length === 0) {
      // Don't disclose whether the id exists vs. is unpublished —
      // both go to 404 to avoid being a draft-jobs enumeration oracle.
      return NextResponse.json({ questions: [] });
    }

    let rows: any[] = [];
    try {
      rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, text, type, options, required, "sortOrder"
           FROM "JobOpeningQuestion"
          WHERE "jobOpeningId" = $1
          ORDER BY "sortOrder" ASC, id ASC`,
        jobId,
      );
    } catch (e: any) {
      const msg = String(e?.meta?.message || e?.message || "");
      if (!/does not exist|42P01/i.test(msg)) throw e;
      // Table not migrated yet — render the form without questions.
    }

    // Strip internal fields, keep just what the apply form needs to
    // render + validate.
    const questions = rows.map((q) => ({
      id:       Number(q.id),
      text:     q.text,
      type:     q.type,
      options:  Array.isArray(q.options) ? q.options : null,
      required: q.required === true,
    }));
    return NextResponse.json({ questions });
  } catch (e: any) {
    console.error("[GET /api/jobs/[id]/questions]", e);
    return NextResponse.json({ questions: [] });
  }
}
