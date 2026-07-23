import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// Returns the currently running job id (if any), based on SyncLog status.
// Ignores stale "running" entries older than 10 minutes (crashed processes).
export async function GET() {
    try {
        const { errorResponse } = await requireAdmin();
        if (errorResponse) return errorResponse;

        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const running = await prisma.syncLog.findFirst({
            where: {
                status: "running",
                startedAt: { gte: tenMinutesAgo },
            },
            orderBy: { startedAt: "desc" },
            select: { syncType: true, startedAt: true },
        });

        return NextResponse.json({ runningJobId: running?.syncType ?? null });
    } catch (error) {
        return serverError(error, "cron-jobs/running GET");
    }
}
