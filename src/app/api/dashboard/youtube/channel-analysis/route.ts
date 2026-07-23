import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { userCanAccessYoutubeDashboard } from "@/lib/youtube-dashboard-access";
import { getChannelConfigs } from "@/lib/youtube/youtube-analytics";
import type { StoredChartJson } from "@/lib/youtube/channel-quarter-analysis";
import { serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET ?channelId=UC…&year=2026&quarter=1
 * Reads pre-computed chart JSON from DB (written by YouTube dashboard cron — same job as quarter totals).
 */
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (!userCanAccessYoutubeDashboard(session.user as any)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const channelId = searchParams.get("channelId")?.trim();
        const year = Math.min(2035, Math.max(2010, parseInt(searchParams.get("year") || "", 10) || 0));
        const quarter = Math.min(4, Math.max(1, parseInt(searchParams.get("quarter") || "", 10) || 0));

        if (!channelId || !year || !quarter) {
            return NextResponse.json(
                { error: "Missing or invalid channelId, year, or quarter" },
                { status: 400 }
            );
        }

        const configs = getChannelConfigs();
        const channel = configs.find((c) => c.channelId === channelId);
        if (!channel) {
            return NextResponse.json({ error: "Channel not found in YOUTUBE_CHANNELS" }, { status: 404 });
        }

        const delegate = prisma.youtubeDashboardChannelQuarterAnalysis;
        if (typeof delegate?.findUnique !== "function") {
            return NextResponse.json(
                {
                    error:
                        "Prisma client is out of date (missing YoutubeDashboardChannelQuarterAnalysis). Run: npx prisma generate — then restart the server, and npx prisma migrate deploy on the DB host.",
                    code: "PRISMA_GENERATE_REQUIRED",
                },
                { status: 503 }
            );
        }

        const quarterDelegate = prisma.youtubeDashboardQuarterMetrics;
        const [row, quarterRow] = await Promise.all([
            delegate.findUnique({
                where: {
                    channelId_year_quarter: { channelId, year, quarter },
                },
            }),
            typeof quarterDelegate?.findUnique === "function"
                ? quarterDelegate.findUnique({
                      where: {
                          channelId_year_quarter: { channelId, year, quarter },
                      },
                  })
                : Promise.resolve(null),
        ]);

        if (!row) {
            return NextResponse.json(
                {
                    error:
                        "No stored chart for this channel and quarter yet. Run YouTube dashboard sync (Admin → Crons → YouTube dashboard quarter sync).",
                    code: "NOT_SYNCED",
                },
                { status: 404 }
            );
        }

        const chart = row.chartJson as unknown as StoredChartJson;
        const buckets = Array.isArray(chart?.buckets) ? chart.buckets : [];
        const headlineViews =
            row.headlineViews ??
            (buckets.length > 0 ? (buckets[buckets.length - 1]?.views ?? 0) : 0);

        const viewsGainedInQuarter =
            quarterRow?.viewsGainedInQuarter != null ? Number(quarterRow.viewsGainedInQuarter) : null;

        return NextResponse.json({
            channelId,
            channelName: channel.name,
            year,
            quarter,
            analyticsStartStr: chart?.analyticsStartStr ?? "",
            analyticsEndStr: chart?.analyticsEndStr ?? "",
            buckets,
            headlineViews,
            uploadsTotal: typeof chart?.uploadsTotal === "number" ? chart.uploadsTotal : 0,
            fetchedAt: row.fetchedAt?.toISOString() ?? null,
            /** Same field as the production channel strip — YouTube Analytics quarter total from YoutubeDashboardQuarterMetrics. */
            viewsGainedInQuarter,
            quarterAnalyticsStartStr: quarterRow?.analyticsStartStr ?? null,
            quarterAnalyticsEndStr: quarterRow?.analyticsEndStr ?? null,
            quarterMetricsFetchedAt: quarterRow?.fetchedAt?.toISOString() ?? null,
            dataSource: "database" as const,
        });
    } catch (error) {
        console.error("[youtube/channel-analysis]", error);
        return serverError(error, "youtube/channel-analysis");
    }
}
