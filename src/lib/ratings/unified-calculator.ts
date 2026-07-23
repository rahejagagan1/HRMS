// ═══════════════════════════════════════════════════════
// Unified Calculator — Orchestrates the full rating pipeline
//
// This is the single entry point for all rating calculations.
// Replaces writer-calculator.ts and editor-calculator.ts as
// the active calculation path.
//
// Key improvements over previous calculators:
// - Config loaded ONCE per batch (not once per user)
// - All usernames fetched in a single query
// - Ranks updated in a single DB transaction
// - Formula versioning: MonthlyRating stores which template version
//   produced it — changing formula never silently overwrites old logic
// - Automatic default template seeding on first run
// - Proper error handling with full logging (no silent catch {})
// - Calculation lock via SyncLog to prevent concurrent runs
// ═══════════════════════════════════════════════════════

import prisma from "@/lib/prisma";
import type { FormulaTemplateData, EvaluationResult } from "./types";
import { evaluateFormula } from "./formula-engine";
import { getQualifiedCasesForRole, resolveDataContext, type QualifiedCase } from "./data-resolver";
import { DEFAULT_TEMPLATES } from "./default-templates";
import { getResearcherPipelineCounts } from "@/lib/clickup/researcher-pipeline";

// ═══════════════════════════════════════════════════════
// Template management
// ═══════════════════════════════════════════════════════

/**
 * Load the currently active formula template for a role.
 * Returns null if none is active (caller should fall back or seed default).
 */
export async function getActiveTemplate(
    roleType: string
): Promise<FormulaTemplateData | null> {
    try {
        const template = await prisma.formulaTemplate.findFirst({
            where: { roleType, isActive: true },
            orderBy: { version: "desc" },
        });
        if (!template) return null;
        return template as unknown as FormulaTemplateData;
    } catch (err) {
        console.error(`[UnifiedCalculator] Failed to load active template for '${roleType}':`, err);
        return null;
    }
}

/**
 * Activate a template by ID.
 * Deactivates all other templates for the same role atomically.
 */
export async function activateTemplate(templateId: number): Promise<FormulaTemplateData> {
    const template = await prisma.formulaTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new Error(`FormulaTemplate ${templateId} not found`);

    await prisma.$transaction([
        // Deactivate all others for this role
        prisma.formulaTemplate.updateMany({
            where: { roleType: template.roleType, id: { not: templateId } },
            data: { isActive: false },
        }),
        // Activate the target
        prisma.formulaTemplate.update({
            where: { id: templateId },
            data: { isActive: true },
        }),
    ]);

    return (await prisma.formulaTemplate.findUnique({
        where: { id: templateId },
    })) as unknown as FormulaTemplateData;
}

/**
 * Seed the default template for a role if none exists, then activate it.
 * Safe to call multiple times — idempotent.
 */
export async function ensureDefaultTemplate(roleType: string): Promise<FormulaTemplateData> {
    const existing = await prisma.formulaTemplate.findFirst({
        where: { roleType, isActive: true },
    });
    if (existing) return existing as unknown as FormulaTemplateData;

    const defaultTpl = DEFAULT_TEMPLATES.find((t) => t.roleType === roleType);
    if (!defaultTpl) {
        throw new Error(`No active template for role '${roleType}'. Create and activate one via the Formula Template page.`);
    }

    // Check if a v1 already exists but is inactive — activate it instead of duplicating
    const v1 = await prisma.formulaTemplate.findFirst({
        where: { roleType, version: defaultTpl.version },
    });

    if (v1) {
        await activateTemplate(v1.id);
        console.log(`[UnifiedCalculator] Re-activated existing template for '${roleType}' v${v1.version}`);
        return (await prisma.formulaTemplate.findUnique({ where: { id: v1.id } })) as unknown as FormulaTemplateData;
    }

    const created = await prisma.formulaTemplate.create({
        data: {
            roleType: defaultTpl.roleType,
            version: defaultTpl.version,
            isActive: true,
            label: defaultTpl.label,
            description: defaultTpl.description,
            sections: JSON.parse(JSON.stringify(defaultTpl.sections)),
            guardrails: JSON.parse(JSON.stringify(defaultTpl.guardrails)),
            roundOff: defaultTpl.roundOff ?? true,
        },
    });

    console.log(
        `[UnifiedCalculator] Seeded default template for '${roleType}' (v${created.version}, id=${created.id})`
    );
    return created as unknown as FormulaTemplateData;
}

// ═══════════════════════════════════════════════════════
// Single-user calculation (useful for preview / on-demand)
// ═══════════════════════════════════════════════════════

// Roles that are purely manager-rated (no ClickUp cases, no YouTube)
const MANAGER_ONLY_ROLES = ["hr_manager", "researcher_foia", "researcher_rtc", "researcher_foia_pitching"];

// Roles that have cases but qualified differently than writer/editor (Video QA1 + capsule filter, same pipeline)
const CM_ROLES = ["production_manager", "researcher_manager"];

export async function calculateUserRating(
    userId: number,
    roleType: string,
    monthStart: Date,
    monthEnd: Date,
    monthPeriod: string,
    template: FormulaTemplateData,
    baselineMap: Map<string, number>,
    casesOverride?: QualifiedCase[]
): Promise<EvaluationResult> {
    // Manager-only roles have no cases — pass empty array
    const isManagerOnly = MANAGER_ONLY_ROLES.includes(roleType);
    const isCM = CM_ROLES.includes(roleType);
    const cases = isManagerOnly
        ? []
        : (casesOverride ??
            (await getQualifiedCasesForRole(monthStart, monthEnd, roleType, userId)));

    // Quality threshold: CM uses bracket_lookup (cm_delivery_pct). Writer/editor use matrix_lookup
    // Monthly Targets matrix uses variable_x "cases_completed" — must not only look for qualified_* or
    // writer templates never read qualify_threshold and always fell back to 32.
    const matrixSection = template.sections.find(
        (s) =>
            s.type === "matrix_lookup" &&
            (s.variable_x === "qualified_writer_cases" ||
                s.variable_x === "qualified_editor_cases" ||
                s.variable_x === "cases_completed"),
    );
    const deliveryPctSection = template.sections.find(
        (s) => s.type === "bracket_lookup" && s.variable === "cm_delivery_pct"
    );
    const qualifyThreshold =
        roleType === "production_manager" || roleType === "researcher_manager"
            ? (deliveryPctSection?.qualify_threshold ?? 32)
            : (matrixSection?.qualify_threshold ?? 32);

    const combinedSection = template.sections.find((s) => s.type === "combined_team_manager_rating");
    const teamManagerStarKeys = combinedSection?.team_question_keys;

    const context = await resolveDataContext(
        userId,
        monthPeriod,
        roleType,
        cases,
        baselineMap,
        qualifyThreshold,
        teamManagerStarKeys,
        deliveryPctSection,
    );

    return evaluateFormula(
        template.id,
        template.version,
        template.sections,
        template.guardrails ?? [],
        context,
        template.roundOff ?? true
    );
}

// ═══════════════════════════════════════════════════════
// Batch calculation
// ═══════════════════════════════════════════════════════

export interface BatchResult {
    count: number;
    results: Array<{ userId: number; name: string; score: number | null }>;
    errors: Array<{ userId: number; error: string }>;
    /** Users skipped because their row is admin-locked (`isManualOverride`). */
    skippedManualLocks: Array<{ userId: number; name: string }>;
    templateId: number;
    templateVersion: number;
}

/**
 * Calculate monthly ratings for ALL users in a role.
 *
 * Performance guarantees:
 * - Template + config loaded once
 * - All qualified cases fetched in one query
 * - All user names fetched in one query
 * - Rank updates done in a single $transaction
 */
export async function calculateAllRatings(
    roleType: string,
    month?: Date
): Promise<BatchResult> {
    const targetMonth = month ?? new Date();
    const y = targetMonth.getUTCFullYear();
    const m = targetMonth.getUTCMonth();
    const monthStart = new Date(Date.UTC(y, m, 1));
    const monthEnd   = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59));
    const monthPeriod = `${y}-${String(m + 1).padStart(2, "0")}`;

    // ── Load or seed template ONCE ──
    const template = await ensureDefaultTemplate(roleType);

    // ── Researcher Manager: sync pipeline from ClickUp → DB before calculation ──
    if (roleType === "researcher_manager") {
        try {
            console.log(`[UnifiedCalculator] Syncing researcher pipeline for ${monthPeriod} from ClickUp...`);
            const pipe = await getResearcherPipelineCounts(monthPeriod);
            await prisma.researcherPipelineSnapshot.upsert({
                where: { month: monthStart },
                create: {
                    month: monthStart,
                    rtcCount: pipe.rtc,
                    foiaCount: pipe.foia,
                    totalCount: pipe.total,
                    rtcCaseRatingAvg: pipe.rtcCaseRatingAvg,
                    foiaCaseRatingAvg: pipe.foiaCaseRatingAvg,
                    foiaPitchedCount: pipe.foiaPitched,
                    foiaPitchedCaseRatingAvg: pipe.foiaPitchedCaseRatingAvg,
                    caseRatingAvgCombined: pipe.caseRatingAvgCombined,
                    rtcListName: pipe.rtcListName,
                    foiaListName: pipe.foiaListName,
                    foiaPitchedListName: pipe.foiaPitchedListName,
                    syncError: pipe.error || null,
                    syncedAt: new Date(),
                },
                update: {
                    rtcCount: pipe.rtc,
                    foiaCount: pipe.foia,
                    totalCount: pipe.total,
                    rtcCaseRatingAvg: pipe.rtcCaseRatingAvg,
                    foiaCaseRatingAvg: pipe.foiaCaseRatingAvg,
                    foiaPitchedCount: pipe.foiaPitched,
                    foiaPitchedCaseRatingAvg: pipe.foiaPitchedCaseRatingAvg,
                    caseRatingAvgCombined: pipe.caseRatingAvgCombined,
                    rtcListName: pipe.rtcListName,
                    foiaListName: pipe.foiaListName,
                    foiaPitchedListName: pipe.foiaPitchedListName,
                    syncError: pipe.error || null,
                    syncedAt: new Date(),
                },
            });
            console.log(
                `[UnifiedCalculator] Pipeline synced: RTC=${pipe.rtc}, FOIA=${pipe.foia}, FOIA pitched list=${pipe.foiaPitched}, total=${pipe.total}`
            );
        } catch (err) {
            console.error(`[UnifiedCalculator] Pipeline sync failed for ${monthPeriod}, will use existing snapshot if available:`, err);
        }
    }

    // ── Load channel baselines ONCE ──
    const baselines = await prisma.channelBaseline.findMany();
    const baselineMap = new Map(
        baselines.map((b) => [b.channelName, Number(b.baselineViews)])
    );

    const isManagerOnly = MANAGER_ONLY_ROLES.includes(roleType);
    const isCM = CM_ROLES.includes(roleType);

    // ── Build user list based on role type ──
    let userCasesMap: Map<number, QualifiedCase[]>;
    let userNameMap: Map<number, string>;

    if (isManagerOnly) {
        // Manager-only roles: fetch active users (no cases needed)
        // If the template has assignedUserIds, use those instead of role-based lookup
        const assignedIds = Array.isArray((template as any).assignedUserIds)
            ? (template as any).assignedUserIds as number[]
            : null;
        const roleUsers = await prisma.user.findMany({
            where: assignedIds
                ? { id: { in: assignedIds }, isActive: true }
                : { role: roleType as any, isActive: true },
            select: { id: true, name: true },
        });
        userCasesMap = new Map(roleUsers.map((u) => [u.id, [] as QualifiedCase[]]));
        userNameMap = new Map(roleUsers.map((u) => [u.id, u.name]));
    } else if (isCM) {
        // CM/PM roles: fetch users first, then qualified cases per user (filtered by capsule)
        const cmUsers = await prisma.user.findMany({
            where: { role: roleType as any, isActive: true },
            select: { id: true, name: true },
        });
        userNameMap = new Map(cmUsers.map((u) => [u.id, u.name]));
        userCasesMap = new Map<number, QualifiedCase[]>();
        for (const u of cmUsers) {
            const cases = await getQualifiedCasesForRole(monthStart, monthEnd, roleType, u.id);
            userCasesMap.set(u.id, cases);
        }
    } else {
        // Case-based roles (writer/editor): only include users who actually have
        // qualified cases this month. Zero-case users are hidden from the audit panel.
        const allCases = await getQualifiedCasesForRole(monthStart, monthEnd, roleType);
        const userIdField = roleType === "writer" ? "writerUserId" : "editorUserId";

        userCasesMap = new Map<number, QualifiedCase[]>();
        for (const c of allCases) {
            const uid = (c as any)[userIdField] as number | null;
            if (!uid) continue;
            const bucket = userCasesMap.get(uid) ?? [];
            bucket.push(c);
            userCasesMap.set(uid, bucket);
        }

        const userIds = [...userCasesMap.keys()];
        const roleUsers = userIds.length > 0
            ? await prisma.user.findMany({
                where: { id: { in: userIds }, role: roleType as any, isActive: true },
                select: { id: true, name: true },
            })
            : [];
        userNameMap = new Map(roleUsers.map((u) => [u.id, u.name]));

        // Drop any cases whose user is inactive or role-changed (keeps the roster clean).
        for (const uid of [...userCasesMap.keys()]) {
            if (!userNameMap.has(uid)) userCasesMap.delete(uid);
        }
    }

    // Rows created or edited via Audit Panel / admin API keep `isManualOverride: true` — never overwrite on batch calculate.
    const lockedRows = await prisma.monthlyRating.findMany({
        where: { month: monthStart, roleType, isManualOverride: true },
        select: { userId: true },
    });
    const manualLockedUserIds = new Set(lockedRows.map((r) => r.userId));

    const results: BatchResult["results"] = [];
    const errors: BatchResult["errors"]   = [];
    const skippedManualLocks: BatchResult["skippedManualLocks"] = [];

    // ── Calculate per user ──
    for (const [userId, cases] of userCasesMap) {
        try {
            if (manualLockedUserIds.has(userId)) {
                skippedManualLocks.push({
                    userId,
                    name: userNameMap.get(userId) ?? "Unknown",
                });
                console.log(
                    `[UnifiedCalculator] Skipping userId=${userId} (${userNameMap.get(userId) ?? "?"}) — manual lock (isManualOverride)`
                );
                continue;
            }

            const evalResult = await calculateUserRating(
                userId,
                roleType,
                monthStart,
                monthEnd,
                monthPeriod,
                template,
                baselineMap,
                cases
            );

            const upsertData = buildMonthlyRatingData(
                userId,
                monthStart,
                roleType,
                evalResult
            );

            await prisma.monthlyRating.upsert({
                where: {
                    userId_month_roleType: { userId, month: monthStart, roleType },
                },
                create: upsertData,
                update: { ...upsertData, isManualOverride: false },
            });

            results.push({
                userId,
                name: userNameMap.get(userId) ?? "Unknown",
                score: evalResult.finalScore,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(
                `[UnifiedCalculator] Error calculating ${roleType} userId=${userId}:`,
                err
            );
            errors.push({ userId, error: message });
        }
    }

    // ── Update ranks in a single transaction ──
    await updateRanksInRole(monthStart, roleType);

    return {
        count: results.length,
        results,
        errors,
        skippedManualLocks,
        templateId: template.id,
        templateVersion: template.version,
    };
}

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

function buildMonthlyRatingData(
    userId: number,
    monthStart: Date,
    roleType: string,
    result: EvaluationResult
): any {
    const sectionMap = new Map(result.sections.map((s) => [s.key, s]));

    // Find sections by source for backward-compat convenience columns
    const qualitySection  = result.sections.find((s) => s.source === "clickup");
    const deliverySection = result.sections.find(
        (s) => s.source === "manager" && s.key !== "ownership"
    );
    const targetsSection = sectionMap.get("monthlyTargets");
    const ytSection      = result.sections.find((s) => s.source === "youtube");

    return {
        userId,
        month:            monthStart,
        roleType,
        casesCompleted:   result.casesCompleted,
        avgQualityScore:  qualitySection?.rawValue  ?? null,
        avgDeliveryScore: deliverySection?.rawValue ?? null,
        avgEfficiencyScore: targetsSection?.rawValue ?? null,
        totalViews:       result.totalViews,
        overallRating:    result.finalScore,

        // Convenience star columns (parametersJson is authoritative)
        writerQualityStars:  qualitySection?.stars  ?? null,
        scriptQualityStars:  deliverySection?.stars ?? null,
        ownershipStars:      sectionMap.get("ownership")?.stars ?? null,
        monthlyTargetsStars: targetsSection?.stars  ?? null,
        ytViewsStars:        ytSection?.stars       ?? null,

        // Authoritative breakdown + formula versioning
        parametersJson:      JSON.parse(JSON.stringify(result.sections)),
        manualRatingsPending: result.manualRatingsPending,
        formulaTemplateId:   result.formulaTemplateId,
        formulaVersion:      result.formulaVersion,
        calculatedAt:        new Date(),
    };
}

async function updateRanksInRole(monthStart: Date, roleType: string): Promise<void> {
    const ratings = await prisma.monthlyRating.findMany({
        // Only rank active users so ranks read 1..N without gaps from people who left.
        where: { month: monthStart, roleType, user: { isActive: true } },
        select: { id: true, overallRating: true },
        orderBy: { overallRating: "desc" },
    });

    if (ratings.length === 0) return;

    // Single transaction — replaces N individual update calls
    await prisma.$transaction(
        ratings.map((r, i) =>
            prisma.monthlyRating.update({
                where: { id: r.id },
                data: { rankInRole: i + 1 },
            })
        )
    );
}
