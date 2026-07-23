// Single JobOpening — GET / PATCH / DELETE.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

/** Pre-migration soft-fail wrapper — see /api/hr/hiring/dashboard for
 *  the full rationale. Returns `fallback` if Postgres reports the
 *  table/column doesn't exist (42P01 / 42703). */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    const code = e?.meta?.code || e?.code;
    const msg = String(e?.meta?.message || e?.message || "");
    if (code === "42P01" || code === "42703" || /does not exist/i.test(msg)) return fallback;
    throw e;
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

    // Job lookup: full query (with recruiter/hiringManager joins) →
    // legacy fallback if those columns don't exist yet.
    let jobRows = await safe(
      () => prisma.$queryRawUnsafe<any[]>(
        `SELECT o.*, r."name" AS "recruiterName", h."name" AS "hiringManagerName"
           FROM "JobOpening" o
           LEFT JOIN "User" r ON r."id" = o."recruiterId"
           LEFT JOIN "User" h ON h."id" = o."hiringManagerId"
          WHERE o."id" = $1`,
        id,
      ),
      null as any,
    );
    if (jobRows === null) {
      jobRows = await safe(
        () => prisma.$queryRawUnsafe<any[]>(
          `SELECT o.*, NULL AS "recruiterName", NULL AS "hiringManagerName"
             FROM "JobOpening" o WHERE o."id" = $1`,
          id,
        ),
        [],
      );
    }

    const [interviewers, stageStats] = await Promise.all([
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT u."id", u."name", u."profilePictureUrl"
           FROM "JobOpeningInterviewer" ji
           JOIN "User" u ON u."id" = ji."userId"
          WHERE ji."jobOpeningId" = $1`,
        id,
      ), []),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT s."id", s."key", COUNT(a."id") AS "count"
           FROM "HiringStage" s
           LEFT JOIN "JobApplication" a ON a."currentStageId" = s."id" AND a."jobOpeningId" = $1
          GROUP BY s."id", s."key"
          ORDER BY s."sortOrder" ASC`,
        id,
      ), []),
    ]);

    const job = jobRows[0];
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({
      job,
      interviewers,
      stageStats: stageStats.map((s) => ({ ...s, count: Number(s.count ?? 0) })),
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/hiring/jobs/[id]");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

    const body = await req.json();
    const set: string[] = [];
    const args: any[] = [];
    const setField = (col: string, val: any, sqlCast = "") => {
      if (val === undefined) return;
      args.push(val);
      set.push(`"${col}" = $${args.length}${sqlCast}`);
    };
    setField("title",          body.title);
    setField("department",     body.department);
    setField("location",       body.location);
    setField("description",    body.description);
    setField("brand",          body.brand);
    setField("employmentType", body.employmentType);
    setField("experienceLevel",body.experienceLevel);
    setField("salaryRange",    body.salaryRange);
    setField("internalNotes",  body.internalNotes);
    setField("recruiterId",    body.recruiterId);
    setField("hiringManagerId",body.hiringManagerId);

    // Vacancies — clamp to a sane positive int.
    if (body.vacancies !== undefined) {
      const n = Number(body.vacancies);
      if (Number.isInteger(n) && n > 0) {
        args.push(n); set.push(`"vacancies" = $${args.length}`);
      }
    }

    // Status / isOpen — these two columns must stay in lock-step.
    // Prefer the dedicated /publish endpoint for transitions, but if
    // PATCH includes either, keep them consistent.
    if (typeof body.status === "string" && ["draft", "published", "on_hold", "closed"].includes(body.status)) {
      args.push(body.status); set.push(`"status" = $${args.length}`);
      args.push(body.status === "published"); set.push(`"isOpen" = $${args.length}`);
    } else if (typeof body.isOpen === "boolean") {
      // Legacy callers that toggle isOpen directly. Mirror to status.
      args.push(body.isOpen); set.push(`"isOpen" = $${args.length}`);
      args.push(body.isOpen ? "published" : "closed");
      set.push(`"status" = $${args.length}`);
    }
    if (body.closesAt !== undefined) {
      args.push(body.closesAt ? new Date(body.closesAt) : null);
      set.push(`"closesAt" = $${args.length}`);
    }

    if (set.length > 0) {
      args.push(id);
      await prisma.$executeRawUnsafe(
        `UPDATE "JobOpening" SET ${set.join(", ")}, "updatedAt" = NOW() WHERE "id" = $${args.length}`,
        ...args,
      );
    }

    if (Array.isArray(body.interviewerIds)) {
      await prisma.$executeRawUnsafe(`DELETE FROM "JobOpeningInterviewer" WHERE "jobOpeningId" = $1`, id);
      for (const uid of body.interviewerIds) {
        const uidNum = Number(uid);
        if (!Number.isInteger(uidNum)) continue;
        await prisma.$executeRawUnsafe(
          `INSERT INTO "JobOpeningInterviewer" ("jobOpeningId", "userId")
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          id, uidNum,
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "PATCH /api/hr/hiring/jobs/[id]");
  }
}

// Hard-delete a JobOpening. Refuses when the role still has any
// applications — HR is asked to use "Close role" instead so the
// candidate history is preserved. Force-delete is supported via
// `?force=1` for the rare case where HR really wants to nuke the
// requisition and all of its candidate data.
//
// Cleanup order matters because of FK constraints:
//   JobApplicationStage  (history rows tied to each application)
//   Interview / InterviewPanelist / InterviewScorecard
//   CandidateActivity / OfferLetter
//   JobApplication       (candidates)
//   JobOpeningInterviewer (panel join rows)
//   JobOpening           (the row itself)
//
// Each step is wrapped in tolerateMissingTable() so older deploys
// that don't have every table (e.g. pre-Keka-parity migrations)
// don't blow up.
async function tolerateMissingTable(fn: () => Promise<any>): Promise<void> {
  try { await fn(); }
  catch (e: any) {
    const code = e?.meta?.code || e?.code;
    const msg = String(e?.meta?.message || e?.message || "");
    if (code === "42P01" || code === "42703" || /does not exist/i.test(msg)) return;
    throw e;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

    const { searchParams } = new URL(req.url);
    const force = searchParams.get("force") === "1";

    // Block accidental deletes when there's candidate history attached.
    const counts = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "JobApplication" WHERE "jobOpeningId" = $1`,
      id,
    );
    const applicantCount = Number(counts[0]?.n ?? 0);
    if (applicantCount > 0 && !force) {
      return NextResponse.json(
        {
          error: `This job has ${applicantCount} application${applicantCount === 1 ? "" : "s"}. Use "Close role" to preserve history, or re-confirm to permanently delete.`,
          applicantCount,
          needsForce: true,
        },
        { status: 409 },
      );
    }

    // Cascade cleanup, safest order. All tables are namespaced under
    // the JobOpening so deleting nothing else stays orphaned.
    await tolerateMissingTable(() => prisma.$executeRawUnsafe(
      `DELETE FROM "JobApplicationStage" WHERE "jobApplicationId" IN (
         SELECT id FROM "JobApplication" WHERE "jobOpeningId" = $1
       )`, id,
    ));
    await tolerateMissingTable(() => prisma.$executeRawUnsafe(
      `DELETE FROM "InterviewPanelist" WHERE "interviewId" IN (
         SELECT id FROM "Interview" WHERE "jobApplicationId" IN (
           SELECT id FROM "JobApplication" WHERE "jobOpeningId" = $1
         )
       )`, id,
    ));
    await tolerateMissingTable(() => prisma.$executeRawUnsafe(
      `DELETE FROM "InterviewScorecard" WHERE "interviewId" IN (
         SELECT id FROM "Interview" WHERE "jobApplicationId" IN (
           SELECT id FROM "JobApplication" WHERE "jobOpeningId" = $1
         )
       )`, id,
    ));
    await tolerateMissingTable(() => prisma.$executeRawUnsafe(
      `DELETE FROM "Interview" WHERE "jobApplicationId" IN (
         SELECT id FROM "JobApplication" WHERE "jobOpeningId" = $1
       )`, id,
    ));
    await tolerateMissingTable(() => prisma.$executeRawUnsafe(
      `DELETE FROM "CandidateActivity" WHERE "jobApplicationId" IN (
         SELECT id FROM "JobApplication" WHERE "jobOpeningId" = $1
       )`, id,
    ));
    await tolerateMissingTable(() => prisma.$executeRawUnsafe(
      `DELETE FROM "OfferLetter" WHERE "jobApplicationId" IN (
         SELECT id FROM "JobApplication" WHERE "jobOpeningId" = $1
       )`, id,
    ));
    await tolerateMissingTable(() => prisma.$executeRawUnsafe(
      `DELETE FROM "JobApplication" WHERE "jobOpeningId" = $1`, id,
    ));
    await tolerateMissingTable(() => prisma.$executeRawUnsafe(
      `DELETE FROM "JobOpeningInterviewer" WHERE "jobOpeningId" = $1`, id,
    ));
    await prisma.$executeRawUnsafe(
      `DELETE FROM "JobOpening" WHERE "id" = $1`, id,
    );

    return NextResponse.json({ ok: true, deletedApplicants: applicantCount });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/hiring/jobs/[id]");
  }
}
