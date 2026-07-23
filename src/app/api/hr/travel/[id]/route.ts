import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, isHRAdmin, serverError } from "@/lib/api-auth";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

        const { id: idRaw } = await params;
  const user = session!.user as any;
  const myId = await resolveUserId(session);
  const isAdmin = isHRAdmin(user);

  try {
    const id = parseInt(idRaw);
    const { action, approvalNote } = await req.json();
    const record = await prisma.travelRequest.findUnique({ where: { id } });
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!isAdmin) {
      const isMgr = await prisma.user.findFirst({ where: { id: record.userId, managerId: myId! } });
      if (!isMgr) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const updated = await prisma.travelRequest.update({
      where: { id },
      data: {
        status: action === "approve" ? "approved" : action === "complete" ? "completed" : "rejected",
        approvedById: myId,
        approvalNote,
      },
    });
    return NextResponse.json(updated);
  } catch (e) { return serverError(e, "PUT /api/hr/travel/[id]"); }
}
