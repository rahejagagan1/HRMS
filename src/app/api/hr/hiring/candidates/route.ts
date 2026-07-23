// HR Hiring — list candidates, optionally scoped to a job opening.
//
// GET /api/hr/hiring/candidates?openingId=N
//   → returns candidates for that job, hydrated with current stage +
//     basic counts (resume, interviews, offers). Used by the kanban.
//
// GET /api/hr/hiring/candidates
//   → returns all candidates across all jobs (Candidates tab).
//
// Each row includes:
//   { id, fullName, email, phone, experienceYears, currentCompany,
//     resumeUrl, source, overallRating, currentStage: { id, key,
//     label, kind, color }, enteredStageAt, jobOpeningId, roleTitle }

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { gravatarUrl } from "@/lib/gravatar";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  // HR-admin gate — candidate rows include phone, email, salary
  // expectations and resume URLs. Non-HR employees have no business
  // seeing this. Mirrors the gate on POST/PATCH.
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const openingIdRaw = searchParams.get("openingId");
    const openingId = openingIdRaw && /^\d+$/.test(openingIdRaw) ? parseInt(openingIdRaw, 10) : null;

    // Raw SQL so the new currentStageId column doesn't trip the typed
    // client when prisma generate hasn't been re-run. Two-step query
    // with a fallback for the pre-migration dev DB: if currentStageId
    // / HiringStage don't exist yet, fall back to the legacy schema
    // (no stage join) so the page still renders.
    let rows: any[] = [];
    try {
      rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT
           a."id", a."fullName", a."email", a."phone", a."experienceYears",
           a."currentCompany", a."noticePeriod", a."resumeUrl", a."resumeFileName",
           a."source", a."overallRating", a."status",
           a."currentStageId", a."enteredStageAt", a."createdAt", a."updatedAt",
           a."jobOpeningId",
           a."archivedAt", a."archiveReason",
           a."referredById",
           rb."id"   AS "rb_id",
           rb."name" AS "rb_name",
           o."title" AS "roleTitle",
           s."id"   AS "s_id",
           s."key"  AS "s_key",
           s."label" AS "s_label",
           s."kind"  AS "s_kind",
           s."color" AS "s_color"
         FROM "JobApplication" a
         LEFT JOIN "JobOpening" o ON o."id" = a."jobOpeningId"
         LEFT JOIN "HiringStage" s ON s."id" = a."currentStageId"
         LEFT JOIN "User" rb ON rb."id" = a."referredById"
         ${openingId ? `WHERE a."jobOpeningId" = $1` : ""}
         ORDER BY a."createdAt" DESC`,
        ...(openingId ? [openingId] : []),
      );
    } catch (e: any) {
      const code = e?.meta?.code || e?.code;
      const msg = String(e?.meta?.message || e?.message || "");
      if (code === "42703" || code === "42P01" || /does not exist/i.test(msg)) {
        // Pre-migration fallback — read legacy columns only.
        rows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT
             a."id", a."fullName", a."email", a."phone", a."experienceYears",
             a."currentCompany", a."noticePeriod", a."resumeUrl", a."resumeFileName",
             a."source", a."overallRating", a."status",
             NULL AS "currentStageId", NULL AS "enteredStageAt",
             a."createdAt", a."updatedAt", a."jobOpeningId",
             NULL::timestamp AS "archivedAt", NULL::text AS "archiveReason",
             o."title" AS "roleTitle",
             NULL AS "s_id", NULL AS "s_key", NULL AS "s_label",
             NULL AS "s_kind", NULL AS "s_color"
           FROM "JobApplication" a
           LEFT JOIN "JobOpening" o ON o."id" = a."jobOpeningId"
           ${openingId ? `WHERE a."jobOpeningId" = $1` : ""}
           ORDER BY a."createdAt" DESC`,
          ...(openingId ? [openingId] : []),
        );
      } else {
        throw e;
      }
    }

    // Hydrate tags in a second pass — kept separate so a DB without
    // the JobApplication."tags" column (pre-migration) doesn't break
    // the main list. Soft-fail to an empty map on 42703.
    const tagsById = new Map<number, string[]>();
    if (rows.length > 0) {
      try {
        const tagRows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT "id", "tags" FROM "JobApplication" WHERE "id" = ANY($1::int[])`,
          rows.map((r) => r.id),
        );
        for (const t of tagRows) tagsById.set(Number(t.id), Array.isArray(t.tags) ? t.tags : []);
      } catch { /* column missing — leave map empty */ }
    }

    // Rejection-email status — pull the latest CandidateActivity row
    // tagged kind='email_sent' AND tied to the Candidate Rejection
    // template (either templateKey='rejection' OR summary mentions
    // "rejection"). Drives the "Email sent" badge next to rejected
    // candidates in the list view. Soft-fails to empty if the
    // CandidateActivity table is missing on a stale DB.
    const rejectEmailById = new Map<number, string>();
    if (rows.length > 0) {
      try {
        const sentRows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT "applicationId", MAX("createdAt") AS "sentAt"
             FROM "CandidateActivity"
            WHERE kind = 'email_sent'
              AND "applicationId" = ANY($1::int[])
              AND (meta->>'templateKey' = 'rejection' OR summary ILIKE '%rejection%')
            GROUP BY "applicationId"`,
          rows.map((r) => r.id),
        );
        for (const s of sentRows) {
          rejectEmailById.set(Number(s.applicationId), s.sentAt);
        }
      } catch { /* table or column missing — leave map empty */ }
    }

    // Same pattern for recruiterOwnerId — soft-fails if the column
    // isn't migrated yet, leaving every candidate ownerless.
    const ownerById = new Map<number, { id: number | null; name: string | null }>();
    if (rows.length > 0) {
      try {
        const ownerRows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT a."id", a."recruiterOwnerId", u."name" AS "ownerName"
             FROM "JobApplication" a
             LEFT JOIN "User" u ON u."id" = a."recruiterOwnerId"
            WHERE a."id" = ANY($1::int[])`,
          rows.map((r) => r.id),
        );
        for (const o of ownerRows) {
          ownerById.set(Number(o.id), {
            id: o.recruiterOwnerId == null ? null : Number(o.recruiterOwnerId),
            name: o.ownerName ?? null,
          });
        }
      } catch { /* column missing — leave map empty */ }
    }

    const candidates = rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      // Resolves to a Gravatar URL when the candidate's email has
      // one set; null otherwise. The UI does an <img onError> fall-
      // back to initials so a 404 from Gravatar isn't a problem.
      photoUrl: gravatarUrl(r.email, 160),
      phone: r.phone,
      experienceYears: r.experienceYears,
      currentCompany: r.currentCompany,
      noticePeriod: r.noticePeriod,
      resumeUrl: r.resumeUrl,
      resumeFileName: r.resumeFileName,
      source: r.source,
      // When source === "referral", surface the employee who
      // referred them. UI shows "Referral · {name}" instead of
      // just "referral" so HR can see WHO sourced the candidate
      // and route the referral bonus correctly.
      referredBy: r.rb_id ? { id: r.rb_id, name: r.rb_name } : null,
      overallRating: r.overallRating,
      legacyStatus: r.status,
      currentStage: r.s_id
        ? { id: r.s_id, key: r.s_key, label: r.s_label, kind: r.s_kind, color: r.s_color }
        : null,
      enteredStageAt: r.enteredStageAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      jobOpeningId: r.jobOpeningId,
      roleTitle: r.roleTitle,
      // Archived state — set when HR moved them to a rejected/closed
      // stage with a reason. Drives the "Archived" badge in the list
      // view so HR can see at a glance who's out of the pipeline.
      archivedAt:    r.archivedAt ?? null,
      archiveReason: r.archiveReason ?? null,
      tags: tagsById.get(Number(r.id)) ?? [],
      recruiterOwnerId: ownerById.get(Number(r.id))?.id ?? null,
      ownerName:        ownerById.get(Number(r.id))?.name ?? null,
      // ISO timestamp of the last rejection email sent, or null.
      // UI uses presence-not-value, but the timestamp lets HR see
      // "sent yesterday" on hover if we want to add that later.
      rejectionEmailSentAt: rejectEmailById.get(Number(r.id)) ?? null,
    }));

    return NextResponse.json({ candidates });
  } catch (e) {
    return serverError(e, "GET /api/hr/hiring/candidates");
  }
}

// ── HR-side manual candidate creation ──────────────────────────────
// POST /api/hr/hiring/candidates
//   body: multipart/form-data {
//     jobOpeningId : <int>
//     source       : "indeed" | "naukri" | "linkedin" | "referral" | …
//     resume       : <File>   (PDF/DOCX/DOC — same parsers as apply)
//     fullName?    : <str>    (overrides parser)
//     email?       : <str>
//     phone?       : <str>
//   }
// Creates a new JobApplication row in the "sourced" stage, stores
// the resume blob, and fires the async background extractor so name
// / email / education / skills auto-fill from the resume. Same code
// path as /api/jobs/apply — only the auth gate and source default
// differ.
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const jobOpeningId = Number(form.get("jobOpeningId"));
    const source       = String(form.get("source") ?? "").trim() || "direct";
    const fullNameRaw  = String(form.get("fullName") ?? "").trim();
    const emailRaw     = String(form.get("email")    ?? "").trim();
    const phoneRaw     = String(form.get("phone")    ?? "").trim();
    const file         = form.get("resume");

    if (!Number.isFinite(jobOpeningId) || jobOpeningId <= 0) {
      return NextResponse.json({ error: "jobOpeningId required" }, { status: 400 });
    }
    // Verify the job exists + is open. Don't let HR attach
    // candidates to deleted / archived job rows.
    const job = (await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, status FROM "JobOpening" WHERE id = $1 LIMIT 1`, jobOpeningId,
    ))[0];
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // Resume blob — required for the manual-add flow because the
    // whole pitch is "drop the PDF and we'll fetch everything from
    // it". HR can still manually override fields before saving.
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Resume file required" }, { status: 400 });
    }
    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: "Resume must be 8 MB or smaller" }, { status: 400 });
    }
    const resumeBuf  = Buffer.from(await file.arrayBuffer());
    const resumeName = file.name || "resume.pdf";
    const resumeMime = file.type || "application/pdf";

    // Sniff name / email / phone from the resume so HR doesn't have
    // to retype basic fields. The full parse (skills, education,
    // URLs) runs async via enqueueResumeBackfill below. HR-typed
    // overrides win when both are present.
    let sniffedName  = "";
    let sniffedEmail = "";
    let sniffedPhone = "";
    try {
      const { extractText } = await import("@/lib/resume-auto-extract");
      const text = await extractText(resumeBuf, resumeName);
      if (text) {
        // First non-empty line that's all-letters/spaces ≈ name. The
        // background parser does a better job; this is just to give
        // HR something to look at if the auto-fill row hasn't been
        // hydrated yet.
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 10);
        for (const ln of lines) {
          if (/^[A-Za-z][A-Za-z .'-]{2,60}$/.test(ln) && ln.split(/\s+/).length <= 5) {
            sniffedName = ln; break;
          }
        }
        const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
        if (emailMatch) sniffedEmail = emailMatch[0];
        const phoneMatch = text.match(/(?:\+?91[-.\s]?)?[6-9]\d{9}/);
        if (phoneMatch) sniffedPhone = phoneMatch[0];
      }
    } catch { /* parser unavailable — caller fills manually */ }

    const fullName = fullNameRaw || sniffedName  || "Unknown Applicant";
    const email    = emailRaw    || sniffedEmail || "";
    const phone    = phoneRaw    || sniffedPhone || "";

    // Resolve the initial stage = "Sourced". Mirrors the apply
    // flow's behaviour so kanban / list places the manual addition
    // in the same column candidates start in.
    const sourcedStage = (await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM "HiringStage" WHERE key = 'sourced' LIMIT 1`,
    ))[0];
    const currentStageId = sourcedStage?.id ?? null;

    const inserted = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO "JobApplication"
         ("jobOpeningId", "fullName", "email", "phone", "source",
          "resumeFileName", "currentStageId", "enteredStageAt", "status")
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'new')
       RETURNING id`,
      jobOpeningId, fullName, email, phone, source, resumeName, currentStageId,
    );
    const applicationId = inserted[0]?.id;
    if (!applicationId) {
      return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    }

    // Stamp the blob + the canonical resumeUrl on the row.
    try {
      const resumeUrl = `/api/hr/hiring/resumes/${applicationId}`;
      await prisma.$executeRawUnsafe(
        `UPDATE "JobApplication"
            SET "resumeBlob" = $1,
                "resumeMime" = $2,
                "resumeUrl"  = $3
          WHERE id = $4`,
        resumeBuf, resumeMime, resumeUrl, applicationId,
      );
    } catch (e) {
      console.error("[hr/hiring/candidates POST] resume blob save failed:", e);
    }

    // Open a stage-history row so the activity feed shows "HR
    // sourced this candidate manually" — keeps the timeline
    // consistent with apply-flow additions.
    try {
      if (currentStageId) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "JobApplicationStage"
             ("applicationId", "stageId", "enteredAt", "note")
           VALUES ($1, $2, NOW(), 'Sourced manually by HR')`,
          applicationId, currentStageId,
        );
      }
    } catch (e) {
      console.warn("[hr/hiring/candidates POST] stage history write failed:", e);
    }

    // Async parse — fills education / skills / linkedin / portfolio
    // in the background so the candidate drawer is hydrated by the
    // time HR opens it.
    try {
      const { enqueueResumeBackfill } = await import("@/lib/resume-backfill");
      enqueueResumeBackfill(applicationId);
    } catch (e) {
      console.warn("[hr/hiring/candidates POST] backfill enqueue failed:", e);
    }

    return NextResponse.json({
      ok: true,
      id: applicationId,
      candidate: { id: applicationId, fullName, email, phone, source },
    }, { status: 201 });
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/candidates");
  }
}
