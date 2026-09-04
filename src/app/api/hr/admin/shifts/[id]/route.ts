// DELETE /api/hr/admin/shifts/[id] — remove a shift template.
//
// Refuses while anyone is assigned: UserShift.shiftId has no ON DELETE
// action (Postgres RESTRICT), and silently orphaning people's working-day
// rules would corrupt attendance/auto-LOP decisions anyway. HR reassigns
// those employees to another shift (Apply on a different template) first,
// then deletes. Historical attendance is untouched — verdicts are stored
// on the Attendance rows, and dates before any future shift's
// effectiveFrom fall back to the legacy defaults by design.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireHRAdmin, serverError } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;

  try {
    const id = parseInt((await params).id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<Array<{ id: number; name: string; assigned: number }>>(
      `SELECT s.id, s.name,
              (SELECT COUNT(*) FROM "UserShift" us WHERE us."shiftId" = s.id)::int AS assigned
         FROM "Shift" s WHERE s.id = $1`,
      id,
    );
    const shift = rows[0];
    if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });

    if (shift.assigned > 0) {
      return NextResponse.json(
        {
          error: `"${shift.name}" is assigned to ${shift.assigned} employee${shift.assigned === 1 ? "" : "s"} — ` +
                 `apply a different shift to them first, then delete this template.`,
        },
        { status: 409 },
      );
    }

    await prisma.$executeRawUnsafe(`DELETE FROM "Shift" WHERE id = $1`, id);

    await writeAuditLog({
      req,
      actorId: (session!.user as any)?.dbId ?? null,
      actorEmail: (session!.user as any)?.email ?? null,
      action: "shift.delete",
      entityType: "Shift",
      entityId: id,
      before: { name: shift.name },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/admin/shifts/[id]");
  }
}
