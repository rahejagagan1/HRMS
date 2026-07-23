import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

        const { id: idRaw } = await params;
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: parseInt(idRaw) },
      include: {
        raisedBy: { select: { id: true, name: true, profilePictureUrl: true } },
        assignedTo: { select: { id: true, name: true } },
        comments: { include: { author: { select: { id: true, name: true, profilePictureUrl: true } } }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(ticket);
  } catch (e) { return serverError(e, "GET /api/hr/tickets/[id]"); }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

        const { id: idRaw } = await params;
  try {
    const body = await req.json();
    const data: any = {};
    if (body.status) data.status = body.status;
    if (body.assignedToId !== undefined) data.assignedToId = body.assignedToId || null;
    if (body.priority) data.priority = body.priority;
    if (body.status === "resolved" || body.status === "closed") data.resolvedAt = new Date();

    const ticket = await prisma.ticket.update({
      where: { id: parseInt(idRaw) }, data,
      include: { raisedBy: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true } } },
    });
    return NextResponse.json(ticket);
  } catch (e) { return serverError(e, "PUT /api/hr/tickets/[id]"); }
}
