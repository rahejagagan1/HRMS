import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";
type Params = Promise<{ id: string }>;

// PUT /api/hr/admin/leave-policies/[id]
// Body: { name?, description?, isActive?, entries?: Array<{leaveTypeId, daysPerYear, monthlyAccrual}> }
// Replaces all entries when `entries` is provided. Leaves them untouched otherwise.
export async function PUT(req: NextRequest, { params }: { params: Params }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user as any)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id: idRaw } = await params;
    const id = parseInt(idRaw);
    if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const body = await req.json();

    const data: any = {};
    if (typeof body?.name === "string")        data.name        = body.name.trim();
    if ("description" in (body ?? {}))         data.description = body.description ? String(body.description) : null;
    if (typeof body?.isActive === "boolean")   data.isActive    = body.isActive;

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.leavePolicy.update({ where: { id }, data });
      }
      if (Array.isArray(body?.entries)) {
        await tx.leavePolicyEntry.deleteMany({ where: { policyId: id } });
        if (body.entries.length > 0) {
          await tx.leavePolicyEntry.createMany({
            data: body.entries.map((e: any) => ({
              policyId:       id,
              leaveTypeId:    Number(e.leaveTypeId),
              daysPerYear:    Number(e.daysPerYear    ?? 0),
              monthlyAccrual: Number(e.monthlyAccrual ?? 0),
            })),
          });
        }
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "A policy with that name already exists." }, { status: 409 });
    }
    return serverError(e, "PUT /api/hr/admin/leave-policies/[id]");
  }
}

// DELETE /api/hr/admin/leave-policies/[id]
// Soft-delete: isActive=false. Any users still assigned remain assigned;
// HR should reassign them. Hard delete is intentionally not exposed —
// historical balance rows reference the policy implicitly via the user.
export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user as any)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id: idRaw } = await params;
    const id = parseInt(idRaw);
    if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    await prisma.leavePolicy.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true });
  } catch (e) { return serverError(e, "DELETE /api/hr/admin/leave-policies/[id]"); }
}
