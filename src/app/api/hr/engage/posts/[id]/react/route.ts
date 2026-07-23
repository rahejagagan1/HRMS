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
    const { emoji = "👍" } = await req.json().catch(() => ({}));

    const existing = await prisma.engageReaction.findUnique({
      where: { postId_userId: { postId, userId: user.dbId } },
    });

    // Three-way: same emoji = toggle off, different emoji = replace,
    // no prior reaction = add. Lets a user switch from 👍 → ❤️ → 🎉
    // without first un-reacting, matching Facebook / Slack semantics.
    if (existing) {
      if (existing.emoji === emoji) {
        await prisma.engageReaction.delete({ where: { id: existing.id } });
        return NextResponse.json({ action: "removed" });
      }
      const updated = await prisma.engageReaction.update({
        where: { id: existing.id },
        data:  { emoji },
      });
      return NextResponse.json({ action: "replaced", emoji: updated.emoji });
    }
    await prisma.engageReaction.create({ data: { postId, userId: user.dbId, emoji } });
    return NextResponse.json({ action: "added" });
  } catch (e) { return serverError(e, "POST /api/hr/engage/posts/[id]/react"); }
}
