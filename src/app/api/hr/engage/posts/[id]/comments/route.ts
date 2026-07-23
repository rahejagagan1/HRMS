import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

        const { id: idRaw } = await params;
  const user = session!.user as any;

  try {
    const postId = parseInt(idRaw);
    const { content } = await req.json();
    if (!content?.trim()) return NextResponse.json({ error: "content required" }, { status: 400 });

    const comment = await prisma.engageComment.create({
      data: { postId, authorId: user.dbId, content: content.trim() },
      include: { author: { select: { id: true, name: true, profilePictureUrl: true } } },
    });
    return NextResponse.json(comment, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/engage/posts/[id]/comments"); }
}
