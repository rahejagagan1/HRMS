import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const cycles = await prisma.goalCycle.findMany({
      orderBy: { startDate: "desc" },
    });

    // Auto-create current quarter if none exist
    if (cycles.length === 0) {
      const now = new Date();
      const q = Math.ceil((now.getMonth() + 1) / 3);
      const year = now.getFullYear();
      const qStarts = [0, 3, 6, 9];
      const start = new Date(year, qStarts[q - 1], 1);
      const end = new Date(year, qStarts[q - 1] + 3, 0);
      const cycle = await prisma.goalCycle.create({
        data: { name: `Q${q} ${year}`, cycleType: "quarterly", startDate: start, endDate: end, isActive: true },
      });
      return NextResponse.json([cycle]);
    }

    return NextResponse.json(cycles);
  } catch (error) {
    return serverError(error, "hr/goals/cycles GET");
  }
}

export async function POST(request: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;

  // RBAC-designation-driven (policy 2026-07-14) — shared isHRAdmin resolves
  // MANAGE_HR from the caller's designation.
  const isAdmin = isHRAdmin(user);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json();
    const cycle = await prisma.goalCycle.create({
      data: {
        name: body.name,
        cycleType: body.cycleType || "quarterly",
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        isActive: body.isActive ?? true,
      },
    });
    return NextResponse.json(cycle, { status: 201 });
  } catch (error) {
    return serverError(error, "hr/goals/cycles POST");
  }
}
