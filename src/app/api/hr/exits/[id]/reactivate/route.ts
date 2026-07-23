// POST /api/hr/exits/[id]/reactivate — HR brings an offboarded employee
// back into active status. Flips User.isActive=true and removes the exit
// row so they reappear in active directories and can sign in again.
// All their historical data (attendance / leaves / notes / etc.) stays
// untouched — only the offboard "tombstone" goes away.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

// Use canonical isHRAdmin helper. Inline copy omitted
// special_access — restored by switching to the helper.
const canManage = (session: any) => isHRAdmin(session?.user);

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    // Pull the exit row so we know which user to reactivate.
    const exitRow = await prisma.$queryRawUnsafe<Array<{ id: number; userId: number }>>(
      `SELECT id, "userId" FROM "EmployeeExit" WHERE id = $1 LIMIT 1`,
      id,
    );
    if (exitRow.length === 0) {
      return NextResponse.json({ error: "Exit record not found" }, { status: 404 });
    }
    const { userId } = exitRow[0];

    // Single transaction: flip isActive back to true AND delete the
    // exit row so the user is fully restored. Their attendance / leaves
    // / posts / etc. stay where they are.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data:  { isActive: true },
      }),
      prisma.$executeRawUnsafe(
        `DELETE FROM "EmployeeExit" WHERE id = $1`,
        id,
      ),
    ]);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[POST /api/hr/exits/:id/reactivate] failed:", e);
    return NextResponse.json({ error: e?.message || "Reactivate failed" }, { status: 500 });
  }
}
