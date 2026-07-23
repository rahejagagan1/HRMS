import { NextRequest, NextResponse } from "next/server";
import { runYoutubeDashboardSync } from "@/lib/youtube/yt-dashboard-sync";
import { serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * POST with Authorization: Bearer CRON_SECRET
 * Runs the same sync as the scheduled job: quarter totals + stored per-channel quarter charts (DB).
 */
export async function POST(request: NextRequest) {
    try {
        const secret = process.env.CRON_SECRET;
        const auth = request.headers.get("authorization");
        if (!secret || auth !== `Bearer ${secret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const result = await runYoutubeDashboardSync();
        return NextResponse.json({
            ok: true,
            ...result,
        });
    } catch (error) {
        console.error("[cron/youtube-dashboard-sync]", error);
        return serverError(error, "cron/youtube-dashboard-sync");
    }
}
