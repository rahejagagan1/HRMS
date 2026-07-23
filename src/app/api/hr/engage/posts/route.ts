import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isLeadershipOrHR, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const INCLUDE = {
  author: { select: { id: true, name: true, profilePictureUrl: true, role: true } },
  praiseTo: { select: { id: true, name: true, profilePictureUrl: true } },
  reactions: { include: { user: { select: { id: true, name: true } } } },
  comments: {
    orderBy: { createdAt: "asc" as const },
    include: { author: { select: { id: true, name: true, profilePictureUrl: true } } },
  },
};

/**
 * List-endpoint `select` shape. Mirrors INCLUDE but explicitly omits
 * mediaUrl (~3.5 MB of base64 per post) and replaces it with a tiny
 * `hasMedia` flag the client uses to decide whether to render the
 * <img> tag pointing at /api/hr/engage/posts/[id]/media. This was the
 * fix for "posts take 16 s to load" — full mediaUrl payload was
 * shipping on every list refresh.
 */
const LIST_SELECT = {
  id: true,
  authorId: true,
  type: true,
  content: true,
  praiseToId: true,
  scope: true,
  department: true,
  // mediaUrl: deliberately omitted — see comment above.
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true, profilePictureUrl: true, role: true } },
  praiseTo: { select: { id: true, name: true, profilePictureUrl: true } },
  reactions: { include: { user: { select: { id: true, name: true } } } },
  comments: {
    orderBy: { createdAt: "asc" as const },
    include: { author: { select: { id: true, name: true, profilePictureUrl: true } } },
  },
};

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope") || "org";
  const cursor = searchParams.get("cursor") ? parseInt(searchParams.get("cursor")!) : undefined;

  try {
    // Two-step: list pulls the lightweight fields (LIST_SELECT
    // deliberately omits mediaUrl), then a tiny second query
    // identifies which post ids have media so the client can build
    // the <img src="/api/hr/engage/posts/<id>/media"> URL without
    // needing the bytes. Avoids the 70 MB blob round-trip that was
    // causing 16 s loads.
    const posts = await prisma.engagePost.findMany({
      where: scope !== "org" ? { scope } : {},
      orderBy: { createdAt: "desc" },
      take: 20,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: LIST_SELECT,
    });

    if (posts.length === 0) return NextResponse.json([]);

    const ids = posts.map((p) => p.id);
    const withMedia = await prisma.$queryRawUnsafe<{ id: number; kind: string }[]>(
      `SELECT id,
              CASE WHEN "mediaUrl" LIKE 'data:%' THEN 'data'
                   WHEN "mediaUrl" ~ '^https?://'      THEN 'url'
                   ELSE 'none'
              END AS kind
         FROM "EngagePost"
        WHERE id = ANY($1::int[]) AND "mediaUrl" IS NOT NULL`,
      ids,
    );
    const mediaKindById = new Map(withMedia.map((r) => [r.id, r.kind]));

    // Re-attach mediaUrl on the response:
    //   • 'data' kind → URL to the /media streaming route
    //   • 'url'  kind → fetch the raw column (single small query) so
    //                   external URLs still flow through unchanged
    //   • 'none' or absent → no mediaUrl on the payload
    const externalIds = withMedia.filter((r) => r.kind === "url").map((r) => r.id);
    const externalById = new Map<number, string>();
    if (externalIds.length > 0) {
      const rows = await prisma.engagePost.findMany({
        where: { id: { in: externalIds } },
        select: { id: true, mediaUrl: true },
      });
      for (const r of rows) if (r.mediaUrl) externalById.set(r.id, r.mediaUrl);
    }

    const shaped = posts.map((p) => {
      const kind = mediaKindById.get(p.id);
      if (kind === "data") return { ...p, mediaUrl: `/api/hr/engage/posts/${p.id}/media` };
      if (kind === "url")  return { ...p, mediaUrl: externalById.get(p.id) ?? null };
      return { ...p, mediaUrl: null };
    });
    return NextResponse.json(shaped);
  } catch (e) { return serverError(e, "GET /api/hr/engage/posts"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;

  // Engage post creation is leadership/HR-tier only — CEO,
  // developers, and the HR team (orgLevel=hr_manager). Mirrors the
  // `canCompose` gate on the composer card; the server check makes
  // it a real ACL rather than a UI suggestion. Excludes
  // special_access and role=admin per the same policy used for
  // employee documents.
  if (!isLeadershipOrHR(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { content, type, praiseToId, scope, department, mediaUrl } = body;
    // Require EITHER a non-empty caption OR an attached image —
    // image-only posts (work anniversaries, posters) are valid.
    const safeContent = typeof content === "string" ? content.trim() : "";
    const safeMediaUrl = typeof mediaUrl === "string" ? mediaUrl.trim() : "";
    if (!safeContent && !safeMediaUrl) {
      return NextResponse.json({ error: "content or image required" }, { status: 400 });
    }
    // Only accept data: URIs for images or http(s) URLs — anything
    // else (javascript:, file:, etc.) is rejected. Hard-cap data URI
    // size at ~3 MB encoded so a single row can't bloat the table.
    if (safeMediaUrl) {
      const isHttp = /^https?:\/\//i.test(safeMediaUrl);
      // SVG intentionally excluded — it can carry inline JS / XSS.
      // Same rule as the safe-MIME allowlist in /api/hr/documents.
      const isDataImage = /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(safeMediaUrl);
      if (!isHttp && !isDataImage) {
        return NextResponse.json({ error: "Invalid image URL" }, { status: 400 });
      }
      if (safeMediaUrl.length > 3 * 1024 * 1024) {
        return NextResponse.json({ error: "Image too large" }, { status: 413 });
      }
    }

    const post = await prisma.engagePost.create({
      data: {
        authorId: user.dbId,
        type: type || "post",
        content: safeContent,
        praiseToId: praiseToId ? parseInt(praiseToId) : null,
        scope: scope || "org",
        department: department || null,
        mediaUrl: safeMediaUrl || null,
      },
      include: INCLUDE,
    });
    return NextResponse.json(post, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/engage/posts"); }
}
