import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isLeadershipOrHR, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const INCLUDE = {
  author:   { select: { id: true, name: true, profilePictureUrl: true, role: true } },
  praiseTo: { select: { id: true, name: true, profilePictureUrl: true } },
  reactions: { include: { user: { select: { id: true, name: true } } } },
  comments: {
    orderBy: { createdAt: "asc" as const },
    include: { author: { select: { id: true, name: true, profilePictureUrl: true } } },
  },
};

// PATCH /api/hr/engage/posts/:id — edit post body / praise target.
// Only the post author can edit. HR admins can edit too (moderation).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;

  try {
    const { id: idRaw } = await params;
    const id = parseInt(idRaw);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

    const post = await prisma.engagePost.findUnique({ where: { id } });
    if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isAuthor = post.authorId === user.dbId;
    if (!isAuthor && !isLeadershipOrHR(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const data: any = {};
    if (typeof body.content === "string" && body.content.trim()) data.content = body.content.trim();
    if (body.praiseToId !== undefined) {
      data.praiseToId = body.praiseToId ? parseInt(String(body.praiseToId)) : null;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await prisma.engagePost.update({
      where: { id },
      data,
      include: INCLUDE,
    });
    return NextResponse.json(updated);
  } catch (e) { return serverError(e, "PATCH /api/hr/engage/posts/[id]"); }
}

// DELETE /api/hr/engage/posts/:id — author or HR admin.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;

  try {
    const { id: idRaw } = await params;
    const id = parseInt(idRaw);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

    const post = await prisma.engagePost.findUnique({ where: { id } });
    if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isAuthor = post.authorId === user.dbId;
    if (!isAuthor && !isLeadershipOrHR(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // EngageReaction.post and EngageComment.post both declare
    // `onDelete: Cascade` (see schema.prisma) — Postgres clears the
    // children for us when the parent row goes away, so no manual
    // pre-delete or transaction is needed. The previous version wrapped
    // these in $transaction([...]) with `.catch()` chained to each inner
    // delete, which broke the call: `$transaction` requires
    // PrismaPromise[] and `.catch()` returns a plain Promise, so Prisma
    // rejected the whole call with "Internal server error".
    await prisma.engagePost.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) { return serverError(e, "DELETE /api/hr/engage/posts/[id]"); }
}
