// GET  /api/hr/letter-templates       — list all (HR-team / dev / CEO)
// POST /api/hr/letter-templates/seed  — idempotent re-seed (HR-team / dev / CEO)
//
// The Templates page reads this to render the catalog; the editor
// page pulls individual templates via [key]/route.ts below.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isLeadershipOrHR, serverError } from "@/lib/api-auth";
import { LETTER_TEMPLATE_SEEDS } from "@/lib/hr/letter-template-seeds";
import { sanitizeLetterHtml } from "@/lib/hr/letter-render";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isLeadershipOrHR(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    // Brand resolution — three sources, in priority order:
    //   1. ?all=1            → developer-only cross-brand listing
    //   2. ?brand=NB Media   → explicit URL override (from the HR
    //                          Dashboard brand-switcher)
    //   3. session.user.businessUnit (default fallback)
    // Default to "NB Media" when nothing is set (parent brand).
    // The ?all=1 path is gated to developers so a regular HR user
    // can't escape their brand by typing the param in the URL.
    const url = new URL(req.url);
    const wantAll = url.searchParams.get("all") === "1";
    const urlBrand = url.searchParams.get("brand")?.trim() || null;
    const viewer = session!.user as any;
    const viewerBrand: string = viewer?.businessUnit || "NB Media";

    if (wantAll) {
      if (viewer?.isDeveloper !== true) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, key, title, category, "businessUnit", "customFields", "isActive", "updatedAt"
           FROM "LetterTemplate"
          WHERE "isActive" = true
          ORDER BY category ASC, "businessUnit" NULLS FIRST, title ASC`,
      );
      return NextResponse.json(rows);
    }

    // SECURITY: only honor ?brand= when the resulting brand IS the
    // viewer's session brand, or the viewer is a developer.
    // Otherwise an NB Media HR could navigate to ?brand=yt-labs and
    // read YT Labs templates — classic IDOR. Unauthorized override
    // attempts silently fall back to the viewer's brand.
    const requestedBrand = urlBrand && (urlBrand === "NB Media" || urlBrand === "YT Labs")
      ? urlBrand
      : null;
    const mayCrossBrand = viewer?.isDeveloper === true || requestedBrand === viewerBrand;
    const effectiveBrand = mayCrossBrand && requestedBrand ? requestedBrand : viewerBrand;

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, key, title, category, "businessUnit", "customFields", "isActive", "updatedAt"
         FROM "LetterTemplate"
        WHERE "isActive" = true
          AND ("businessUnit" = $1 OR "businessUnit" IS NULL)
        ORDER BY category ASC, title ASC`,
      effectiveBrand,
    );
    return NextResponse.json(rows);
  } catch (e) {
    return serverError(e, "GET /api/hr/letter-templates");
  }
}

// Idempotent seed — inserts the canonical 4 templates if they're
// missing. Existing rows are left alone so HR's edits aren't
// clobbered on subsequent calls. Useful to bootstrap a fresh DB and
// to backfill new template keys when we ship them.
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isLeadershipOrHR(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    // Seed inserts every template in LETTER_TEMPLATE_SEEDS that
    // isn't already in the DB for its brand. Each seed entry now
    // carries an explicit `businessUnit` ("NB Media" or "YT Labs"),
    // defaulting to "NB Media" when omitted to stay backwards-
    // compatible with the original 5 seeds.
    let inserted = 0;
    let skipped  = 0;
    for (const t of LETTER_TEMPLATE_SEEDS) {
      const brand = t.businessUnit ?? "NB Media";
      const existing = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM "LetterTemplate" WHERE key = $1 AND "businessUnit" = $2 LIMIT 1`,
        t.key, brand,
      );
      if (existing[0]) { skipped++; continue; }
      await prisma.$executeRawUnsafe(
        `INSERT INTO "LetterTemplate"
           (key, title, category, "businessUnit", "bodyHtml", "customFields", "isActive", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, true, NOW(), NOW())`,
        t.key, t.title, t.category, brand, sanitizeLetterHtml(t.bodyHtml), JSON.stringify(t.customFields),
      );
      inserted++;
    }
    return NextResponse.json({ ok: true, inserted, skipped });
  } catch (e) {
    return serverError(e, "POST /api/hr/letter-templates");
  }
}
