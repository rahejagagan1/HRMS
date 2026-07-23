import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

        const { id: idRaw } = await params;
  const user = session!.user as any;

  try {
    const id = parseInt(idRaw);
    const body = await request.json();

    const goal = await prisma.goal.findUnique({ where: { id } });
    if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });

    // Canonical isHRAdmin — was inline check missing special_access
    // and role=admin tiers.
    const isAdmin = isHRAdmin(user);
    if (goal.ownerId !== user.dbId && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const data: any = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.status !== undefined) data.status = body.status;
    if (body.progress !== undefined) data.progress = Math.min(100, Math.max(0, parseInt(body.progress)));
    if (body.visibility !== undefined) data.visibility = body.visibility;

    // If all key results completed, auto-complete goal
    if (body.keyResultId !== undefined && body.currentValue !== undefined) {
      const kr = await prisma.keyResult.update({
        where: { id: body.keyResultId },
        data: {
          currentValue: body.currentValue,
          progress: Math.round((body.currentValue / (await prisma.keyResult.findUnique({ where: { id: body.keyResultId }, select: { targetValue: true } }))!.targetValue.toNumber()) * 100),
        },
      });
      // Recalculate goal progress as average of all KR progress
      const allKRs = await prisma.keyResult.findMany({ where: { goalId: id } });
      const avgProgress = allKRs.length
        ? Math.round(allKRs.reduce((s, k) => s + k.progress, 0) / allKRs.length)
        : 0;
      data.progress = avgProgress;
      if (avgProgress >= 100) data.status = "completed";
    }

    const updated = await prisma.goal.update({
      where: { id },
      data,
      include: { keyResults: true, owner: { select: { id: true, name: true } }, cycle: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return serverError(error, "hr/goals/[id] PUT");
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

        const { id: idRaw } = await params;
  const user = session!.user as any;

  try {
    const id = parseInt(idRaw);
    const goal = await prisma.goal.findUnique({ where: { id } });
    if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });

    // Canonical isHRAdmin — was inline check missing special_access
    // and role=admin tiers.
    const isAdmin = isHRAdmin(user);
    if (goal.ownerId !== user.dbId && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.goal.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return serverError(error, "hr/goals/[id] DELETE");
  }
}
