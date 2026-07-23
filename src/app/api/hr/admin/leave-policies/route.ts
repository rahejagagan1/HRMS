import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

// GET /api/hr/admin/leave-policies
// Returns every (active or inactive) policy + its entries. HR-admin only.
export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user as any)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const policies = await prisma.leavePolicy.findMany({
      include: {
        entries: {
          include: { leaveType: { select: { id: true, name: true, code: true } } },
          orderBy: { leaveType: { name: "asc" } },
        },
        _count: { select: { users: true } },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });
    // Flatten to a UI-friendly shape: each policy has {id, name, …, entries[], userCount}.
    return NextResponse.json(
      policies.map((p) => ({
        id:          p.id,
        name:        p.name,
        description: p.description,
        isActive:    p.isActive,
        createdAt:   p.createdAt,
        updatedAt:   p.updatedAt,
        userCount:   p._count.users,
        entries: p.entries.map((e) => ({
          id:             e.id,
          leaveTypeId:    e.leaveTypeId,
          leaveTypeName:  e.leaveType.name,
          leaveTypeCode:  e.leaveType.code,
          daysPerYear:    Number(e.daysPerYear),
          monthlyAccrual: Number(e.monthlyAccrual),
        })),
      })),
    );
  } catch (e) { return serverError(e, "GET /api/hr/admin/leave-policies"); }
}

// POST /api/hr/admin/leave-policies
// Body: { name: string, description?: string, entries: Array<{leaveTypeId, daysPerYear, monthlyAccrual}> }
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user as any)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const name = String(body?.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const entries: any[] = Array.isArray(body?.entries) ? body.entries : [];
    const created = await prisma.leavePolicy.create({
      data: {
        name,
        description: body?.description ? String(body.description) : null,
        entries: { create: entries.map((e) => ({
          leaveTypeId:    Number(e.leaveTypeId),
          daysPerYear:    Number(e.daysPerYear    ?? 0),
          monthlyAccrual: Number(e.monthlyAccrual ?? 0),
        })) },
      },
    });
    return NextResponse.json({ id: created.id });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "A policy with that name already exists." }, { status: 409 });
    }
    return serverError(e, "POST /api/hr/admin/leave-policies");
  }
}
