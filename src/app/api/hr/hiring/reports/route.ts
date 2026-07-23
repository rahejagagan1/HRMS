// HR Hiring — Reports aggregates.
//
// GET /api/hr/hiring/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&jobId=N
//   → returns:
//     • funnel: [{ stageKey, stageLabel, count }] — count of candidates
//       per stage in the window
//     • timeToHire: { avgDays, p50, p90 } — days from application to
//       hired stage for offers that closed in the window
//     • sourceBreakdown: [{ source, count }]
//     • activeJobs / openJobs / candidatesAdded
//
// All gated to HR-admin tier.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

/** Pre-migration safety: any sub-query that touches a brand-new
 *  hiring table/column should fall through to its empty shape rather
 *  than 500ing the whole reports page. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    const code = e?.meta?.code || e?.code;
    const msg = String(e?.meta?.message || e?.message || "");
    if (code === "42P01" || code === "42703" || /does not exist/i.test(msg)) return fallback;
    throw e;
  }
}

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { searchParams } = new URL(req.url);
    const from   = searchParams.get("from");
    const to     = searchParams.get("to");
    const jobIdQ = searchParams.get("jobId");

    const filters: string[] = [];
    const params: any[] = [];
    if (from) { params.push(new Date(from)); filters.push(`a."createdAt" >= $${params.length}`); }
    if (to)   { params.push(new Date(to));   filters.push(`a."createdAt" <= $${params.length}`); }
    if (jobIdQ && /^\d+$/.test(jobIdQ)) {
      params.push(parseInt(jobIdQ, 10));
      filters.push(`a."jobOpeningId" = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const [funnel, ttHire, sources, headlineRows] = await Promise.all([
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT s."key" AS "stageKey", s."label" AS "stageLabel", s."color",
                COUNT(a."id") AS "count"
           FROM "HiringStage" s
           LEFT JOIN "JobApplication" a ON a."currentStageId" = s."id"
                                       AND a."currentStageId" IS NOT NULL
           ${where ? `${where} GROUP BY s."id"` : `GROUP BY s."id"`}
          ORDER BY s."sortOrder" ASC`,
        ...params,
      ), [] as any[]),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `WITH hires AS (
           SELECT a."id",
                  EXTRACT(EPOCH FROM (a."updatedAt" - a."createdAt")) / 86400.0 AS days
             FROM "JobApplication" a
             JOIN "HiringStage" s ON s."id" = a."currentStageId"
            WHERE s."kind" = 'hired'
              ${where ? "AND " + filters.join(" AND ") : ""}
         )
         SELECT
           AVG(days) AS "avgDays",
           percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS "p50",
           percentile_cont(0.9) WITHIN GROUP (ORDER BY days) AS "p90",
           COUNT(*) AS "n"
         FROM hires`,
        ...params,
      ), [{ avgDays: null, p50: null, p90: null, n: 0 }]),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT COALESCE(a."source", 'Direct') AS source, COUNT(*) AS count
           FROM "JobApplication" a
          ${where}
          GROUP BY COALESCE(a."source", 'Direct')
          ORDER BY count DESC`,
        ...params,
      ), [] as any[]),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT
           (SELECT COUNT(*) FROM "JobOpening" WHERE "isOpen" = true) AS "openJobs",
           (SELECT COUNT(*) FROM "JobOpening") AS "totalJobs",
           (SELECT COUNT(*) FROM "JobApplication" a ${where || ""}) AS "candidatesAdded"`,
        ...params,
      ), [{ openJobs: 0, totalJobs: 0, candidatesAdded: 0 }]),
    ]);

    return NextResponse.json({
      funnel: funnel.map((r) => ({ ...r, count: Number(r.count ?? 0) })),
      timeToHire: ttHire[0]
        ? {
            avgDays: ttHire[0].avgDays != null ? Number(ttHire[0].avgDays).toFixed(1) : null,
            p50: ttHire[0].p50 != null ? Number(ttHire[0].p50).toFixed(1) : null,
            p90: ttHire[0].p90 != null ? Number(ttHire[0].p90).toFixed(1) : null,
            n:   Number(ttHire[0].n ?? 0),
          }
        : { avgDays: null, p50: null, p90: null, n: 0 },
      sources: sources.map((s) => ({ source: s.source, count: Number(s.count ?? 0) })),
      headline: headlineRows[0]
        ? {
            openJobs:        Number(headlineRows[0].openJobs ?? 0),
            totalJobs:       Number(headlineRows[0].totalJobs ?? 0),
            candidatesAdded: Number(headlineRows[0].candidatesAdded ?? 0),
          }
        : { openJobs: 0, totalJobs: 0, candidatesAdded: 0 },
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/hiring/reports");
  }
}
