// ═══════════════════════════════════════════════════════
// Shared types for the dynamic formula rating engine.
// All formula evaluation is driven by these structures —
// no logic is ever hardcoded in calculator files.
// ═══════════════════════════════════════════════════════

export interface RatingCriteriaLevel {
    stars: number;       // 1–5
    bullets: string[];   // bullet-point descriptions for this star level
}

export interface RatingCriteria {
    intro?: string;                  // tagline shown below section header, e.g. "👉 This is your future leader pillar"
    levels: RatingCriteriaLevel[];   // ordered 5 → 1
    important_rule?: string;         // amber note shown at bottom, e.g. "0 ideas this month → max 3 stars"
}

export type Bracket = {
    min: number;
    max: number;
    stars: number;
};

export type MatrixTable = Record<string, Record<string, number>>;

/**
 * Types of formula sections the engine can evaluate.
 *
 * bracket_lookup             — Numeric variable → stars via bracket table
 * matrix_lookup              — (cases_count × sibling_stars) → stars via 2D matrix
 * manager_questions_avg      — Avg a set of manager question responses → stars
 * manager_direct_rating      — Manager gives a single 1–5 star rating directly (no sub-questions)
 * yt_baseline_ratio          — Per-case YouTube baseline % → stars (with fallback)
 * passthrough                — Variable → stars: either direct (legacy) or linear map via
 *                              `passthrough_scale_min` / `passthrough_scale_max` to 1–5; optional
 *                              `passthrough_manager_adjustment_key` (±0.5) like YouTube pillar
 * team_quality_avg           — Avg of team members' quality scores from their MonthlyRating (for CM/PM)
 * combined_team_manager_rating — 50% manager self-rating + 50% team member avg rating of manager
 * rm_pipeline_targets_avg    — Research Manager: RTC / FOIA / FOIA pitched each scored as
 *                              min(5, actual/target×5), then average of the three → pillar stars
 */
export type FormulaSectionType =
    | "bracket_lookup"
    | "matrix_lookup"
    | "manager_questions_avg"
    | "manager_direct_rating"
    | "yt_baseline_ratio"
    | "passthrough"
    | "team_quality_avg"
    | "combined_team_manager_rating"
    | "rm_pipeline_targets_avg";

export type FormulaSource = "clickup" | "manager" | "youtube" | "formula";

/**
 * A single pillar/section within a formula template.
 * Stored as JSON in FormulaTemplate.sections.
 */
export interface FormulaSection {
    key: string;     // Unique identifier within template, e.g. "writerQuality"
    label: string;   // Display label, e.g. "Writer Quality Score"
    weight: number;  // 0-1 weight in final score (all weights should sum to 1)
    type: FormulaSectionType;
    source: FormulaSource;

    // ── bracket_lookup ──
    variable?: string;    // Variable key from variable-registry
    brackets?: Bracket[];

    // ── matrix_lookup ──
    variable_x?: string;         // Variable key for x-axis (e.g., "cases_completed")
    variable_y_section?: string; // Key of a sibling section whose stars become y-axis
    matrix?: MatrixTable;        // { "2": { "5": 4, "4": 3, ... }, "3": {...} }
    /**
     * Matrix: only when variable_x = "qualified_writer_cases" / "qualified_editor_cases".
     * Also used when type = bracket_lookup and variable = "cm_delivery_pct": cases count
     * toward delivery only if both writer and editor quality scores exceed this (out of 50).
     * Default: 32.
     */
    qualify_threshold?: number;

    /**
     * CM delivery % (bracket_lookup, variable = "cm_delivery_pct"):
     * Optional weighted units: `Case.caseType` (ClickUp "Case type") matching
     * `cm_delivery_hero_case_type_labels` uses `cm_delivery_hero_multiplier`; others use
     * `cm_delivery_default_multiplier`. Empty/null case type counts as default.
     * If `cm_delivery_hero_multiplier` is omitted, numerator is a plain count (legacy).
     */
    cm_delivery_hero_multiplier?: number;
    cm_delivery_default_multiplier?: number;
    /** Normalized match against `Case.caseType` (case-insensitive trim). Default: ["hero"]. */
    cm_delivery_hero_case_type_labels?: string[];

    /**
     * Optional per-manager monthly targets by **display name** (trimmed, case-insensitive).
     * If the rated user's `User.name` matches a key, that value is used as the denominator
     * instead of `User.monthlyDeliveryTargetCases`.
     */
    cm_delivery_target_by_manager_name?: Record<string, number>;

    // ── manager_questions_avg ──
    question_keys?: string[];    // Keys in manager ratingsJson (e.g., ["script_q1"..."script_q5"])
    question_labels?: string[];  // Human-readable label per question (parallel array to question_keys)

    // ── manager_direct_rating ──
    rating_key?: string;         // Single key stored in managerRatingsJson (e.g., "research_quality")

    // ── shared manager fields ──
    description?: string;        // Explanation shown to manager in the rating form

    /**
     * Structured rating criteria shown to the manager alongside the star input.
     * When present, replaces the plain `description` text with a formatted display
     * (star levels with bullet points + optional important rule).
     *
     * For `combined_team_manager_rating`, prefer `manager_rating_criteria` and
     * `team_rating_criteria`; this field is a legacy fallback when those are unset.
     */
    rating_criteria?: RatingCriteria;

    // ── yt_baseline_ratio ──
    yt_fallback_stars?: number; // Default stars when no YT data (default: 3)
    // (also uses `brackets` for ratio → stars mapping)

    /**
     * Optional key in managerRatingsJson holding a ±0.5 adjustment applied to the
     * YouTube stars BEFORE final rounding. Lets managers correct for external
     * factors like a bad title/thumbnail that suppressed views.
     * Stored as -0.5, 0, or 0.5 in the manager rating form.
     * Example: "yt_adjustment"
     */
    yt_manager_adjustment_key?: string;

    // ── passthrough ──
    /**
     * When both set, variable is clamped to [min, max] and mapped linearly to stars in [1, 5]
     * (no bracket table). `rawValue` in results stays the original variable value.
     * When omitted, variable is treated as stars directly (must be ~1–5 for sensible weights).
     */
    passthrough_scale_min?: number;
    passthrough_scale_max?: number;
    /**
     * Key in managerRatingsJson: -0.5, 0, or 0.5 applied after scale mapping, before clamp/round.
     */
    passthrough_manager_adjustment_key?: string;

    // ── rm_pipeline_targets_avg (Research Manager) ──
    /** Monthly target count for RTC pipeline (ClickUp). Actual = rm_pipeline_rtc_count. */
    rm_target_rtc?: number;
    /** Monthly target for FOIA pipeline (ClickUp). Actual = rm_pipeline_foia_count. */
    rm_target_foia?: number;
    /** Monthly target for FOIA pitched. Actual = rm_foia_pitched_count (monthly report). */
    rm_target_foia_pitched?: number;

    // ── team_quality_avg ──
    /** Which quality variables to average from team members' MonthlyRatings.
     *  e.g. ["writer_quality_score_avg", "editor_quality_score_avg"] */
    team_quality_variables?: string[];

    // ── combined_team_manager_rating ──
    /** Question keys for the manager's self-rating portion (50% weight) */
    manager_question_keys?: string[];
    manager_question_labels?: string[];
    /** Question keys for the team-member-rates-manager form (50% weight).
     *  Add as many as needed in the template; each key gets its own 1–5 score in ratingsJson.
     *  The pillar averages all team-question scores (after averaging across team members per key). */
    team_question_keys?: string[];
    team_question_labels?: string[];
    /**
     * Per team question: exactly three option labels (e.g. disagree / neutral / agree).
     * Same length as `team_question_keys` (pad with defaults in UI). Shown on Rate Manager
     * together with the 1–5 star row. Selection is stored in ratingsJson as `{key}_opt`: "0"|"1"|"2".
     */
    team_question_options?: string[][];
    /**
     * Combined pillar only: pointer structure for the CEO/HOD manager rating form
     * (manager_question_keys). If unset, `rating_criteria` is used (legacy).
     */
    manager_rating_criteria?: RatingCriteria;
    /**
     * Combined pillar only: pointer structure for the anonymous "Rate Manager"
     * page (team_question_keys). If unset, `rating_criteria` is used (legacy).
     */
    team_rating_criteria?: RatingCriteria;

    /**
     * Combined pillar only: rules based on aggregated **team** average (same `teamAvg`
     * used for the 50% team portion). Applied after blending manager + team; only when
     * `teamAvg` is available (team feedback exists for the month).
     */
    team_pillar_team_rules_enabled?: boolean;
    /** Team avg strictly below this → pillar stars forced to 0. Default 2. */
    team_pillar_zero_below_team_avg?: number;
    /** Team avg strictly below this (and not already zeroed) → pillar capped. Default 3. */
    team_pillar_cap_below_team_avg?: number;
    /** Max pillar score when cap rule applies. Default 3.5. */
    team_pillar_cap_max_stars?: number;

    // ── Section-level guardrails ──
    min_stars?: number;
    max_stars?: number;

    /**
     * If true and this section's stars are null, the final score is withheld
     * until data is available (e.g., manager hasn't submitted rating yet).
     */
    blocks_final_score?: boolean;
}

export type GuardrailConditionOperator =
    | "<" | ">" | "<=" | ">=" | "==" | "is_null" | "is_not_null";

/** A single condition within a multi-condition guardrail. */
export interface GuardrailCondition {
    section: string;
    operator: GuardrailConditionOperator;
    value?: number;
}

/**
 * A template-level guardrail that can cap, floor, or block the final score.
 *
 * Supports two modes:
 *  - Simple: single condition via condition_section / condition_operator / condition_value
 *  - Multi:  conditions[] array with condition_logic "AND" | "OR"
 *
 * Multi-condition takes precedence when conditions[] is present and non-empty.
 */
export interface GuardrailRule {
    // ── Simple (single-condition, backward compat) ──
    condition_section?: string;
    condition_operator?: GuardrailConditionOperator;
    condition_value?: number;

    // ── Multi-condition ──
    conditions?: GuardrailCondition[];
    condition_logic?: "AND" | "OR"; // default: "AND"

    action: "cap_final" | "floor_final" | "block_final";
    action_value?: number;
    message?: string;
}

/**
 * Full formula template parsed from DB JsonB fields.
 */
export interface FormulaTemplateData {
    id: number;
    roleType: string;
    version: number;
    isActive: boolean;
    label: string;
    description?: string | null;
    sections: FormulaSection[];
    guardrails: GuardrailRule[];
    /** Whether to round pillar star results to nearest integer. Default: true */
    roundOff: boolean;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * The result of evaluating a single section for one user/month.
 */
/** Sub-metrics for UI (e.g. pipeline pillar: RTC / FOIA / pitched vs targets). */
export interface PipelineTargetBreakdown {
    rtc: { actual: number; target: number };
    foia: { actual: number; target: number };
    foia_pitched: { actual: number; target: number };
}

/** Avg Case Rating (0–50) per stream for Research Manager UI (pitched = `{Month} FOIA Pitched Cases` list). */
export interface RmCaseQualityBreakdown {
    rtc: number | null;
    foia: number | null;
    foia_pitched: number | null;
}

export interface SectionResult {
    key: string;
    label: string;
    weight: number;
    source: FormulaSource;
    rawValue: number | null;
    stars: number | null;
    details: string;
    blocksScore: boolean;
    /** When set (e.g. `rm_pipeline_targets_avg`), admin & manager form show counts vs targets. */
    breakdown?: PipelineTargetBreakdown;
    /** When set (passthrough `rm_case_rating_avg_combined`), show per-stream avg Case Rating. */
    qualityBreakdown?: RmCaseQualityBreakdown;
}

/**
 * Full evaluation result for one user/month.
 * Saved as-is into MonthlyRating.parametersJson.
 */
export interface EvaluationResult {
    finalScore: number | null;
    finalStars: number | null;
    sections: SectionResult[];
    casesCompleted: number;
    totalViews: bigint;
    manualRatingsPending: boolean;
    formulaTemplateId: number;
    formulaVersion: number;
    guardrailsApplied: string[];
}

/**
 * Resolved data context passed into the formula engine.
 * All DB fetching happens BEFORE engine evaluation — the engine is pure.
 */
export interface ResolvedDataContext {
    userId: number;
    monthPeriod: string; // "YYYY-MM"

    /** Pre-computed case-level variables (keyed by variable registry key). */
    variables: Record<string, number | null>;

    /** Raw manager ratingsJson — engine computes question averages from this. */
    managerRatingsJson: Record<string, number> | null;
    managerRatingExists: boolean;

    /**
     * Per-case YouTube data. Each item is either:
     *   - isDefault: true  → use yt_fallback_stars (video < 30 days old / no link)
     *   - ratio: number    → (last30DaysViews / baseline) * 100, ready for brackets
     */
    ytPerCaseRatios: Array<{
        ratio: number | null;
        isDefault: boolean;
    }>;

    totalViews: bigint;

    /** Avg quality scores of team members (writers/editors) for this month.
     *  Keyed by variable name, e.g. "writer_quality_score_avg" → avg across all writers. */
    teamQualityScores?: Record<string, number | null>;

    /** Average of all team members' ratings of this manager (from TeamManagerRating).
     *  Keyed by question_key → avg across all team members. */
    teamManagerRatingsJson?: Record<string, number> | null;
    /** Rows in TeamManagerRating for this manager/period (one per submitting direct report). */
    teamManagerRatingCount?: number;
    /**
     * CM/PM: count of active writer + editor users with `managerId` = this user.
     * Used to require one team rating submission per expected direct report before
     * `combined_team_manager_rating` can score when the template includes team questions.
     */
    cmDirectReportCount?: number;
}
