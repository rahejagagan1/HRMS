// ═══════════════════════════════════════════════════════
// Variable Registry
//
// Defines all variables that can be referenced inside
// FormulaSection configs. This is the contract between
// formula config (stored in DB) and data resolution
// (implemented in data-resolver.ts).
//
// Admins pick variables from this list when building
// formula templates. The resolution logic that maps each
// variable to actual DB data lives in data-resolver.ts.
// ═══════════════════════════════════════════════════════

export type VariableSource = "clickup" | "manager" | "youtube" | "derived";
export type VariableDataType = "number" | "integer";

export interface VariableDefinition {
    key: string;
    label: string;
    source: VariableSource;
    description: string;
    dataType: VariableDataType;
    nullable: boolean;
    example?: string;
    /** Which section types this variable is compatible with */
    compatibleWith: string[];
}

export const VARIABLE_REGISTRY: Record<string, VariableDefinition> = {
    // ─── ClickUp → Case fields (avg over qualified cases) ───

    writer_quality_score_avg: {
        key: "writer_quality_score_avg",
        label: "Avg Writer Quality Score",
        source: "clickup",
        description: "Average writerQualityScore across qualified cases (range: 0–50)",
        dataType: "number",
        nullable: true,
        example: "38.5",
        compatibleWith: ["bracket_lookup"],
    },

    editor_quality_score_avg: {
        key: "editor_quality_score_avg",
        label: "Avg Editor Quality Score",
        source: "clickup",
        description: "Average editorQualityScore across qualified cases (range: 0–50)",
        dataType: "number",
        nullable: true,
        example: "41.0",
        compatibleWith: ["bracket_lookup"],
    },

    script_quality_rating_avg: {
        key: "script_quality_rating_avg",
        label: "Avg Script Quality Rating (ClickUp)",
        source: "clickup",
        description: "Average scriptQualityRating from ClickUp dropdown field (decimal)",
        dataType: "number",
        nullable: true,
        example: "4.5",
        compatibleWith: ["bracket_lookup", "passthrough"],
    },

    video_quality_rating_avg: {
        key: "video_quality_rating_avg",
        label: "Avg Video Quality Rating (ClickUp)",
        source: "clickup",
        description: "Average videoQualityRating from ClickUp dropdown field (decimal)",
        dataType: "number",
        nullable: true,
        example: "4.0",
        compatibleWith: ["bracket_lookup", "passthrough"],
    },

    // ─── Derived from case count ───

    cases_completed: {
        key: "cases_completed",
        label: "Cases Completed",
        source: "derived",
        description: "Count of qualified cases for this user/month",
        dataType: "integer",
        nullable: false,
        example: "3",
        compatibleWith: ["matrix_lookup"],
    },

    qualified_writer_cases: {
        key: "qualified_writer_cases",
        label: "Qualified Writer Cases (quality > threshold)",
        source: "derived",
        description:
            "Count of writer cases: if qualify_threshold > 0, only cases with writerQualityScore > threshold; if threshold is 0 (or less), same as cases_completed (all month cases).",
        dataType: "integer",
        nullable: false,
        example: "3",
        compatibleWith: ["matrix_lookup"],
    },

    qualified_writer_quality_avg: {
        key: "qualified_writer_quality_avg",
        label: "Avg Quality Score (qualifying scripts only)",
        source: "derived",
        description: "Average writerQualityScore of only the scripts that exceed the qualify_threshold. Scripts below the threshold are excluded from this average.",
        dataType: "number",
        nullable: true,
        example: "38.5",
        compatibleWith: ["bracket_lookup"],
    },

    qualified_editor_cases: {
        key: "qualified_editor_cases",
        label: "Qualified Editor Cases (quality > threshold)",
        source: "derived",
        description:
            "Count of editor cases: if qualify_threshold > 0, only cases with editorQualityScore > threshold; if threshold is 0 (or less), same as cases_completed (all month cases).",
        dataType: "integer",
        nullable: false,
        example: "3",
        compatibleWith: ["matrix_lookup"],
    },

    qualified_editor_quality_avg: {
        key: "qualified_editor_quality_avg",
        label: "Avg Editor Quality Score (qualifying videos only)",
        source: "derived",
        description: "Average editorQualityScore of only the videos that exceed the qualify_threshold. Videos below the threshold are excluded from this average.",
        dataType: "number",
        nullable: true,
        example: "38.5",
        compatibleWith: ["bracket_lookup"],
    },

    // ─── CM / Production Manager variables ───

    cm_cases_completed: {
        key: "cm_cases_completed",
        label: "CM Cases Completed (Video QA1)",
        source: "derived",
        description:
            "Count of cases where the QA subtask (name contains 'Video QA1' or 'Video QA 1') is done within the month. The subtask's dateDone determines the month.",
        dataType: "integer",
        nullable: false,
        example: "8",
        compatibleWith: ["matrix_lookup"],
    },

    cm_team_writer_quality_avg: {
        key: "cm_team_writer_quality_avg",
        label: "Team Avg Writer Quality Score",
        source: "derived",
        description: "Average of all writers' quality scores (from their MonthlyRating) under this CM for the month.",
        dataType: "number",
        nullable: true,
        example: "39.5",
        compatibleWith: ["bracket_lookup", "team_quality_avg"],
    },

    cm_team_editor_quality_avg: {
        key: "cm_team_editor_quality_avg",
        label: "Team Avg Editor Quality Score",
        source: "derived",
        description: "Average of all editors' quality scores (from their MonthlyRating) under this CM for the month.",
        dataType: "number",
        nullable: true,
        example: "41.0",
        compatibleWith: ["bracket_lookup", "team_quality_avg"],
    },

    cm_team_production_quality_avg: {
        key: "cm_team_production_quality_avg",
        label: "Team Production Quality (writers + editors avg)",
        source: "derived",
        description: "Combined average of all writers' and editors' quality scores under this CM for the month.",
        dataType: "number",
        nullable: true,
        example: "40.2",
        compatibleWith: ["bracket_lookup", "team_quality_avg"],
    },

    cm_monthly_target_cases: {
        key: "cm_monthly_target_cases",
        label: "Monthly Delivery Target (cases)",
        source: "derived",
        description: "Per-manager monthly case target from the user profile (denominator for delivery %).",
        dataType: "integer",
        nullable: true,
        example: "9",
        compatibleWith: ["bracket_lookup"],
    },

    cm_delivery_qualified_cases: {
        key: "cm_delivery_qualified_cases",
        label: "Delivery-Qualified Cases (CM subtask + quality)",
        source: "derived",
        description:
            "Count for CM delivery: if qualify_threshold > 0, cases where both writer and editor scores > threshold; if threshold is 0 (or less), same as cm_cases_completed (all month-qualified cases).",
        dataType: "integer",
        nullable: false,
        example: "8",
        compatibleWith: ["bracket_lookup"],
    },

    cm_delivery_qualified_units: {
        key: "cm_delivery_qualified_units",
        label: "Delivery-Qualified Units (weighted)",
        source: "derived",
        description:
            "Weighted delivery numerator: hero case types use template hero multiplier; others 1.0. Equals case count when hero multiplier is not set on the template.",
        dataType: "number",
        nullable: true,
        example: "8.3",
        compatibleWith: ["bracket_lookup"],
    },

    cm_delivery_pct: {
        key: "cm_delivery_pct",
        label: "Monthly Delivery %",
        source: "derived",
        description:
            "(cm_delivery_qualified_units ÷ cm_monthly_target_cases) × 100, capped at 100%. Null if no target set.",
        dataType: "number",
        nullable: true,
        example: "88.9",
        compatibleWith: ["bracket_lookup"],
    },

    // ─── Research Manager — Researcher Space pipeline lists (ClickUp API) ───

    rm_pipeline_rtc_count: {
        key: "rm_pipeline_rtc_count",
        label: "RTC pipeline count (month)",
        source: "derived",
        description:
            "Count of tasks in \"{Month} RTC Cases\" (Ready To Cover 2026) whose status matches RTC pipeline statuses. Matching is punctuation/spacing-insensitive (same normalized key as FOIA).",
        dataType: "integer",
        nullable: false,
        example: "12",
        compatibleWith: ["bracket_lookup", "passthrough"],
    },

    rm_pipeline_foia_count: {
        key: "rm_pipeline_foia_count",
        label: "FOIA pipeline count (month)",
        source: "derived",
        description:
            "Count of tasks in \"{Month} FOIA Cases\" (FOIA Worksheet 2026) whose status matches FOIA pipeline statuses (Pre-approved, Ready To Sent For Exl, In Progress, etc.). Same punctuation/spacing-insensitive normKey matching as RTC.",
        dataType: "integer",
        nullable: false,
        example: "18",
        compatibleWith: ["bracket_lookup", "passthrough"],
    },

    rm_pipeline_rtc_plus_foia_count: {
        key: "rm_pipeline_rtc_plus_foia_count",
        label: "RTC + FOIA only (ClickUp pipeline)",
        source: "derived",
        description:
            "rm_pipeline_rtc_count + rm_pipeline_foia_count from Researcher Space month lists (same as snapshot ClickUp total, excludes FOIA pitched from the monthly report).",
        dataType: "integer",
        nullable: true,
        example: "30",
        compatibleWith: ["bracket_lookup", "passthrough"],
    },

    rm_pipeline_total_count: {
        key: "rm_pipeline_total_count",
        label: "RTC + FOIA + FOIA pitched (month)",
        source: "derived",
        description:
            "rm_pipeline_rtc_count + rm_pipeline_foia_count + rm_foia_pitched_count. FOIA pitched comes from the Research Manager’s MonthlyReport (nishantOverview.totalFOIAPitched) for the rated user/month. Missing pieces count as 0; null only if RTC, FOIA, and pitched are all unavailable.",
        dataType: "integer",
        nullable: true,
        example: "38",
        compatibleWith: ["bracket_lookup", "passthrough"],
    },

    rm_rtc_case_rating_avg: {
        key: "rm_rtc_case_rating_avg",
        label: "RTC — avg Case Rating (pipeline tasks)",
        source: "derived",
        description:
            "Mean of the Case Rating custom field on pipeline-qualified parent tasks in \"{Month} RTC Cases\" (Ready To Cover 2026). Only tasks with a numeric Case Rating are included; null if none.",
        dataType: "number",
        nullable: true,
        example: "38.5",
        compatibleWith: ["bracket_lookup", "passthrough"],
    },

    rm_foia_case_rating_avg: {
        key: "rm_foia_case_rating_avg",
        label: "FOIA — avg Case Rating (pipeline tasks)",
        source: "derived",
        description:
            "Mean of the Case Rating custom field on pipeline-qualified parent tasks in \"{Month} FOIA Cases\" (FOIA Worksheet 2026). Only tasks with a numeric Case Rating are included; null if none.",
        dataType: "number",
        nullable: true,
        example: "40.0",
        compatibleWith: ["bracket_lookup", "passthrough"],
    },

    rm_case_rating_avg_combined: {
        key: "rm_case_rating_avg_combined",
        label: "RTC + FOIA + Pitched — combined avg Case Rating",
        source: "derived",
        description:
            "Mean Case Rating across all rated tasks: pipeline-qualified parents in \"{Month} RTC Cases\" and \"{Month} FOIA Cases\", plus parent tasks in \"{Month} FOIA Pitched Cases\" (ClickUp). Null if no task has a Case Rating.",
        dataType: "number",
        nullable: true,
        example: "39.2",
        compatibleWith: ["bracket_lookup", "passthrough"],
    },

    rm_foia_pitched_case_rating_avg: {
        key: "rm_foia_pitched_case_rating_avg",
        label: "FOIA Pitched — avg Case Rating (month list)",
        source: "derived",
        description:
            "Mean Case Rating on parent tasks in \"{Month} FOIA Pitched Cases\" in the FOIA workspace folder (see RESEARCHER_FOIA_PITCHED_FOLDER_NAME). Null if the list is missing or no tasks have a rating.",
        dataType: "number",
        nullable: true,
        example: "40.0",
        compatibleWith: ["bracket_lookup", "passthrough"],
    },

    rm_foia_pitched_count: {
        key: "rm_foia_pitched_count",
        label: "FOIA pitched count (from Monthly Report)",
        source: "derived",
        description:
            "Total 'Actual Number of FOIA pitched' from the researcher manager's Monthly Report (nishantOverview.totalFOIAPitched). Reads from the MonthlyReport table for the same month being rated.",
        dataType: "integer",
        nullable: true,
        example: "8",
        compatibleWith: ["bracket_lookup", "passthrough"],
    },
};

export function isValidVariable(key: string): boolean {
    return key in VARIABLE_REGISTRY;
}

export function getVariableDefinition(key: string): VariableDefinition | undefined {
    return VARIABLE_REGISTRY[key];
}

export function listVariables(): VariableDefinition[] {
    return Object.values(VARIABLE_REGISTRY);
}
