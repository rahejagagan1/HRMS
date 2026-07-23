// ═══════════════════════════════════════════════════════
// Data Resolver — All DB access for formula evaluation
//
// This is the ONLY place that fetches data from the DB
// for rating calculations. The formula engine receives a
// ResolvedDataContext and never touches the DB itself.
//
// Key design rules:
// - Every DB call is wrapped in try/catch with full logging
// - No N+1 queries: batch-friendly signatures throughout
// - Baselines and config are loaded ONCE per batch run,
//   not once per user
// ═══════════════════════════════════════════════════════

import prisma from "@/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import {
    findCapsulesMatchingTeamCapsule,
    normalizeTeamCapsuleInput,
} from "@/lib/capsule-matching";
import type { FormulaSection, ResolvedDataContext } from "./types";
import { getResearcherPipelineCounts } from "@/lib/clickup/researcher-pipeline";
import { getMonthlyReportWindow } from "@/lib/reports/monthly-window";

/** Same ClickUp case pipeline as CM/PM (Video QA1 + team capsule + delivery %). */
function isCmLikeRole(roleType: string): boolean {
    return roleType === "production_manager" || roleType === "researcher_manager";
}

const RESEARCHER_MONTHLY_ROLE_TYPES = ["researcher_foia", "researcher_rtc", "researcher_foia_pitching"] as const;

// ═══════════════════════════════════════════════════════
// Internal types
// ═══════════════════════════════════════════════════════

/** CM/PM: cases that count toward delivery % (both qualities above threshold). */
export function countCmDeliveryQualifiedCases(cases: QualifiedCase[], qualifyThreshold: number): number {
    if (qualifyThreshold <= 0) return cases.length;
    return cases.filter((c) => isCmDeliveryQualityQualified(c, qualifyThreshold)).length;
}

function normalizeCaseTypeLabel(s: string | null | undefined): string {
    return (s ?? "").trim().toLowerCase();
}

function normalizeManagerNameKey(s: string): string {
    return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function isCmDeliveryQualityQualified(c: QualifiedCase, qualifyThreshold: number): boolean {
    if (qualifyThreshold <= 0) return true;
    const w = c.writerQualityScore;
    const e = c.editorQualityScore;
    if (w == null || e == null) return false;
    return w > qualifyThreshold && e > qualifyThreshold;
}

/**
 * CM delivery numerator: weighted units when `cm_delivery_hero_multiplier` is set on the section,
 * otherwise raw qualifying case count.
 */
export function computeCmDeliveryNumerator(
    cases: QualifiedCase[],
    qualifyThreshold: number,
    cmDeliverySection?: FormulaSection | null,
): { units: number; qualifyingCount: number; usesCaseTypeWeighting: boolean } {
    const qualifying =
        qualifyThreshold <= 0
            ? cases
            : cases.filter((c) => isCmDeliveryQualityQualified(c, qualifyThreshold));
    const qualifyingCount = qualifying.length;
    const heroMult = cmDeliverySection?.cm_delivery_hero_multiplier;
    if (heroMult === undefined || heroMult === null) {
        return { units: qualifyingCount, qualifyingCount, usesCaseTypeWeighting: false };
    }
    const defaultMult = cmDeliverySection?.cm_delivery_default_multiplier ?? 1;
    const labels =
        cmDeliverySection?.cm_delivery_hero_case_type_labels?.length
            ? cmDeliverySection.cm_delivery_hero_case_type_labels
            : ["hero"];
    const normLabels = labels.map((l) => normalizeCaseTypeLabel(l)).filter((s) => s.length > 0);
    let units = 0;
    for (const c of qualifying) {
        const ct = normalizeCaseTypeLabel(c.caseType);
        const isHero = ct.length > 0 && normLabels.some((l) => ct === l);
        units += isHero ? Number(heroMult) : Number(defaultMult);
    }
    return { units, qualifyingCount, usesCaseTypeWeighting: true };
}

function resolveTargetFromTemplateNameMap(
    map: Record<string, number> | undefined,
    managerName: string | null,
): number | null {
    if (!map || !managerName) return null;
    const nn = normalizeManagerNameKey(managerName);
    for (const [k, v] of Object.entries(map)) {
        if (normalizeManagerNameKey(k) === nn) {
            const n = Number(v);
            if (!Number.isFinite(n) || n <= 0) return null;
            return n;
        }
    }
    return null;
}

export interface QualifiedCase {
    id: number;
    /** ClickUp custom field "Case type" on the main task (e.g. "hero"). */
    caseType: string | null;
    writerQualityScore: number | null;
    editorQualityScore: number | null;
    scriptQualityRating: Decimal | null;
    videoQualityRating: Decimal | null;
    channel: string | null;
    writerUserId: number | null;
    editorUserId: number | null;
    youtubeStats: {
        viewCount: bigint | null;
        last30DaysViews: bigint | null;
        publishedAt: Date | null;
        youtubeVideoId: string;
    } | null;
}

// ═══════════════════════════════════════════════════════
// Case qualification
// ═══════════════════════════════════════════════════════

/**
 * Fetch all qualified cases for a role/month combination.
 * A case qualifies when its role-specific subtask ("Scripting" or "Editing")
 * is marked done within the month + grace period (up to end of the 3rd day of the next month).
 *
 * For production_manager: cases qualify when the QA subtask is done — we match names
 * containing "Video QA1" or "Video QA 1" (ClickUp naming varies).
 * The subtask's dateDone determines which month the case belongs to.
 *
 * Pass userId to filter to one user, or omit for full batch.
 */
export async function getQualifiedCasesForRole(
    monthStart: Date,
    monthEnd: Date,
    roleType: string,
    userId?: number
): Promise<QualifiedCase[]> {
    if (!["writer", "editor", "production_manager", "researcher_manager"].includes(roleType)) return [];
    // Reporting window: day 4 of month M → end of day 3 of month M+1.
    const { windowStart, windowEnd } = getMonthlyReportWindow(
        monthStart.getUTCFullYear(),
        monthStart.getUTCMonth()
    );

    const subtaskName =
        roleType === "writer" ? "Scripting" : roleType === "editor" ? "Editing" : null;

    let subtasks: { caseId: number }[];
    try {
        subtasks = await prisma.subtask.findMany({
            where:
                roleType === "production_manager" || roleType === "researcher_manager"
                    ? {
                          OR: [
                              { name: { contains: "Video QA1", mode: "insensitive" } },
                              { name: { contains: "Video QA 1", mode: "insensitive" } },
                          ],
                          status: { in: ["done", "complete", "closed"] },
                          dateDone: { gte: windowStart, lte: windowEnd },
                      }
                    : {
                          name: { contains: subtaskName!, mode: "insensitive" },
                          status: { in: ["done", "complete", "closed"] },
                          dateDone: { gte: windowStart, lte: windowEnd },
                      },
            select: { caseId: true },
        });
    } catch (err) {
        console.error(`[DataResolver] Failed to fetch subtasks for ${roleType}:`, err);
        return [];
    }

    const caseIds = [...new Set(subtasks.map((s) => s.caseId))];
    if (caseIds.length === 0) return [];

    const caseFilter: any = { id: { in: caseIds } };
    if (roleType === "production_manager" || roleType === "researcher_manager") {
        // For CM / Research Manager: filter by production list(s). If `teamCapsule` matches a ProductionList
        // name (case-insensitive), only those lists are used. Otherwise it matches Capsule
        // folder(s) and all lists under those folders are included.
        // Non-empty with no list or capsule match → 0 cases.
        // Empty teamCapsule: legacy — no list filter (all Video QA1 / Video QA 1 cases in month).
        if (userId) {
            const cmUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { teamCapsule: true },
            });
            const tc = normalizeTeamCapsuleInput(cmUser?.teamCapsule ?? "");
            if (tc) {
                // Prefer a production **list** name (managers work on lists). Otherwise match a capsule folder and include all its lists.
                const listsByExactName = await prisma.productionList.findMany({
                    where: { name: { equals: tc, mode: "insensitive" } },
                    select: { id: true },
                });
                if (listsByExactName.length > 0) {
                    caseFilter.productionListId = { in: listsByExactName.map((l) => l.id) };
                } else {
                    const capsules = await findCapsulesMatchingTeamCapsule(tc);
                    if (capsules.length === 0) {
                        console.warn(
                            `[DataResolver] CM user ${userId}: teamCapsule "${tc}" matches no production list or capsule — 0 cases for delivery.`,
                        );
                        return [];
                    }
                    const capsuleIds = capsules.map((c) => c.id);
                    const lists = await prisma.productionList.findMany({
                        where: { capsuleId: { in: capsuleIds } },
                        select: { id: true },
                    });
                    if (lists.length === 0) {
                        console.warn(
                            `[DataResolver] CM user ${userId}: teamCapsule matched capsule(s) but no ProductionLists — 0 cases.`,
                        );
                        return [];
                    }
                    caseFilter.productionListId = { in: lists.map((l) => l.id) };
                }
            }
        }
    } else if (userId) {
        caseFilter[roleType === "writer" ? "writerUserId" : "editorUserId"] = userId;
    }

    try {
        return await prisma.case.findMany({
            where: caseFilter,
            select: {
                id: true,
                caseType: true,
                writerQualityScore: true,
                editorQualityScore: true,
                scriptQualityRating: true,
                videoQualityRating: true,
                channel: true,
                writerUserId: true,
                editorUserId: true,
                youtubeStats: {
                    select: {
                        viewCount: true,
                        last30DaysViews: true,
                        publishedAt: true,
                        youtubeVideoId: true,
                    },
                },
            },
        });
    } catch (err) {
        console.error(`[DataResolver] Failed to fetch cases for ${roleType}:`, err);
        return [];
    }
}

// ═══════════════════════════════════════════════════════
// Context resolution
// ═══════════════════════════════════════════════════════

function toNum(val: Decimal | null | undefined): number | null {
    if (val === null || val === undefined) return null;
    return Number(val);
}

function safeAvg(vals: (number | null)[]): number | null {
    const valid = vals.filter((v): v is number => v !== null && !isNaN(v));
    if (valid.length === 0) return null;
    return valid.reduce((s, v) => s + v, 0) / valid.length;
}

/**
 * Research Manager — Views performance pillar only:
 * every case under a production **capsule** (any PM capsule: `ProductionList.capsuleId` set)
 * whose YouTube `publishedAt` falls in the rating month (UTC). Not limited to the RM user's `teamCapsule`.
 */
async function fetchResearcherManagerViewsPillarCases(monthPeriod: string): Promise<QualifiedCase[]> {
    const parts = monthPeriod.split("-");
    const yr = parseInt(parts[0], 10);
    const mo = parseInt(parts[1], 10) - 1;
    if (!yr || mo < 0 || mo > 11) return [];

    const monthStartUtc = new Date(Date.UTC(yr, mo, 1));
    const monthEndUtc = new Date(Date.UTC(yr, mo + 1, 0, 23, 59, 59, 999));

    try {
        return await prisma.case.findMany({
            where: {
                isArchived: false,
                productionList: { capsuleId: { not: null } },
                youtubeStats: {
                    is: {
                        publishedAt: { gte: monthStartUtc, lte: monthEndUtc },
                    },
                },
            },
            select: {
                id: true,
                caseType: true,
                writerQualityScore: true,
                editorQualityScore: true,
                scriptQualityRating: true,
                videoQualityRating: true,
                channel: true,
                writerUserId: true,
                editorUserId: true,
                youtubeStats: {
                    select: {
                        viewCount: true,
                        last30DaysViews: true,
                        publishedAt: true,
                        youtubeVideoId: true,
                    },
                },
            },
        });
    } catch (err) {
        console.error("[DataResolver] fetchResearcherManagerViewsPillarCases failed:", err);
        return [];
    }
}

/**
 * Resolve team quality scores for a CM/PM or Research Manager from direct reports' MonthlyRatings.
 * CM/PM: writers + editors avgQualityScore. Research Manager: researchers' overallRating by researcher formula role types.
 */
async function resolveTeamQualityScores(
    managerId: number,
    monthStart: Date,
    managerRoleType: string,
): Promise<Record<string, number | null>> {
    if (managerRoleType === "researcher_manager") {
        const teamMembers = await prisma.user.findMany({
            where: { managerId, isActive: true, role: "researcher" },
            select: { id: true },
        });
        if (teamMembers.length === 0) {
            return {
                cm_team_writer_quality_avg: null,
                cm_team_editor_quality_avg: null,
                cm_team_production_quality_avg: null,
            };
        }
        const teamIds = teamMembers.map((m) => m.id);
        const ratings = await prisma.monthlyRating.findMany({
            where: {
                userId: { in: teamIds },
                month: monthStart,
                roleType: { in: [...RESEARCHER_MONTHLY_ROLE_TYPES] },
            },
            select: { overallRating: true },
        });
        const scores: number[] = [];
        for (const r of ratings) {
            const ov = r.overallRating != null ? Number(r.overallRating) : null;
            if (ov != null && !isNaN(ov)) scores.push(ov);
        }
        const productionAvg =
            scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : null;
        return {
            cm_team_writer_quality_avg: null,
            cm_team_editor_quality_avg: null,
            cm_team_production_quality_avg: productionAvg,
        };
    }

    const teamMembers = await prisma.user.findMany({
        where: { managerId, isActive: true, role: { in: ["writer", "editor"] } },
        select: { id: true, role: true },
    });

    if (teamMembers.length === 0) {
        return {
            cm_team_writer_quality_avg: null,
            cm_team_editor_quality_avg: null,
            cm_team_production_quality_avg: null,
        };
    }

    const teamIds = teamMembers.map(m => m.id);
    const ratings = await prisma.monthlyRating.findMany({
        where: {
            userId: { in: teamIds },
            month: monthStart,
            roleType: { in: ["writer", "editor"] },
        },
        select: {
            userId: true,
            roleType: true,
            avgQualityScore: true,
        },
    });

    const writerScores: number[] = [];
    const editorScores: number[] = [];

    for (const r of ratings) {
        const score = r.avgQualityScore ? Number(r.avgQualityScore) : null;
        if (score === null) continue;
        if (r.roleType === "writer") writerScores.push(score);
        else if (r.roleType === "editor") editorScores.push(score);
    }

    const writerAvg = writerScores.length > 0
        ? writerScores.reduce((s, v) => s + v, 0) / writerScores.length : null;
    const editorAvg = editorScores.length > 0
        ? editorScores.reduce((s, v) => s + v, 0) / editorScores.length : null;

    const allScores = [...writerScores, ...editorScores];
    const productionAvg = allScores.length > 0
        ? allScores.reduce((s, v) => s + v, 0) / allScores.length : null;

    return {
        cm_team_writer_quality_avg: writerAvg,
        cm_team_editor_quality_avg: editorAvg,
        cm_team_production_quality_avg: productionAvg,
    };
}

/**
 * Resolve team member ratings of a manager for Pillar 5 (combined rating).
 * Returns the average of all team members' ratings keyed by question_key.
 */
function isTeamStarKey(key: string, starKeys?: string[]): boolean {
    if (starKeys && starKeys.length > 0) return starKeys.includes(key);
    if (key.endsWith("_opt") || key.endsWith("_option") || key.endsWith("_comment")) return false;
    return true;
}

async function resolveTeamManagerRatings(
    managerId: number,
    monthPeriod: string,
    /** Only these keys contribute to numeric averages (star scores). */
    teamStarKeys?: string[],
): Promise<{ ratingsJson: Record<string, number> | null; count: number }> {
    const teamRatings = await prisma.teamManagerRating.findMany({
        where: { managerId, period: monthPeriod, periodType: "monthly" },
        select: { ratingsJson: true },
    });

    if (teamRatings.length === 0) return { ratingsJson: null, count: 0 };

    const keyTotals: Record<string, { sum: number; count: number }> = {};
    for (const tr of teamRatings) {
        const rj = tr.ratingsJson as Record<string, unknown>;
        for (const [key, val] of Object.entries(rj)) {
            if (!isTeamStarKey(key, teamStarKeys)) continue;
            if (typeof val !== "number" || isNaN(val)) continue;
            if (!keyTotals[key]) keyTotals[key] = { sum: 0, count: 0 };
            keyTotals[key].sum += val;
            keyTotals[key].count += 1;
        }
    }

    const avgJson: Record<string, number> = {};
    for (const [key, { sum, count }] of Object.entries(keyTotals)) {
        avgJson[key] = Math.round((sum / count) * 100) / 100;
    }

    return { ratingsJson: avgJson, count: teamRatings.length };
}

/**
 * Build the full ResolvedDataContext for a single user/month.
 * Called once per user during batch processing.
 * Baselines should be pre-loaded and passed in (not re-fetched per user).
 */
export async function resolveDataContext(
    userId: number,
    monthPeriod: string,
    roleType: string,
    cases: QualifiedCase[],
    baselineMap: Map<string, number>,
    qualifyThreshold: number = 32,
    /** For CM/PM: star keys from the active template’s combined section (team questions only). */
    teamManagerStarKeys?: string[],
    /** Monthly Targets pillar section when using `cm_delivery_pct` (hero weighting + optional target-by-name). */
    cmDeliverySection?: FormulaSection | null,
): Promise<ResolvedDataContext> {

    // ── Manager rating ──
    let managerRatingsJson: Record<string, number> | null = null;
    let managerRatingExists = false;

    try {
        const managerRating = await prisma.managerRating.findFirst({
            where: { userId, period: monthPeriod, periodType: "monthly" },
            orderBy: { submittedAt: "desc" },
        });
        if (managerRating?.ratingsJson) {
            managerRatingsJson = managerRating.ratingsJson as Record<string, number>;
            managerRatingExists = true;
        }
    } catch (err) {
        // Non-fatal: pending rating just means manual sections stay null
        console.error(`[DataResolver] Manager rating fetch failed for user ${userId}:`, err);
    }

    // ── Pre-compute case-level numeric variables ──
    const writerQualityScores = cases
        .map((c) => c.writerQualityScore)
        .filter((v): v is number => v !== null);

    const editorQualityScores = cases
        .map((c) => c.editorQualityScore)
        .filter((v): v is number => v !== null);

    const scriptQualityRatings = cases
        .map((c) => toNum(c.scriptQualityRating))
        .filter((v): v is number => v !== null);

    const videoQualityRatings = cases
        .map((c) => toNum(c.videoQualityRating))
        .filter((v): v is number => v !== null);

    // qualify_threshold: >0 = only cases with quality score strictly above threshold.
    // <=0 = "no gate" — qualified_* counts equal cases_completed (all month-qualified cases).
    const qualifyingWriterScores =
        qualifyThreshold <= 0
            ? writerQualityScores
            : writerQualityScores.filter((s) => s > qualifyThreshold);
    const qualifiedWriterCases =
        qualifyThreshold <= 0
            ? cases.length
            : cases.filter(
                  (c) =>
                      c.writerQualityScore != null &&
                      c.writerQualityScore > qualifyThreshold,
              ).length;
    const qualifiedWriterQualityAvg = safeAvg(qualifyingWriterScores);

    const qualifyingEditorScores =
        qualifyThreshold <= 0
            ? editorQualityScores
            : editorQualityScores.filter((s) => s > qualifyThreshold);
    const qualifiedEditorCases =
        qualifyThreshold <= 0
            ? cases.length
            : cases.filter(
                  (c) =>
                      c.editorQualityScore != null &&
                      c.editorQualityScore > qualifyThreshold,
              ).length;
    const qualifiedEditorQualityAvg = safeAvg(qualifyingEditorScores);

    // ── CM/PM: resolve team quality scores and team manager ratings ──
    let teamQualityScores: Record<string, number | null> | undefined;
    let teamManagerRatingsJson: Record<string, number> | null = null;
    let teamManagerRatingCount = 0;
    let cmDirectReportCount = 0;

    let monthlyDeliveryTarget: number | null = null;
    if (isCmLikeRole(roleType)) {
        try {
            const cmUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { monthlyDeliveryTargetCases: true, name: true },
            });
            const fromTemplate = resolveTargetFromTemplateNameMap(
                cmDeliverySection?.cm_delivery_target_by_manager_name,
                cmUser?.name ?? null,
            );
            monthlyDeliveryTarget =
                fromTemplate ?? cmUser?.monthlyDeliveryTargetCases ?? null;
        } catch {
            monthlyDeliveryTarget = null;
        }
    }

    const cmNumerator =
        isCmLikeRole(roleType)
            ? computeCmDeliveryNumerator(cases, qualifyThreshold, cmDeliverySection)
            : { units: 0, qualifyingCount: 0, usesCaseTypeWeighting: false };
    const cmDeliveryQualified =
        isCmLikeRole(roleType) ? cmNumerator.qualifyingCount : 0;
    const cmDeliveryQualifiedUnits =
        isCmLikeRole(roleType) ? cmNumerator.units : 0;

    let cmDeliveryPct: number | null = null;
    if (isCmLikeRole(roleType) && monthlyDeliveryTarget != null && monthlyDeliveryTarget > 0) {
        cmDeliveryPct =
            Math.round(Math.min(100, (cmDeliveryQualifiedUnits / monthlyDeliveryTarget) * 100) * 100) / 100;
    }

    if (isCmLikeRole(roleType)) {
        const [yearStr, monthStr] = monthPeriod.split("-");
        const mStart = new Date(Date.UTC(parseInt(yearStr), parseInt(monthStr) - 1, 1));

        // These three are independent of each other — resolve in parallel
        // instead of three serial round-trips (per CM/PM user). The count
        // keeps its own fallback so a failure there still yields 0.
        const [teamQ, teamRatingResult, directReportCount] = await Promise.all([
            resolveTeamQualityScores(userId, mStart, roleType),
            resolveTeamManagerRatings(userId, monthPeriod, teamManagerStarKeys),
            prisma.user.count({
                where: {
                    managerId: userId,
                    isActive: true,
                    role:
                        roleType === "researcher_manager"
                            ? "researcher"
                            : { in: ["writer", "editor"] },
                },
            }).catch((err) => {
                console.error(`[DataResolver] cmDirectReportCount failed for user ${userId}:`, err);
                return 0;
            }),
        ]);

        teamQualityScores = teamQ;
        teamManagerRatingsJson = teamRatingResult.ratingsJson;
        teamManagerRatingCount = teamRatingResult.count;
        cmDirectReportCount = directReportCount;
    }

    let rmPipelineRtc: number | null = null;
    let rmPipelineFoia: number | null = null;
    let rmRtcCaseRatingAvg: number | null = null;
    let rmFoiaCaseRatingAvg: number | null = null;
    let rmFoiaPitchedCaseRatingAvg: number | null = null;
    let rmCaseRatingAvgCombined: number | null = null;
    if (roleType === "researcher_manager") {
        try {
            // Read from DB snapshot first (synced via POST /api/sync/researcher-pipeline)
            const [yearStr, monStr] = monthPeriod.split("-");
            const snapMonth = new Date(Date.UTC(parseInt(yearStr), parseInt(monStr) - 1, 1));
            const snapshot = await prisma.researcherPipelineSnapshot.findUnique({
                where: { month: snapMonth },
            });

            if (snapshot) {
                rmPipelineRtc = snapshot.rtcCount;
                rmPipelineFoia = snapshot.foiaCount;
                rmRtcCaseRatingAvg = snapshot.rtcCaseRatingAvg != null ? Number(snapshot.rtcCaseRatingAvg) : null;
                rmFoiaCaseRatingAvg = snapshot.foiaCaseRatingAvg != null ? Number(snapshot.foiaCaseRatingAvg) : null;
                rmFoiaPitchedCaseRatingAvg =
                    snapshot.foiaPitchedCaseRatingAvg != null ? Number(snapshot.foiaPitchedCaseRatingAvg) : null;
                rmCaseRatingAvgCombined = snapshot.caseRatingAvgCombined != null ? Number(snapshot.caseRatingAvgCombined) : null;
            } else {
                // No snapshot — fallback to live ClickUp fetch
                console.warn(`[DataResolver] No pipeline snapshot for ${monthPeriod}, falling back to live ClickUp fetch`);
                const pipe = await getResearcherPipelineCounts(monthPeriod);
                rmPipelineRtc = pipe.rtc;
                rmPipelineFoia = pipe.foia;
                rmRtcCaseRatingAvg = pipe.rtcCaseRatingAvg;
                rmFoiaCaseRatingAvg = pipe.foiaCaseRatingAvg;
                rmFoiaPitchedCaseRatingAvg = pipe.foiaPitchedCaseRatingAvg;
                rmCaseRatingAvgCombined = pipe.caseRatingAvgCombined;
            }
        } catch (err) {
            console.error(`[DataResolver] Researcher pipeline counts failed for ${monthPeriod}:`, err);
        }
    }

    // ── FOIA Pitched count from Monthly Report ──
    let rmFoiaPitchedCount: number | null = null;
    if (roleType === "researcher_manager") {
        try {
            const [yearStr, monStr] = monthPeriod.split("-");
            const reportYear = parseInt(yearStr);
            const reportMonth = parseInt(monStr) - 1; // MonthlyReport uses 0-11
            const monthlyReport = await prisma.monthlyReport.findFirst({
                where: { managerId: userId, year: reportYear, month: reportMonth },
                select: { nishantOverview: true },
            });
            if (monthlyReport?.nishantOverview) {
                const overview = monthlyReport.nishantOverview as any;
                const pitched = parseFloat(overview.totalFOIAPitched);
                rmFoiaPitchedCount = isNaN(pitched) ? null : pitched;
            }
        } catch (err) {
            console.error(`[DataResolver] Failed to read FOIA pitched from MonthlyReport for user ${userId}, ${monthPeriod}:`, err);
        }
    }

    /** ClickUp RTC + FOIA only (same as snapshot `totalCount` / live `pipe.total`). */
    let rmPipelineRtcPlusFoia: number | null = null;
    /** RTC + FOIA + FOIA pitched (monthly report); null only if all three inputs are missing. */
    let rmPipelineTotalWithPitched: number | null = null;
    if (roleType === "researcher_manager") {
        if (rmPipelineRtc !== null || rmPipelineFoia !== null) {
            rmPipelineRtcPlusFoia = (rmPipelineRtc ?? 0) + (rmPipelineFoia ?? 0);
        }
        if (rmPipelineRtc !== null || rmPipelineFoia !== null || rmFoiaPitchedCount !== null) {
            rmPipelineTotalWithPitched =
                (rmPipelineRtc ?? 0) + (rmPipelineFoia ?? 0) + (rmFoiaPitchedCount ?? 0);
        }
    }

    /**
     * Pillar 1 (Views / yt_baseline_ratio) — case source differs by role:
     * - production_manager (CM/PM): same as always — `cases` = Video QA1–qualified tasks in that manager’s capsule; 30-day-since-publish rule applies below.
     * - researcher_manager: `fetchResearcherManagerViewsPillarCases` — all capsule-backed lists, YT published in rating month; no 30-day gate.
     */
    let ytCasesForRatios: QualifiedCase[] = cases;
    if (roleType === "researcher_manager") {
        ytCasesForRatios = await fetchResearcherManagerViewsPillarCases(monthPeriod);
    }

    const variables: Record<string, number | null> = {
        cases_completed:                cases.length,
        // Writer
        qualified_writer_cases:         qualifiedWriterCases,
        qualified_writer_quality_avg:   qualifiedWriterQualityAvg,
        writer_quality_score_avg:       safeAvg(writerQualityScores),
        // Editor
        qualified_editor_cases:         qualifiedEditorCases,
        qualified_editor_quality_avg:   qualifiedEditorQualityAvg,
        editor_quality_score_avg:       safeAvg(editorQualityScores),
        // Shared
        script_quality_rating_avg:      safeAvg(scriptQualityRatings),
        video_quality_rating_avg:       safeAvg(videoQualityRatings),
        // CM / PM / Research Manager (same variables)
        cm_cases_completed:             isCmLikeRole(roleType) ? cases.length : null,
        cm_monthly_target_cases:        isCmLikeRole(roleType) ? monthlyDeliveryTarget : null,
        cm_delivery_qualified_cases:    isCmLikeRole(roleType) ? cmDeliveryQualified : null,
        cm_delivery_qualified_units:    isCmLikeRole(roleType) ? cmDeliveryQualifiedUnits : null,
        cm_delivery_pct:                isCmLikeRole(roleType) ? cmDeliveryPct : null,
        cm_team_writer_quality_avg:     teamQualityScores?.cm_team_writer_quality_avg ?? null,
        cm_team_editor_quality_avg:     teamQualityScores?.cm_team_editor_quality_avg ?? null,
        cm_team_production_quality_avg: teamQualityScores?.cm_team_production_quality_avg ?? null,
        // Research Manager — RTC + FOIA pipeline (ClickUp Researcher Space lists)
        rm_pipeline_rtc_count:  roleType === "researcher_manager" ? rmPipelineRtc : null,
        rm_pipeline_foia_count: roleType === "researcher_manager" ? rmPipelineFoia : null,
        rm_pipeline_rtc_plus_foia_count: roleType === "researcher_manager" ? rmPipelineRtcPlusFoia : null,
        rm_pipeline_total_count: roleType === "researcher_manager" ? rmPipelineTotalWithPitched : null,
        rm_rtc_case_rating_avg: roleType === "researcher_manager" ? rmRtcCaseRatingAvg : null,
        rm_foia_case_rating_avg: roleType === "researcher_manager" ? rmFoiaCaseRatingAvg : null,
        rm_foia_pitched_case_rating_avg: roleType === "researcher_manager" ? rmFoiaPitchedCaseRatingAvg : null,
        rm_case_rating_avg_combined: roleType === "researcher_manager" ? rmCaseRatingAvgCombined : null,
        // Research Manager — FOIA Pitched (from Monthly Report nishantOverview)
        rm_foia_pitched_count: roleType === "researcher_manager" ? rmFoiaPitchedCount : null,
    };

    // ── YouTube per-case ratios ──
    let totalViews = BigInt(0);
    const ytPerCaseRatios: ResolvedDataContext["ytPerCaseRatios"] = [];
    const now = new Date();
    /** Only Research Manager skips the 30-day maturity check; CM/PM keep the original behavior. */
    const rmViewsPillar = roleType === "researcher_manager";

    for (const c of ytCasesForRatios) {
        totalViews += BigInt(c.youtubeStats?.viewCount?.toString() ?? "0");

        if (!c.youtubeStats) continue; // case has no YouTube link — skip

        const { viewCount, last30DaysViews, publishedAt } = c.youtubeStats;

        if (!publishedAt) {
            // No publish date → use fallback stars
            ytPerCaseRatios.push({ ratio: null, isDefault: true });
            continue;
        }

        if (!rmViewsPillar) {
            const daysSincePublish = Math.floor(
                (now.getTime() - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24)
            );

            if (daysSincePublish < 30) {
                // Too early to evaluate — use fallback stars
                ytPerCaseRatios.push({ ratio: null, isDefault: true });
                continue;
            }
        }

        const baseline = c.channel ? baselineMap.get(c.channel) : undefined;
        if (!baseline || baseline === 0) {
            // No baseline configured for this channel — skip this case
            // (does not contribute to YT average, unlike fallback cases)
            continue;
        }

        const views =
            last30DaysViews !== null
                ? Number(last30DaysViews.toString())
                : Number(viewCount?.toString() ?? "0");

        const ratio = (views / baseline) * 100;
        ytPerCaseRatios.push({ ratio, isDefault: false });
    }

    return {
        userId,
        monthPeriod,
        variables,
        managerRatingsJson,
        managerRatingExists,
        ytPerCaseRatios,
        totalViews,
        teamQualityScores,
        teamManagerRatingsJson,
        teamManagerRatingCount,
        cmDirectReportCount: isCmLikeRole(roleType) ? cmDirectReportCount : undefined,
    };
}
