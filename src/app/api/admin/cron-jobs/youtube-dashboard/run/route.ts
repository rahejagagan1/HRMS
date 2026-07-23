import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCronJobsConfig, saveCronJobsConfig, type CronJobsConfig } from "@/lib/cron-jobs-config";
import { runYoutubeDashboardSync } from "@/lib/youtube/yt-dashboard-sync";
import { serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

function canManage(session: any): boolean {
    const u = session?.user as any;
    return u?.orgLevel === "ceo" || u?.isDeveloper === true;
}

/** POST — CEO / Developer: run YouTube dashboard sync now (does not change lastAutoRunAt) */
export async function POST() {
    try {
        const session = await getServerSession(authOptions);
        if (!canManage(session)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const result = await runYoutubeDashboardSync();

        const cfg = await getCronJobsConfig();
        const next: CronJobsConfig = {
            ...cfg,
            youtube_dashboard: {
                ...cfg.youtube_dashboard,
                lastManualRunAt: new Date().toISOString(),
            },
        };
        await saveCronJobsConfig(next);

        return NextResponse.json({ ok: true, result });
    } catch (error) {
        console.error("[admin/cron-jobs/youtube-dashboard/run]", error);
        return serverError(error, "admin/cron-jobs/youtube-dashboard/run");
    }
}
