import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Streams a single post's image bytes.
 *
 * Background: EngagePost.mediaUrl historically stored full
 * `data:image/...;base64,...` URIs inline. With ~20 posts at 3-7 MB
 * each, the feed list endpoint was shipping 70 MB per request and
 * taking 16+ seconds. Data URIs are also un-cacheable in the browser
 * so every refresh paid the full cost.
 *
 * Now: the list endpoint replaces inline data URIs with a URL
 * pointing here (/api/hr/engage/posts/<id>/media). This route reads
 * just that one post's `mediaUrl`, decodes the base64, and streams
 * the bytes with a long Cache-Control so the browser keeps them
 * across reloads. Posts that already use http(s) URLs (e.g. external
 * CDN) skip this route entirely.
 *
 * Any authenticated user can fetch any post's image — same gate as
 * the list endpoint, since the post itself is already visible there.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { session, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    void session;

    try {
        const { id: idRaw } = await ctx.params;
        const postId = parseInt(idRaw, 10);
        if (!Number.isInteger(postId) || postId <= 0) {
            return NextResponse.json({ error: "Bad id" }, { status: 400 });
        }

        const post = await prisma.engagePost.findUnique({
            where: { id: postId },
            select: { mediaUrl: true },
        });
        if (!post?.mediaUrl) {
            return NextResponse.json({ error: "No media" }, { status: 404 });
        }

        // External URL — bounce the caller back to the source.
        if (/^https?:\/\//i.test(post.mediaUrl)) {
            return NextResponse.redirect(post.mediaUrl, 302);
        }

        // data:image/<mime>;base64,<payload>
        const m = post.mediaUrl.match(/^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i);
        if (!m) {
            return NextResponse.json({ error: "Unsupported media" }, { status: 415 });
        }
        const mime = m[1]!;
        const buf = Buffer.from(m[2]!, "base64");

        return new NextResponse(new Uint8Array(buf), {
            status: 200,
            headers: {
                "Content-Type": mime,
                "Content-Length": String(buf.length),
                // Posts never edit mediaUrl in the current code path, so
                // the bytes for a given id are stable — long cache is safe.
                // `private` keeps proxies/CDNs from sharing across users
                // (no auth-tied content, but defensive default).
                "Cache-Control": "private, max-age=31536000, immutable",
            },
        });
    } catch (e) {
        return serverError(e, "GET /api/hr/engage/posts/[id]/media");
    }
}
