// Employee-facing: POST /api/hr/pulse/respond
//
// Body: {
//   surveyType: "weekly" | "monthly",   // defaults to "weekly"
//   responses: [{ questionId, score?, comment? }, ...]
// }
//
// Inserts one PulseResponse row per answered question, all keyed to
// the current cycleKey for the submitting user. cycleKey is:
//   • "<year>-W<week>"  for weekly   (e.g. "2026-W23")
//   • "<year>-M<month>" for monthly  (e.g. "2026-M06")
//
// Existence of any row for (userId, cycleKey) means "this user has
// submitted this cycle". The clock-out guard reads that for the
// weekly cycle.
//
// Validation:
//   • Every responded questionId must belong to the currently-active
//     question set for the given surveyType. For weekly, that's the
//     currently-active rotation week (1-4). For monthly, it's the
//     full monthly question set.
//   • Score required for non-text types; comment may be blank.
//   • UNIQUE(userId, weekKey, questionId) prevents double-submission.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { getActiveWeekNumber, getCycleKey } from "@/lib/hr/pulse-week";

export const dynamic = "force-dynamic";

type Incoming = { questionId: number; score?: number | null; comment?: string | null };

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const userId = await resolveUserId(session);
    if (!userId) return NextResponse.json({ error: "Session user missing" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const surveyType: "weekly" | "monthly" =
      body?.surveyType === "monthly" ? "monthly" : "weekly";
    const incoming = Array.isArray(body?.responses) ? body.responses as Incoming[] : null;
    if (!incoming || incoming.length === 0) {
      return NextResponse.json({ error: "responses[] required" }, { status: 400 });
    }

    const cycleKey = getCycleKey(surveyType);

    // Brand scope — strict separation. The active-question set the
    // submission is validated against is filtered to the CALLER'S
    // brand, so a hand-crafted POST carrying the other brand's
    // questionIds is rejected (the form itself only ever surfaces
    // the caller's brand questions, but the API must not trust that).
    // A user with no businessUnit has no valid question set to
    // answer → 400.
    const profile = await prisma.employeeProfile.findUnique({
      where: { userId },
      select: { businessUnit: true },
    });
    const callerBrand = profile?.businessUnit ?? null;
    if (callerBrand !== "NB Media" && callerBrand !== "YT Labs") {
      return NextResponse.json(
        { error: "No brand assigned to your profile — nothing to submit." },
        { status: 400 },
      );
    }

    // Active question set for the chosen surveyType, scoped to brand.
    let activeRows: any[];
    if (surveyType === "monthly") {
      activeRows = await prisma.$queryRawUnsafe(
        `SELECT id, type FROM "PulseQuestion"
          WHERE "surveyType" = 'monthly' AND "isActive" = true
            AND brand = $1`,
        callerBrand,
      );
    } else {
      const activeWeek = getActiveWeekNumber();
      activeRows = await prisma.$queryRawUnsafe(
        `SELECT id, type FROM "PulseQuestion"
          WHERE "surveyType" = 'weekly' AND week = $1 AND "isActive" = true
            AND brand = $2`,
        activeWeek, callerBrand,
      );
    }
    const activeMap = new Map<number, string>(activeRows.map((r) => [Number(r.id), r.type]));

    const rowsToInsert: Array<{ qid: number; score: number | null; comment: string | null }> = [];
    for (const r of incoming) {
      const qid = Number(r?.questionId);
      const type = activeMap.get(qid);
      if (!type) {
        return NextResponse.json({
          error: `questionId ${qid} is not part of this ${surveyType} cycle`,
        }, { status: 400 });
      }
      let score: number | null = null;
      let comment: string | null = null;
      if (type === "text") {
        const c = String(r?.comment ?? "").trim().slice(0, 500);
        comment = c || null;
      } else {
        const n = Number(r?.score);
        if (!Number.isFinite(n)) {
          return NextResponse.json({
            error: `Score required for question ${qid} (type=${type})`,
          }, { status: 400 });
        }
        if (type === "enps" && (n < 0 || n > 10)) {
          return NextResponse.json({ error: `eNPS score must be 0-10 for question ${qid}` }, { status: 400 });
        }
        if ((type === "likert" || type === "rating") && (n < 1 || n > 5)) {
          return NextResponse.json({ error: `Score must be 1-5 for question ${qid}` }, { status: 400 });
        }
        if (type === "emoji" && (n < 0 || n > 4)) {
          return NextResponse.json({ error: `Emoji index must be 0-4 for question ${qid}` }, { status: 400 });
        }
        score = Math.round(n);
        if (typeof r?.comment === "string") {
          const c = r.comment.trim().slice(0, 500);
          if (c) comment = c;
        }
      }
      rowsToInsert.push({ qid, score, comment });
    }

    if (rowsToInsert.length === 0) {
      return NextResponse.json({ error: "No valid responses" }, { status: 400 });
    }
    const valuesSql = rowsToInsert
      .map((_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`)
      .join(", ");
    const params: any[] = [];
    for (const r of rowsToInsert) {
      params.push(userId, cycleKey, r.qid, r.score, r.comment);
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PulseResponse" ("userId", "weekKey", "questionId", "score", "comment")
       VALUES ${valuesSql}
       ON CONFLICT ("userId", "weekKey", "questionId") DO NOTHING`,
      ...params,
    );

    return NextResponse.json({
      ok: true,
      surveyType,
      cycleKey,
      inserted: rowsToInsert.length,
    }, { status: 201 });
  } catch (e) {
    return serverError(e, "POST /api/hr/pulse/respond");
  }
}
