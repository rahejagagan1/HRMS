import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/* PATCH — toggle lock/unlock.
 *
 * Auth: admin-only (CEO / developer / special_access). Previously this
 * route only required `requireAuth()`, so any authenticated user could
 * unlock another manager's submitted report by POSTing to this endpoint
 * with `{ isLocked: false }` and re-edit it. requireAdmin() is the
 * shared helper that enforces the admin-tier role check. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { errorResponse } = await requireAdmin();
        if (errorResponse) return errorResponse;


        const { id: idRaw } = await params;
        const id = parseInt(idRaw);
        if (isNaN(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

        const { isLocked, isMonthly } = await req.json();

        if (isMonthly) {
            const report = await prisma.monthlyReport.update({
                where: { id },
                data:  { isLocked },
            });
            return NextResponse.json({ success: true, id: report.id, isLocked: report.isLocked });
        } else {
            const report = await prisma.weeklyReport.update({
                where: { id },
                data:  { isLocked },
            });
            return NextResponse.json({ success: true, id: report.id, isLocked: report.isLocked });
        }
    } catch (error) {
        return serverError(error, "admin/reports/[id] PATCH");
    }
}
