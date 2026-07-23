import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCronJobsConfig, saveCronJobsConfig } from "@/lib/cron-jobs-config";
import { CRON_JOB_DEFINITIONS, CRON_JOB_IDS, type CronJobId } from "@/lib/cron-jobs-registry";
import { serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

function canManage(session: any): boolean {
    const u = session?.user as any;
    return u?.orgLevel === "ceo" || u?.isDeveloper === true;
}

/** GET — CEO / Developer: list every registered cron job with its current state */
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!canManage(session)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const config = await getCronJobsConfig();
        const internalDisabled = process.env.DISABLE_INTERNAL_CRON_SCHEDULER === "true";

        return NextResponse.json({
            internalSchedulerDisabled: internalDisabled,
            serverNote: internalDisabled
                ? "Internal 60s poll is OFF (DISABLE_INTERNAL_CRON_SCHEDULER). Hit the per-job 'Run now' or wire an external cron to /api/cron/youtube-dashboard-sync."
                : "Internal scheduler polls every 60 seconds while this Node process runs (next start). Auto jobs run when enabled below and the interval has passed.",
            jobs: CRON_JOB_DEFINITIONS.map((def) => ({
                id:          def.id,
                name:        def.name,
                description: def.description,
                ...config[def.id],
            })),
        });
    } catch (error) {
        console.error("[admin/cron-jobs GET]", error);
        return serverError(error, "admin/cron-jobs GET");
    }
}

/** PATCH — CEO / Developer: update one or more job settings.
 *  Accepts both legacy shape `{ youtube_dashboard: {…} }` and the
 *  generic shape `{ jobId: "youtube_dashboard", patch: {…} }`. */
export async function PATCH(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!canManage(session)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const body = await request.json().catch(() => ({} as any));
        const current = await getCronJobsConfig();

        // Build a patch-by-id map regardless of which body shape was used.
        const patchById: Partial<Record<CronJobId, Partial<{ enabled: boolean; intervalHours: number; syncPastQuarters: boolean }>>> = {};
        for (const id of CRON_JOB_IDS) {
            if (body?.[id] && typeof body[id] === "object") patchById[id] = body[id];
        }
        if (typeof body?.jobId === "string" && CRON_JOB_IDS.includes(body.jobId)) {
            patchById[body.jobId as CronJobId] = body.patch ?? body;
        }

        for (const [idRaw, patch] of Object.entries(patchById)) {
            const id = idRaw as CronJobId;
            const cur = current[id];
            current[id] = {
                ...cur,
                ...(typeof patch?.enabled === "boolean" ? { enabled: patch.enabled } : {}),
                ...(patch?.intervalHours != null
                    ? {
                          intervalHours: Math.min(168, Math.max(1, Math.floor(Number(patch.intervalHours)) || cur.intervalHours)),
                      }
                    : {}),
                ...(typeof patch?.syncPastQuarters === "boolean" ? { syncPastQuarters: patch.syncPastQuarters } : {}),
            };
        }
        await saveCronJobsConfig(current);

        const fresh = await getCronJobsConfig();
        return NextResponse.json({ ok: true, jobs: fresh });
    } catch (error) {
        console.error("[admin/cron-jobs PATCH]", error);
        return serverError(error, "admin/cron-jobs PATCH");
    }
}
