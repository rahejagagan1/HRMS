import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, isHRAdmin, serverError } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const { searchParams } = new URL(req.url);
    const isAdmin = isHRAdmin(self);
    const view = searchParams.get("view") || "my";
    const status = searchParams.get("status");

    let where: any = {};
    if (view === "my") where.raisedById = myId;
    else if (view === "assigned") where.assignedToId = myId;
    if (status) where.status = status;
    if (!isAdmin && view === "all") where.raisedById = myId;

    const tickets = await prisma.ticket.findMany({
      where, include: {
        raisedBy: { select: { id: true, name: true, profilePictureUrl: true } },
        assignedTo: { select: { id: true, name: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: "desc" }, take: 100,
    });
    return NextResponse.json(tickets);
  } catch (e) { return serverError(e, "GET /api/hr/tickets"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const body = await req.json();
    const { subject, description, category, priority } = body;
    if (!subject || !description || !category) return NextResponse.json({ error: "Required fields missing" }, { status: 400 });

    const slaHours: Record<string, number> = { urgent: 4, high: 24, medium: 72, low: 168 };
    const dueAt = new Date(Date.now() + (slaHours[priority || "medium"] || 72) * 60 * 60 * 1000);

    const ticket = await prisma.ticket.create({
      data: { subject, description, category, priority: priority || "medium", raisedById: myId, dueAt },
      include: { raisedBy: { select: { id: true, name: true } } },
    });
    return NextResponse.json(ticket);
  } catch (e) { return serverError(e, "POST /api/hr/tickets"); }
}
