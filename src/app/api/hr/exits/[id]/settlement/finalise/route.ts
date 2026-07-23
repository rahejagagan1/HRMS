// POST /api/hr/exits/:id/settlement/finalise
//
// Locks the ExitSettlement after HR confirms the Payable Summary on
// Step 2 of the wizard. Side-effect: also ticks
// EmployeeExit.finalSettlementDone = true so the global checklist
// stays in sync with the wizard.
//
// We do NOT auto-transition the exit to "exited" here — finalising the
// settlement is independent of clearance. HR flips the status
// separately once tasks + interview are done.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// RBAC-designation-driven (policy 2026-07-14): shared isHRAdmin resolves
// MANAGE_HR from the caller's designation. Replaced a local legacy copy.
import { isHRAdmin } from "@/lib/access";
function canManage(session: any): boolean {
  return isHRAdmin(session?.user);
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    // Confirm the exit exists.
    const exitRows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT id FROM "EmployeeExit" WHERE id = $1`, id,
    );
    if (exitRows.length === 0) return NextResponse.json({ error: "Exit not found" }, { status: 404 });

    let rows = await prisma.$queryRawUnsafe<Array<{ id: number; finalised: boolean }>>(
      `SELECT id, finalised FROM "ExitSettlement" WHERE "exitId" = $1`, id,
    );
    // F&F-Letter-as-finalization flow: HR finalises straight from the F&F
    // Letter action without going through the line-item wizard. Create a
    // minimal settlement header on the fly so there's a row to lock.
    if (rows.length === 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ExitSettlement" ("exitId", "paymentMode", "settlementMode",
            "actualNoticeDays", "noticeServingDays", "buyoutEligible", "gratuityEligible",
            "settlementDate", "updatedAt")
         VALUES ($1, 'pay', 'at_once', 0, 0, false, false, now(), now())
         ON CONFLICT ("exitId") DO NOTHING`,
        id,
      );
      rows = await prisma.$queryRawUnsafe<Array<{ id: number; finalised: boolean }>>(
        `SELECT id, finalised FROM "ExitSettlement" WHERE "exitId" = $1`, id,
      );
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: "Could not create settlement" }, { status: 500 });
    }
    if (rows[0].finalised) {
      return NextResponse.json({ error: "Already finalised" }, { status: 409 });
    }

    const actor = (session!.user as any)?.dbId ?? null;
    await prisma.$transaction([
      prisma.$executeRawUnsafe(
        `UPDATE "ExitSettlement"
            SET finalised = TRUE,
                "finalisedAt" = now(),
                "finalisedById" = $1,
                "updatedAt" = now()
          WHERE id = $2`,
        actor, rows[0].id,
      ),
      prisma.$executeRawUnsafe(
        `UPDATE "EmployeeExit"
            SET "finalSettlementDone" = TRUE,
                "updatedAt" = now()
          WHERE id = $1`,
        id,
      ),
      prisma.$executeRawUnsafe(
        `INSERT INTO "ExitNote" ("exitId", "authorId", body)
           VALUES ($1, $2, 'Settlement finalised.')`,
        id, actor,
      ),
    ]);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[POST /api/hr/exits/:id/settlement/finalise] failed:", e);
    return NextResponse.json({ error: e?.message || "Finalise failed" }, { status: 500 });
  }
}
