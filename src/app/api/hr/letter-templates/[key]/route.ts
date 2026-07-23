// GET   /api/hr/letter-templates/:key — fetch one template
// PATCH /api/hr/letter-templates/:key — update body / customFields

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isLeadershipOrHR, resolveUserId, serverError } from "@/lib/api-auth";
import { sanitizeLetterHtml } from "@/lib/hr/letter-render";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  // Rename for clarity — we're using the request now (for ?brand=).
  const req = _req;
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isLeadershipOrHR(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { key } = await params;
    // Brand resolution: ?brand= (slug) → session.user.businessUnit
    // → "NB Media" (parent default). The Templates page forwards
    // the slug from the HR-Dashboard brand-switcher.
    //
    // SECURITY: an NB Media HR could otherwise navigate to
    // ?brand=yt-labs and read the YT Labs variant. Only honor the
    // URL brand when it MATCHES the viewer's session brand, or
    // the viewer is a developer. Unauthorized overrides silently
    // fall back to the viewer's own brand.
    const url = new URL(req.url);
    const slugParam = url.searchParams.get("brand")?.trim() || null;
    const slugToBrand = (s: string | null) =>
      s === "yt-labs" ? "YT Labs" : s === "nb-media" ? "NB Media" : null;
    const viewer = session!.user as any;
    const viewerBrand: string = viewer?.businessUnit || "NB Media";
    const requestedBrand = slugToBrand(slugParam);
    const mayCrossBrand = viewer?.isDeveloper === true || requestedBrand === viewerBrand;
    const effectiveBrand: string = mayCrossBrand && requestedBrand ? requestedBrand : viewerBrand;

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, key, title, category, "businessUnit", "bodyHtml", "customFields", "isActive", "updatedAt"
         FROM "LetterTemplate"
        WHERE key = $1
          AND ("businessUnit" = $2 OR "businessUnit" IS NULL)
        ORDER BY CASE WHEN "businessUnit" = $2 THEN 0 ELSE 1 END
        LIMIT 1`,
      key, effectiveBrand,
    );
    if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (e) {
    return serverError(e, "GET /api/hr/letter-templates/[key]");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isLeadershipOrHR(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { key } = await params;
    const body = await req.json().catch(() => ({}));
    const sets: string[] = [];
    const args: any[] = [];
    let i = 1;
    if (typeof body.bodyHtml === "string") {
      if (body.bodyHtml.length > 200_000) {
        return NextResponse.json({ error: "Body too large (200 KB max)" }, { status: 413 });
      }
      // Strip <script> / iframe / on... handlers / javascript: URLs
      // server-side so a compromised HR account can't persist an
      // XSS payload in the template body.
      const clean = sanitizeLetterHtml(body.bodyHtml);
      sets.push(`"bodyHtml" = $${i++}`); args.push(clean);
    }
    if (typeof body.title === "string" && body.title.trim()) {
      sets.push(`"title" = $${i++}`); args.push(body.title.trim());
    }
    if (Array.isArray(body.customFields)) {
      sets.push(`"customFields" = $${i++}::jsonb`); args.push(JSON.stringify(body.customFields));
    }
    if (body.isActive !== undefined) {
      sets.push(`"isActive" = $${i++}`); args.push(!!body.isActive);
    }
    if (sets.length === 0) return NextResponse.json({ ok: true });
    // Brand resolution — mirrors GET. Scope the UPDATE to exactly
    // one brand variant; otherwise an UPDATE WHERE key='fnf_settlement'
    // would touch BOTH the NB Media and YT Labs rows.
    //
    // SECURITY: same IDOR gate as GET. Reject the brand override
    // unless it matches the viewer's session brand OR the viewer
    // is a developer. An unauthorized override forces the write
    // back to the viewer's own brand — never the other brand's row.
    const urlBrand = new URL(req.url).searchParams.get("brand")?.trim() || null;
    const slugToBrand = (s: string | null) =>
      s === "yt-labs" ? "YT Labs" : s === "nb-media" ? "NB Media" : null;
    const viewer = session!.user as any;
    const viewerBrand: string = viewer?.businessUnit || "NB Media";
    const requestedBrand = slugToBrand(urlBrand);
    const mayCrossBrand = viewer?.isDeveloper === true || requestedBrand === viewerBrand;
    const effectiveBrand: string = mayCrossBrand && requestedBrand ? requestedBrand : viewerBrand;

    const editorId = await resolveUserId(session);
    if (editorId) { sets.push(`"updatedById" = $${i++}`); args.push(editorId); }
    sets.push(`"updatedAt" = NOW()`);
    args.push(key);
    const brandIdx = i + 1;
    args.push(effectiveBrand);
    await prisma.$executeRawUnsafe(
      `UPDATE "LetterTemplate" SET ${sets.join(", ")} WHERE key = $${i} AND "businessUnit" = $${brandIdx}`,
      ...args,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "PATCH /api/hr/letter-templates/[key]");
  }
}
