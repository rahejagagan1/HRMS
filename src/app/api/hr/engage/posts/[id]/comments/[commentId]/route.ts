// DELETE /api/hr/engage/posts/:id/comments/:commentId
//
// Removes a comment. Allowed when the caller is:
//   • The comment author themselves
//   • The HR-confidential tier (isLeadershipOrHR — HR_CONFIDENTIAL via
//     designation, plus CEO / developers)
//
// Anyone else → 403.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// RBAC-designation-driven (policy 2026-07-14): moderation follows the shared
// isLeadershipOrHR tier (HR_CONFIDENTIAL via designation), matching the
// engage page's client-side gate. Replaced a local orgLevel-only copy.
import { isLeadershipOrHR } from "@/lib/access";
function canModerateComments(user: any): boolean {
  return isLeadershipOrHR(user);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const { id: idRaw, commentId: commentIdRaw } = await params;
    const postId    = parseInt(idRaw, 10);
    const commentId = parseInt(commentIdRaw, 10);
    if (!Number.isInteger(postId)    || postId    <= 0) return NextResponse.json({ error: "Invalid post id" },    { status: 400 });
    if (!Number.isInteger(commentId) || commentId <= 0) return NextResponse.json({ error: "Invalid comment id" }, { status: 400 });

    const callerId = await resolveUserId(session);
    const user     = session!.user as any;

    // Look up the comment + verify it belongs to the given post.
    const existing = await prisma.engageComment.findUnique({
      where: { id: commentId },
      select: { id: true, postId: true, authorId: true },
    });
    if (!existing || existing.postId !== postId) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    const isOwner = callerId != null && existing.authorId === callerId;
    if (!isOwner && !canModerateComments(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.engageComment.delete({ where: { id: commentId } });
    return NextResponse.json({ ok: true, deleted: commentId });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/engage/posts/[id]/comments/[commentId]");
  }
}
