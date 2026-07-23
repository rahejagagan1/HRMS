import { serverError } from "@/lib/api-auth";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { cachedFetch } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const data = await cachedFetch("dashboard:my", async () => {
            // All queries already run in parallel — good!
            const [recentCases, totalCases, completedCases, recentSubtasks] =
                await Promise.all([
                    prisma.case.findMany({
                        take: 20,
                        orderBy: { dateCreated: "desc" },
                        select: {
                            id: true,
                            name: true,
                            status: true,
                            statusType: true,
                            channel: true,
                            dateCreated: true,
                            tat: true,
                            writer: { select: { id: true, name: true } },
                            editor: { select: { id: true, name: true } },
                            youtubeStats: {
                                select: { viewCount: true, likeCount: true },
                            },
                            productionList: {
                                select: {
                                    name: true,
                                    capsule: { select: { shortName: true } },
                                },
                            },
                        },
                    }),
                    prisma.case.count(),
                    prisma.case.count({ where: { statusType: "closed" } }),
                    prisma.subtask.findMany({
                        take: 10,
                        orderBy: { dateDone: "desc" },
                        where: { dateDone: { not: null } },
                        select: {
                            id: true,
                            name: true,
                            status: true,
                            dateDone: true,
                            case: { select: { name: true } },
                            assignee: { select: { name: true } },
                        },
                    }),
                ]);

            return {
                summary: {
                    totalCases,
                    completedCases,
                    activeCases: totalCases - completedCases,
                },
                recentCases,
                recentActivity: recentSubtasks,
            };
        }, 1000 * 60 * 2); // Cache for 2 minutes

        return NextResponse.json(serializeBigInt(data));
    } catch (error) {
        return serverError(error, "route");
    }
}
