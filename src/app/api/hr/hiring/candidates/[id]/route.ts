// Single candidate detail + stage transitions.
//
// GET   → full candidate + stageHistory + interviews + activity + offers
// PATCH → { action: "moveStage", stageId }  /  { action: "rate", overallRating }
//        | { action: "addNote", note }      /  { action: "reject", reason }
//
// All actions append a CandidateActivity row so the drawer's Activity
// tab stays in sync.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { gravatarUrl } from "@/lib/gravatar";
import { resolveTemplate } from "@/lib/hr/email-merge";
import { sendEmail } from "@/lib/email/sender";
import { createGoogleMeetEvent, isGoogleMeetConfigured } from "@/lib/google/calendar";
import { runResumeBackfill, needsBackfill } from "@/lib/resume-backfill";

export const dynamic = "force-dynamic";

// Per-attachment cap. 4 MB matches Vercel's default request body limit
// and keeps a single email well under most SMTP per-message ceilings.
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

function parseEmailList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((e): e is string => typeof e === "string")
    .map((e) => e.trim())
    .filter(Boolean);
}

function parseAttachments(input: unknown): { filename: string; contentType?: string; contentBase64: string }[] {
  if (!Array.isArray(input)) return [];
  const out: { filename: string; contentType?: string; contentBase64: string }[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const filename = String((raw as any).filename ?? "").trim();
    const b64      = String((raw as any).contentBase64 ?? "");
    if (!filename || !b64) continue;
    // Approximate base64 → bytes ratio is 4 chars per 3 bytes, padding
    // accounts for ~1-2 chars. The cap is conservative enough that the
    // approximation is fine.
    const approxBytes = Math.floor(b64.length * 0.75);
    if (approxBytes > MAX_ATTACHMENT_BYTES) continue;
    out.push({
      filename,
      contentType: typeof (raw as any).contentType === "string" ? (raw as any).contentType : undefined,
      contentBase64: b64,
    });
  }
  return out;
}

/** Pre-migration soft-fail wrapper — swallows 42P01 (table missing) /
 *  42703 (column missing) and returns `fallback` so /api/hr/hiring
 *  routes don't 500 the dashboard while the migration is in flight on
 *  dev. Production rolls all this in via `prisma migrate deploy`. */
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
  // Detail payload includes stageHistory, interviews, activity feed
  // and offer letters — strictly HR-admin only. Same gate as PATCH.
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id: idParam } = await params;
    const id = /^\d+$/.test(idParam) ? parseInt(idParam, 10) : NaN;
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }

    const [appRows, stageHistory, interviews, activity, offers] = await Promise.all([
      // Application lookup: full query with stage join first, then a
      // legacy-shaped fallback if currentStageId / HiringStage are
      // missing.
      safe(
        () => prisma.$queryRawUnsafe<any[]>(
          `SELECT a.*, o."title" AS "roleTitle",
                  o."salaryRange" AS "jobSalaryRange",
                  o."salaryUnit"  AS "jobSalaryUnit",
                  o."employmentType" AS "jobEmploymentType",
                  s."id" AS "s_id", s."key" AS "s_key", s."label" AS "s_label",
                  s."kind" AS "s_kind", s."color" AS "s_color"
             FROM "JobApplication" a
             LEFT JOIN "JobOpening" o ON o."id" = a."jobOpeningId"
             LEFT JOIN "HiringStage" s ON s."id" = a."currentStageId"
            WHERE a."id" = $1`,
          id,
        ),
        // No fallback shape — caught below and retried with legacy SQL.
        null as any,
      ).then(async (rows) => {
        if (rows) return rows;
        return safe(
          () => prisma.$queryRawUnsafe<any[]>(
            `SELECT a.*, o."title" AS "roleTitle",
                    NULL AS "jobSalaryRange", NULL AS "jobSalaryUnit", NULL AS "jobEmploymentType",
                    NULL AS "s_id", NULL AS "s_key", NULL AS "s_label",
                    NULL AS "s_kind", NULL AS "s_color"
               FROM "JobApplication" a
               LEFT JOIN "JobOpening" o ON o."id" = a."jobOpeningId"
              WHERE a."id" = $1`,
            id,
          ),
          [],
        );
      }),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT h."id", h."stageId", h."enteredAt", h."exitedAt", h."note",
                s."key" AS "stageKey", s."label" AS "stageLabel", s."color" AS "stageColor",
                u."id" AS "movedById", u."name" AS "movedByName"
           FROM "JobApplicationStage" h
           JOIN "HiringStage" s ON s."id" = h."stageId"
           LEFT JOIN "User" u ON u."id" = h."movedById"
          WHERE h."applicationId" = $1
          ORDER BY h."enteredAt" DESC`,
        id,
      ), []),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `WITH panel AS (
           SELECT ip."interviewId",
                  json_agg(
                    json_build_object('id', u."id", 'name', u."name", 'pic', u."profilePictureUrl")
                    ORDER BY u."name"
                  ) AS "members"
             FROM "InterviewPanelist" ip
             JOIN "User" u ON u."id" = ip."userId"
            GROUP BY ip."interviewId"
         ),
         cards AS (
           SELECT s."interviewId",
                  json_agg(
                    json_build_object(
                      'id',                 s."id",
                      'interviewerId',      s."interviewerId",
                      'interviewerName',    u."name",
                      'interviewerPic',     u."profilePictureUrl",
                      'technicalScore',     s."technicalScore",
                      'communicationScore', s."communicationScore",
                      'cultureScore',       s."cultureScore",
                      'problemSolvingScore',s."problemSolvingScore",
                      'recommendation',     s."recommendation",
                      'strengths',          s."strengths",
                      'weaknesses',         s."weaknesses",
                      'notes',              s."notes",
                      'submittedAt',        s."submittedAt"
                    )
                    ORDER BY s."submittedAt" DESC NULLS LAST, s."id"
                  ) AS "scorecards"
             FROM "InterviewScorecard" s
             JOIN "User" u ON u."id" = s."interviewerId"
            GROUP BY s."interviewId"
         )
         SELECT i."id", i."roundNumber", i."title", i."scheduledAt", i."durationMinutes",
                i."location", i."status", i."outcome", i."notes",
                COALESCE(panel."members",    '[]'::json) AS "panel",
                COALESCE(cards."scorecards", '[]'::json) AS "scorecards"
           FROM "Interview" i
           LEFT JOIN panel ON panel."interviewId" = i."id"
           LEFT JOIN cards ON cards."interviewId" = i."id"
          WHERE i."applicationId" = $1
          ORDER BY i."roundNumber" ASC, i."scheduledAt" ASC`,
        id,
      ), []),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT c."id", c."kind", c."summary", c."meta", c."createdAt",
                u."id" AS "actorId", u."name" AS "actorName", u."profilePictureUrl" AS "actorPic"
           FROM "CandidateActivity" c
           LEFT JOIN "User" u ON u."id" = c."actorId"
          WHERE c."applicationId" = $1
          ORDER BY c."createdAt" DESC
          LIMIT 200`,
        id,
      ), []),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT id, status, "ctcAnnual", "joiningDate", "expiresAt",
                "attachmentFileName", "acceptedAt", "declinedAt", "createdAt"
           FROM "OfferLetter"
          WHERE "applicationId" = $1
          ORDER BY "createdAt" DESC`,
        id,
      ), []),
    ]);

    const row = appRows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // The drawer renders from resumeUrl, never the raw bytes — so drop the
    // resumeBlob (up to ~8MB) from the response. Shipping it ballooned the
    // JSON on every drawer open. Capture a flag first for the backfill gate.
    const hasResumeBlob = row.resumeBlob != null;
    delete row.resumeBlob;

    // ── Auto-backfill from the resume (FIRE-AND-FORGET) ────────────
    // The apply route fires an eager background extraction right
    // after submission, so most rows will already be populated by
    // the time HR opens the drawer. This block stays as a fallback
    // for rows where the eager job failed / the candidate was
    // imported through a path that bypasses /api/jobs/apply / HR
    // has manually nulled a field.
    //
    // CRITICAL: we DO NOT await runResumeBackfill any more. The
    // backfill internally runs the resume parser (including OCR
    // fallback for scanned PDFs) which can take 30-120 seconds on
    // a difficult document — long enough that the API request
    // times out and the candidate drawer hangs on a spinner
    // forever. User reported "candidate #21 stuck loading" — this
    // was the cause.
    //
    // Returning fresh data IS still possible: kick off the
    // backfill, fire a SWR mutate from the client when the user
    // refetches, and the next drawer open picks up the parsed
    // values. Trade-off is acceptable — most candidates already
    // have complete data; this only affects a handful of rows.
    if (hasResumeBlob && needsBackfill(row)) {
      runResumeBackfill(id).catch(() => { /* logged inside helper */ });
    }

    const candidate = {
      ...row,
      currentStage: row.s_id
        ? { id: row.s_id, key: row.s_key, label: row.s_label, kind: row.s_kind, color: row.s_color }
        : null,
      s_id: undefined, s_key: undefined, s_label: undefined, s_kind: undefined, s_color: undefined,
      // Gravatar URL for the avatar — null when the email has no
      // Gravatar set or is missing entirely. UI does an onError
      // fallback to the initials avatar.
      photoUrl: gravatarUrl(row.email, 240),
    };

    return NextResponse.json({ candidate, stageHistory, interviews, activity, offers });
  } catch (e) {
    return serverError(e, "GET /api/hr/hiring/candidates/[id]");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  // HR-admin gate. Every mutating action on a candidate row (stage
  // moves, ratings, notes) can also fire auto-send emails to the
  // candidate — restricting to HR-admin tier prevents a regular
  // logged-in employee from triggering hiring workflows.
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id: idParam } = await params;
    const id = /^\d+$/.test(idParam) ? parseInt(idParam, 10) : NaN;
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;
    const actorId = await resolveUserId(session);

    if (action === "moveStage") {
      const stageId = Number(body?.stageId);
      if (!Number.isInteger(stageId)) return NextResponse.json({ error: "Bad stageId" }, { status: 400 });

      // Look up the target stage so we can mirror its kind back into
      // the legacy `status` column (keeps the old list view working).
      // Pre-migration safety: if HiringStage doesn't exist yet,
      // return a clear 503 instead of a confusing 500 — HR knows the
      // hiring pipeline isn't ready on this DB.
      const stageRows = await safe(
        () => prisma.$queryRawUnsafe<any[]>(
          `SELECT "key", "kind" FROM "HiringStage" WHERE "id" = $1`,
          stageId,
        ),
        null as any,
      );
      if (stageRows === null) {
        return NextResponse.json(
          { error: "Hiring pipeline tables aren't migrated on this database yet. Run `prisma migrate deploy` first." },
          { status: 503 },
        );
      }
      const stage = stageRows[0];
      if (!stage) return NextResponse.json({ error: "Stage not found" }, { status: 404 });

      const prev = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "currentStageId" FROM "JobApplication" WHERE "id" = $1`,
        id,
      );
      const prevStageId = prev[0]?.currentStageId ?? null;

      await prisma.$transaction(async (tx) => {
        // Close out the previous stage row in the audit log.
        if (prevStageId) {
          await tx.$executeRawUnsafe(
            `UPDATE "JobApplicationStage" SET "exitedAt" = NOW()
              WHERE "applicationId" = $1 AND "stageId" = $2 AND "exitedAt" IS NULL`,
            id, prevStageId,
          );
        }
        // Insert the new stage entry.
        await tx.$executeRawUnsafe(
          `INSERT INTO "JobApplicationStage" ("applicationId", "stageId", "movedById", "note")
           VALUES ($1, $2, $3, $4)`,
          id, stageId, actorId, body?.note ?? null,
        );
        // Update the application row's pointer.
        await tx.$executeRawUnsafe(
          `UPDATE "JobApplication" SET
             "currentStageId" = $1,
             "enteredStageAt" = NOW(),
             "status"         = $2,
             "updatedAt"      = NOW()
           WHERE "id" = $3`,
          stageId,
          stage.kind === "hired" ? "hired" : stage.kind === "rejected" ? "rejected" : "interviewing",
          id,
        );
        // Activity feed.
        await tx.$executeRawUnsafe(
          `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
           VALUES ($1, 'stage_change', $2, $3::jsonb, $4)`,
          id,
          `Moved to ${stage.key}`,
          JSON.stringify({ stageId, stageKey: stage.key }),
          actorId,
        );

        // ── Auto-archive when positions are filled ─────────────────
        // If the candidate just entered a 'hired' stage AND the job
        // has archiveAfterFilled=true AND we've now hit/exceeded the
        // vacancies count, flip the job to status='closed' so it
        // disappears from the public careers page.
        if (stage.kind === "hired") {
          try {
            const cfgRows = await tx.$queryRawUnsafe<any[]>(
              `SELECT j."id", j."vacancies", j."archiveAfterFilled", j."status"
                 FROM "JobOpening" j
                 JOIN "JobApplication" a ON a."jobOpeningId" = j."id"
                WHERE a."id" = $1`,
              id,
            );
            const cfg = cfgRows[0];
            if (cfg && cfg.archiveAfterFilled === true && cfg.status !== "closed") {
              const hiredRows = await tx.$queryRawUnsafe<any[]>(
                `SELECT COUNT(*)::int AS n
                   FROM "JobApplication" a
                   JOIN "HiringStage"   s ON s."id" = a."currentStageId"
                  WHERE a."jobOpeningId" = $1 AND s."kind" = 'hired'`,
                cfg.id,
              );
              const hiredCount = Number(hiredRows[0]?.n ?? 0);
              const target     = Number(cfg.vacancies ?? 1);
              if (hiredCount >= target) {
                await tx.$executeRawUnsafe(
                  `UPDATE "JobOpening"
                      SET "status" = 'closed', "isOpen" = false,
                          "closesAt" = COALESCE("closesAt", NOW()),
                          "updatedAt" = NOW()
                    WHERE "id" = $1`,
                  cfg.id,
                );
              }
            }
          } catch { /* soft-fail — archiveAfterFilled column may not exist on legacy DBs */ }
        }
      });

      // ── Auto-send any EmailTemplate registered for this stage with
      //    autoSend = true. Fire-and-forget — a template failure
      //    (missing SMTP creds, no recipient resolved, etc.) must not
      //    roll back the stage move. We log the failure to the
      //    activity feed and move on.
      (async () => {
        try {
          const tpls = await prisma.$queryRawUnsafe<any[]>(
            `SELECT "id" FROM "EmailTemplate"
              WHERE "isActive" = true AND "autoSend" = true
                AND "trigger" = 'stage_change' AND "stageId" = $1
              LIMIT 5`,
            stageId,
          );
          for (const t of tpls) {
            try {
              const resolved = await resolveTemplate({
                templateId: Number(t.id),
                applicationId: id,
              });
              if (!resolved.to) continue;
              await sendEmail({
                to: resolved.to,
                content: {
                  subject: resolved.subject,
                  html: resolved.bodyHtml,
                  text: resolved.bodyHtml.replace(/<[^>]+>/g, ""),
                } as any,
              });
              await prisma.$executeRawUnsafe(
                `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
                 VALUES ($1, 'email_sent', $2, $3::jsonb, $4)`,
                id,
                `Auto-sent: ${resolved.subject}`,
                JSON.stringify({ templateKey: resolved.templateKey, to: resolved.to, auto: true }),
                actorId,
              );
            } catch (e: any) {
              console.error("[hiring auto-send] template", t.id, "failed:", e?.message || e);
            }
          }
        } catch (e: any) {
          console.error("[hiring auto-send] lookup failed:", e?.message || e);
        }
      })();

      return NextResponse.json({ ok: true });
    }

    if (action === "rate") {
      const rating = Number(body?.overallRating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return NextResponse.json({ error: "Rating must be 1-5" }, { status: 400 });
      }
      await prisma.$executeRawUnsafe(
        `UPDATE "JobApplication" SET "overallRating" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
        rating, id,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
         VALUES ($1, 'note', $2, $3::jsonb, $4)`,
        id, `Rated ${rating}/5`, JSON.stringify({ rating }), actorId,
      );
      return NextResponse.json({ ok: true });
    }

    if (action === "addNote") {
      const note = String(body?.note ?? "").trim();
      if (!note) return NextResponse.json({ error: "Note required" }, { status: 400 });
      await prisma.$executeRawUnsafe(
        `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
         VALUES ($1, 'note', $2, $3::jsonb, $4)`,
        id, note.slice(0, 200), JSON.stringify({ note }), actorId,
      );
      return NextResponse.json({ ok: true });
    }

    if (action === "updateProfile") {
      // HR-side inline edit of the candidate's basic identity fields:
      // fullName, email, phone. Used when the parsed resume mislabels
      // the candidate (e.g. their cover sheet title gets picked up as
      // the name). Only writes the fields explicitly present in the
      // body so an HR who sends just { fullName } doesn't blank email.
      const set: string[] = [];
      const args: any[] = [];
      if (typeof body?.fullName === "string") {
        const v = body.fullName.trim();
        if (!v) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
        if (v.length > 200) return NextResponse.json({ error: "Name too long" }, { status: 400 });
        args.push(v); set.push(`"fullName" = $${args.length}`);
      }
      if (typeof body?.email === "string") {
        const v = body.email.trim();
        if (!v || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
          return NextResponse.json({ error: "Valid email required" }, { status: 400 });
        }
        args.push(v); set.push(`"email" = $${args.length}`);
      }
      if ("phone" in body) {
        const v = body.phone ? String(body.phone).trim() : null;
        args.push(v); set.push(`"phone" = $${args.length}`);
      }
      if (set.length === 0) {
        return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
      }
      args.push(id);
      await prisma.$executeRawUnsafe(
        `UPDATE "JobApplication" SET ${set.join(", ")}, "updatedAt" = NOW()
          WHERE "id" = $${args.length}`,
        ...args,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
         VALUES ($1, 'profile_edit', $2, $3::jsonb, $4)`,
        id, "Profile edited",
        JSON.stringify({
          fields: set.map((s) => s.split('"')[1]),  // ["fullName", "email", ...]
        }),
        actorId,
      );
      return NextResponse.json({ ok: true });
    }

    if (action === "updateSkills") {
      // HR-side inline edit of the candidate's skills tags. Use
      // case: resume parser couldn't extract skills (multi-column
      // sidebar layout, sectioned headings the regex doesn't
      // match, etc.) and HR is filling them in by hand.
      // Body shape: { action:"updateSkills", skills:["Foo","Bar"] }
      // — stored as comma-separated string in the existing
      // JobApplication.skills text column (matches the chip-
      // input format the apply form writes).
      const raw = Array.isArray(body?.skills) ? body.skills : null;
      if (!raw) {
        return NextResponse.json({ error: "skills array required" }, { status: 400 });
      }
      const cleaned = raw
        .map((s: any) => (typeof s === "string" ? s.trim().slice(0, 80) : ""))
        .filter((s: string) => s.length > 0);
      if (cleaned.length > 100) {
        return NextResponse.json({ error: "Too many skills (max 100)" }, { status: 400 });
      }
      // Dedup case-insensitively but preserve the HR-entered casing.
      const seen = new Set<string>();
      const dedup: string[] = [];
      for (const s of cleaned) {
        const key = s.toLowerCase();
        if (!seen.has(key)) { seen.add(key); dedup.push(s); }
      }
      const joined = dedup.join(", ");
      await prisma.$executeRawUnsafe(
        `UPDATE "JobApplication" SET "skills" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
        joined || null, id,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
         VALUES ($1, 'profile_edit', $2, $3::jsonb, $4)`,
        id,
        `Skills updated — ${dedup.length} skill${dedup.length === 1 ? "" : "s"}`,
        JSON.stringify({ field: "skills", count: dedup.length }),
        actorId,
      );
      return NextResponse.json({ ok: true, count: dedup.length });
    }

    if (action === "updateEducation") {
      // HR-side inline edit of the candidate's education history.
      // Use case: the resume auto-parser picks up junk (a bullet
      // from a different section gets tagged as a degree) or misses
      // entries entirely, and HR needs to clean it up before
      // shortlisting. Body shape:
      //   { action: "updateEducation",
      //     entries: [{ course, branch, startOfCourse, endOfCourse,
      //                  university, location }, …] }
      const raw = Array.isArray(body?.entries) ? body.entries : null;
      if (!raw) {
        return NextResponse.json({ error: "entries array required" }, { status: 400 });
      }
      // Whitelist keys + cap lengths so HR can't paste a 1MB blob
      // into "course" and balloon the row.
      const TRUNC = (s: any, n: number) =>
        typeof s === "string" ? s.trim().slice(0, n) : "";
      const cleaned = raw
        .map((e: any) => ({
          course:        TRUNC(e?.course,        120),
          branch:        TRUNC(e?.branch,        120),
          startOfCourse: TRUNC(e?.startOfCourse,  20),
          endOfCourse:   TRUNC(e?.endOfCourse,    20),
          university:    TRUNC(e?.university,    200),
          location:      TRUNC(e?.location,      120),
        }))
        // Drop entries where every field is empty — those are
        // half-filled rows the user added then abandoned.
        .filter((e: any) => Object.values(e).some((v) => typeof v === "string" && v.length > 0));
      if (cleaned.length > 20) {
        return NextResponse.json({ error: "Too many education entries (max 20)" }, { status: 400 });
      }
      // Column is text holding JSON — match the storage shape
      // CandidateDrawer's parseJsonList<T>() reads.
      await prisma.$executeRawUnsafe(
        `UPDATE "JobApplication"
            SET "educationDetails" = $1,
                "updatedAt"        = NOW()
          WHERE "id" = $2`,
        JSON.stringify(cleaned), id,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
         VALUES ($1, 'profile_edit', $2, $3::jsonb, $4)`,
        id,
        `Education updated — ${cleaned.length} entr${cleaned.length === 1 ? "y" : "ies"}`,
        JSON.stringify({ field: "educationDetails", count: cleaned.length }),
        actorId,
      );
      return NextResponse.json({ ok: true, count: cleaned.length });
    }

    if (action === "setOwner") {
      // Set or clear the recruiter owner for this candidate. ownerId
      // can be null to unassign.
      const rawId = body?.ownerId;
      const ownerId = rawId == null ? null : Number(rawId);
      if (ownerId !== null && (!Number.isInteger(ownerId) || ownerId <= 0)) {
        return NextResponse.json({ error: "Bad ownerId" }, { status: 400 });
      }
      try {
        const updated = await prisma.$queryRawUnsafe<any[]>(
          `UPDATE "JobApplication" a
              SET "recruiterOwnerId" = $1, "updatedAt" = NOW()
            WHERE a."id" = $2
            RETURNING a."recruiterOwnerId",
              (SELECT u."name" FROM "User" u WHERE u."id" = a."recruiterOwnerId") AS "ownerName"`,
          ownerId, id,
        );
        await prisma.$executeRawUnsafe(
          `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
           VALUES ($1, 'owner_change', $2, $3::jsonb, $4)`,
          id,
          ownerId == null ? "Owner cleared" : `Owner set to ${updated[0]?.ownerName ?? "user #" + ownerId}`,
          JSON.stringify({ ownerId, ownerName: updated[0]?.ownerName ?? null }),
          actorId,
        );
        return NextResponse.json({
          ok: true,
          recruiterOwnerId: updated[0]?.recruiterOwnerId ?? null,
          ownerName: updated[0]?.ownerName ?? null,
        });
      } catch (e: any) {
        const msg = String(e?.meta?.message || e?.message || "");
        if (/does not exist|42703/i.test(msg)) {
          return NextResponse.json(
            { error: "Owner column isn't migrated yet — run prisma migrations." },
            { status: 503 },
          );
        }
        throw e;
      }
    }

    if (action === "sendEmail" || action === "sendAssessment") {
      // Custom email composed by HR. kind=assessment is the same
      // pipeline but logs a different activity verb + includes the
      // assessment link in the body.
      const to = String(body?.to ?? "").trim();
      const subject = String(body?.subject ?? "").trim();
      const html = String(body?.body ?? "").trim();
      const cc          = parseEmailList(body?.cc);
      const bcc         = parseEmailList(body?.bcc);
      const attachments = parseAttachments(body?.attachments);
      if (!to)      return NextResponse.json({ error: "Recipient required" }, { status: 400 });
      if (!subject) return NextResponse.json({ error: "Subject required" }, { status: 400 });
      if (!html)    return NextResponse.json({ error: "Body required" },    { status: 400 });
      try {
        await sendEmail({
          to,
          cc, bcc,
          content: {
            subject,
            html,
            text: html.replace(/<[^>]+>/g, ""),
          } as any,
          attachments,
        });
        const kind = action === "sendAssessment" ? "assessment_sent" : "email_sent";
        await prisma.$executeRawUnsafe(
          `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
           VALUES ($1, $2, $3, $4::jsonb, $5)`,
          id, kind,
          `${action === "sendAssessment" ? "Assessment sent" : "Email sent"}: ${subject.slice(0, 100)}`,
          JSON.stringify({ to, subject }),
          actorId,
        );
        return NextResponse.json({ ok: true });
      } catch (e: any) {
        return NextResponse.json(
          { error: e?.message || "Couldn't send email" },
          { status: 500 },
        );
      }
    }

    if (action === "scheduleInterview") {
      // Minimal interview create — just enough for HR to book a
      // round. Full panel + scorecard wiring is a follow-up.
      const title = String(body?.title ?? "").trim();
      const scheduledAt = body?.scheduledAt ? new Date(body.scheduledAt) : null;
      const durationMinutes = Number.isInteger(body?.durationMinutes) ? Number(body.durationMinutes) : 45;
      let   location = body?.location ? String(body.location).trim() : null;
      const note     = body?.note     ? String(body.note).trim()     : null;
      // "online" | "face_to_face" | "self_schedule" — sent by the modal;
      // only "online" triggers Google Meet auto-creation.
      const kind     = typeof body?.kind === "string" ? body.kind : null;
      if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });
      if (!scheduledAt || isNaN(scheduledAt.getTime())) {
        return NextResponse.json({ error: "Valid scheduled date/time required" }, { status: 400 });
      }
      // Next round number = max existing + 1.
      const maxRound = await prisma.$queryRawUnsafe<any[]>(
        `SELECT COALESCE(MAX("roundNumber"), 0) AS m FROM "Interview" WHERE "applicationId" = $1`,
        id,
      );
      const roundNumber = Number(maxRound[0]?.m ?? 0) + 1;
      const inserted = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO "Interview"
          ("applicationId", "roundNumber", "title", "scheduledAt", "durationMinutes", "location", "notes", "status")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
         RETURNING id, "scheduledAt"`,
        id, roundNumber, title, scheduledAt, durationMinutes, location, note,
      );
      const interviewId = inserted[0]?.id;

      // Auto-create a Google Meet link when this is an online interview
      // and HR didn't paste their own URL. Soft-fails so a Meet outage
      // never blocks scheduling — HR can paste a link manually later.
      let meetingUrl: string | null = null;
      const isPlaceholder = !location || /^\{\{MeetingLink\}\}/.test(location);
      if (kind === "online" && isPlaceholder && isGoogleMeetConfigured()) {
        try {
          const cand = await prisma.$queryRawUnsafe<any[]>(
            `SELECT "email", "fullName" FROM "JobApplication" WHERE "id" = $1`, id,
          );
          const candEmail = cand[0]?.email ?? null;
          const candName  = cand[0]?.fullName ?? null;
          const attendees = candEmail
            ? [{ email: candEmail, displayName: candName ?? undefined }]
            : [];
          const startISO = scheduledAt.toISOString();
          const endISO   = new Date(scheduledAt.getTime() + durationMinutes * 60_000).toISOString();
          const meet = await createGoogleMeetEvent({
            summary:     title,
            description: note ?? "",
            startISO, endISO,
            attendees,
          });
          if (meet.meetingUrl) {
            meetingUrl = meet.meetingUrl;
            // Store googleEventId too — the Reschedule + Cancel
            // endpoints use it to patch/delete the calendar event so
            // the candidate's existing invite updates in place
            // instead of going stale.
            await prisma.$executeRawUnsafe(
              `UPDATE "Interview" SET "location" = $1, "googleEventId" = $2 WHERE "id" = $3`,
              meetingUrl, meet.eventId, interviewId,
            );
            location = meetingUrl;
          }
        } catch (e: any) {
          console.error("[scheduleInterview] Google Meet creation failed:", e?.message ?? e);
          // Interview row stays — HR can paste a link manually.
        }
      }

      await prisma.$executeRawUnsafe(
        `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
         VALUES ($1, 'interview_scheduled', $2, $3::jsonb, $4)`,
        id,
        `${title} scheduled for ${scheduledAt.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`,
        JSON.stringify({ interviewId, scheduledAt: scheduledAt.toISOString(), title, location, meetingUrl }),
        actorId,
      );
      return NextResponse.json({
        ok: true,
        interview: { ...inserted[0], meetingUrl, location },
      });
    }

    if (action === "archive") {
      // Move candidate to the rejected stage AND capture the reason +
      // optional note + send a closing email. The reason is one of a
      // canonical list (validated client-side; we store whatever HR
      // picked so reports can group by it). If HR included subject +
      // body we also send the email and log it in the activity feed.
      const reason  = String(body?.reason ?? "").trim();
      const note    = body?.note    ? String(body.note).trim()    : null;
      const subject = body?.subject ? String(body.subject).trim() : null;
      const html    = body?.body    ? String(body.body).trim()    : null;
      const cc          = parseEmailList(body?.cc);
      const bcc         = parseEmailList(body?.bcc);
      const attachments = parseAttachments(body?.attachments);
      if (!reason) return NextResponse.json({ error: "Archive reason required" }, { status: 400 });

      // Find the rejected stage so we can move them.
      const rejRows = await safe(
        () => prisma.$queryRawUnsafe<any[]>(
          `SELECT "id" FROM "HiringStage" WHERE "kind" = 'rejected' LIMIT 1`,
        ),
        [] as any[],
      );
      const rejStageId = rejRows[0]?.id ? Number(rejRows[0].id) : null;

      const recipientRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "email", "fullName" FROM "JobApplication" WHERE "id" = $1`, id,
      );
      const recipient = recipientRows[0];

      try {
        await prisma.$transaction(async (tx) => {
          // Persist reason + denormalized archivedAt — soft-fail when
          // the columns aren't migrated yet so dev DBs keep working.
          try {
            await tx.$executeRawUnsafe(
              `UPDATE "JobApplication"
                  SET "archiveReason" = $1,
                      "archiveNote"   = $2,
                      "archivedAt"    = NOW(),
                      "status"        = 'rejected',
                      "updatedAt"     = NOW()
                WHERE "id" = $3`,
              reason, note, id,
            );
          } catch {
            await tx.$executeRawUnsafe(
              `UPDATE "JobApplication" SET "status" = 'rejected', "updatedAt" = NOW() WHERE "id" = $1`,
              id,
            );
          }
          // Move to rejected stage if one exists.
          if (rejStageId) {
            const prev = await tx.$queryRawUnsafe<any[]>(
              `SELECT "currentStageId" FROM "JobApplication" WHERE "id" = $1`, id,
            );
            const prevStageId = prev[0]?.currentStageId ?? null;
            if (prevStageId) {
              await tx.$executeRawUnsafe(
                `UPDATE "JobApplicationStage" SET "exitedAt" = NOW()
                  WHERE "applicationId" = $1 AND "stageId" = $2 AND "exitedAt" IS NULL`,
                id, prevStageId,
              );
            }
            await tx.$executeRawUnsafe(
              `INSERT INTO "JobApplicationStage" ("applicationId", "stageId", "movedById", "note")
               VALUES ($1, $2, $3, $4)`,
              id, rejStageId, actorId, note ? `Archived: ${reason} — ${note}` : `Archived: ${reason}`,
            );
            await tx.$executeRawUnsafe(
              `UPDATE "JobApplication" SET "currentStageId" = $1, "enteredStageAt" = NOW() WHERE "id" = $2`,
              rejStageId, id,
            );
          }
          await tx.$executeRawUnsafe(
            `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
             VALUES ($1, 'archived', $2, $3::jsonb, $4)`,
            id,
            `Archived — ${reason}`,
            JSON.stringify({ reason, note, subject, hasEmail: !!(subject && html) }),
            actorId,
          );
        });

        if (subject && html && recipient?.email) {
          try {
            await sendEmail({
              to: recipient.email,
              cc, bcc,
              content: {
                subject,
                html,
                text: html.replace(/<[^>]+>/g, ""),
              } as any,
              attachments,
            } as any);
          } catch (e: any) {
            console.error("[archive] email send failed:", e?.message || e);
          }
        }
        return NextResponse.json({ ok: true });
      } catch (e) {
        return serverError(e, "PATCH /api/hr/hiring/candidates/[id] (archive)");
      }
    }

    if (action === "rollbackArchive") {
      // Undo an archive — sets archive metadata back to null and (if
      // a `targetStageId` is provided) restores the previous stage.
      const targetStageId = Number.isInteger(Number(body?.targetStageId))
        ? Number(body.targetStageId) : null;
      try {
        await prisma.$transaction(async (tx) => {
          try {
            await tx.$executeRawUnsafe(
              `UPDATE "JobApplication"
                  SET "archiveReason" = NULL,
                      "archiveNote"   = NULL,
                      "archivedAt"    = NULL,
                      "status"        = 'interviewing',
                      "updatedAt"     = NOW()
                WHERE "id" = $1`, id,
            );
          } catch {
            await tx.$executeRawUnsafe(
              `UPDATE "JobApplication" SET "status" = 'interviewing', "updatedAt" = NOW() WHERE "id" = $1`,
              id,
            );
          }
          if (targetStageId) {
            await tx.$executeRawUnsafe(
              `UPDATE "JobApplication" SET "currentStageId" = $1, "enteredStageAt" = NOW() WHERE "id" = $2`,
              targetStageId, id,
            );
          }
          await tx.$executeRawUnsafe(
            `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
             VALUES ($1, 'unarchived', 'Restored from archive', $2::jsonb, $3)`,
            id, JSON.stringify({ targetStageId }), actorId,
          );
        });
        return NextResponse.json({ ok: true });
      } catch (e) {
        return serverError(e, "PATCH /api/hr/hiring/candidates/[id] (rollback)");
      }
    }

    if (action === "addTag" || action === "removeTag") {
      const tag = String(body?.tag ?? "").trim().slice(0, 40);
      if (!tag) return NextResponse.json({ error: "Tag required" }, { status: 400 });
      // array_append / array_remove handle dedup + safe-on-empty for us.
      const op = action === "addTag"
        ? `array_append(COALESCE("tags", ARRAY[]::TEXT[]), $1)`
        : `array_remove(COALESCE("tags", ARRAY[]::TEXT[]), $1)`;
      try {
        // For addTag, skip the append when the tag is already present
        // so the array stays a dedup set without needing CONFLICT.
        const sql = action === "addTag"
          ? `UPDATE "JobApplication"
              SET "tags" = CASE WHEN $1 = ANY(COALESCE("tags", ARRAY[]::TEXT[]))
                                 THEN "tags"
                                 ELSE ${op}
                            END,
                  "updatedAt" = NOW()
              WHERE "id" = $2
              RETURNING "tags"`
          : `UPDATE "JobApplication"
              SET "tags" = ${op}, "updatedAt" = NOW()
              WHERE "id" = $2
              RETURNING "tags"`;
        const updated = await prisma.$queryRawUnsafe<any[]>(sql, tag, id);
        const tags = Array.isArray(updated[0]?.tags) ? updated[0].tags : [];
        return NextResponse.json({ ok: true, tags });
      } catch (e: any) {
        const msg = String(e?.meta?.message || e?.message || "");
        if (/does not exist|42703/i.test(msg)) {
          return NextResponse.json(
            { error: "Tags column isn't migrated yet. Run prisma migrations to add it." },
            { status: 503 },
          );
        }
        throw e;
      }
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return serverError(e, "PATCH /api/hr/hiring/candidates/[id]");
  }
}
