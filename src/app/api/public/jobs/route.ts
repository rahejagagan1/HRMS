// Public careers feed — no auth, CORS-open.
//
//   GET /api/public/jobs?brand=nb_media       → all published jobs for a brand
//   GET /api/public/jobs?brand=yt_labs
//   GET /api/public/jobs                       → all published jobs (every brand)
//
// Designed to be fetched cross-origin by the marketing site
// (nbmediaproductions.com, ytlpro.com) so it can render its own
// careers page using this dashboard's data. The response shape is
// stable and only exposes public-safe fields — no internal notes,
// recruiter ids, candidate counts, etc.
//
// Auto-hides:
//   • jobs whose closesAt is in the past
//   • jobs not in status='published' (drafts / on-hold / closed)
//
// CORS: `Access-Control-Allow-Origin: *` is intentionally wide here —
// only published-job metadata leaves through this endpoint, and we
// want the company website to be able to fetch it without a server-
// side proxy. If you ever add private fields, lock this down.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  // 10-minute browser cache so a refresh on the careers page isn't a
  // round-trip to Postgres every time. Tweak if HR wants instant
  // visibility of just-published jobs.
  "Cache-Control":                "public, max-age=60, s-maxage=300",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const brand = (searchParams.get("brand") || "").toLowerCase();

    const params: any[] = [];
    let where = `o."status" = 'published' AND (o."closesAt" IS NULL OR o."closesAt" > NOW())`;
    if (brand && ["nb_media", "yt_labs"].includes(brand)) {
      params.push(brand); where += ` AND o."brand" = $${params.length}`;
    }

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT o.id,
              o.title,
              o."publicSlug" AS slug,
              o.department,
              o.location,
              o.brand,
              o."employmentType" AS "employmentType",
              o."experienceLevel" AS "experienceLevel",
              o."salaryRange"    AS "salaryRange",
              o.vacancies,
              o."publishedAt"    AS "publishedAt",
              o."closesAt"       AS "closesAt"
         FROM "JobOpening" o
        WHERE ${where}
        ORDER BY o."publishedAt" DESC NULLS LAST, o."createdAt" DESC`,
      ...params,
    );

    return NextResponse.json(
      {
        jobs: rows.map((r) => ({
          ...r,
          // Only published jobs leak through this endpoint, but be
          // defensive — never return a job without a slug, since the
          // detail-page URL would be broken otherwise.
          slug: r.slug,
        })).filter((j) => j.slug),
      },
      { headers: CORS_HEADERS },
    );
  } catch (e: any) {
    console.error("[GET /api/public/jobs] failed:", e);
    return NextResponse.json(
      { error: "Could not load careers feed" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
