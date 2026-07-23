import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isHRAdmin, serverError } from "@/lib/api-auth";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

        const { id: idRaw } = await params;
  const user = session!.user as any;

  try {
    const id = parseInt(idRaw);
    const body = await request.json();
    const isAdmin = isHRAdmin(user);

    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const data: any = {};

    // Owner can update their own pending expense
    if (expense.userId === user.dbId && expense.status === "pending") {
      if (body.title) data.title = body.title;
      if (body.amount) data.amount = parseFloat(body.amount);
      if (body.description !== undefined) data.description = body.description;
    }

    // Admin or direct manager can approve/reject
    const isDirectManager = !isAdmin && body.action
      ? !!(await prisma.user.findFirst({ where: { id: expense.userId, managerId: user.dbId } }))
      : false;

    if ((isAdmin || isDirectManager) && body.action) {
      if (body.action === "approve") {
        data.status = "approved";
        data.approvedById = user.dbId;
        data.approvalNote = body.approvalNote || null;
      } else if (body.action === "reject") {
        data.status = "rejected";
        data.approvedById = user.dbId;
        data.approvalNote = body.approvalNote || null;
      } else if (body.action === "mark_paid") {
        data.status = "paid";
        data.paidAt = new Date();
      }
    }

    const updated = await prisma.expense.update({
      where: { id },
      data,
      include: { user: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return serverError(error, "hr/expenses/[id] PUT");
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

        const { id: idRaw } = await params;
  const user = session!.user as any;

  try {
    const id = parseInt(idRaw);
    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (expense.userId !== user.dbId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (expense.status !== "pending") return NextResponse.json({ error: "Cannot delete non-pending expense" }, { status: 400 });

    await prisma.expense.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return serverError(error, "hr/expenses/[id] DELETE");
  }
}
