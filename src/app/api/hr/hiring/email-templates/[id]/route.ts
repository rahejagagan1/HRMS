import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

    const body = await req.json();
    const set: string[] = [];
    const args: any[] = [];
    const f = (col: string, v: any) => {
      if (v === undefined) return;
      args.push(v); set.push(`"${col}" = $${args.length}`);
    };
    f("name", body.name);
    f("trigger", body.trigger);
    f("stageId", body.stageId === null ? null : body.stageId);
    f("subject", body.subject);
    f("bodyHtml", body.bodyHtml);
    f("isActive", body.isActive);
    f("autoSend", body.autoSend);

    if (set.length > 0) {
      args.push(id);
      await prisma.$executeRawUnsafe(
        `UPDATE "EmailTemplate" SET ${set.join(", ")}, "updatedAt" = NOW() WHERE "id" = $${args.length}`,
        ...args,
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "PATCH /api/hr/hiring/email-templates/[id]");
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
    await prisma.$executeRawUnsafe(`DELETE FROM "EmailTemplate" WHERE "id" = $1`, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/hiring/email-templates/[id]");
  }
}
