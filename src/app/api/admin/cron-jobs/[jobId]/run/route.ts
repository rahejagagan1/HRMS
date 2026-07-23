// Generic "Run now" — works for any job in the registry.
//   POST /api/admin/cron-jobs/<jobId>/run
// Stamps `lastManualRunAt` (not lastAutoRunAt) so manual runs don't
// reset the automatic interval.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCronJobsConfig, saveCronJobsConfig } from "@/lib/cron-jobs-config";
import { CRON_JOB_IDS, type CronJobId } from "@/lib/cron-jobs-registry";
import { CRON_JOB_RUNNERS } from "@/lib/cron-jobs-runners";
import { serverError } from "@/lib/api-auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // long syncs (ClickUp / ratings) can take a while

function canManage(session: any): boolean {
    const u = session?.user as any;
    return u?.orgLevel === "ceo" || u?.isDeveloper === true;
}

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ jobId: string }> },
) {
    try {
        const session = await getServerSession(authOptions);
        if (!canManage(session)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const { jobId } = await params;
        if (!CRON_JOB_IDS.includes(jobId as CronJobId)) {
            return NextResponse.json({ error: "Unknown job id" }, { status: 400 });
        }
        const id = jobId as CronJobId;

        const log = await prisma.syncLog.create({
            data: { syncType: id, status: "running" },
        });

        try {
            await CRON_JOB_RUNNERS[id]();
            await prisma.syncLog.update({
                where: { id: log.id },
                data: { status: "success", completedAt: new Date() },
            });
        } catch (runError) {
            await prisma.syncLog.update({
                where: { id: log.id },
                data: { status: "error", completedAt: new Date() },
            });
            throw runError;
        }

        const cfg = await getCronJobsConfig();
        cfg[id] = { ...cfg[id], lastManualRunAt: new Date().toISOString() };
        await saveCronJobsConfig(cfg);

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("[admin/cron-jobs/<id>/run]", error);
        return serverError(error, "admin/cron-jobs/run");
    }
}
