// ═══════════════════════════════════════════════════════
// Formula Engine — Pure evaluation, zero DB access
//
// Takes a resolved data context + formula template and
// evaluates every section safely without eval() or
// dynamic code execution.
//
// Sections are evaluated in declaration order so later
// sections can reference earlier ones (e.g., matrix_lookup
// references the stars computed by a bracket_lookup above it).
// ═══════════════════════════════════════════════════════

import type {
    FormulaSection,
    GuardrailRule,
    GuardrailConditionOperator,
    ResolvedDataContext,
    SectionResult,
    EvaluationResult,
    Bracket,
    MatrixTable,
    PipelineTargetBreakdown,
    RmCaseQualityBreakdown,
} from "./types";
import prisma from "@/lib/prisma";

// ═══════════════════════════════════════════════════════
// Math helpers (pure, no side effects)
// ═══════════════════════════════════════════════════════

function safeAvg(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((s, v) => s + v, 0) / values.length;
}

function variableAsNullableNumber(v: number | null | undefined): number | null {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Custom rounding: exactly 0.5 rounds DOWN, anything above rounds UP.
 * Matches existing business rule used throughout the system.
 */
export function customRound(value: number): number {
    if (value === 0) return 0;
    const decimal = value - Math.floor(value);
    return decimal > 0.5 ? Math.ceil(value) : Math.floor(value);
}

/**
 * Find matching bracket for a value. Falls back to lowest/highest bracket
 * if the value falls outside all defined ranges (never returns undefined).
 */
function formatCmDeliveryUnitsLabel(context: ResolvedDataContext): string {
    const u = context.variables.cm_delivery_qualified_units;
    if (u == null || u === undefined || Number.isNaN(Number(u))) return "?";
    const n = Number(u);
    return Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) : n.toFixed(2);
}

export function applyBrackets(value: number, brackets: Bracket[]): number {
    for (const b of brackets) {
        if (value >= b.min && value <= b.max) return b.stars;
    }
    if (brackets.length === 0) return 1;
    const sorted = [...brackets].sort((a, b) => a.min - b.min);
    // Below the lowest bracket → return lowest stars
    if (value < sorted[0].min) return sorted[0].stars;
    // Value is above all brackets OR in a gap between brackets:
    // find the highest bracket whose min is still <= value (floor match)
    let best = sorted[0];
    for (const b of sorted) {
        if (b.min <= value) best = b;
    }
    return best.stars;
}

/**
 * 2D matrix lookup: find score given cases count and quality stars.
 * Finds the best row key where casesCompleted >= key (highest match).
 * Returns 0 if casesCompleted <= 1 (minimum threshold).
 */
export function applyMatrix(
    casesCompleted: number,
    qualityStars: number,
    matrix: MatrixTable
): number | null {
    if (casesCompleted <= 1) return 0;
    const roundedQuality = Math.min(5, Math.max(1, Math.round(qualityStars)));
    const caseKeys = Object.keys(matrix).map(Number).sort((a, b) => a - b);

    let matchKey: string | null = null;
    for (const ck of caseKeys) {
        if (casesCompleted >= ck) matchKey = String(ck);
    }
    if (!matchKey && caseKeys.length > 0) {
        matchKey = String(caseKeys[caseKeys.length - 1]);
    }
    if (!matchKey) return null;

    const qualityMap = matrix[matchKey];
    if (!qualityMap) return null;

    const qKey = String(roundedQuality);
    return qualityMap[qKey] ?? null;
}

function clamp(
    value: number,
    min: number | undefined,
    max: number | undefined
): number {
    let v = value;
    if (min !== undefined) v = Math.max(v, min);
    if (max !== undefined) v = Math.min(v, max);
    return v;
}

// ═══════════════════════════════════════════════════════
// Final-score brackets (configurable, with DB fallback)
// ═══════════════════════════════════════════════════════

const DEFAULT_FINAL_SCORE_BRACKETS: Bracket[] = [
    { min: 0,  max: 54,  stars: 1 },
    { min: 55, max: 64,  stars: 2 },
    { min: 65, max: 74,  stars: 3 },
    { min: 75, max: 84,  stars: 4 },
    { min: 85, max: 100, stars: 5 },
];

async function getFinalScoreBrackets(): Promise<Bracket[]> {
    try {
        const config = await prisma.ratingConfig.findUnique({
            where: { key: "final_score_brackets" },
        });
        if (config?.value) return config.value as unknown as Bracket[];
    } catch (err) {
        console.warn("[FormulaEngine] Cannot load final_score_brackets, using defaults:", err);
    }
    return DEFAULT_FINAL_SCORE_BRACKETS;
}

function scoreToFinalStars(scoreOutOf5: number, brackets: Bracket[]): number {
    // Convert 0-5 score to 0-100 percentage for bracket lookup
    const pct = (scoreOutOf5 / 5) * 100;
    return applyBrackets(pct, brackets);
}

// ═══════════════════════════════════════════════════════
// Guardrail evaluation
// ═══════════════════════════════════════════════════════

function evalSingleCondition(
    section: string,
    op: GuardrailConditionOperator,
    condVal: number | undefined,
    sectionResults: Map<string, SectionResult>
): boolean {
    const result = sectionResults.get(section);
    if (!result) return false;
    const stars = result.stars;
    if (op === "is_null")     return stars === null;
    if (op === "is_not_null") return stars !== null;
    if (stars === null)       return false;
    const v = condVal ?? 0;
    switch (op) {
        case "<":  return stars < v;
        case ">":  return stars > v;
        case "<=": return stars <= v;
        case ">=": return stars >= v;
        case "==": return stars === v;
        default:   return false;
    }
}

function checkGuardrailCondition(
    rule: GuardrailRule,
    sectionResults: Map<string, SectionResult>
): boolean {
    // Multi-condition mode
    if (rule.conditions && rule.conditions.length > 0) {
        const logic = rule.condition_logic ?? "AND";
        if (logic === "OR") {
            return rule.conditions.some((c) =>
                evalSingleCondition(c.section, c.operator, c.value, sectionResults)
            );
        }
        // AND (default)
        return rule.conditions.every((c) =>
            evalSingleCondition(c.section, c.operator, c.value, sectionResults)
        );
    }

    // Simple single-condition mode (backward compat)
    if (!rule.condition_section) return true; // unconditional
    return evalSingleCondition(
        rule.condition_section,
        rule.condition_operator as GuardrailConditionOperator,
        rule.condition_value,
        sectionResults
    );
}

// ═══════════════════════════════════════════════════════
// Main evaluation function
// ═══════════════════════════════════════════════════════

/**
 * Evaluate a full formula template against a resolved data context.
 *
 * Guarantees:
 * - Never throws (all section errors are caught and recorded in details)
 * - Never calls eval() or runs dynamic code
 * - Sections are evaluated in declaration order (later sections can
 *   reference earlier section results via variable_y_section)
 */
export async function evaluateFormula(
    templateId: number,
    templateVersion: number,
    sections: FormulaSection[],
    guardrails: GuardrailRule[],
    context: ResolvedDataContext,
    roundOff: boolean = true
): Promise<EvaluationResult> {
    const sectionResults = new Map<string, SectionResult>();
    const guardrailsApplied: string[] = [];

    // When roundOff is false, keep decimal stars; otherwise apply customRound
    const maybeRound = (v: number) => roundOff ? customRound(v) : Math.round(v * 100) / 100;

    // ── Evaluate each section in declaration order ──
    for (const section of sections) {
        let rawValue: number | null = null;
        let stars: number | null = null;
        let details = "";
        let breakdown: PipelineTargetBreakdown | undefined = undefined;
        let qualityBreakdown: RmCaseQualityBreakdown | undefined = undefined;

        try {
            switch (section.type) {

                // ─── rm_pipeline_targets_avg (Research Manager) ───
                case "rm_pipeline_targets_avg": {
                    const tr = section.rm_target_rtc;
                    const tf = section.rm_target_foia;
                    const tp = section.rm_target_foia_pitched;
                    if (
                        tr === undefined ||
                        tf === undefined ||
                        tp === undefined ||
                        !Number.isFinite(Number(tr)) ||
                        !Number.isFinite(Number(tf)) ||
                        !Number.isFinite(Number(tp)) ||
                        Number(tr) <= 0 ||
                        Number(tf) <= 0 ||
                        Number(tp) <= 0
                    ) {
                        details = `Config error: section '${section.key}' needs rm_target_rtc, rm_target_foia, rm_target_foia_pitched — all numeric and > 0`;
                        break;
                    }
                    const targetRtc = Number(tr);
                    const targetFoia = Number(tf);
                    const targetPitched = Number(tp);
                    const rtc = Number(context.variables.rm_pipeline_rtc_count ?? 0);
                    const foia = Number(context.variables.rm_pipeline_foia_count ?? 0);
                    const pitched = Number(context.variables.rm_foia_pitched_count ?? 0);
                    const sub = (actual: number, target: number) =>
                        Math.min(5, (actual / target) * 5);
                    const sR = sub(rtc, targetRtc);
                    const sF = sub(foia, targetFoia);
                    const sP = sub(pitched, targetPitched);
                    const avg = (sR + sF + sP) / 3;
                    rawValue = Math.round(avg * 100) / 100;
                    stars = maybeRound(avg);
                    breakdown = {
                        rtc: { actual: rtc, target: targetRtc },
                        foia: { actual: foia, target: targetFoia },
                        foia_pitched: { actual: pitched, target: targetPitched },
                    };
                    details =
                        `RTC ${rtc}/${targetRtc}→${sR.toFixed(2)}★ · FOIA ${foia}/${targetFoia}→${sF.toFixed(2)}★ · Pitched ${pitched}/${targetPitched}→${sP.toFixed(2)}★ → avg ${avg.toFixed(2)}★ → ${stars}★`;
                    break;
                }

                // ─── bracket_lookup ─────────────────────────────
                case "bracket_lookup": {
                    if (!section.variable) {
                        details = `Config error: missing 'variable' in section '${section.key}'`;
                        break;
                    }
                    const val = context.variables[section.variable];
                    if (val === null || val === undefined) {
                        details = `No data for variable '${section.variable}'`;
                        break;
                    }
                    if (!section.brackets?.length) {
                        details = `Config error: missing 'brackets' in section '${section.key}'`;
                        break;
                    }
                    rawValue = val;
                    stars = applyBrackets(val, section.brackets);
                    details =
                        section.variable === "cm_delivery_pct"
                            ? `Delivery ${val.toFixed(1)}% (${formatCmDeliveryUnitsLabel(context)} units / ${context.variables.cm_monthly_target_cases ?? "?"} target) → ${stars}★ (bracket lookup)`
                            : `Value ${val.toFixed(2)} → ${stars}★ (bracket lookup)`;
                    break;
                }

                // ─── manager_questions_avg ───────────────────────
                case "manager_questions_avg": {
                    if (!context.managerRatingExists) {
                        details = "Pending — manager has not submitted a rating this month";
                        break;
                    }
                    if (!section.question_keys?.length) {
                        details = `Config error: missing 'question_keys' in section '${section.key}'`;
                        break;
                    }
                    const rj = context.managerRatingsJson ?? {};
                    const vals = section.question_keys
                        .map((k) => rj[k])
                        .filter((v): v is number => v != null && !isNaN(Number(v)))
                        .map(Number);

                    if (vals.length === 0) {
                        details = `Pending — 0/${section.question_keys.length} questions answered`;
                        break;
                    }
                    const avgVal = safeAvg(vals);
                    rawValue = Math.round(avgVal * 100) / 100;
                    stars = maybeRound(avgVal);
                    details = `Avg ${avgVal.toFixed(2)} from ${vals.length}/${section.question_keys.length} questions → ${stars}★`;
                    break;
                }

                // ─── matrix_lookup ──────────────────────────────
                case "matrix_lookup": {
                    if (!section.variable_x) {
                        details = `Config error: missing 'variable_x' in section '${section.key}'`;
                        break;
                    }
                    const xVal = context.variables[section.variable_x];
                    if (xVal === null || xVal === undefined) {
                        details = `No data for variable '${section.variable_x}'`;
                        break;
                    }
                    if (!section.variable_y_section) {
                        details = `Config error: missing 'variable_y_section' in section '${section.key}'`;
                        break;
                    }
                    const yResult = sectionResults.get(section.variable_y_section);
                    if (!yResult || yResult.stars === null) {
                        details = `Waiting for section '${section.variable_y_section}' to produce stars`;
                        break;
                    }
                    if (!section.matrix) {
                        details = `Config error: missing 'matrix' in section '${section.key}'`;
                        break;
                    }
                    const score = applyMatrix(xVal, yResult.stars, section.matrix);
                    rawValue = score;
                    stars = score;
                    details = score !== null
                        ? `${xVal} cases × ${yResult.stars}★ quality → ${score}★ (matrix)`
                        : "Insufficient cases (≤1)";
                    break;
                }

                // ─── yt_baseline_ratio ──────────────────────────
                case "yt_baseline_ratio": {
                    const fallback = section.yt_fallback_stars ?? 3;
                    const brackets = section.brackets ?? [];

                    if (context.ytPerCaseRatios.length === 0) {
                        stars = fallback;
                        rawValue = fallback;
                        details = `Default ${fallback}★ — no videos with baseline data`;
                        break;
                    }

                    const caseStars: number[] = [];
                    for (const item of context.ytPerCaseRatios) {
                        if (item.isDefault || item.ratio === null) {
                            caseStars.push(fallback);
                        } else {
                            caseStars.push(
                                brackets.length > 0
                                    ? applyBrackets(item.ratio, brackets)
                                    : fallback
                            );
                        }
                    }

                    const avgStars = safeAvg(caseStars);
                    rawValue = Math.round(avgStars * 100) / 100;

                    // Apply manager adjustment (±0.5) if configured and present
                    // Adjustment is applied to the float average BEFORE rounding so
                    // e.g. avg 2.3 + 0.5 = 2.8 → 3★ instead of 2★.
                    let adjustedAvg = avgStars;
                    let adjNote = "";
                    if (section.yt_manager_adjustment_key && context.managerRatingsJson) {
                        const adj = context.managerRatingsJson[section.yt_manager_adjustment_key];
                        if (adj !== undefined && adj !== null && Number(adj) !== 0) {
                            adjustedAvg = avgStars + Number(adj);
                            adjNote = ` | Manager adj ${Number(adj) > 0 ? "+" : ""}${adj}`;
                        }
                    }

                    stars = maybeRound(adjustedAvg);
                    details = `Avg ${avgStars.toFixed(2)}★ across ${caseStars.length} video(s) → ${maybeRound(avgStars)}★${adjNote} → ${stars}★`;
                    break;
                }

                // ─── manager_direct_rating ──────────────────────
                case "manager_direct_rating": {
                    if (!context.managerRatingExists) {
                        details = "Pending — manager has not submitted a rating this month";
                        break;
                    }
                    const ratingKey = section.rating_key || section.key;
                    const rj = context.managerRatingsJson ?? {};
                    const val = rj[ratingKey];
                    if (val === undefined || val === null) {
                        details = `Pending — manager has not rated '${ratingKey}'`;
                        break;
                    }
                    rawValue = Number(val);
                    stars = roundOff ? Math.min(5, Math.max(1, Math.round(rawValue))) : Math.min(5, Math.max(1, rawValue));
                    details = `Direct manager rating: ${rawValue}★`;
                    break;
                }

                // ─── team_quality_avg ──────────────────────────
                case "team_quality_avg": {
                    if (!section.variable) {
                        details = `Config error: missing 'variable' in team_quality_avg section '${section.key}'`;
                        break;
                    }
                    const teamVal = context.teamQualityScores?.[section.variable]
                        ?? context.variables[section.variable];
                    if (teamVal === null || teamVal === undefined) {
                        details = `No team quality data for variable '${section.variable}'`;
                        break;
                    }
                    rawValue = teamVal;
                    if (section.brackets?.length) {
                        stars = applyBrackets(teamVal, section.brackets);
                        details = `Team avg ${teamVal.toFixed(2)} → ${stars}★ (bracket lookup)`;
                    } else {
                        stars = maybeRound(teamVal);
                        details = `Team avg ${teamVal.toFixed(2)} → ${stars}★`;
                    }
                    break;
                }

                // ─── combined_team_manager_rating ─────────────
                case "combined_team_manager_rating": {
                    const mgrKeys = section.manager_question_keys ?? [];
                    const teamKeys = section.team_question_keys ?? [];
                    const expectedTeam = context.cmDirectReportCount ?? 0;
                    const submittedTeam = context.teamManagerRatingCount ?? 0;

                    let managerAvg: number | null = null;
                    if (mgrKeys.length > 0 && context.managerRatingExists) {
                        const rj = context.managerRatingsJson ?? {};
                        const mgrVals = mgrKeys
                            .map((k) => rj[k])
                            .filter((v): v is number => v != null && !isNaN(Number(v)))
                            .map(Number);
                        if (mgrVals.length > 0) {
                            managerAvg = safeAvg(mgrVals);
                        }
                    }

                    let teamAvg: number | null = null;
                    const teamRatings = context.teamManagerRatingsJson;
                    const teamCount = context.teamManagerRatingCount ?? 0;
                    if (teamKeys.length > 0 && teamRatings && teamCount > 0) {
                        const teamVals = teamKeys
                            .map((k) => teamRatings[k])
                            .filter((v): v is number => v != null && !isNaN(Number(v)))
                            .map(Number);
                        if (teamVals.length > 0) {
                            teamAvg = safeAvg(teamVals);
                        }
                    }

                    // Team questions in template: require one TeamManagerRating row per expected direct report (writers/editors for CM/PM, researchers for Research Manager)
                    if (teamKeys.length > 0 && expectedTeam > 0 && submittedTeam < expectedTeam) {
                        details = `Pending — team feedback incomplete (${submittedTeam}/${expectedTeam} direct reports submitted)`;
                        break;
                    }

                    if (teamKeys.length > 0 && expectedTeam === 0) {
                        if (mgrKeys.length > 0) {
                            if (managerAvg === null) {
                                details = "Pending — manager (CEO/HOD) questions not completed";
                                break;
                            }
                            rawValue = Math.round(managerAvg * 100) / 100;
                            stars = rawValue !== null ? maybeRound(rawValue) : null;
                            details = `Manager avg ${managerAvg.toFixed(2)} only (no eligible direct reports for team feedback)`;
                            if (rawValue !== null) details += ` → ${stars}★`;
                            break;
                        }
                        details = "Pending — no direct reports to collect team feedback";
                        break;
                    }

                    if (managerAvg === null && teamAvg === null) {
                        details = "Pending — no manager or team ratings submitted";
                        break;
                    }

                    if (mgrKeys.length > 0 && teamKeys.length > 0) {
                        if (managerAvg === null) {
                            details = "Pending — manager (CEO/HOD) rating incomplete";
                            break;
                        }
                        if (teamAvg === null) {
                            details = "Pending — team ratings missing or incomplete";
                            break;
                        }
                        rawValue = Math.round((managerAvg * 0.5 + teamAvg * 0.5) * 100) / 100;
                        details = `Manager avg ${managerAvg.toFixed(2)} (50%) + Team avg ${teamAvg.toFixed(2)} (50%, ${teamCount} submission(s))`;
                    } else if (mgrKeys.length > 0 && teamKeys.length === 0) {
                        if (managerAvg === null) {
                            details = "Pending — manager questions not completed";
                            break;
                        }
                        rawValue = Math.round(managerAvg * 100) / 100;
                        details = `Manager avg ${managerAvg.toFixed(2)} only`;
                    } else if (teamKeys.length > 0 && mgrKeys.length === 0) {
                        if (teamAvg === null) {
                            details = "Pending — team ratings incomplete";
                            break;
                        }
                        rawValue = Math.round(teamAvg! * 100) / 100;
                        details = `Team avg ${teamAvg!.toFixed(2)} only (${teamCount} submission(s))`;
                    }

                    const rulesOn = section.team_pillar_team_rules_enabled !== false;
                    if (rulesOn && teamAvg !== null) {
                        const zeroBelow = section.team_pillar_zero_below_team_avg ?? 2;
                        const capBelow = section.team_pillar_cap_below_team_avg ?? 3;
                        const capMax = section.team_pillar_cap_max_stars ?? 3.5;

                        if (teamAvg < zeroBelow) {
                            const before = rawValue;
                            rawValue = 0;
                            details += ` | Team rule: team avg ${teamAvg.toFixed(2)} < ${zeroBelow} → pillar forced to 0★ (was ${before?.toFixed(2)}★)`;
                        } else if (teamAvg < capBelow) {
                            const before = rawValue;
                            rawValue = Math.min(rawValue ?? 0, capMax);
                            details += ` | Team rule: team avg ${teamAvg.toFixed(2)} < ${capBelow} → pillar capped at ${capMax}★ (was ${before?.toFixed(2)}★)`;
                        }
                    }

                    stars = rawValue !== null ? maybeRound(rawValue) : null;
                    if (rawValue !== null) {
                        details += ` → ${stars}★`;
                    }
                    break;
                }

                // ─── passthrough ────────────────────────────────
                case "passthrough": {
                    if (!section.variable) {
                        details = `Config error: missing 'variable' in passthrough section '${section.key}'`;
                        break;
                    }
                    if (section.variable === "rm_case_rating_avg_combined") {
                        qualityBreakdown = {
                            rtc: variableAsNullableNumber(context.variables.rm_rtc_case_rating_avg),
                            foia: variableAsNullableNumber(context.variables.rm_foia_case_rating_avg),
                            foia_pitched: variableAsNullableNumber(
                                (context.variables as Record<string, number | null>).rm_foia_pitched_case_rating_avg
                            ),
                        };
                    }
                    const val = context.variables[section.variable];
                    rawValue = val;
                    if (val === null || val === undefined || Number.isNaN(Number(val))) {
                        details = `No data for variable '${section.variable}'`;
                        break;
                    }
                    const num = Number(val);
                    const mn = section.passthrough_scale_min;
                    const mx = section.passthrough_scale_max;
                    let baseStars: number;
                    if (mn !== undefined && mx !== undefined && mx > mn) {
                        const t = (num - mn) / (mx - mn);
                        baseStars = 1 + t * 4;
                        details = `Avg ${num.toFixed(2)} mapped [${mn},${mx}]→1–5★ → ${baseStars.toFixed(2)}★ base`;
                    } else {
                        baseStars = num;
                        details = `Passthrough ${num}★ base`;
                    }
                    let adj = 0;
                    if (section.passthrough_manager_adjustment_key && context.managerRatingsJson) {
                        const a = context.managerRatingsJson[section.passthrough_manager_adjustment_key];
                        if (a !== undefined && a !== null && !Number.isNaN(Number(a))) {
                            adj = Math.min(0.5, Math.max(-0.5, Number(a)));
                        }
                    }
                    if (adj !== 0) {
                        details += ` | Manager adj ${adj > 0 ? "+" : ""}${adj}`;
                    }
                    stars = maybeRound(baseStars + adj);
                    details += ` → ${stars}★`;
                    break;
                }

                default: {
                    details = `Unknown section type: '${(section as any).type}'`;
                }
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[FormulaEngine] Section '${section.key}' evaluation error:`, err);
            details = `Evaluation error: ${msg}`;
            stars = null;
            rawValue = null;
            breakdown = undefined;
            qualityBreakdown = undefined;
        }

        // Apply section-level star guardrails (min/max clamp)
        if (stars !== null) {
            stars = clamp(stars, section.min_stars, section.max_stars);
        }

        const blocksScore =
            section.type === "combined_team_manager_rating" && stars === null
                ? true
                : (section.blocks_final_score ?? false);

        sectionResults.set(section.key, {
            key: section.key,
            label: section.label,
            weight: section.weight,
            source: section.source,
            rawValue,
            stars,
            details,
            blocksScore,
            ...(breakdown ? { breakdown } : {}),
            ...(qualityBreakdown ? { qualityBreakdown } : {}),
        });
    }

    // ── Check which blocking sections have no data yet ──
    const blockingSections = [...sectionResults.values()].filter(
        (s) => s.blocksScore && s.stars === null
    );
    const manualRatingsPending = blockingSections.length > 0;

    // ── Compute weighted final score ──
    let finalScore: number | null = null;
    let finalStars: number | null = null;

    if (!manualRatingsPending) {
        const validSections = [...sectionResults.values()].filter((s) => s.stars !== null);

        if (validSections.length > 0) {
            const totalWeight = validSections.reduce((sum, s) => sum + s.weight, 0);

            let rawScore = validSections.reduce((sum, s) => {
                return sum + s.stars! * (s.weight / totalWeight);
            }, 0);

            finalScore = Math.round(rawScore * 100) / 100;

            // ── Apply template-level guardrails ──
            for (const rule of guardrails) {
                if (checkGuardrailCondition(rule, sectionResults)) {
                    const msg = rule.message ?? `Guardrail: ${rule.action}`;
                    switch (rule.action) {
                        case "cap_final":
                            if (rule.action_value !== undefined && finalScore > rule.action_value) {
                                finalScore = rule.action_value;
                                guardrailsApplied.push(msg);
                            }
                            break;
                        case "floor_final":
                            if (rule.action_value !== undefined && finalScore < rule.action_value) {
                                finalScore = rule.action_value;
                                guardrailsApplied.push(msg);
                            }
                            break;
                        case "block_final":
                            finalScore = null;
                            guardrailsApplied.push(msg);
                            break;
                    }
                    if (finalScore === null) break;
                }
            }

            if (finalScore !== null) {
                const finalBrackets = await getFinalScoreBrackets();
                finalStars = scoreToFinalStars(finalScore, finalBrackets);
            }
        }
    }

    return {
        finalScore,
        finalStars,
        sections: [...sectionResults.values()],
        casesCompleted: context.variables["cases_completed"] ?? 0,
        totalViews: context.totalViews,
        manualRatingsPending,
        formulaTemplateId: templateId,
        formulaVersion: templateVersion,
        guardrailsApplied,
    };
}
