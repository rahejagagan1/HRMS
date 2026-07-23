// HR-admin: GET /api/hr/pulse/responses?surveyType=…&cycleKey=…&brand=…
//
// ANONYMITY ENFORCED AT THIS LAYER.
//
// Returns aggregated stats for a cycle — counts, averages,
// distributions, AND anonymous text comments. We deliberately never
// return userId or any per-respondent breakdown, even to HR-admin.
// The DB stores userId for the clock-out gate + uniqueness check;
// this endpoint is the only path HR has to view responses, and it
// strips identity before it leaves the server.
//
// surveyType defaults to "weekly".  cycleKey defaults to current
// week / month. brand REQUIRED — strict brand separation matches
// the question bank's policy. Defaults to "NB Media".
//
// Response shape:
// {
//   cycleKey, surveyType, brand,
//   participation: { responded, totalActiveUsers, percent },
//   questions: [{
//     id, order, text, type,
//     stats: { count, average, distribution, enpsScore? },
//     comments: string[]
//   }]
// }

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { getCycleKey, getActiveWeekNumber } from "@/lib/hr/pulse-week";

export const dynamic = "force-dynamic";

function normalizeBrand(raw: string | null | undefined): "NB Media" | "YT Labs" {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "yt_labs" || s === "ytlabs" || s === "yt labs") return "YT Labs";
  return "NB Media"; // default
}

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const surveyType: "weekly" | "monthly" =
      url.searchParams.get("surveyType") === "monthly" ? "monthly" : "weekly";
    const cycleKey = url.searchParams.get("cycleKey") || getCycleKey(surveyType);
    const brand    = normalizeBrand(url.searchParams.get("brand"));

    // ── Question set for this cycle + brand ─────────────────────
    // Strict brand separation: each brand has its own bank.
    let questions: any[];
    if (surveyType === "monthly") {
      questions = await prisma.$queryRawUnsafe(
        `SELECT id, "order", text, type, emojis, brand
           FROM "PulseQuestion"
          WHERE "surveyType" = 'monthly' AND "isActive" = true
            AND brand = $1
          ORDER BY "order" ASC`,
        brand,
      );
    } else {
      // Weekly: find what was actually answered (handles historical
      // cycles) but constrained to this brand. Fall back to the
      // current rotation's questions if the cycle has zero
      // responses so HR still sees the form shape.
      const respondedIds = await prisma.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT r."questionId"
           FROM "PulseResponse" r
           JOIN "PulseQuestion" q ON q.id = r."questionId"
          WHERE r."weekKey" = $1 AND q.brand = $2`,
        cycleKey, brand,
      );
      if (respondedIds.length > 0) {
        questions = await prisma.$queryRawUnsafe(
          `SELECT id, "order", text, type, emojis, brand
             FROM "PulseQuestion"
            WHERE id = ANY($1::int[])
            ORDER BY "order" ASC`,
          respondedIds.map((r) => r.questionId),
        );
      } else {
        const activeWeek = getActiveWeekNumber();
        questions = await prisma.$queryRawUnsafe(
          `SELECT id, "order", text, type, emojis, brand
             FROM "PulseQuestion"
            WHERE "surveyType" = 'weekly' AND week = $1 AND "isActive" = true
              AND brand = $2
            ORDER BY "order" ASC`,
          activeWeek, brand,
        );
      }
    }

    if (questions.length === 0) {
      return NextResponse.json({
        cycleKey, surveyType, brand,
        participation: { responded: 0, totalActiveUsers: 0, percent: 0 },
        questions: [],
      });
    }

    const qids = questions.map((q) => Number(q.id));

    // ── Per-question distribution (brand-scoped) ───────────────
    // Filter the responses to ones from users in the selected
    // brand only. Join User → EmployeeProfile.businessUnit.
    const distRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT r."questionId", r."score", count(*)::int AS n
         FROM "PulseResponse" r
         JOIN "User" u ON u.id = r."userId"
         LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
        WHERE r."weekKey" = $1
          AND r."questionId" = ANY($2::int[])
          AND ep."businessUnit" = $3
        GROUP BY r."questionId", r."score"`,
      cycleKey, qids, brand,
    );

    // ── Participation, brand-scoped ────────────────────────────
    const respondedRow = (await prisma.$queryRawUnsafe<any[]>(
      `SELECT count(DISTINCT r."userId")::int AS n
         FROM "PulseResponse" r
         JOIN "User" u ON u.id = r."userId"
         LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
        WHERE r."weekKey" = $1
          AND ep."businessUnit" = $2`,
      cycleKey, brand,
    ))[0];
    const responded = respondedRow?.n ?? 0;

    let totalActiveUsers = 0;
    try {
      const t = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::int AS n FROM "User" u
           LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
          WHERE u."isActive" = true
            AND u.email IS NOT NULL AND u.email <> ''
            AND COALESCE(u."isDeveloper", false) = false
            AND ep."businessUnit" = $1`,
        brand,
      );
      totalActiveUsers = t[0]?.n ?? 0;
    } catch {
      const t = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::int AS n FROM "User" u
           LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
          WHERE u."isActive" = true
            AND u.email IS NOT NULL AND u.email <> ''
            AND ep."businessUnit" = $1`,
        brand,
      );
      totalActiveUsers = t[0]?.n ?? 0;
    }
    const percent = totalActiveUsers > 0
      ? Math.round((responded / totalActiveUsers) * 100)
      : 0;

    // ── Anonymous comments (brand-scoped) ──────────────────────
    const commentRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT r."questionId", r."comment"
         FROM "PulseResponse" r
         JOIN "User" u ON u.id = r."userId"
         LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
        WHERE r."weekKey" = $1
          AND r."questionId" = ANY($2::int[])
          AND r."comment" IS NOT NULL AND r."comment" <> ''
          AND ep."businessUnit" = $3
        ORDER BY r."submittedAt" DESC`,
      cycleKey, qids, brand,
    );

    // Roll up per-question.
    const out = questions.map((q) => {
      const id = Number(q.id);
      const rows = distRows.filter((r) => Number(r.questionId) === id);
      const dist: Record<string, number> = {};
      let count = 0, sum = 0;
      for (const r of rows) {
        if (r.score == null) continue;
        const s = Number(r.score);
        const n = Number(r.n);
        dist[String(s)] = (dist[String(s)] ?? 0) + n;
        count += n;
        sum   += s * n;
      }
      if (q.type === "text") {
        count = commentRows.filter((c) => Number(c.questionId) === id).length;
      }
      const average = q.type === "text" || count === 0
        ? null
        : Number((sum / count).toFixed(2));

      // eNPS formula for type=enps. Promoters 9-10, Passives 7-8,
      // Detractors 0-6. Score = % promoters - % detractors.
      let enpsScore: number | null = null;
      if (q.type === "enps" && count > 0) {
        let promoters = 0, detractors = 0;
        for (let s = 0; s <= 10; s++) {
          const n = dist[String(s)] ?? 0;
          if (s <= 6) detractors += n;
          else if (s >= 9) promoters += n;
        }
        enpsScore = Math.round(((promoters - detractors) / count) * 100);
      }

      const comments = commentRows
        .filter((c) => Number(c.questionId) === id)
        .map((c) => String(c.comment))
        .slice(0, 200);

      return {
        id, order: q.order, text: q.text, type: q.type, emojis: q.emojis,
        brand: q.brand,
        stats: { count, average, distribution: q.type === "text" ? null : dist, enpsScore },
        comments,
      };
    });

    return NextResponse.json({
      cycleKey,
      surveyType,
      brand,
      participation: { responded, totalActiveUsers, percent },
      questions: out,
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/pulse/responses");
  }
}
