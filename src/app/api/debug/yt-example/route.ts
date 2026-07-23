import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const YT_BRACKETS = [
    { min: 0, max: 50, stars: 1 },
    { min: 51, max: 95, stars: 2 },
    { min: 95, max: 105, stars: 3 },
    { min: 105, max: 200, stars: 4 },
    { min: 201, max: 999_999_999, stars: 5 },
];

function applyBrackets(value: number, brackets: typeof YT_BRACKETS): number {
    for (const b of brackets) {
        if (value >= b.min && value <= b.max) return b.stars;
    }
    if (brackets.length === 0) return 1;
    const sorted = [...brackets].sort((a, b) => a.min - b.min);
    if (value < sorted[0].min) return sorted[0].stars;
    let best = sorted[0];
    for (const b of sorted) {
        if (b.min <= value) best = b;
    }
    return best.stars;
}

function customRound(value: number): number {
    if (value === 0) return 0;
    const decimal = value - Math.floor(value);
    return decimal > 0.5 ? Math.ceil(value) : Math.floor(value);
}

export async function GET() {
    try {
        // 1. Find a writer or editor with a recent ytViewsStars
        const rating = await prisma.monthlyRating.findFirst({
            where: {
                ytViewsStars: { not: null },
                roleType: { in: ["writer", "editor"] },
            },
            orderBy: { month: "desc" },
            include: {
                user: { select: { id: true, name: true, role: true } },
            },
        });

        if (!rating) {
            return NextResponse.json({ error: "No MonthlyRating found with ytViewsStars" });
        }

        const userId = rating.userId;
        const roleType = rating.roleType;
        const monthDate = new Date(rating.month);
        const monthStart = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1));
        const monthEnd = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0, 23, 59, 59));

        // Grace period: 3 working days into next month
        const nextYear = monthEnd.getUTCMonth() === 11
            ? monthEnd.getUTCFullYear() + 1
            : monthEnd.getUTCFullYear();
        const nextMonth = (monthEnd.getUTCMonth() + 1) % 12;
        let count = 0, day = 1;
        let graceEnd = monthEnd;
        while (count < 3) {
            const d = new Date(Date.UTC(nextYear, nextMonth, day));
            const dow = d.getUTCDay();
            if (dow !== 0 && dow !== 6) {
                count++;
                if (count === 3) graceEnd = new Date(Date.UTC(nextYear, nextMonth, day, 23, 59, 59));
            }
            day++;
        }

        // 2. Get qualified cases (same logic as data-resolver.ts)
        const subtaskName = roleType === "writer" ? "Scripting" : "Editing";
        const subtasks = await prisma.subtask.findMany({
            where: {
                name: { contains: subtaskName, mode: "insensitive" },
                status: { in: ["done", "complete", "closed"] },
                dateDone: { gte: monthStart, lte: graceEnd },
            },
            select: { caseId: true },
        });

        const caseIds = [...new Set(subtasks.map((s) => s.caseId))];
        const userField = roleType === "writer" ? "writerUserId" : "editorUserId";

        const cases = await prisma.case.findMany({
            where: {
                id: { in: caseIds },
                [userField]: userId,
            },
            select: {
                id: true,
                name: true,
                channel: true,
                writerUserId: true,
                editorUserId: true,
                youtubeStats: {
                    select: {
                        viewCount: true,
                        last30DaysViews: true,
                        publishedAt: true,
                        youtubeVideoId: true,
                        videoTitle: true,
                    },
                },
            },
        });

        // 3. Get all channel baselines
        const baselines = await prisma.channelBaseline.findMany();
        const baselineMap = new Map(baselines.map((b) => [b.channelName, Number(b.baselineViews)]));

        // 4. Also load any active FormulaTemplate brackets (in case they differ from defaults)
        const activeTemplate = await prisma.formulaTemplate.findFirst({
            where: { roleType, isActive: true },
            select: { id: true, version: true, sections: true },
        });

        let liveBrackets = YT_BRACKETS;
        let fallbackStars = 3;
        if (activeTemplate?.sections) {
            const sections = activeTemplate.sections as any[];
            const ytSection = sections.find((s: any) => s.type === "yt_baseline_ratio");
            if (ytSection?.brackets) liveBrackets = ytSection.brackets;
            if (ytSection?.yt_fallback_stars !== undefined) fallbackStars = ytSection.yt_fallback_stars;
        }

        // 5. Compute per-case breakdown
        const now = new Date();
        const perCaseBreakdown: any[] = [];
        const caseStars: number[] = [];

        for (const c of cases) {
            const yt = c.youtubeStats;
            const baseline = c.channel ? baselineMap.get(c.channel) : undefined;

            if (!yt) {
                perCaseBreakdown.push({
                    caseId: c.id,
                    caseName: c.name,
                    channel: c.channel,
                    hasYoutubeStats: false,
                    note: "No YouTube stats — case skipped from YT pillar",
                });
                continue;
            }

            const daysSincePublish = yt.publishedAt
                ? Math.floor((now.getTime() - new Date(yt.publishedAt).getTime()) / (1000 * 60 * 60 * 24))
                : null;

            if (!yt.publishedAt || (daysSincePublish !== null && daysSincePublish < 30)) {
                const star = fallbackStars;
                caseStars.push(star);
                perCaseBreakdown.push({
                    caseId: c.id,
                    caseName: c.name,
                    videoTitle: yt.videoTitle,
                    youtubeVideoId: yt.youtubeVideoId,
                    channel: c.channel,
                    publishedAt: yt.publishedAt?.toISOString() ?? null,
                    daysSincePublish,
                    viewCount: yt.viewCount?.toString() ?? null,
                    last30DaysViews: yt.last30DaysViews?.toString() ?? null,
                    baseline: baseline ?? null,
                    status: daysSincePublish === null ? "NO_PUBLISH_DATE" : "TOO_RECENT",
                    assignedStars: star,
                    note: `Fallback ${star}★ — video ${daysSincePublish === null ? "has no publish date" : `only ${daysSincePublish} days old (< 30)`}`,
                });
                continue;
            }

            if (!baseline || baseline === 0) {
                perCaseBreakdown.push({
                    caseId: c.id,
                    caseName: c.name,
                    videoTitle: yt.videoTitle,
                    youtubeVideoId: yt.youtubeVideoId,
                    channel: c.channel,
                    publishedAt: yt.publishedAt?.toISOString(),
                    daysSincePublish,
                    viewCount: yt.viewCount?.toString() ?? null,
                    last30DaysViews: yt.last30DaysViews?.toString() ?? null,
                    baseline: null,
                    status: "NO_BASELINE",
                    note: `No baseline for channel "${c.channel}" — case excluded from average`,
                });
                continue;
            }

            const views = yt.last30DaysViews !== null
                ? Number(yt.last30DaysViews.toString())
                : Number(yt.viewCount?.toString() ?? "0");

            const ratio = (views / baseline) * 100;
            const star = applyBrackets(ratio, liveBrackets);
            caseStars.push(star);

            perCaseBreakdown.push({
                caseId: c.id,
                caseName: c.name,
                videoTitle: yt.videoTitle,
                youtubeVideoId: yt.youtubeVideoId,
                channel: c.channel,
                publishedAt: yt.publishedAt?.toISOString(),
                daysSincePublish,
                viewCount: yt.viewCount?.toString() ?? null,
                last30DaysViews: yt.last30DaysViews?.toString() ?? null,
                viewsUsed: views,
                baseline,
                ratio: Math.round(ratio * 100) / 100,
                ratioFormula: `(${views} / ${baseline}) × 100 = ${(ratio).toFixed(2)}%`,
                bracketMatch: liveBrackets.find((b) => ratio >= b.min && ratio <= b.max) ?? "overflow/underflow",
                assignedStars: star,
                status: "COMPUTED",
            });
        }

        // 6. Compute final average
        const avgStars = caseStars.length > 0
            ? caseStars.reduce((s, v) => s + v, 0) / caseStars.length
            : null;
        const finalStars = avgStars !== null ? customRound(avgStars) : null;

        return NextResponse.json({
            user: {
                id: rating.user.id,
                name: rating.user.name,
                role: rating.user.role,
            },
            monthlyRating: {
                id: rating.id,
                month: rating.month,
                roleType: rating.roleType,
                ytViewsStars: rating.ytViewsStars?.toString(),
                overallRating: rating.overallRating?.toString(),
            },
            period: {
                monthStart: monthStart.toISOString(),
                monthEnd: monthEnd.toISOString(),
                graceEnd: graceEnd.toISOString(),
            },
            qualifiedCasesCount: cases.length,
            casesWithYoutubeStats: cases.filter((c) => c.youtubeStats).length,
            bracketsUsed: liveBrackets,
            fallbackStars,
            channelBaselines: Object.fromEntries(baselineMap),
            perCaseBreakdown,
            summary: {
                casesContributingToAverage: caseStars.length,
                perCaseStars: caseStars,
                rawAverage: avgStars !== null ? Math.round(avgStars * 100) / 100 : null,
                finalStars_customRound: finalStars,
                storedYtViewsStars: rating.ytViewsStars?.toString(),
            },
        });
    } catch (error: any) {
        console.error("[yt-example] Error:", error);
        return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
}
