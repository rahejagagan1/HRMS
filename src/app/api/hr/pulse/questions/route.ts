// Pulse & Surveys — question bank CRUD (Weekly Pulse + Monthly Survey).
//
// GET    /api/hr/pulse/questions?surveyType=weekly&week=N
//   → Weekly: filter by week (1-4). Omit week to return all 4 weeks
//     flattened. surveyType defaults to 'weekly' for back-compat.
// GET    /api/hr/pulse/questions?surveyType=monthly
//   → Monthly: single list of monthly questions in `order` ASC.
// POST   /api/hr/pulse/questions          → create.
// PATCH  /api/hr/pulse/questions/[id]     → edit (separate file).
// DELETE /api/hr/pulse/questions/[id]     → hard delete.
//
// Read is open to every authenticated employee (the answer page
// will fetch the active set). Write is HR-admin only.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

// `emoji` / `rating` are weekly-pulse staples. `likert` is the
// 5-point Strongly Disagree → Strongly Agree scale used by the
// Monthly Survey's engagement-driver questions. `enps` is the
// 0-10 Net Promoter slider that drives the eNPS metric. `text`
// is the free-text comment box shared by both.
const VALID_TYPES = new Set(["emoji", "rating", "likert", "enps", "text"]);
const VALID_SURVEY_TYPES = new Set(["weekly", "monthly"]);
const VALID_BRANDS = new Set(["NB Media", "YT Labs"]);
const DEFAULT_EMOJIS = ["😡", "😟", "😐", "🙂", "😄"];

// Normalise an incoming brand string. Accepts slugs + friendly
// names + the literal "both" / "shared" / "" → null (= both brands).
function normalizeBrand(raw: unknown): "NB Media" | "YT Labs" | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === "both" || s === "shared") return null;
  const lower = s.toLowerCase();
  if (lower === "nb_media" || lower === "nbmedia" || lower === "nb media") return "NB Media";
  if (lower === "yt_labs"  || lower === "ytlabs"  || lower === "yt labs")  return "YT Labs";
  return null;
}

export async function GET(req: NextRequest) {
  // HR-admin only — this surface manages the question bank. The
  // employee-facing path goes through /api/hr/pulse/this-week
  // (separate endpoint) so tightening this GET doesn't break the
  // weekly clock-out gate.
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const surveyTypeRaw = url.searchParams.get("surveyType") ?? "weekly";
    const surveyType = VALID_SURVEY_TYPES.has(surveyTypeRaw) ? surveyTypeRaw : "weekly";
    const week = Number(url.searchParams.get("week"));
    const hasWeek = surveyType === "weekly" && Number.isFinite(week) && week >= 1 && week <= 4;

    // Strict brand separation — each brand has its own independent
    // question bank. No shared/fallback layer. ?brand is REQUIRED;
    // we default to NB Media if missing (the most common HR view).
    const brandParam = url.searchParams.get("brand");
    const requestedBrand = normalizeBrand(brandParam) ?? "NB Media";

    const params: any[] = [surveyType, requestedBrand];
    if (hasWeek) params.push(week);

    const sql = hasWeek
      ? `SELECT id, week, "order", text, type, emojis, "isActive", "surveyType", brand,
                "createdAt", "updatedAt"
           FROM "PulseQuestion"
          WHERE "surveyType" = $1 AND brand = $2 AND week = $3
          ORDER BY "order" ASC, id ASC`
      : `SELECT id, week, "order", text, type, emojis, "isActive", "surveyType", brand,
                "createdAt", "updatedAt"
           FROM "PulseQuestion"
          WHERE "surveyType" = $1 AND brand = $2
          ORDER BY COALESCE(week, 0) ASC, "order" ASC, id ASC`;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...params);
    return NextResponse.json({ questions: rows, brandFilter: requestedBrand });
  } catch (e) {
    return serverError(e, "GET /api/hr/pulse/questions");
  }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));

    const surveyType = String(body?.surveyType ?? "weekly").trim();
    if (!VALID_SURVEY_TYPES.has(surveyType)) {
      return NextResponse.json({ error: "surveyType must be weekly or monthly" }, { status: 400 });
    }

    // Weekly questions need a week (1-4). Monthly leaves it NULL.
    let week: number | null = null;
    if (surveyType === "weekly") {
      const w = Number(body?.week);
      if (!Number.isInteger(w) || w < 1 || w > 4) {
        return NextResponse.json({ error: "week must be 1, 2, 3, or 4 for weekly questions" }, { status: 400 });
      }
      week = w;
    }

    const text = String(body?.text ?? "").trim();
    if (!text || text.length > 400) {
      return NextResponse.json({ error: "text required (≤400 chars)" }, { status: 400 });
    }

    const type = String(body?.type ?? "emoji").trim();
    if (!VALID_TYPES.has(type)) {
      return NextResponse.json({ error: "type must be emoji | rating | likert | enps | text" }, { status: 400 });
    }

    // `emojis` array only meaningful for type=emoji.
    let emojis: string[] | null = null;
    if (type === "emoji") {
      emojis = Array.isArray(body?.emojis) && body.emojis.length === 5
        ? body.emojis.map((e: any) => String(e).slice(0, 8))
        : DEFAULT_EMOJIS;
    }

    // Brand is REQUIRED — strict brand separation. Default to
    // NB Media if the client forgot to send one so a malformed
    // POST doesn't 400 the HR panel.
    const brand = normalizeBrand(body?.brand) ?? "NB Media";

    // Next `order` within the same (surveyType, week, brand) bucket.
    const maxRow = (await prisma.$queryRawUnsafe<any[]>(
      week == null
        ? `SELECT COALESCE(MAX("order"), 0) AS m FROM "PulseQuestion"
             WHERE "surveyType" = $1 AND week IS NULL AND brand = $2`
        : `SELECT COALESCE(MAX("order"), 0) AS m FROM "PulseQuestion"
             WHERE "surveyType" = $1 AND week = $2 AND brand = $3`,
      ...(week == null ? [surveyType, brand] : [surveyType, week, brand]),
    ))[0];
    const nextOrder = (maxRow?.m ?? 0) + 1;

    const inserted = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO "PulseQuestion" (week, "order", text, type, emojis, "isActive", "surveyType", brand)
       VALUES ($1, $2, $3, $4, $5::jsonb, true, $6, $7)
       RETURNING id, week, "order", text, type, emojis, "isActive", "surveyType", brand, "createdAt", "updatedAt"`,
      week, nextOrder, text, type, emojis ? JSON.stringify(emojis) : null, surveyType, brand,
    );
    return NextResponse.json({ question: inserted[0] }, { status: 201 });
  } catch (e) {
    return serverError(e, "POST /api/hr/pulse/questions");
  }
}
