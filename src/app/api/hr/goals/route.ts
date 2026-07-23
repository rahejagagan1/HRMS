import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") || "my";   // my | team | company
  const cycleId = searchParams.get("cycleId");

  try {
    const where: any = {};
    if (cycleId) where.cycleId = parseInt(cycleId);

    if (view === "my") {
      where.ownerId = user.dbId;
    } else if (view === "team") {
      // goals owned by people in the same team (reportees of same manager)
      const me = await prisma.user.findUnique({ where: { id: user.dbId }, select: { managerId: true } });
      if (me?.managerId) {
        const teammates = await prisma.user.findMany({ where: { managerId: me.managerId }, select: { id: true } });
        where.ownerId = { in: teammates.map((t: any) => t.id) };
        where.visibility = { in: ["team", "company"] };
      } else {
        where.ownerId = user.dbId;
      }
    } else if (view === "company") {
      where.visibility = "company";
    }

    const goals = await prisma.goal.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, profilePictureUrl: true } },
        cycle: { select: { id: true, name: true, cycleType: true } },
        keyResults: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(goals);
  } catch (error) {
    return serverError(error, "hr/goals GET");
  }
}

export async function POST(request: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;

  try {
    const body = await request.json();
    const { title, description, cycleId, visibility, startDate, endDate, keyResults } = body;

    if (!title || !cycleId) {
      return NextResponse.json({ error: "title and cycleId are required" }, { status: 400 });
    }

    const goal = await prisma.goal.create({
      data: {
        title,
        description,
        ownerId: user.dbId,
        cycleId: parseInt(cycleId),
        visibility: visibility || "personal",
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        keyResults: keyResults?.length ? {
          create: keyResults.map((kr: any) => ({
            title: kr.title,
            targetValue: kr.targetValue || 100,
            currentValue: 0,
            unit: kr.unit || "%",
          })),
        } : undefined,
      },
      include: { keyResults: true, owner: { select: { id: true, name: true } }, cycle: true },
    });

    return NextResponse.json(goal, { status: 201 });
  } catch (error) {
    return serverError(error, "hr/goals POST");
  }
}
