// ⚠️  DEPRECATED — DO NOT USE
//
// This was the original hardcoded calculator. It has been superseded by:
//   - src/lib/ratings/unified-calculator.ts  (active, config-driven)
//   - src/lib/ratings/writer-calculator.ts   (fallback)
//   - src/lib/ratings/editor-calculator.ts   (fallback)
//
// This file is kept only for historical reference and will be removed
// in a future cleanup. Nothing in the codebase should import from here.
// If you see a runtime call here, it is a bug — please fix the call site.

import prisma from "@/lib/prisma";
import { avg } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";

interface CaseWithStats {
    scriptQualityRating: Decimal | null;
    writerQualityScore: number | null;
    writerDeliveryTime: string | null;
    writerEfficiencyScore: string | null;
    videoQualityRating: Decimal | null;
    editorQualityScore: number | null;
    editorDeliveryTime: string | null;
    editorEfficiencyScore: string | null;
    youtubeStats?: { viewCount: bigint | null } | null;
}

// ═══ Helper Functions ═══

function efficiencyToScore(efficiency: string | null): number {
    if (!efficiency) return 0;
    if (efficiency.startsWith("Full")) return 5;
    if (efficiency.startsWith("Moderate")) return 3;
    if (efficiency.startsWith("Low")) return 1;
    return 0;
}

function deliveryToScore(delivery: string | null): number {
    if (!delivery) return 0;
    if (delivery === "On Time") return 5;
    if (delivery === "1 day late") return 3;
    if (delivery === "More than 1 day late") return 1;
    return 0;
}

function normalizeQualityScore(score: number | null): number {
    if (!score) return 0;
    return Math.min((score / 100) * 5, 5);
}

function ytViewsToScore(views: bigint | null | undefined): number {
    if (!views) return 0;
    const v = Number(views);
    if (v >= 1_000_000) return 5;
    if (v >= 500_000) return 4.5;
    if (v >= 200_000) return 4;
    if (v >= 100_000) return 3.5;
    if (v >= 50_000) return 3;
    if (v >= 20_000) return 2.5;
    if (v >= 10_000) return 2;
    return 1;
}

function toNum(val: Decimal | null | undefined): number | null {
    if (val === null || val === undefined) return null;
    return Number(val);
}

// ═══ Writer Monthly Rating Formula ═══
function calculateWriterRating(cases: CaseWithStats[]): number {
    if (cases.length === 0) return 0;

    const avgScriptQuality = avg(cases.map((c) => toNum(c.scriptQualityRating)));
    const avgWriterQuality = avg(
        cases.map((c) => normalizeQualityScore(c.writerQualityScore))
    );
    const deliveryRate =
        cases.filter((c) => c.writerDeliveryTime === "On Time").length / cases.length;
    const avgEfficiency = avg(
        cases.map((c) => efficiencyToScore(c.writerEfficiencyScore))
    );

    return (
        avgScriptQuality * 0.4 +
        avgWriterQuality * 0.25 +
        deliveryRate * 5 * 0.2 +
        avgEfficiency * 0.15
    );
}

// ═══ Editor Monthly Rating Formula ═══
function calculateEditorRating(cases: CaseWithStats[]): number {
    if (cases.length === 0) return 0;

    const avgVideoQuality = avg(cases.map((c) => toNum(c.videoQualityRating)));
    const avgEditorQuality = avg(
        cases.map((c) => normalizeQualityScore(c.editorQualityScore))
    );
    const avgYtPerformance = avg(
        cases.map((c) => ytViewsToScore(c.youtubeStats?.viewCount))
    );
    const deliveryAndEfficiency = avg(
        cases.map(
            (c) =>
                (deliveryToScore(c.editorDeliveryTime) +
                    efficiencyToScore(c.editorEfficiencyScore)) /
                2
        )
    );

    return (
        avgVideoQuality * 0.35 +
        avgEditorQuality * 0.25 +
        avgYtPerformance * 0.2 +
        deliveryAndEfficiency * 0.2
    );
}

// ═══ Calculate & Store Monthly Ratings ═══
export async function calculateMonthlyRatings(
    month?: Date
): Promise<number> {
    const targetMonth = month || new Date();
    const monthStart = new Date(
        targetMonth.getFullYear(),
        targetMonth.getMonth(),
        1
    );
    const monthEnd = new Date(
        targetMonth.getFullYear(),
        targetMonth.getMonth() + 1,
        0,
        23,
        59,
        59
    );

    let count = 0;

    // Get all writers with completed cases this month
    const writers = await prisma.user.findMany({
        where: {
            writtenCases: {
                some: {
                    dateDone: { gte: monthStart, lte: monthEnd },
                },
            },
        },
        select: { id: true },
    });

    for (const writer of writers) {
        const cases = await prisma.case.findMany({
            where: {
                writerUserId: writer.id,
                dateDone: { gte: monthStart, lte: monthEnd },
            },
            include: { youtubeStats: true },
        });

        const rating = calculateWriterRating(cases);

        const totalViews = cases.reduce((sum, c) => {
            return sum + BigInt(c.youtubeStats?.viewCount || 0);
        }, BigInt(0));

        await prisma.monthlyRating.upsert({
            where: {
                userId_month_roleType: {
                    userId: writer.id,
                    month: monthStart,
                    roleType: "writer",
                },
            },
            create: {
                userId: writer.id,
                month: monthStart,
                roleType: "writer",
                casesCompleted: cases.length,
                avgQualityScore: avg(cases.map((c) => toNum(c.scriptQualityRating))),
                avgDeliveryScore: avg(
                    cases.map((c) => deliveryToScore(c.writerDeliveryTime))
                ),
                avgEfficiencyScore: avg(
                    cases.map((c) => efficiencyToScore(c.writerEfficiencyScore))
                ),
                totalViews: totalViews,
                overallRating: rating,
                calculatedAt: new Date(),
            },
            update: {
                casesCompleted: cases.length,
                avgQualityScore: avg(cases.map((c) => toNum(c.scriptQualityRating))),
                avgDeliveryScore: avg(
                    cases.map((c) => deliveryToScore(c.writerDeliveryTime))
                ),
                avgEfficiencyScore: avg(
                    cases.map((c) => efficiencyToScore(c.writerEfficiencyScore))
                ),
                totalViews: totalViews,
                overallRating: rating,
                calculatedAt: new Date(),
            },
        });
        count++;
    }

    // Get all editors with completed cases this month
    const editors = await prisma.user.findMany({
        where: {
            editedCases: {
                some: {
                    dateDone: { gte: monthStart, lte: monthEnd },
                },
            },
        },
        select: { id: true },
    });

    for (const editor of editors) {
        const cases = await prisma.case.findMany({
            where: {
                editorUserId: editor.id,
                dateDone: { gte: monthStart, lte: monthEnd },
            },
            include: { youtubeStats: true },
        });

        const rating = calculateEditorRating(cases);

        const totalViews = cases.reduce((sum, c) => {
            return sum + BigInt(c.youtubeStats?.viewCount || 0);
        }, BigInt(0));

        await prisma.monthlyRating.upsert({
            where: {
                userId_month_roleType: {
                    userId: editor.id,
                    month: monthStart,
                    roleType: "editor",
                },
            },
            create: {
                userId: editor.id,
                month: monthStart,
                roleType: "editor",
                casesCompleted: cases.length,
                avgQualityScore: avg(cases.map((c) => toNum(c.videoQualityRating))),
                avgDeliveryScore: avg(
                    cases.map((c) => deliveryToScore(c.editorDeliveryTime))
                ),
                avgEfficiencyScore: avg(
                    cases.map((c) => efficiencyToScore(c.editorEfficiencyScore))
                ),
                totalViews: totalViews,
                overallRating: rating,
                calculatedAt: new Date(),
            },
            update: {
                casesCompleted: cases.length,
                avgQualityScore: avg(cases.map((c) => toNum(c.videoQualityRating))),
                avgDeliveryScore: avg(
                    cases.map((c) => deliveryToScore(c.editorDeliveryTime))
                ),
                avgEfficiencyScore: avg(
                    cases.map((c) => efficiencyToScore(c.editorEfficiencyScore))
                ),
                totalViews: totalViews,
                overallRating: rating,
                calculatedAt: new Date(),
            },
        });
        count++;
    }

    // Calculate ranks within each role — active users only so ranks read
    // 1..N without gaps from people who left the company.
    const allRatings = await prisma.monthlyRating.findMany({
        where: { month: monthStart, user: { isActive: true } },
        orderBy: { overallRating: "desc" },
    });

    const roleGroups: Record<string, typeof allRatings> = {};
    for (const r of allRatings) {
        if (!roleGroups[r.roleType]) roleGroups[r.roleType] = [];
        roleGroups[r.roleType].push(r);
    }

    for (const [, ratings] of Object.entries(roleGroups)) {
        for (let i = 0; i < ratings.length; i++) {
            await prisma.monthlyRating.update({
                where: { id: ratings[i].id },
                data: { rankInRole: i + 1 },
            });
        }
    }

    return count;
}
