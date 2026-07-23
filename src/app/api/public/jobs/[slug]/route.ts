// Public single-job endpoint — no auth, CORS-open. Looked up by slug,
// not numeric id, so the URL we hand out stays stable and human-
// readable even if HR renames the job internally.
//
//   GET /api/public/jobs/[slug]      → full job detail
//   POST                              → 405 (use /api/jobs/apply)
//   OPTIONS                           → CORS preflight
//
// Returns 404 unless status='published' AND closesAt is in the future
// (or null). Soft 410-style behaviour for closed jobs is overkill —
// 404 with the same body keeps the careers page simple.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control":                "public, max-age=60, s-maxage=300",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    if (!slug || typeof slug !== "string") {
      return NextResponse.json({ error: "Bad slug" }, { status: 400, headers: CORS_HEADERS });
    }

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, title, "publicSlug" AS slug, department, location, brand,
              "employmentType" AS "employmentType",
              "experienceLevel" AS "experienceLevel",
              "salaryRange"    AS "salaryRange",
              description,
              vacancies,
              "publishedAt"    AS "publishedAt",
              "closesAt"       AS "closesAt",
              status
         FROM "JobOpening"
        WHERE "publicSlug" = $1
          AND status = 'published'
          AND ("closesAt" IS NULL OR "closesAt" > NOW())
        LIMIT 1`,
      slug,
    );
    const job = rows[0];
    if (!job) {
      return NextResponse.json({ error: "Job not found or no longer accepting applications" },
        { status: 404, headers: CORS_HEADERS });
    }

    return NextResponse.json({ job }, { headers: CORS_HEADERS });
  } catch (e: any) {
    console.error("[GET /api/public/jobs/[slug]] failed:", e);
    return NextResponse.json({ error: "Could not load job" },
      { status: 500, headers: CORS_HEADERS });
  }
}
