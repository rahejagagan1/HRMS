// POST /api/hr/payroll/exits/[id]/settle
//   Body: { month, year, amount, comment? }
//   Marks EmployeeExit.finalSettlementDone = true AND inserts an
//   AdhocLineItem(kind='payment', type='ff_settlement') so the engine
//   picks the amount up on the next /generate.
//
// HR-admin only.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, canViewSalary, serverError } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idStr } = await ctx.params;
    const id = parseInt(idStr);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

    const body = await req.json();
    const month  = parseInt(body?.month);
    const year   = parseInt(body?.year);
    const amount = Number(body?.amount);
    const comment = body?.comment ? String(body.comment).slice(0, 500) : null;

    if (!Number.isFinite(month) || month < 0 || month > 11)
      return NextResponse.json({ error: "Bad month" }, { status: 400 });
    if (!Number.isFinite(year)) return NextResponse.json({ error: "Bad year" }, { status: 400 });
    if (!Number.isFinite(amount) || amount < 0)
      return NextResponse.json({ error: "amount must be ≥ 0" }, { status: 400 });

    const exitRow = await prisma.$queryRawUnsafe<{ userId: number; finalSettlementDone: boolean }[]>(
      `SELECT "userId", "finalSettlementDone" FROM "EmployeeExit" WHERE id = $1`, id,
    );
    if (!exitRow.length) return NextResponse.json({ error: "Exit not found" }, { status: 404 });
    const userId = exitRow[0].userId;

    const createdBy = await resolveUserId(session);

    await prisma.$executeRawUnsafe(
      `UPDATE "EmployeeExit" SET "finalSettlementDone" = TRUE, status = 'cleared', "updatedAt" = NOW() WHERE id = $1`,
      id,
    );

    if (amount > 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AdhocLineItem" ("userId", month, year, kind, type, amount, comment, "createdBy")
         VALUES ($1, $2, $3, 'payment', 'ff_settlement', $4, $5, $6)`,
        userId, month, year, amount, comment ?? "F&F settlement", createdBy,
      );
    }

    await writeAuditLog({
      req,
      actorId: createdBy ?? null,
      actorEmail: (session!.user as any).email ?? null,
      action: "payroll.exit.ff_settle",
      entityType: "EmployeeExit",
      entityId: id,
      after: { userId, month, year, amount, comment },
    });

    return NextResponse.json({ ok: true });
  } catch (e) { return serverError(e, "POST /api/hr/payroll/exits/[id]/settle"); }
}
