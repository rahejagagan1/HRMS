import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import {
    normalizeTeamCapsuleInput,
    findCapsulesMatchingTeamCapsule,
} from "@/lib/capsule-matching";
import { getMonthlyReportWindow } from "@/lib/reports/monthly-window";

export const dynamic = "force-dynamic";

type Params = Promise<{ managerId: string; month: string }>;
/**
 * Auto-fill for PM monthly report section 4 ("Content Performance Review").
 *
 * Returns videos published by the PM's capsule in the REPORT month, ranked by
 * first-30-day views (`last30DaysViews`, falling back to lifetime `viewCount`
 * when the 30-day window hasn't been synced yet).
 *
 * GET /api/reports/[managerId]/monthly/[month]/content-performance?year=YYYY
 *   `month` is 0-indexed (matches the page route).
 */
export async function GET(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;


        const { managerId: managerIdRaw, month: monthRaw } = await params;
        const managerId = parseInt(managerIdRaw);
        const month     = parseInt(monthRaw); // 0-indexed report month
        const year      = parseInt(req.nextUrl.searchParams.get("year") ?? "");

        if (isNaN(managerId) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        // Use the same reporting window as Section 2 (day 4 of month → day 3 of next month)
        // so the video count here matches the Videos Published auto-fill exactly.
        const { windowStart: analysisStart, windowEnd: analysisEnd } = getMonthlyReportWindow(year, month);

        const manager = await prisma.user.findUnique({
            where: { id: managerId },
            select: { teamCapsule: true },
        });
        const tc = normalizeTeamCapsuleInput(manager?.teamCapsule ?? "");
        if (!tc) {
            return NextResponse.json({
                totalViews: "0",
                videos: [],
                reason: "Manager has no teamCapsule assigned",
            });
        }

        // Resolve teamCapsule → production lists (same logic as data-resolver).
        let listIds: number[] = [];
        const listsByExactName = await prisma.productionList.findMany({
            where: { name: { equals: tc, mode: "insensitive" } },
            select: { id: true },
        });
        if (listsByExactName.length > 0) {
            listIds = listsByExactName.map((l) => l.id);
        } else {
            const capsules = await findCapsulesMatchingTeamCapsule(tc);
            if (capsules.length > 0) {
                const lists = await prisma.productionList.findMany({
                    where: { capsuleId: { in: capsules.map((c) => c.id) } },
                    select: { id: true },
                });
                listIds = lists.map((l) => l.id);
            }
        }

        if (listIds.length === 0) {
            return NextResponse.json({
                totalViews: "0",
                videos: [],
                reason: `teamCapsule "${tc}" matched no production lists or capsules`,
            });
        }

        const cases = await prisma.case.findMany({
            where: {
                productionListId: { in: listIds },
                youtubeStats: {
                    is: { publishedAt: { gte: analysisStart, lte: analysisEnd } },
                },
            },
            select: {
                id: true,
                name: true,
                channel: true,
                productionList: {
                    select: { capsule: { select: { name: true, shortName: true } } },
                },
                youtubeStats: {
                    select: {
                        videoTitle: true,
                        videoUrl: true,
                        viewCount: true,
                        last30DaysViews: true,
                        publishedAt: true,
                    },
                },
            },
        });

        const toBig = (v: bigint | null | undefined): bigint =>
            v != null ? BigInt(v.toString()) : BigInt(0);

        // Rank by last30DaysViews; fall back to lifetime viewCount when the
        // first-30-day sync hasn't landed yet so brand-new videos still sort.
        const ranked = cases
            .map((c) => {
                const yt = c.youtubeStats!;
                const first30 = toBig(yt.last30DaysViews);
                const lifetime = toBig(yt.viewCount);
                const views = first30 > BigInt(0) ? first30 : lifetime;
                const capsuleName =
                    c.productionList?.capsule?.name ??
                    c.productionList?.capsule?.shortName ??
                    c.channel ??
                    "";
                return {
                    caseId: c.id,
                    title: yt.videoTitle || c.name,
                    videoUrl: yt.videoUrl,
                    views: String(views),
                    capsule: capsuleName,
                    publishedAt: yt.publishedAt,
                };
            })
            .filter((v) => BigInt(v.views) > BigInt(0))
            .sort((a, b) => {
                const av = BigInt(a.views);
                const bv = BigInt(b.views);
                return bv > av ? 1 : bv < av ? -1 : 0;
            });

        const total = ranked.reduce((sum, v) => sum + BigInt(v.views), BigInt(0));

        // Top 3 (highest). Bottom 3 (lowest, ascending), de-duped vs top.
        const top3 = ranked.slice(0, 3);
        const topIds = new Set(top3.map((v) => v.caseId));
        const bottom3 = [...ranked]
            .reverse()
            .filter((v) => !topIds.has(v.caseId))
            .slice(0, 3);

        return NextResponse.json({
            totalViews: String(total),
            videos: ranked,
            top3,
            bottom3,
            analysisMonth: { year, month },
        });
    } catch (error) {
        return serverError(error, "content-performance");
    }
}
