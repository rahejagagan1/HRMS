// Submit or update the current user's scorecard for an interview.
//
// POST /api/hr/hiring/interviews/[id]/scorecard
//   body: { technicalScore?, communicationScore?, cultureScore?,
//           problemSolvingScore?, recommendation?, strengths?,
//           weaknesses?, notes? }
//
// Upserts one row in InterviewScorecard for (interviewId, interviewerId).
// `interviewerId` is always the current user — panelists can only fill
// THEIR OWN card, not someone else's. HR-admins are allowed to fill
// on behalf of any panelist (when they need to capture verbal feedback
// from someone who didn't open the dashboard).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

const RATING_MIN = 1;
const RATING_MAX = 5;
const ALLOWED_RECS = new Set(["strong_yes", "yes", "no", "strong_no"]);

function clampRating(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < RATING_MIN || n > RATING_MAX) return null;
  return Math.round(n);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const actorId = await resolveUserId(session);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: idParam } = await params;
    const interviewId = /^\d+$/.test(idParam) ? parseInt(idParam, 10) : NaN;
    if (!Number.isInteger(interviewId)) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));

    // Resolve target interviewerId. HR-admins may pass `interviewerId`
    // to record on behalf of someone else; everyone else can only
    // touch their own row.
    let interviewerId = actorId;
    if (isHRAdmin(session!.user) && Number.isInteger(Number(body?.interviewerId))) {
      interviewerId = Number(body.interviewerId);
    }

    // Auth check 1 — the ACTOR must be HR-admin or on the panel.
    const actorAllowed = isHRAdmin(session!.user) || await (async () => {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT 1 FROM "InterviewPanelist" WHERE "interviewId" = $1 AND "userId" = $2 LIMIT 1`,
        interviewId, actorId,
      );
      return rows.length > 0;
    })();
    if (!actorAllowed) {
      return NextResponse.json(
        { error: "Only HR or assigned panelists can submit feedback for this interview." },
        { status: 403 },
      );
    }

    // Auth check 2 — when HR records on behalf of someone, the TARGET
    // user must actually be on the panel. Without this, an HR-admin
    // could attribute fake feedback to any user in the company.
    if (interviewerId !== actorId) {
      const targetOnPanel = await prisma.$queryRawUnsafe<any[]>(
        `SELECT 1 FROM "InterviewPanelist" WHERE "interviewId" = $1 AND "userId" = $2 LIMIT 1`,
        interviewId, interviewerId,
      );
      if (targetOnPanel.length === 0) {
        return NextResponse.json(
          { error: "Target user is not on this interview's panel — add them first, then record their feedback." },
          { status: 400 },
        );
      }
    }

    const recommendation = typeof body?.recommendation === "string" && ALLOWED_RECS.has(body.recommendation)
      ? body.recommendation : null;

    const payload = {
      technicalScore:      clampRating(body?.technicalScore),
      communicationScore:  clampRating(body?.communicationScore),
      cultureScore:        clampRating(body?.cultureScore),
      problemSolvingScore: clampRating(body?.problemSolvingScore),
      strengths:      body?.strengths      ? String(body.strengths).slice(0, 4000)      : null,
      weaknesses:     body?.weaknesses     ? String(body.weaknesses).slice(0, 4000)     : null,
      notes:          body?.notes          ? String(body.notes).slice(0, 4000)          : null,
      recommendation,
    };

    await prisma.$executeRawUnsafe(
      `INSERT INTO "InterviewScorecard"
         ("interviewId", "interviewerId",
          "technicalScore", "communicationScore", "cultureScore", "problemSolvingScore",
          "strengths", "weaknesses", "notes", "recommendation",
          "submittedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), NOW())
       ON CONFLICT ("interviewId", "interviewerId") DO UPDATE
         SET "technicalScore"      = EXCLUDED."technicalScore",
             "communicationScore"  = EXCLUDED."communicationScore",
             "cultureScore"        = EXCLUDED."cultureScore",
             "problemSolvingScore" = EXCLUDED."problemSolvingScore",
             "strengths"           = EXCLUDED."strengths",
             "weaknesses"          = EXCLUDED."weaknesses",
             "notes"               = EXCLUDED."notes",
             "recommendation"      = EXCLUDED."recommendation",
             "submittedAt"         = NOW(),
             "updatedAt"           = NOW()`,
      interviewId, interviewerId,
      payload.technicalScore, payload.communicationScore, payload.cultureScore, payload.problemSolvingScore,
      payload.strengths, payload.weaknesses, payload.notes, payload.recommendation,
    );

    // Log activity on the candidate's feed so HR sees feedback land.
    const interviewRow = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "applicationId", "title", "roundNumber" FROM "Interview" WHERE "id" = $1`,
      interviewId,
    );
    if (interviewRow[0]?.applicationId) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
         VALUES ($1, 'feedback_submitted', $2, $3::jsonb, $4)`,
        interviewRow[0].applicationId,
        `Feedback submitted for ${interviewRow[0].title} (Round ${interviewRow[0].roundNumber})`,
        JSON.stringify({ interviewId, recommendation }),
        actorId,
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/interviews/[id]/scorecard");
  }
}
