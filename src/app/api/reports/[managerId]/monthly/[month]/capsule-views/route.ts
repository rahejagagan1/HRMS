import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type Params = Promise<{ managerId: string; month: string }>;
/**
 * GET /api/reports/[managerId]/monthly/[month]/capsule-views?year=2026
 *
 * Strategy:
 * 1. YoutubeStatsHistory deltas (most accurate — views gained in month).
 *    views_gained = last_snapshot_in_month − last_snapshot_before_month, grouped by channel.
 *
 * 2. Fallback → sum last30DaysViews per channel (Case.channel field).
 *    Used when no history snapshots exist yet.
 *    Previous month left blank for manual entry.
 */
export async function GET(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;


        const { month: monthRaw } = await params;
        const month = parseInt(monthRaw); // 0-indexed
        const year  = parseInt(req.nextUrl.searchParams.get("year") ?? "");
        if (isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const toBigInt = (v: bigint | null | undefined): bigint =>
            v != null ? BigInt(v.toString()) : BigInt(0);

        const curMonthStart  = new Date(year, month, 1);
        const curMonthEnd    = new Date(year, month + 1, 0, 23, 59, 59, 999);
        const prevMonthStart = new Date(year, month - 1, 1);

        // ── Step 1: Try YoutubeStatsHistory deltas grouped by channel ────────
        const casesForHistory = await prisma.case.findMany({
            where: { youtubeStats: { isNot: null }, channel: { not: null } },
            select: {
                channel: true,
                youtubeStats: {
                    select: {
                        id: true,
                        history: {
                            where: { snapshotDate: { gte: prevMonthStart, lte: curMonthEnd } },
                            orderBy: { snapshotDate: "asc" },
                            select: { snapshotDate: true, viewCount: true },
                        },
                    },
                },
            },
        });

        // Baseline: last snapshot before prev month per youtube stats id
        const allStatsIds = casesForHistory
            .map(c => c.youtubeStats?.id)
            .filter((id): id is number => id != null);

        const baselineMap = new Map<number, bigint>(); // statsId → viewCount before prev month
        if (allStatsIds.length > 0) {
            // Use groupBy workaround: fetch latest snapshot before prevMonthStart per statsId
            const baselineRows = await prisma.youtubeStatsHistory.findMany({
                where: {
                    youtubeStatsId: { in: allStatsIds },
                    snapshotDate:   { lt: prevMonthStart },
                },
                orderBy: [{ youtubeStatsId: "asc" }, { snapshotDate: "desc" }],
                select: { youtubeStatsId: true, viewCount: true },
            });
            // Keep only the first (latest) entry per statsId (already sorted desc by date)
            const seen = new Set<number>();
            for (const row of baselineRows) {
                if (!seen.has(row.youtubeStatsId)) {
                    seen.add(row.youtubeStatsId);
                    baselineMap.set(row.youtubeStatsId, toBigInt(row.viewCount));
                }
            }
        }

        // Aggregate views gained per channel
        const historyChannelMap = new Map<string, { cur: bigint; prev: bigint }>();

        for (const c of casesForHistory) {
            if (!c.channel || !c.youtubeStats?.id) continue;
            const history = c.youtubeStats.history;
            if (history.length === 0) continue;

            const statsId   = c.youtubeStats.id;
            const baseline  = baselineMap.get(statsId) ?? BigInt(0);
            const channel   = c.channel;

            if (!historyChannelMap.has(channel)) {
                historyChannelMap.set(channel, { cur: BigInt(0), prev: BigInt(0) });
            }
            const agg = historyChannelMap.get(channel)!;

            const prevSnaps = history.filter(h => new Date(h.snapshotDate) < curMonthStart);
            const curSnaps  = history.filter(h => new Date(h.snapshotDate) >= curMonthStart);

            if (prevSnaps.length > 0) {
                const gained = toBigInt(prevSnaps[prevSnaps.length - 1].viewCount) - baseline;
                if (gained > BigInt(0)) agg.prev += gained;
            }
            if (curSnaps.length > 0) {
                const before = prevSnaps.length > 0
                    ? toBigInt(prevSnaps[prevSnaps.length - 1].viewCount)
                    : baseline;
                const gained = toBigInt(curSnaps[curSnaps.length - 1].viewCount) - before;
                if (gained > BigInt(0)) agg.cur += gained;
            }
        }

        const hasHistoryData = Array.from(historyChannelMap.values()).some(
            a => a.cur > BigInt(0) || a.prev > BigInt(0)
        );

        if (hasHistoryData) {
            const views = Array.from(historyChannelMap.entries())
                .filter(([, a]) => a.cur > BigInt(0) || a.prev > BigInt(0))
                .map(([channel, a]) => ({
                    capsule:           channel,
                    currentMonthViews: a.cur  > BigInt(0) ? String(a.cur)  : "",
                    lastMonthViews:    a.prev > BigInt(0) ? String(a.prev) : "",
                }))
                .sort((a, b) => {
                    const bv = BigInt(b.currentMonthViews || "0");
                    const av = BigInt(a.currentMonthViews || "0");
                    return bv > av ? 1 : bv < av ? -1 : 0;
                });
            return NextResponse.json({ views, source: "history" });
        }

        // ── Step 2: Fallback — last30DaysViews grouped by Case.channel ──────
        const fallbackCases = await prisma.case.findMany({
            where: {
                youtubeStats: { isNot: null },
                channel:      { not: null },
            },
            select: {
                channel: true,
                youtubeStats: {
                    select: { last30DaysViews: true, viewCount: true, publishedAt: true },
                },
            },
        });

        const fallbackMap = new Map<string, bigint>(); // channel → total views

        for (const c of fallbackCases) {
            if (!c.channel) continue;
            const l30 = toBigInt(c.youtubeStats?.last30DaysViews);
            if (l30 > BigInt(0)) {
                fallbackMap.set(c.channel, (fallbackMap.get(c.channel) ?? BigInt(0)) + l30);
                continue;
            }
            // Secondary fallback: viewCount of videos published this month
            const pub = c.youtubeStats?.publishedAt ? new Date(c.youtubeStats.publishedAt) : null;
            if (pub && pub >= curMonthStart && pub <= curMonthEnd) {
                const vc = toBigInt(c.youtubeStats?.viewCount);
                if (vc > BigInt(0)) {
                    fallbackMap.set(c.channel, (fallbackMap.get(c.channel) ?? BigInt(0)) + vc);
                }
            }
        }

        const views = Array.from(fallbackMap.entries())
            .filter(([, v]) => v > BigInt(0))
            .map(([channel, v]) => ({
                capsule:           channel,
                currentMonthViews: String(v),
                lastMonthViews:    "", // no history yet — fill manually
            }))
            .sort((a, b) => {
                const bv = BigInt(b.currentMonthViews);
                const av = BigInt(a.currentMonthViews);
                return bv > av ? 1 : bv < av ? -1 : 0;
            });

        return NextResponse.json({ views, source: "last30DaysViews" });
    } catch (error) {
        return serverError(error, "capsule-views");
    }
}
