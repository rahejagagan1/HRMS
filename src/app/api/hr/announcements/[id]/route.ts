import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

// PUT /api/hr/announcements/:id — mark read
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

        const { id: idRaw } = await params;
  try {
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const announcementId = parseInt(idRaw);
    await prisma.announcementRead.upsert({
      where: { announcementId_userId: { announcementId, userId: myId } },
      create: { announcementId, userId: myId },
      update: { readAt: new Date() },
    });
    return NextResponse.json({ success: true });
  } catch (e) { return serverError(e, "PUT /api/hr/announcements/[id]"); }
}

// DELETE /api/hr/announcements/:id — admin delete
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

        const { id: idRaw } = await params;
  try {
    await prisma.announcement.delete({ where: { id: parseInt(idRaw) } });
    return NextResponse.json({ success: true });
  } catch (e) { return serverError(e, "DELETE /api/hr/announcements/[id]"); }
}
