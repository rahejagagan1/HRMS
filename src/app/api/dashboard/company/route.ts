import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { cachedFetch } from "@/lib/cache";
import { CHANNELS } from "@/lib/constants";
import { requireAuth, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const data = await cachedFetch("dashboard:company", async () => {
            // ✅ All independent queries run in parallel (was sequential before)
            const [
                totalCases,
                completedCases,
                totalUsers,
                allChannelCases,
                capsules,
                topWriters,
                topEditors,
                lastSync,
            ] = await Promise.all([
                prisma.case.count(),
                prisma.case.count({ where: { statusType: "closed" } }),
                prisma.user.count(),
                // ✅ Single query for ALL channels (was N+1 loop before)
                prisma.case.findMany({
                    where: { channel: { in: [...CHANNELS] } },
                    select: {
                        channel: true,
                        id: true,
                        youtubeStats: { select: { viewCount: true } },
                    },
                }),
                prisma.capsule.findMany({
                    include: {
                        productionLists: {
                            include: {
                                cases: { select: { id: true, statusType: true } },
                            },
                        },
                    },
                }),
                prisma.monthlyRating.findMany({
                    where: { roleType: "writer", user: { isActive: true } },
                    orderBy: { overallRating: "desc" },
                    take: 10,
                    include: {
                        user: { select: { name: true, profilePictureUrl: true } },
                    },
                }),
                prisma.monthlyRating.findMany({
                    where: { roleType: "editor", user: { isActive: true } },
                    orderBy: { overallRating: "desc" },
                    take: 10,
                    include: {
                        user: { select: { name: true, profilePictureUrl: true } },
                    },
                }),
                prisma.syncLog.findFirst({
                    orderBy: { startedAt: "desc" },
                }),
            ]);

            // Group channel cases in JS (instead of N separate DB queries)
            const channelMap = new Map<string, { count: number; totalViews: number }>();
            for (const ch of CHANNELS) {
                channelMap.set(ch, { count: 0, totalViews: 0 });
            }
            for (const c of allChannelCases) {
                const entry = channelMap.get(c.channel || "");
                if (entry) {
                    entry.count++;
                    entry.totalViews += Number(c.youtubeStats?.viewCount || 0);
                }
            }
            const channelStats = CHANNELS.map((ch) => {
                const entry = channelMap.get(ch)!;
                return {
                    channel: ch,
                    casesCount: entry.count,
                    totalViews: entry.totalViews,
                    avgViews: entry.count > 0 ? Math.round(entry.totalViews / entry.count) : 0,
                };
            });

            // Capsule stats
            const capsuleStats = capsules.map((cap) => {
                const cases = cap.productionLists.flatMap((l) => l.cases);
                return {
                    id: cap.id,
                    name: cap.shortName || cap.name,
                    totalCases: cases.length,
                    completedCases: cases.filter((c) => c.statusType === "closed").length,
                };
            });

            return {
                kpis: {
                    totalCases,
                    completedCases,
                    activeCases: totalCases - completedCases,
                    totalUsers,
                },
                channelStats,
                capsuleStats,
                leaderboard: { topWriters, topEditors },
                lastSync,
            };
        }, 1000 * 60 * 2); // Cache for 2 minutes

        return NextResponse.json(serializeBigInt(data));
    } catch (error) {
        return serverError(error, "dashboard/company GET");
    }
}
