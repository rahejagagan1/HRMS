// Public job-by-id endpoint — no auth, used by the apply form to
// load full job context (title, brand, meta, full description, JD
// attachment) so candidates know what they're applying for.
//
// Only returns rows where status='published' AND the close date is
// either null or in the future. Anything else 404s.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }

    // Be defensive: the JD columns may not exist on every deployment
    // yet, so fall back to a query without them on a 42703 error.
    let rows: any[] = [];
    try {
      rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, title, "publicSlug" AS slug, department, location, brand,
                "employmentType", "experienceLevel", "salaryRange",
                description, vacancies, "publishedAt", "closesAt",
                "jdFileUrl", "jdFileName"
           FROM "JobOpening"
          WHERE id = $1
            AND "status" = 'published'
            AND ("closesAt" IS NULL OR "closesAt" > NOW())
          LIMIT 1`,
        id,
      );
    } catch (e: any) {
      const code = e?.meta?.code || e?.code;
      if (code === "42703" || /does not exist/i.test(String(e?.message))) {
        rows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT id, title, "publicSlug" AS slug, department, location, brand,
                  "employmentType", "experienceLevel", "salaryRange",
                  description, vacancies, "publishedAt", "closesAt",
                  NULL AS "jdFileUrl", NULL AS "jdFileName"
             FROM "JobOpening"
            WHERE id = $1
              AND "status" = 'published'
              AND ("closesAt" IS NULL OR "closesAt" > NOW())
            LIMIT 1`,
          id,
        );
      } else { throw e; }
    }
    const job = rows[0];
    if (!job) return NextResponse.json({ error: "Job not found or no longer accepting applications" }, { status: 404 });
    return NextResponse.json({ job });
  } catch (e: any) {
    console.error("[GET /api/jobs/[id]] failed:", e);
    return NextResponse.json({ error: "Could not load job" }, { status: 500 });
  }
}
