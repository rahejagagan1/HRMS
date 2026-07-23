// ═══════════════════════════════════════════════════════
// Editor Calculator
//
// ACTIVE PATH: The calculate route now uses unified-calculator.ts.
// This file is kept as FALLBACK only.
//
// Bug fixes vs original version:
// - Configs loaded ONCE per batch (not per-user)
// - User names fetched in ONE query
// - Rank updates in a single $transaction
// - Proper error logging (no silent catch {})
// - Editor-specific matrix key
// - manualRatingsPending requires ALL question sets answered
// ═══════════════════════════════════════════════════════

import prisma from "@/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import {
    getMonthlyTargetsMatrix,
    computeMonthlyTargetsScore,
    getFinalScoreBrackets,
    scoreToFinalStars,
    type MonthlyTargetsMatrix,
} from "./writer-calculator";
import { getMonthlyReportWindow } from "@/lib/reports/monthly-window";

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

interface Bracket {
    min: number;
    max: number;
    stars: number;
}

interface EditorWeights {
    editorQuality:  number;
    videoQuality:   number;
    ownership:      number;
    monthlyTargets: number;
    youtubeViews:   number;
}

// ═══════════════════════════════════════════════════════
// Defaults
// ═══════════════════════════════════════════════════════

const DEFAULT_EDITOR_WEIGHTS: EditorWeights = {
    editorQuality:  0.20,
    videoQuality:   0.25,
    ownership:      0.15,
    monthlyTargets: 0.15,
    youtubeViews:   0.25,
};

const DEFAULT_EDITOR_QUALITY_BRACKETS: Bracket[] = [
    { min: 0,  max: 29, stars: 1 },
    { min: 30, max: 34, stars: 2 },
    { min: 35, max: 39, stars: 3 },
    { min: 40, max: 44, stars: 4 },
    { min: 45, max: 50, stars: 5 },
];

const DEFAULT_YT_VIEWS_BRACKETS: Bracket[] = [
    { min: 0,   max: 50,          stars: 1 },
    { min: 51,  max: 95,          stars: 2 },
    { min: 95,  max: 105,         stars: 3 },
    { min: 105, max: 200,         stars: 4 },
    { min: 201, max: Number.MAX_SAFE_INTEGER, stars: 5 },
];

// ═══════════════════════════════════════════════════════
// Config loaders
// ═══════════════════════════════════════════════════════

export async function getEditorWeights(): Promise<EditorWeights> {
    try {
        const config = await prisma.ratingConfig.findUnique({ where: { key: "editor_weights" } });
        if (config?.value) return config.value as unknown as EditorWeights;
    } catch (err) {
        console.warn("[EditorCalc] Could not load editor_weights, using defaults:", err);
    }
    return DEFAULT_EDITOR_WEIGHTS;
}

export async function getEditorQualityBrackets(): Promise<Bracket[]> {
    try {
        const config = await prisma.ratingConfig.findUnique({ where: { key: "editor_quality_brackets" } });
        if (config?.value) return config.value as unknown as Bracket[];
    } catch (err) {
        console.warn("[EditorCalc] Could not load editor_quality_brackets, using defaults:", err);
    }
    return DEFAULT_EDITOR_QUALITY_BRACKETS;
}

export async function getEditorYtViewsBrackets(): Promise<Bracket[]> {
    try {
        const config = await prisma.ratingConfig.findUnique({ where: { key: "yt_views_brackets" } });
        if (config?.value) return config.value as unknown as Bracket[];
    } catch (err) {
        console.warn("[EditorCalc] Could not load yt_views_brackets, using defaults:", err);
    }
    return DEFAULT_YT_VIEWS_BRACKETS;
}

// Editor-specific matrix — does NOT share with writer
export async function getEditorMonthlyTargetsMatrix(): Promise<MonthlyTargetsMatrix> {
    try {
        const config = await prisma.ratingConfig.findUnique({ where: { key: "editor_monthly_targets_matrix" } });
        if (config?.value) return config.value as unknown as MonthlyTargetsMatrix;
        // Fall back to shared key for backward compat
        const shared = await prisma.ratingConfig.findUnique({ where: { key: "monthly_targets_matrix" } });
        if (shared?.value) return shared.value as unknown as MonthlyTargetsMatrix;
    } catch (err) {
        console.warn("[EditorCalc] Could not load monthly_targets_matrix, using defaults:", err);
    }
    return getMonthlyTargetsMatrix();
}

// ═══════════════════════════════════════════════════════
// Pure math helpers
// ═══════════════════════════════════════════════════════

function valueToStars(value: number, brackets: Bracket[]): number {
    for (const b of brackets) {
        if (value >= b.min && value <= b.max) return b.stars;
    }
    if (value <= (brackets[0]?.min ?? 0)) return 1;
    return 5;
}

function avg(values: (number | null)[]): number {
    const valid = values.filter((v): v is number => v !== null && !isNaN(v));
    if (valid.length === 0) return 0;
    return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

function customRound(value: number): number {
    if (value === 0) return 0;
    const decimal = value - Math.floor(value);
    return decimal > 0.5 ? Math.ceil(value) : Math.floor(value);
}

// ═══════════════════════════════════════════════════════
// Case qualification
// ═══════════════════════════════════════════════════════

interface QualifiedEditorCase {
    id: number;
    editorQualityScore: number | null;
    videoQualityRating: Decimal | null;
    channel: string | null;
    editorUserId: number | null;
    youtubeStats: {
        viewCount: bigint | null;
        last30DaysViews: bigint | null;
        publishedAt: Date | null;
        youtubeVideoId: string;
    } | null;
}

export async function getQualifiedEditorCases(
    monthStart: Date,
    monthEnd: Date,
    editorId?: number
): Promise<QualifiedEditorCase[]> {
    // Reporting window: day 4 of month M → end of day 3 of month M+1.
    const { windowStart, windowEnd } = getMonthlyReportWindow(
        monthStart.getUTCFullYear(),
        monthStart.getUTCMonth()
    );

    const subtasks = await prisma.subtask.findMany({
        where: {
            name: { contains: "Editing", mode: "insensitive" },
            status: { in: ["done", "complete", "closed"] },
            dateDone: { gte: windowStart, lte: windowEnd },
        },
        select: { caseId: true },
    });

    const caseIds = [...new Set(subtasks.map((s) => s.caseId))];
    if (caseIds.length === 0) return [];

    const caseFilter: any = { id: { in: caseIds } };
    if (editorId) caseFilter.editorUserId = editorId;

    return prisma.case.findMany({
        where: caseFilter,
        select: {
            id: true,
            editorQualityScore: true,
            videoQualityRating: true,
            channel: true,
            editorUserId: true,
            youtubeStats: {
                select: { viewCount: true, last30DaysViews: true, publishedAt: true, youtubeVideoId: true },
            },
        },
    });
}

// ═══════════════════════════════════════════════════════
// Per-parameter result types
// ═══════════════════════════════════════════════════════

export interface EditorParameterResult {
    name: string;
    label: string;
    rawValue: number | null;
    stars: number | null;
    weight: number;
    source: string;
    caseCount?: number;
    details?: string;
}

export interface EditorRatingResult {
    finalScore: number | null;
    finalStars: number | null;
    parameters: EditorParameterResult[];
    casesCompleted: number;
    manualRatingsPending: boolean;
    totalViews: bigint;
}

// ═══════════════════════════════════════════════════════
// Single-user score calculation
// ═══════════════════════════════════════════════════════

export async function calculateEditorScore(
    editorCases: QualifiedEditorCase[],
    editorId: number,
    monthPeriod: string,
    preloadedWeights?: EditorWeights,
    preloadedQualityBrackets?: Bracket[],
    preloadedYtBrackets?: Bracket[],
    preloadedTargetsMatrix?: MonthlyTargetsMatrix,
    preloadedFinalBrackets?: Bracket[],
    preloadedBaselineMap?: Map<string, number>
): Promise<EditorRatingResult> {
    const weights         = preloadedWeights         ?? await getEditorWeights();
    const qualityBrackets = preloadedQualityBrackets ?? await getEditorQualityBrackets();
    const ytBrackets      = preloadedYtBrackets      ?? await getEditorYtViewsBrackets();
    const targetsMatrix   = preloadedTargetsMatrix   ?? await getEditorMonthlyTargetsMatrix();
    const finalBrackets   = preloadedFinalBrackets   ?? await getFinalScoreBrackets();

    let baselineMap = preloadedBaselineMap;
    if (!baselineMap) {
        const baselines = await prisma.channelBaseline.findMany();
        baselineMap = new Map(baselines.map((b) => [b.channelName, Number(b.baselineViews)]));
    }

    const parameters: EditorParameterResult[] = [];

    // ── Editor Quality Score ──
    const qualityScores = editorCases
        .map((c) => c.editorQualityScore)
        .filter((v): v is number => v !== null);

    let editorQualityStars: number | null = null;
    if (qualityScores.length > 0) {
        const avgQuality = avg(qualityScores);
        editorQualityStars = valueToStars(customRound(avgQuality), qualityBrackets);
        parameters.push({
            name: "editorQuality", label: "Editor Quality Score",
            rawValue: Math.round(avgQuality * 100) / 100, stars: editorQualityStars,
            weight: weights.editorQuality, source: "clickup", caseCount: qualityScores.length,
            details: `Avg ${avgQuality.toFixed(1)} / 50 across ${qualityScores.length} cases`,
        });
    } else {
        parameters.push({
            name: "editorQuality", label: "Editor Quality Score",
            rawValue: null, stars: null, weight: weights.editorQuality,
            source: "clickup", caseCount: 0, details: "No data",
        });
    }

    // ── Manager rating ──
    let ownershipStars: number | null = null;
    let videoQualityStars: number | null = null;
    let manualRatingsPending = true;

    try {
        const managerRating = await prisma.managerRating.findFirst({
            where: { userId: editorId, period: monthPeriod, periodType: "monthly" },
            orderBy: { submittedAt: "desc" },
        });

        if (managerRating?.ratingsJson) {
            const rj = managerRating.ratingsJson as Record<string, number>;

            // Video Rating
            const videoKeys = ["video_q1", "video_q2", "video_q3", "video_q4", "video_q5"];
            const videoVals = videoKeys.map((k) => rj[k]).filter((v) => v != null && !isNaN(v)).map(Number);
            if (videoVals.length > 0) {
                const a = videoVals.reduce((s, v) => s + v, 0) / videoVals.length;
                videoQualityStars = customRound(a);
                parameters.push({
                    name: "videoQuality", label: "Video Rating",
                    rawValue: Math.round(a * 100) / 100, stars: videoQualityStars,
                    weight: weights.videoQuality, source: "manager",
                    caseCount: videoVals.length,
                    details: `Avg ${a.toFixed(2)} from ${videoVals.length}/5 questions`,
                });
            } else {
                parameters.push({
                    name: "videoQuality", label: "Video Rating",
                    rawValue: null, stars: null, weight: weights.videoQuality,
                    source: "manager", caseCount: 0, details: "Pending manager input (5 questions)",
                });
            }

            // Ownership
            const ownerKeys = ["ownership_q1", "ownership_q2", "ownership_q3", "ownership_q4", "ownership_q5"];
            const ownerVals = ownerKeys.map((k) => rj[k]).filter((v) => v != null && !isNaN(v)).map(Number);
            if (ownerVals.length > 0) {
                const a = ownerVals.reduce((s, v) => s + v, 0) / ownerVals.length;
                ownershipStars = customRound(a);
            }

            manualRatingsPending = videoVals.length === 0 || ownerVals.length === 0;
        } else {
            parameters.push({
                name: "videoQuality", label: "Video Rating",
                rawValue: null, stars: null, weight: weights.videoQuality,
                source: "manager", caseCount: 0, details: "Pending manager input",
            });
        }
    } catch (err) {
        console.error(`[EditorCalc] Manager rating fetch failed for editor ${editorId}:`, err);
        parameters.push({
            name: "videoQuality", label: "Video Rating",
            rawValue: null, stars: null, weight: weights.videoQuality,
            source: "manager", caseCount: 0, details: "Error fetching manager rating",
        });
    }

    parameters.push({
        name: "ownership", label: "Ownership & Discipline",
        rawValue: ownershipStars, stars: ownershipStars,
        weight: weights.ownership, source: "manager",
        details: ownershipStars !== null ? `${ownershipStars}★ from 5 questions` : "Pending manager input",
    });

    // ── Monthly Targets ──
    const monthlyTargetsStars = computeMonthlyTargetsScore(
        editorCases.length, editorQualityStars, targetsMatrix
    );
    parameters.push({
        name: "monthlyTargets", label: "Monthly Targets",
        rawValue: monthlyTargetsStars, stars: monthlyTargetsStars,
        weight: weights.monthlyTargets, source: "formula", caseCount: editorCases.length,
        details: monthlyTargetsStars !== null
            ? `${editorCases.length} cases × ${editorQualityStars ?? 0}★ quality = ${monthlyTargetsStars}★`
            : "Pending quality score",
    });

    // ── YouTube Views ──
    let ytViewsStars: number | null = null;
    let totalViews = BigInt(0);
    const ytCaseStars: number[] = [];
    const now = new Date();

    for (const c of editorCases) {
        if (!c.youtubeStats) continue;
        const { viewCount, last30DaysViews, publishedAt } = c.youtubeStats;
        totalViews += BigInt(viewCount?.toString() ?? "0");

        if (!publishedAt) { ytCaseStars.push(3); continue; }

        const daysSince = Math.floor(
            (now.getTime() - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSince < 30) { ytCaseStars.push(3); continue; }

        const baseline = c.channel ? baselineMap.get(c.channel) : undefined;
        if (!baseline || baseline === 0) continue;

        const views = last30DaysViews !== null
            ? Number(last30DaysViews.toString())
            : Number(viewCount?.toString() ?? "0");
        ytCaseStars.push(valueToStars((views / baseline) * 100, ytBrackets));
    }

    if (ytCaseStars.length > 0) {
        ytViewsStars = customRound(avg(ytCaseStars));
        parameters.push({
            name: "youtubeViews", label: "YouTube Views Performance",
            rawValue: Math.round(avg(ytCaseStars) * 100) / 100, stars: ytViewsStars,
            weight: weights.youtubeViews, source: "youtube", caseCount: ytCaseStars.length,
            details: `Avg ${ytViewsStars.toFixed(1)}★ across ${ytCaseStars.length} videos`,
        });
    } else {
        ytViewsStars = 3.0;
        parameters.push({
            name: "youtubeViews", label: "YouTube Views Performance",
            rawValue: 3.0, stars: 3.0, weight: weights.youtubeViews,
            source: "youtube", caseCount: 0, details: "Default 3★ — no published videos",
        });
    }

    // ── Final score ──
    let finalScore: number | null = null;
    let finalStars: number | null = null;

    if (!manualRatingsPending) {
        const validParams = parameters.filter((p) => p.stars !== null);
        if (validParams.length > 0) {
            const totalWeight = validParams.reduce((s, p) => s + p.weight, 0);
            const rawScore = validParams.reduce((s, p) => s + p.stars! * (p.weight / totalWeight), 0);
            finalScore = Math.round(rawScore * 100) / 100;
            finalStars = scoreToFinalStars(finalScore, finalBrackets);
        }
    }

    return { finalScore, finalStars, parameters, casesCompleted: editorCases.length, manualRatingsPending, totalViews };
}

// ═══════════════════════════════════════════════════════
// Batch calculation (fallback path only)
// ═══════════════════════════════════════════════════════

export async function calculateAllEditorRatings(
    month?: Date
): Promise<{ count: number; results: { editorId: number; name: string; score: number | null }[] }> {
    const targetMonth = month ?? new Date();
    const y = targetMonth.getUTCFullYear();
    const m = targetMonth.getUTCMonth();
    const monthStart  = new Date(Date.UTC(y, m, 1));
    const monthEnd    = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59));
    const monthPeriod = `${y}-${String(m + 1).padStart(2, "0")}`;

    // ── Load all configs ONCE ──
    const [weights, qualityBrackets, ytBrackets, targetsMatrix, finalBrackets, baselines] =
        await Promise.all([
            getEditorWeights(),
            getEditorQualityBrackets(),
            getEditorYtViewsBrackets(),
            getEditorMonthlyTargetsMatrix(),
            getFinalScoreBrackets(),
            prisma.channelBaseline.findMany(),
        ]);
    const baselineMap = new Map(baselines.map((b) => [b.channelName, Number(b.baselineViews)]));

    // ── All cases in ONE query ──
    const allCases = await getQualifiedEditorCases(monthStart, monthEnd);
    const editorCasesMap = new Map<number, QualifiedEditorCase[]>();
    for (const c of allCases) {
        if (!c.editorUserId) continue;
        const bucket = editorCasesMap.get(c.editorUserId) ?? [];
        bucket.push(c);
        editorCasesMap.set(c.editorUserId, bucket);
    }

    // ── All user names in ONE query ──
    const editorIds = [...editorCasesMap.keys()];
    const editors   = await prisma.user.findMany({
        where: { id: { in: editorIds } },
        select: { id: true, name: true },
    });
    const nameMap = new Map(editors.map((e) => [e.id, e.name]));

    const results: { editorId: number; name: string; score: number | null }[] = [];

    for (const [editorId, cases] of editorCasesMap) {
        try {
            const result = await calculateEditorScore(
                cases, editorId, monthPeriod,
                weights, qualityBrackets, ytBrackets, targetsMatrix, finalBrackets, baselineMap
            );

            await prisma.monthlyRating.upsert({
                where: { userId_month_roleType: { userId: editorId, month: monthStart, roleType: "editor" } },
                create: {
                    userId: editorId, month: monthStart, roleType: "editor",
                    casesCompleted: result.casesCompleted,
                    avgQualityScore: result.parameters.find((p) => p.name === "editorQuality")?.rawValue ?? null,
                    avgDeliveryScore: result.parameters.find((p) => p.name === "videoQuality")?.rawValue ?? null,
                    avgEfficiencyScore: result.parameters.find((p) => p.name === "monthlyTargets")?.rawValue ?? null,
                    totalViews: result.totalViews, overallRating: result.finalScore,
                    writerQualityStars: result.parameters.find((p) => p.name === "editorQuality")?.stars ?? null,
                    scriptQualityStars: result.parameters.find((p) => p.name === "videoQuality")?.stars ?? null,
                    ownershipStars: result.parameters.find((p) => p.name === "ownership")?.stars ?? null,
                    monthlyTargetsStars: result.parameters.find((p) => p.name === "monthlyTargets")?.stars ?? null,
                    ytViewsStars: result.parameters.find((p) => p.name === "youtubeViews")?.stars ?? null,
                    parametersJson: JSON.parse(JSON.stringify(result.parameters)),
                    manualRatingsPending: result.manualRatingsPending, calculatedAt: new Date(),
                },
                update: {
                    casesCompleted: result.casesCompleted,
                    avgQualityScore: result.parameters.find((p) => p.name === "editorQuality")?.rawValue ?? null,
                    avgDeliveryScore: result.parameters.find((p) => p.name === "videoQuality")?.rawValue ?? null,
                    avgEfficiencyScore: result.parameters.find((p) => p.name === "monthlyTargets")?.rawValue ?? null,
                    totalViews: result.totalViews, overallRating: result.finalScore,
                    writerQualityStars: result.parameters.find((p) => p.name === "editorQuality")?.stars ?? null,
                    scriptQualityStars: result.parameters.find((p) => p.name === "videoQuality")?.stars ?? null,
                    ownershipStars: result.parameters.find((p) => p.name === "ownership")?.stars ?? null,
                    monthlyTargetsStars: result.parameters.find((p) => p.name === "monthlyTargets")?.stars ?? null,
                    ytViewsStars: result.parameters.find((p) => p.name === "youtubeViews")?.stars ?? null,
                    parametersJson: JSON.parse(JSON.stringify(result.parameters)),
                    manualRatingsPending: result.manualRatingsPending,
                    calculatedAt: new Date(), isManualOverride: false,
                },
            });

            results.push({ editorId, name: nameMap.get(editorId) ?? "Unknown", score: result.finalScore });
        } catch (err) {
            console.error(`[EditorCalc] Failed for editorId=${editorId}:`, err);
        }
    }

    // Rank update in single transaction — only rank active users so the
    // leaderboard reads 1..N without gaps from people who left the company.
    const editorRatings = await prisma.monthlyRating.findMany({
        where: { month: monthStart, roleType: "editor", user: { isActive: true } },
        select: { id: true, overallRating: true },
        orderBy: { overallRating: "desc" },
    });
    if (editorRatings.length > 0) {
        await prisma.$transaction(
            editorRatings.map((r, i) =>
                prisma.monthlyRating.update({ where: { id: r.id }, data: { rankInRole: i + 1 } })
            )
        );
    }

    return { count: results.length, results };
}
