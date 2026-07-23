// ═══════════════════════════════════════════════════════
// Writer Calculator
//
// ACTIVE PATH: The calculate route now uses unified-calculator.ts
// which is config-driven and formula-versioned.
//
// This file is kept as a FALLBACK only. It is called by
// /api/ratings/calculate when no active FormulaTemplate
// exists and unified-calculator cannot seed one.
//
// Bug fixes vs original version:
// - All configs loaded ONCE before the user loop (not per-user)
// - User names fetched in ONE query (not N individual lookups)
// - Rank updates done in a single $transaction
// - Proper error logging (no silent catch {})
// - Writer-specific matrix key (not shared with editors)
// - manualRatingsPending requires ALL question sets to have data
// ═══════════════════════════════════════════════════════

import prisma from "@/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import { getMonthlyReportWindow } from "@/lib/reports/monthly-window";

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

interface Bracket {
    min: number;
    max: number;
    stars: number;
}

interface WriterWeights {
    writerQuality:  number;
    scriptQuality:  number;
    ownership:      number;
    monthlyTargets: number;
    youtubeViews:   number;
}

export interface MonthlyTargetsMatrix {
    [cases: string]: { [quality: string]: number };
}

// ═══════════════════════════════════════════════════════
// Defaults
// ═══════════════════════════════════════════════════════

const DEFAULT_WRITER_WEIGHTS: WriterWeights = {
    writerQuality:  0.20,
    scriptQuality:  0.25,
    ownership:      0.15,
    monthlyTargets: 0.15,
    youtubeViews:   0.25,
};

const DEFAULT_WRITER_QUALITY_BRACKETS: Bracket[] = [
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

const DEFAULT_MONTHLY_TARGETS_MATRIX: MonthlyTargetsMatrix = {
    "2": { "5": 4, "4": 3, "3": 2, "2": 1, "1": 1 },
    "3": { "5": 5, "4": 4, "3": 3, "2": 2, "1": 1 },
    "4": { "5": 5, "4": 5, "3": 3, "2": 2, "1": 1 },
};

export const DEFAULT_FINAL_SCORE_BRACKETS: Bracket[] = [
    { min: 0,  max: 54,  stars: 1 },
    { min: 55, max: 64,  stars: 2 },
    { min: 65, max: 74,  stars: 3 },
    { min: 75, max: 84,  stars: 4 },
    { min: 85, max: 100, stars: 5 },
];

// ═══════════════════════════════════════════════════════
// Config loaders (each catches its own error and logs it)
// ═══════════════════════════════════════════════════════

export async function getWriterWeights(): Promise<WriterWeights> {
    try {
        const config = await prisma.ratingConfig.findUnique({ where: { key: "writer_weights" } });
        if (config?.value) return config.value as unknown as WriterWeights;
    } catch (err) {
        console.warn("[WriterCalc] Could not load writer_weights config, using defaults:", err);
    }
    return DEFAULT_WRITER_WEIGHTS;
}

export async function getWriterQualityBrackets(): Promise<Bracket[]> {
    try {
        const config = await prisma.ratingConfig.findUnique({ where: { key: "writer_quality_brackets" } });
        if (config?.value) return config.value as unknown as Bracket[];
    } catch (err) {
        console.warn("[WriterCalc] Could not load writer_quality_brackets, using defaults:", err);
    }
    return DEFAULT_WRITER_QUALITY_BRACKETS;
}

export async function getYtViewsBrackets(): Promise<Bracket[]> {
    try {
        const config = await prisma.ratingConfig.findUnique({ where: { key: "yt_views_brackets" } });
        if (config?.value) return config.value as unknown as Bracket[];
    } catch (err) {
        console.warn("[WriterCalc] Could not load yt_views_brackets, using defaults:", err);
    }
    return DEFAULT_YT_VIEWS_BRACKETS;
}

// Writer-specific matrix key — does NOT share with editor
export async function getMonthlyTargetsMatrix(): Promise<MonthlyTargetsMatrix> {
    try {
        const config = await prisma.ratingConfig.findUnique({ where: { key: "writer_monthly_targets_matrix" } });
        if (config?.value) return config.value as unknown as MonthlyTargetsMatrix;
        // Fall back to shared key for backward compat
        const shared = await prisma.ratingConfig.findUnique({ where: { key: "monthly_targets_matrix" } });
        if (shared?.value) return shared.value as unknown as MonthlyTargetsMatrix;
    } catch (err) {
        console.warn("[WriterCalc] Could not load monthly_targets_matrix, using defaults:", err);
    }
    return DEFAULT_MONTHLY_TARGETS_MATRIX;
}

export async function getFinalScoreBrackets(): Promise<Bracket[]> {
    try {
        const config = await prisma.ratingConfig.findUnique({ where: { key: "final_score_brackets" } });
        if (config?.value) return config.value as unknown as Bracket[];
    } catch (err) {
        console.warn("[WriterCalc] Could not load final_score_brackets, using defaults:", err);
    }
    return DEFAULT_FINAL_SCORE_BRACKETS;
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

function toNum(val: Decimal | null | undefined): number | null {
    if (val === null || val === undefined) return null;
    return Number(val);
}

export function computeMonthlyTargetsScore(
    casesCompleted: number,
    qualityStars: number | null,
    matrix: MonthlyTargetsMatrix
): number | null {
    if (casesCompleted <= 1) return 0;
    if (qualityStars === null) return null;

    const roundedQuality = Math.round(qualityStars);
    const caseKeys = Object.keys(matrix).map(Number).sort((a, b) => a - b);
    let matchKey: string | null = null;
    for (const ck of caseKeys) {
        if (casesCompleted >= ck) matchKey = String(ck);
    }
    if (!matchKey && caseKeys.length > 0) matchKey = String(caseKeys[caseKeys.length - 1]);
    if (!matchKey) return null;

    const qualityMap = matrix[matchKey];
    if (!qualityMap) return null;
    const qKey = String(Math.min(5, Math.max(1, roundedQuality)));
    return qualityMap[qKey] ?? null;
}

export function scoreToFinalStars(scoreOutOf5: number, brackets: Bracket[]): number {
    const pct = (scoreOutOf5 / 5) * 100;
    for (const b of brackets) {
        if (pct >= b.min && pct <= b.max) return b.stars;
    }
    return pct >= 85 ? 5 : 1;
}

// ═══════════════════════════════════════════════════════
// Case qualification
// ═══════════════════════════════════════════════════════

interface QualifiedCase {
    id: number;
    writerQualityScore: number | null;
    scriptQualityRating: Decimal | null;
    channel: string | null;
    writerUserId: number | null;
    youtubeStats: {
        viewCount: bigint | null;
        last30DaysViews: bigint | null;
        publishedAt: Date | null;
        youtubeVideoId: string;
    } | null;
}

export async function getQualifiedWriterCases(
    monthStart: Date,
    monthEnd: Date,
    writerId?: number
): Promise<QualifiedCase[]> {
    // Reporting window: day 4 of month M → end of day 3 of month M+1.
    const { windowStart, windowEnd } = getMonthlyReportWindow(
        monthStart.getUTCFullYear(),
        monthStart.getUTCMonth()
    );

    const subtasks = await prisma.subtask.findMany({
        where: {
            name: { contains: "Scripting", mode: "insensitive" },
            status: { in: ["done", "complete", "closed"] },
            dateDone: { gte: windowStart, lte: windowEnd },
        },
        select: { caseId: true },
    });

    const caseIds = [...new Set(subtasks.map((s) => s.caseId))];
    if (caseIds.length === 0) return [];

    const caseFilter: any = { id: { in: caseIds } };
    if (writerId) caseFilter.writerUserId = writerId;

    return prisma.case.findMany({
        where: caseFilter,
        select: {
            id: true,
            writerQualityScore: true,
            scriptQualityRating: true,
            channel: true,
            writerUserId: true,
            youtubeStats: {
                select: { viewCount: true, last30DaysViews: true, publishedAt: true, youtubeVideoId: true },
            },
        },
    });
}

// ═══════════════════════════════════════════════════════
// Per-parameter result types
// ═══════════════════════════════════════════════════════

export interface WriterParameterResult {
    name: string;
    label: string;
    rawValue: number | null;
    stars: number | null;
    weight: number;
    source: string;
    caseCount?: number;
    details?: string;
}

export interface WriterRatingResult {
    finalScore: number | null;
    finalStars: number | null;
    parameters: WriterParameterResult[];
    casesCompleted: number;
    manualRatingsPending: boolean;
    totalViews: bigint;
}

// ═══════════════════════════════════════════════════════
// Single-user score calculation
// ═══════════════════════════════════════════════════════

export async function calculateWriterScore(
    writerCases: QualifiedCase[],
    writerId: number,
    monthPeriod: string,
    // Pre-loaded configs (pass from batch caller to avoid per-user DB hits)
    preloadedWeights?: WriterWeights,
    preloadedQualityBrackets?: Bracket[],
    preloadedYtBrackets?: Bracket[],
    preloadedTargetsMatrix?: MonthlyTargetsMatrix,
    preloadedFinalBrackets?: Bracket[],
    preloadedBaselineMap?: Map<string, number>
): Promise<WriterRatingResult> {
    const weights         = preloadedWeights         ?? await getWriterWeights();
    const qualityBrackets = preloadedQualityBrackets ?? await getWriterQualityBrackets();
    const ytBrackets      = preloadedYtBrackets      ?? await getYtViewsBrackets();
    const targetsMatrix   = preloadedTargetsMatrix   ?? await getMonthlyTargetsMatrix();
    const finalBrackets   = preloadedFinalBrackets   ?? await getFinalScoreBrackets();

    let baselineMap = preloadedBaselineMap;
    if (!baselineMap) {
        const baselines = await prisma.channelBaseline.findMany();
        baselineMap = new Map(baselines.map((b) => [b.channelName, Number(b.baselineViews)]));
    }

    const parameters: WriterParameterResult[] = [];

    // ── Parameter 1: Writer Quality Score ──
    const qualityScores = writerCases
        .map((c) => c.writerQualityScore)
        .filter((v): v is number => v !== null);

    let writerQualityStars: number | null = null;
    if (qualityScores.length > 0) {
        const avgQuality = avg(qualityScores);
        writerQualityStars = valueToStars(customRound(avgQuality), qualityBrackets);
        parameters.push({
            name: "writerQuality", label: "Writer Quality Score",
            rawValue: Math.round(avgQuality * 100) / 100, stars: writerQualityStars,
            weight: weights.writerQuality, source: "clickup", caseCount: qualityScores.length,
            details: `Avg ${avgQuality.toFixed(1)} / 50 across ${qualityScores.length} cases`,
        });
    } else {
        parameters.push({
            name: "writerQuality", label: "Writer Quality Score",
            rawValue: null, stars: null, weight: weights.writerQuality,
            source: "clickup", caseCount: 0, details: "No data",
        });
    }

    // ── Manager rating ──
    let ownershipStars: number | null = null;
    let scriptQualityStars: number | null = null;
    let manualRatingsPending = true;

    try {
        const managerRating = await prisma.managerRating.findFirst({
            where: { userId: writerId, period: monthPeriod, periodType: "monthly" },
            orderBy: { submittedAt: "desc" },
        });

        if (managerRating?.ratingsJson) {
            const rj = managerRating.ratingsJson as Record<string, number>;

            // Script Rating
            const scriptKeys = ["script_q1", "script_q2", "script_q3", "script_q4", "script_q5"];
            const scriptVals = scriptKeys.map((k) => rj[k]).filter((v) => v != null && !isNaN(v)).map(Number);
            if (scriptVals.length > 0) {
                const a = scriptVals.reduce((s, v) => s + v, 0) / scriptVals.length;
                scriptQualityStars = customRound(a);
                parameters.push({
                    name: "scriptQuality", label: "Script Rating",
                    rawValue: Math.round(a * 100) / 100, stars: scriptQualityStars,
                    weight: weights.scriptQuality, source: "manager",
                    caseCount: scriptVals.length,
                    details: `Avg ${a.toFixed(2)} from ${scriptVals.length}/5 questions`,
                });
            } else {
                parameters.push({
                    name: "scriptQuality", label: "Script Rating",
                    rawValue: null, stars: null, weight: weights.scriptQuality,
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

            // Block final score only if BOTH question sets are missing
            manualRatingsPending = scriptVals.length === 0 || ownerVals.length === 0;
        } else {
            parameters.push({
                name: "scriptQuality", label: "Script Rating",
                rawValue: null, stars: null, weight: weights.scriptQuality,
                source: "manager", caseCount: 0, details: "Pending manager input",
            });
        }
    } catch (err) {
        console.error(`[WriterCalc] Manager rating fetch failed for writer ${writerId}:`, err);
        parameters.push({
            name: "scriptQuality", label: "Script Rating",
            rawValue: null, stars: null, weight: weights.scriptQuality,
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
        writerCases.length, writerQualityStars, targetsMatrix
    );
    parameters.push({
        name: "monthlyTargets", label: "Monthly Targets",
        rawValue: monthlyTargetsStars, stars: monthlyTargetsStars,
        weight: weights.monthlyTargets, source: "formula", caseCount: writerCases.length,
        details: monthlyTargetsStars !== null
            ? `${writerCases.length} cases × ${writerQualityStars ?? 0}★ quality = ${monthlyTargetsStars}★`
            : "Pending quality score",
    });

    // ── YouTube Views ──
    let ytViewsStars: number | null = null;
    let totalViews = BigInt(0);
    const ytCaseStars: number[] = [];
    const now = new Date();

    for (const c of writerCases) {
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

    return { finalScore, finalStars, parameters, casesCompleted: writerCases.length, manualRatingsPending, totalViews };
}

// ═══════════════════════════════════════════════════════
// Batch calculation (fallback path only)
// ═══════════════════════════════════════════════════════

export async function calculateAllWriterRatings(
    month?: Date
): Promise<{ count: number; results: { writerId: number; name: string; score: number | null }[] }> {
    const targetMonth = month ?? new Date();
    const y = targetMonth.getUTCFullYear();
    const m = targetMonth.getUTCMonth();
    const monthStart  = new Date(Date.UTC(y, m, 1));
    const monthEnd    = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59));
    const monthPeriod = `${y}-${String(m + 1).padStart(2, "0")}`;

    // ── Load all configs ONCE ──
    const [weights, qualityBrackets, ytBrackets, targetsMatrix, finalBrackets, baselines] =
        await Promise.all([
            getWriterWeights(),
            getWriterQualityBrackets(),
            getYtViewsBrackets(),
            getMonthlyTargetsMatrix(),
            getFinalScoreBrackets(),
            prisma.channelBaseline.findMany(),
        ]);
    const baselineMap = new Map(baselines.map((b) => [b.channelName, Number(b.baselineViews)]));

    // ── All cases in ONE query ──
    const allCases = await getQualifiedWriterCases(monthStart, monthEnd);
    const writerCasesMap = new Map<number, QualifiedCase[]>();
    for (const c of allCases) {
        if (!c.writerUserId) continue;
        const bucket = writerCasesMap.get(c.writerUserId) ?? [];
        bucket.push(c);
        writerCasesMap.set(c.writerUserId, bucket);
    }

    // ── All user names in ONE query ──
    const writerIds = [...writerCasesMap.keys()];
    const writers   = await prisma.user.findMany({
        where: { id: { in: writerIds } },
        select: { id: true, name: true },
    });
    const nameMap = new Map(writers.map((w) => [w.id, w.name]));

    const results: { writerId: number; name: string; score: number | null }[] = [];

    for (const [writerId, cases] of writerCasesMap) {
        try {
            const result = await calculateWriterScore(
                cases, writerId, monthPeriod,
                weights, qualityBrackets, ytBrackets, targetsMatrix, finalBrackets, baselineMap
            );

            await prisma.monthlyRating.upsert({
                where: { userId_month_roleType: { userId: writerId, month: monthStart, roleType: "writer" } },
                create: {
                    userId: writerId, month: monthStart, roleType: "writer",
                    casesCompleted: result.casesCompleted,
                    avgQualityScore: result.parameters.find((p) => p.name === "writerQuality")?.rawValue ?? null,
                    avgDeliveryScore: result.parameters.find((p) => p.name === "scriptQuality")?.rawValue ?? null,
                    avgEfficiencyScore: result.parameters.find((p) => p.name === "monthlyTargets")?.rawValue ?? null,
                    totalViews: result.totalViews, overallRating: result.finalScore,
                    writerQualityStars: result.parameters.find((p) => p.name === "writerQuality")?.stars ?? null,
                    scriptQualityStars: result.parameters.find((p) => p.name === "scriptQuality")?.stars ?? null,
                    ownershipStars: result.parameters.find((p) => p.name === "ownership")?.stars ?? null,
                    monthlyTargetsStars: result.parameters.find((p) => p.name === "monthlyTargets")?.stars ?? null,
                    ytViewsStars: result.parameters.find((p) => p.name === "youtubeViews")?.stars ?? null,
                    parametersJson: JSON.parse(JSON.stringify(result.parameters)),
                    manualRatingsPending: result.manualRatingsPending, calculatedAt: new Date(),
                },
                update: {
                    casesCompleted: result.casesCompleted,
                    avgQualityScore: result.parameters.find((p) => p.name === "writerQuality")?.rawValue ?? null,
                    avgDeliveryScore: result.parameters.find((p) => p.name === "scriptQuality")?.rawValue ?? null,
                    avgEfficiencyScore: result.parameters.find((p) => p.name === "monthlyTargets")?.rawValue ?? null,
                    totalViews: result.totalViews, overallRating: result.finalScore,
                    writerQualityStars: result.parameters.find((p) => p.name === "writerQuality")?.stars ?? null,
                    scriptQualityStars: result.parameters.find((p) => p.name === "scriptQuality")?.stars ?? null,
                    ownershipStars: result.parameters.find((p) => p.name === "ownership")?.stars ?? null,
                    monthlyTargetsStars: result.parameters.find((p) => p.name === "monthlyTargets")?.stars ?? null,
                    ytViewsStars: result.parameters.find((p) => p.name === "youtubeViews")?.stars ?? null,
                    parametersJson: JSON.parse(JSON.stringify(result.parameters)),
                    manualRatingsPending: result.manualRatingsPending,
                    calculatedAt: new Date(), isManualOverride: false,
                },
            });

            results.push({ writerId, name: nameMap.get(writerId) ?? "Unknown", score: result.finalScore });
        } catch (err) {
            console.error(`[WriterCalc] Failed for writerId=${writerId}:`, err);
        }
    }

    // Rank update in single transaction — only rank active users so the
    // leaderboard reads 1..N without gaps from people who left the company.
    const writerRatings = await prisma.monthlyRating.findMany({
        where: { month: monthStart, roleType: "writer", user: { isActive: true } },
        select: { id: true, overallRating: true },
        orderBy: { overallRating: "desc" },
    });
    if (writerRatings.length > 0) {
        await prisma.$transaction(
            writerRatings.map((r, i) =>
                prisma.monthlyRating.update({ where: { id: r.id }, data: { rankInRole: i + 1 } })
            )
        );
    }

    return { count: results.length, results };
}
