import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { listConfiguredChannels } from "@/lib/youtube/channels-config";
import { filterVisibleChannels } from "@/lib/youtube/channel-visibility";

export const dynamic = "force-dynamic";

/**
 * Per-channel current-quarter / year-to-date view totals + their
 * HR-set targets. Visible to any authenticated user — this powers
 * the dashboard tile every employee sees, not an HR-admin surface.
 *
 * Calendar quarters: Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec.
 *
 * Year-to-date views = sum of all quarter buckets for the current
 * calendar year up to and including the current quarter — exactly
 * what the YoutubeDashboardQuarterMetrics table stores per channel.
 */
export async function GET() {
    try {
        const { session, errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;
        void session;

        const now = new Date();
        const year = now.getUTCFullYear();
        const month = now.getUTCMonth(); // 0-based
        const quarter = Math.floor(month / 3) + 1;

        const allConfigured = listConfiguredChannels();
        if (allConfigured.length === 0) {
            return NextResponse.json({ channels: [], year, quarter });
        }
        // Capsule-based visibility: each channel is gated to its assigned
        // capsules (M7 + M7CS → C1/C2/C5, Echo 3D → 3D, Bodycam → C4).
        // HR-admin / CEO / Developer / Special Access bypass and see all.
        const configured = await filterVisibleChannels(session!.user, allConfigured);
        if (configured.length === 0) {
            return NextResponse.json({ channels: [], year, quarter, rows: [] });
        }

        // Soft-fail each query so the panel still renders something
        // when:
        //   • YoutubeDashboardQuarterMetrics is empty (cron hasn't
        //     run yet)
        //   • ChannelViewTarget table doesn't exist (HR hasn't run
        //     the migration yet)
        // In both cases callers degrade to 0s for the missing data
        // without losing the configured channel list.
        async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
            try { return await p; } catch (e: any) {
                const code = e?.meta?.code || e?.code;
                const msg = String(e?.meta?.message || e?.message || "");
                if (code === "42P01" || /does not exist|42P01/i.test(msg)) return fallback;
                throw e;
            }
        }
        const [currentQuarterRows, ytdRows, targetRows] = await Promise.all([
            safe(prisma.youtubeDashboardQuarterMetrics.findMany({ where: { year, quarter } }), []),
            safe(prisma.youtubeDashboardQuarterMetrics.findMany({ where: { year, quarter: { lte: quarter } } }), []),
            safe(prisma.channelViewTarget.findMany({ where: { year, quarter: { in: [0, quarter] } } }), []),
        ]);

        const currentByChannel = new Map<string, number>();
        for (const row of currentQuarterRows) {
            currentByChannel.set(row.channelId, Number(row.viewsGainedInQuarter ?? 0n));
        }

        const ytdByChannel = new Map<string, number>();
        for (const row of ytdRows) {
            const prev = ytdByChannel.get(row.channelId) ?? 0;
            ytdByChannel.set(row.channelId, prev + Number(row.viewsGainedInQuarter ?? 0n));
        }

        const quarterTargetByChannel = new Map<string, number>();
        const yearTargetByChannel = new Map<string, number>();
        for (const row of targetRows) {
            if (row.quarter === 0) {
                yearTargetByChannel.set(row.channelId, Number(row.target));
            } else if (row.quarter === quarter) {
                quarterTargetByChannel.set(row.channelId, Number(row.target));
            }
        }

        const channels = configured.map((c) => ({
            channelId: c.channelId,
            channelName: c.name,
            quarterViews: currentByChannel.get(c.channelId) ?? 0,
            yearViews:    ytdByChannel.get(c.channelId) ?? 0,
            quarterTarget: quarterTargetByChannel.get(c.channelId) ?? 0,
            yearTarget: yearTargetByChannel.get(c.channelId) ?? 0,
            quarter,
            year,
        }));
        // Page-friendly alias: same data keyed by quarter (0 = year so far).
        // The admin editor reads this to render the "currently 124,500"
        // hint under each input.
        const pageRows = configured.map((c) => ({
            channelId: c.channelId,
            channelName: c.name,
            year,
            currentViews: {
                0: ytdByChannel.get(c.channelId) ?? 0,
                1: quarter === 1 ? (currentByChannel.get(c.channelId) ?? 0) : null,
                2: quarter === 2 ? (currentByChannel.get(c.channelId) ?? 0) : null,
                3: quarter === 3 ? (currentByChannel.get(c.channelId) ?? 0) : null,
                4: quarter === 4 ? (currentByChannel.get(c.channelId) ?? 0) : null,
            },
        }));

        // Company-wide aggregate over EVERY configured channel (not just the
        // ones this viewer can see individually). The "All channels" tab uses
        // this so anyone with access to the tile sees the full target picture,
        // even if their per-channel tabs are capsule-limited.
        let aQV = 0, aYV = 0, aQT = 0, aYT = 0;
        for (const c of allConfigured) {
            aQV += currentByChannel.get(c.channelId) ?? 0;
            aYV += ytdByChannel.get(c.channelId) ?? 0;
            aQT += quarterTargetByChannel.get(c.channelId) ?? 0;
            aYT += yearTargetByChannel.get(c.channelId) ?? 0;
        }
        const allTotals = {
            quarterViews: aQV,
            yearViews: aYV,
            quarterTarget: aQT > 0 ? aQT : null,
            yearTarget: aYT > 0 ? aYT : null,
        };

        return NextResponse.json({ channels, allTotals, year, quarter, rows: pageRows });
    } catch (error) {
        return serverError(error, "GET /api/me/view-targets");
    }
}
