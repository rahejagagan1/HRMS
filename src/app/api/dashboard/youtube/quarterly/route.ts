import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getChannelConfigs, getFullQuarterDateStrings, getQuarterDateStrings, getChannelSubscriberCounts } from "@/lib/youtube/youtube-analytics";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { serverError } from "@/lib/api-auth";
import { userCanAccessYoutubeDashboard } from "@/lib/youtube-dashboard-access";
import { getUserQuarterContributionsByChannelId } from "@/lib/youtube/quarter-user-contribution";

export const dynamic = "force-dynamic";

/**
 * GET ?year=2026&quarter=1
 *
 * Quarter views: DB (YoutubeDashboardQuarterMetrics) — written by Admin/cron sync via YouTube Analytics.
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
        const now = new Date();
        const defaultYear = now.getUTCFullYear();
        const defaultQuarter = Math.floor(now.getUTCMonth() / 3) + 1;

        const year = Math.min(2035, Math.max(2010, parseInt(searchParams.get("year") || String(defaultYear), 10) || defaultYear));
        const quarter = Math.min(4, Math.max(1, parseInt(searchParams.get("quarter") || String(defaultQuarter), 10) || defaultQuarter));

        const { startStr, endStr, label } = getFullQuarterDateStrings(year, quarter);
        const { startStr: analyticsStartStr, endStr: analyticsEndStr } = getQuarterDateStrings(year, quarter);
        const configs = getChannelConfigs();

        if (configs.length === 0) {
            return NextResponse.json({
                year,
                quarter,
                label,
                startStr,
                endStr,
                analyticsStartStr,
                analyticsEndStr,
                configured: false,
                dataSource: "database" as const,
                lastQuarterViewsSyncedAt: null as string | null,
                channels: [] as {
                    name: string;
                    channelId: string;
                    viewsGainedInQuarter: number | null;
                    error: string | null;
                }[],
                totalViewsGainedInQuarter: null as number | null,
                message: "No YouTube channels configured (YOUTUBE_CHANNELS).",
            });
        }

        const channelIds = configs.map((c) => c.channelId);

        const quarterDelegate = prisma.youtubeDashboardQuarterMetrics;
        if (typeof quarterDelegate?.findMany !== "function") {
            return NextResponse.json(
                {
                    error:
                        "Prisma client is out of date (missing YoutubeDashboardQuarterMetrics). Run: npx prisma generate — then restart the Next.js dev server.",
                    code: "PRISMA_GENERATE_REQUIRED",
                },
                { status: 503 }
            );
        }

        let quarterRows: Awaited<ReturnType<typeof quarterDelegate.findMany>> = [];
        let lastQuarterViewsSyncedAt: string | null = null;
        let displayAnalyticsStart = analyticsStartStr;
        let displayAnalyticsEnd = analyticsEndStr;
        let quarterMetricsTableMissing = false;

        try {
            quarterRows = await quarterDelegate.findMany({
                where: {
                    year,
                    quarter,
                    channelId: { in: channelIds },
                },
            });
            const qmFetchedAgg = await quarterDelegate.aggregate({
                where: { year, quarter, channelId: { in: channelIds } },
                _max: { fetchedAt: true },
            });
            lastQuarterViewsSyncedAt = qmFetchedAgg._max.fetchedAt?.toISOString() ?? null;
            const storedRangeRow = quarterRows.find((r) => channelIds.includes(r.channelId));
            displayAnalyticsStart = storedRangeRow?.analyticsStartStr ?? analyticsStartStr;
            displayAnalyticsEnd = storedRangeRow?.analyticsEndStr ?? analyticsEndStr;
        } catch (err) {
            const isP2021 =
                err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021";
            const table = String((err as Prisma.PrismaClientKnownRequestError).meta?.table ?? "");
            if (isP2021 && table.includes("YoutubeDashboardQuarterMetrics")) {
                quarterMetricsTableMissing = true;
            } else {
                throw err;
            }
        }

        const quarterByChannel = new Map(
            quarterRows.map((r) => [
                r.channelId,
                r.viewsGainedInQuarter != null ? Number(r.viewsGainedInQuarter) : null,
            ])
        );

        const prevQuarter = (y: number, q: number): { year: number; quarter: number } =>
            q <= 1 ? { year: y - 1, quarter: 4 } : { year: y, quarter: q - 1 };

        const dbUserId = (session.user as { dbId?: number }).dbId;
        let contributionsByChannelId = new Map<
            string,
            { videoCount: number; viewsOnVideos: number }
        >();
        if (typeof dbUserId === "number" && Number.isFinite(dbUserId)) {
            const quarterStart = new Date(`${startStr}T00:00:00.000Z`);
            const quarterEnd = new Date(`${endStr}T23:59:59.999Z`);
            try {
                contributionsByChannelId = await getUserQuarterContributionsByChannelId(
                    dbUserId,
                    year,
                    quarter,
                    quarterStart,
                    quarterEnd,
                    configs
                );
            } catch (e) {
                console.error("[youtube/quarterly] user contribution:", e);
            }
        }

        let prevByChannel = new Map<string, number | null>();
        if (!quarterMetricsTableMissing && channelIds.length > 0) {
            const pq = prevQuarter(year, quarter);
            try {
                const prevRows = await quarterDelegate.findMany({
                    where: {
                        year: pq.year,
                        quarter: pq.quarter,
                        channelId: { in: channelIds },
                    },
                });
                prevByChannel = new Map(
                    prevRows.map((r) => [
                        r.channelId,
                        r.viewsGainedInQuarter != null ? Number(r.viewsGainedInQuarter) : null,
                    ])
                );
            } catch {
                /* leave prev empty */
            }
        }

        // Fetch live subscriber counts in one batch request (YouTube Data API, API key only)
        let subscribersByChannelId = new Map<string, number>();
        try {
            subscribersByChannelId = await getChannelSubscriberCounts(channelIds);
        } catch {
            /* non-critical — subscriber counts simply won't appear */
        }

        const channels = configs.map((c) => {
            const viewsGainedInQuarter = quarterByChannel.get(c.channelId) ?? null;
            const viewsPreviousQuarter = prevByChannel.get(c.channelId) ?? null;
            const quarterOverQuarterDelta =
                viewsGainedInQuarter != null && viewsPreviousQuarter != null
                    ? viewsGainedInQuarter - viewsPreviousQuarter
                    : null;
            const me = contributionsByChannelId.get(c.channelId) ?? {
                videoCount: 0,
                viewsOnVideos: 0,
            };
            return {
                name: c.name,
                channelId: c.channelId,
                viewsGainedInQuarter,
                viewsPreviousQuarter,
                quarterOverQuarterDelta,
                subscriberCount: subscribersByChannelId.get(c.channelId) ?? null,
                me,
                error: null as string | null,
            };
        });

        const analyticsValues = channels.map((ch) => ch.viewsGainedInQuarter).filter((v): v is number => v != null);
        const totalViewsGainedInQuarter =
            analyticsValues.length === 0 ? null : analyticsValues.reduce((s, v) => s + v, 0);

        const allGreenMissing = channels.every((ch) => ch.viewsGainedInQuarter == null);
        const anyGreenMissing = channels.some((ch) => ch.viewsGainedInQuarter == null);
        let analyticsNote: string | undefined;
        if (quarterMetricsTableMissing) {
            analyticsNote =
                "The YoutubeDashboardQuarterMetrics table is not in your database yet. On the machine that owns the DB, run: npx prisma migrate deploy — then npx prisma generate. After that, run Admin → Crons → YouTube dashboard sync once to fill green (quarter) totals.";
        } else if (allGreenMissing) {
            analyticsNote =
                "No stored quarter views for this period. Run Admin → Crons → YouTube dashboard sync so Analytics can populate YoutubeDashboardQuarterMetrics (each channel needs OAuth in YOUTUBE_CHANNELS).";
        } else if (anyGreenMissing) {
            analyticsNote =
                "Some channels have no stored quarter row for this period (OAuth/Analytics failed at last sync, or the channel was added later). Green totals include only channels with data.";
        }

        return NextResponse.json({
            year,
            quarter,
            label,
            startStr,
            endStr,
            analyticsStartStr: displayAnalyticsStart,
            analyticsEndStr: displayAnalyticsEnd,
            configured: true,
            dataSource: "database" as const,
            lastQuarterViewsSyncedAt,
            channels,
            totalViewsGainedInQuarter,
            ...(analyticsNote ? { analyticsNote } : {}),
            ...(quarterMetricsTableMissing ? { quarterMetricsTableMissing: true as const } : {}),
        });
    } catch (error) {
        console.error("[youtube/quarterly] GET:", error);
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
            return NextResponse.json(
                {
                    error:
                        "YouTube dashboard tables are missing (e.g. YoutubeDashboardQuarterMetrics). Run: npx prisma migrate deploy (then prisma generate).",
                    code: "MIGRATION_REQUIRED",
                },
                { status: 503 }
            );
        }
        return serverError(error, "youtube/quarterly");
    }
}
