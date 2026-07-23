// Employee Referral submission — POST /api/hr/jobs/refer
//
// Multipart/form-data:
//   jobOpeningId : int (required) — must be open + referral channel enabled
//   resume       : File (required) — PDF/DOCX, parsed for auto-fill
//   fullName     : str (optional override)
//   email        : str (optional override)
//   phone        : str (optional override)
//   note         : str (optional, ≤500 chars — "Why they're a fit")
//
// Auth: ANY logged-in employee. Source is hardcoded to "referral";
// referredById is set to session.user.id. Returns the created
// JobApplication row's id.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const me = await resolveUserId(session);
    if (!me) return NextResponse.json({ error: "Session user missing" }, { status: 401 });

    const form = await req.formData();
    const jobOpeningId = Number(form.get("jobOpeningId"));
    const fullNameRaw  = String(form.get("fullName") ?? "").trim();
    const emailRaw     = String(form.get("email")    ?? "").trim();
    const phoneRaw     = String(form.get("phone")    ?? "").trim();
    const noteRaw      = String(form.get("note")     ?? "").trim().slice(0, 500);
    const file         = form.get("resume");

    if (!Number.isFinite(jobOpeningId) || jobOpeningId <= 0) {
      return NextResponse.json({ error: "jobOpeningId required" }, { status: 400 });
    }
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Resume file required" }, { status: 400 });
    }
    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: "Resume must be 8 MB or smaller" }, { status: 400 });
    }

    // Verify the job is OPEN and has the referral channel enabled.
    // Reject otherwise — prevents an employee from sneaking in
    // referrals to closed / draft jobs by guessing IDs.
    const job = (await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, title, status, "isOpen", "publishChannels"
         FROM "JobOpening" WHERE id = $1`, jobOpeningId,
    ))[0];
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (job.status !== "published" || !job.isOpen) {
      return NextResponse.json({ error: "This job isn't open for referrals." }, { status: 400 });
    }
    if (!Array.isArray(job.publishChannels) || !job.publishChannels.includes("referral")) {
      return NextResponse.json({ error: "This job isn't accepting referrals." }, { status: 400 });
    }

    const resumeBuf  = Buffer.from(await file.arrayBuffer());
    const resumeName = file.name || "resume.pdf";
    const resumeMime = file.type || "application/pdf";

    // Best-effort parse for name/email/phone — same heuristic the
    // HR-side add-applicant flow uses. Failures are non-blocking
    // (employee may have typed overrides).
    let sniffedName = "", sniffedEmail = "", sniffedPhone = "";
    try {
      const { extractText } = await import("@/lib/resume-auto-extract");
      const text = await extractText(resumeBuf, resumeName);
      if (text) {
        const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
        if (emailMatch) sniffedEmail = emailMatch[0];
        const phoneMatch = text.match(/(?:\+?91[-.\s]?)?[6-9]\d{9}/);
        if (phoneMatch) sniffedPhone = phoneMatch[0];
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 12);
        for (const ln of lines) {
          if (/^[A-Za-z][A-Za-z .'-]{2,58}[A-Za-z.]$/.test(ln) &&
              ln.split(/\s+/).length >= 2 && ln.split(/\s+/).length <= 5) {
            sniffedName = ln; break;
          }
        }
      }
    } catch { /* swallow — overrides save the day */ }

    const fullName = fullNameRaw || sniffedName  || "Unknown Referral";
    const email    = emailRaw    || sniffedEmail || "";
    const phone    = phoneRaw    || sniffedPhone || "";

    // Sourced stage = initial position. Same as both apply-flow
    // and HR-side manual add.
    const sourcedStage = (await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM "HiringStage" WHERE key = 'sourced' LIMIT 1`,
    ))[0];
    const currentStageId = sourcedStage?.id ?? null;

    // Dupe guard — if THIS employee already referred someone with
    // the same email to the same job, return that row instead of
    // creating a second one. Common case is hitting Submit twice.
    if (email) {
      const dupe = (await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM "JobApplication"
          WHERE "jobOpeningId" = $1 AND lower(email) = lower($2)
            AND "referredById" = $3
          LIMIT 1`,
        jobOpeningId, email, me,
      ))[0];
      if (dupe) {
        return NextResponse.json({
          ok: true, id: dupe.id, dedupe: true,
          message: "You've already referred this person — pulling up the existing record.",
        });
      }
    }

    const noteForHrNotes = noteRaw
      ? `Referrer note: ${noteRaw}`
      : null;

    const inserted = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO "JobApplication"
         ("jobOpeningId", "fullName", "email", "phone", "source",
          "resumeFileName", "currentStageId", "enteredStageAt", "status",
          "referredById", "hrNotes")
       VALUES ($1, $2, $3, $4, 'referral', $5, $6, NOW(), 'new', $7, $8)
       RETURNING id`,
      jobOpeningId, fullName, email, phone, resumeName, currentStageId, me, noteForHrNotes,
    );
    const applicationId = inserted[0]?.id;
    if (!applicationId) {
      return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    }

    try {
      const resumeUrl = `/api/hr/hiring/resumes/${applicationId}`;
      await prisma.$executeRawUnsafe(
        `UPDATE "JobApplication"
            SET "resumeBlob" = $1, "resumeMime" = $2, "resumeUrl" = $3
          WHERE id = $4`,
        resumeBuf, resumeMime, resumeUrl, applicationId,
      );
    } catch (e) {
      console.error("[hr/jobs/refer] resume blob save failed:", e);
    }

    if (currentStageId) {
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "JobApplicationStage"
             ("applicationId", "stageId", "enteredAt", "note", "movedById")
           VALUES ($1, $2, NOW(), 'Referred by employee', $3)`,
          applicationId, currentStageId, me,
        );
      } catch (e) {
        console.warn("[hr/jobs/refer] stage history write failed:", e);
      }
    }

    // Async backfill — parses skills / education / urls so HR sees
    // a populated row when they open the candidate drawer.
    try {
      const { enqueueResumeBackfill } = await import("@/lib/resume-backfill");
      enqueueResumeBackfill(applicationId);
    } catch (e) {
      console.warn("[hr/jobs/refer] backfill enqueue failed:", e);
    }

    return NextResponse.json({
      ok: true,
      id: applicationId,
      candidate: { id: applicationId, fullName, email, phone },
    }, { status: 201 });
  } catch (e) {
    return serverError(e, "POST /api/hr/jobs/refer");
  }
}
