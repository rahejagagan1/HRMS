import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin, serverError } from "@/lib/api-auth";

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { errorResponse } = await requireAdmin();
        if (errorResponse) return errorResponse;

        const syncTypes = ["all", "clickup", "youtube", "ratings", "users"];

        // Single query instead of 5 sequential queries (N+1 fix)
        const rows = await prisma.syncLog.findMany({
            where: {
                syncType: { in: syncTypes },
                status: { in: ["success", "partial"] },
            },
            orderBy: { completedAt: "desc" },
            select: { syncType: true, completedAt: true },
            take: 50, // enough to cover all types with buffer
        });

        // Build map — first occurrence per type is the most recent (ordered desc)
        const lastSyncs: Record<string, string | null> = Object.fromEntries(
            syncTypes.map((t) => [t, null])
        );
        for (const row of rows) {
            if (lastSyncs[row.syncType] === null && row.completedAt) {
                lastSyncs[row.syncType] = row.completedAt.toISOString();
            }
        }

        return NextResponse.json(lastSyncs);
    } catch (error) {
        return serverError(error, "admin/sync-status GET");
    }
}
