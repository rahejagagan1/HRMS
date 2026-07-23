import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

        const { id: idRaw } = await params;
  try {
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const { message } = await req.json();
    if (!message) return NextResponse.json({ error: "Message is required" }, { status: 400 });
    const comment = await prisma.ticketComment.create({
      data: { ticketId: parseInt(idRaw), authorId: myId, message },
      include: { author: { select: { id: true, name: true, profilePictureUrl: true } } },
    });
    return NextResponse.json(comment);
  } catch (e) { return serverError(e, "POST /api/hr/tickets/[id]/comments"); }
}
