"use client";

import { useEffect, useState, useCallback } from "react";

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

interface FormulaTemplate {
    id: number;
    roleType: string;
    version: number;
    isActive: boolean;
    label: string;
    description?: string | null;
    sections: Section[];
    guardrails: Guardrail[];
    roundOff?: boolean;
    assignedUserIds?: number[] | null;
    createdAt: string;
    updatedAt: string;
}

interface Bracket {
    min: number;
    max: number;
    stars: number;
}

interface RatingCriteriaLevel {
    stars: number;
    bullets: string[];
}

interface RatingCriteria {
    intro?: string;
    levels: RatingCriteriaLevel[];
    important_rule?: string;
}

interface Section {
    key: string;
    label: string;
    weight: number;
    type: "bracket_lookup" | "matrix_lookup" | "manager_questions_avg" | "manager_direct_rating" | "yt_baseline_ratio" | "passthrough" | "team_quality_avg" | "combined_team_manager_rating" | "rm_pipeline_targets_avg";
    source: "clickup" | "manager" | "youtube" | "formula";
    variable?: string;
    brackets?: Bracket[];
    variable_x?: string;
    variable_y_section?: string;
    qualify_threshold?: number;
    matrix?: Record<string, Record<string, number>>;
    question_keys?: string[];
    question_labels?: string[];
    rating_key?: string;
    description?: string;
    rating_criteria?: RatingCriteria;
    yt_fallback_stars?: number;
    yt_manager_adjustment_key?: string;
    passthrough_scale_min?: number;
    passthrough_scale_max?: number;
    passthrough_manager_adjustment_key?: string;
    rm_target_rtc?: number;
    rm_target_foia?: number;
    rm_target_foia_pitched?: number;
    min_stars?: number;
    max_stars?: number;
    blocks_final_score?: boolean;
    team_quality_variables?: string[];
    manager_question_keys?: string[];
    manager_question_labels?: string[];
    team_question_keys?: string[];
    team_question_labels?: string[];
    manager_rating_criteria?: RatingCriteria;
    team_rating_criteria?: RatingCriteria;
    team_pillar_team_rules_enabled?: boolean;
    team_pillar_zero_below_team_avg?: number;
    team_pillar_cap_below_team_avg?: number;
    team_pillar_cap_max_stars?: number;
    team_question_options?: string[][];
    cm_delivery_hero_multiplier?: number;
    cm_delivery_default_multiplier?: number;
    cm_delivery_hero_case_type_labels?: string[];
    cm_delivery_target_by_manager_name?: Record<string, number>;
}

interface GuardrailCondition {
    section: string;
    operator: string;
    value?: number;
}

interface Guardrail {
    // simple (single)
    condition_section?: string;
    condition_operator?: string;
    condition_value?: number;
    // multi-condition
    conditions?: GuardrailCondition[];
    condition_logic?: "AND" | "OR";
    action: "cap_final" | "floor_final" | "block_final";
    action_value?: number;
    message?: string;
}

interface Variable {
    key: string;
    label: string;
    source: string;
    description: string;
}

interface PreviewResult {
    user: { id: number; name: string; role: string };
    month: string;
    result: {
        finalScore: number | null;
        finalStars: number | null;
        sections: Array<{
            key: string;
            label: string;
            weight: number;
            stars: number | null;
            rawValue: number | null;
            details: string;
            blocksScore: boolean;
        }>;
        casesCompleted: number;
        manualRatingsPending: boolean;
        guardrailsApplied: string[];
    };
}

// ═══════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════

const SECTION_TYPES = [
    { value: "bracket_lookup",              label: "Bracket Lookup",              desc: "Map a numeric variable → stars via bracket table" },
    { value: "manager_questions_avg",       label: "Manager Questions Avg",       desc: "Average manager-entered question responses → stars" },
    { value: "manager_direct_rating",       label: "Manager Direct Rating",       desc: "Manager gives a single 1–5 star rating with description (no sub-questions)" },
    { value: "matrix_lookup",              label: "Matrix Lookup",               desc: "Map (cases × quality stars) → stars via 2D table" },
    { value: "yt_baseline_ratio",          label: "YouTube Baseline Ratio",      desc: "YouTube views vs channel baseline → stars" },
    {
        value: "rm_pipeline_targets_avg",
        label: "RM pipeline vs targets (3-way avg)",
        desc: "Research Manager: score RTC, FOIA, FOIA pitched each as actual÷target×5 (cap 5★), then average the three",
    },
    { value: "passthrough",                label: "Passthrough",                 desc: "Variable → stars: linear scale (optional) or raw 1–5; optional ±0.5 manager adjustment" },
    { value: "team_quality_avg",           label: "Team Quality Avg",            desc: "Average team members' quality scores from their MonthlyRating (for CM/PM)" },
    { value: "combined_team_manager_rating", label: "Combined Team + Manager",   desc: "50% manager self-rating + 50% team members' avg rating of manager" },
];

const SOURCE_OPTIONS = [
    { value: "clickup", label: "ClickUp" },
    { value: "manager", label: "Manager" },
    { value: "youtube", label: "YouTube" },
    { value: "formula", label: "ClickUp x Formula (derived)" },
];

/** Keep `team_question_options` aligned with `team_question_keys` (3 labels per question). */
function padTeamQuestionOptions(n: number, prev: string[][] | undefined): string[][] {
    const out: string[][] = [];
    for (let i = 0; i < n; i++) {
        const row = prev?.[i];
        if (row && row.length >= 3) {
            out.push([row[0] ?? "Option 1", row[1] ?? "Option 2", row[2] ?? "Option 3"]);
        } else {
            out.push(["Disagree", "Neutral", "Agree"]);
        }
    }
    return out;
}

const SOURCE_COLORS: Record<string, string> = {
    clickup: "bg-violet-500/20 text-violet-300 border-violet-500/30",
    manager: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    youtube: "bg-red-500/20 text-red-300 border-red-500/30",
    formula: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

const DEFAULT_QUALITY_BRACKETS: Bracket[] = [
    { min: 0,  max: 29, stars: 1 },
    { min: 30, max: 34, stars: 2 },
    { min: 35, max: 39, stars: 3 },
    { min: 40, max: 44, stars: 4 },
    { min: 45, max: 50, stars: 5 },
];

const DEFAULT_YT_BRACKETS: Bracket[] = [
    { min: 0,   max: 50,          stars: 1 },
    { min: 51,  max: 95,          stars: 2 },
    { min: 95,  max: 105,         stars: 3 },
    { min: 105, max: 200,         stars: 4 },
    { min: 201, max: 999_999_999, stars: 5 },
];

const DEFAULT_MATRIX = {
    "2": { "5": 4, "4": 3, "3": 2, "2": 1, "1": 1 },
    "3": { "5": 5, "4": 4, "3": 3, "2": 2, "1": 1 },
    "4": { "5": 5, "4": 5, "3": 3, "2": 2, "1": 1 },
};

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

function StarDisplay({ stars }: { stars: number | null }) {
    if (stars === null) return <span className="text-slate-500 text-xs">Pending</span>;
    return (
        <span className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((s) => (
                <svg key={s} className={`w-3.5 h-3.5 ${stars >= s ? "text-amber-400" : "text-slate-600"}`} fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
            ))}
            <span className="text-slate-600 dark:text-slate-300 text-xs ml-1">{stars.toFixed(2)}</span>
        </span>
    );
}

function newBlankSection(): Section {
    return {
        key: "",
        label: "",
        weight: 0.20,
        type: "bracket_lookup",
        source: "clickup",
        variable: "",
        brackets: [...DEFAULT_QUALITY_BRACKETS],
        blocks_final_score: false,
    };
}

// ═══════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════

type View = "list" | "create" | "edit";

export default function FormulaTemplatePage() {
    const [view, setView] = useState<View>("list");
    const [templates, setTemplates] = useState<FormulaTemplate[]>([]);
    const [variables, setVariables] = useState<Variable[]>([]);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState<string | null>(null);
    const [activeRole, setActiveRole] = useState<"writer" | "editor" | "hr_manager" | "production_manager" | "researcher_manager" | "researcher_foia" | "researcher_rtc" | "researcher_foia_pitching">("writer");
    const [actionMsg, setActionMsg] = useState<string | null>(null);
    const [activating, setActivating] = useState<number | null>(null);
    const [deleting, setDeleting]     = useState<number | null>(null);
    const [editingTemplate, setEditingTemplate] = useState<FormulaTemplate | null>(null);

    // Preview
    const [previewUserId, setPreviewUserId]         = useState("");
    const [previewMonth, setPreviewMonth]           = useState(() => {
        const n = new Date();
        return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
    });
    const [previewTemplateId, setPreviewTemplateId] = useState<number | null>(null);
    const [previewResult, setPreviewResult]         = useState<PreviewResult | null>(null);
    const [previewing, setPreviewing]               = useState(false);
    const [previewError, setPreviewError]           = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [tRes, vRes] = await Promise.all([
                fetch("/api/ratings/formula-template"),
                fetch("/api/ratings/variables"),
            ]);
            if (!tRes.ok) throw new Error(await tRes.text());
            if (!vRes.ok) throw new Error(await vRes.text());
            setTemplates(await tRes.json());
            setVariables((await vRes.json()).variables ?? []);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const activateTemplate = async (id: number) => {
        setActivating(id);
        setActionMsg(null);
        try {
            const res = await fetch(`/api/ratings/formula-template/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "activate" }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setActionMsg(`✓ ${data.message}`);
            await loadData();
        } catch (e: any) {
            setActionMsg(`✗ ${e.message}`);
        } finally {
            setActivating(null);
        }
    };

    const deleteTemplate = async (id: number) => {
        if (!confirm("Delete this template? This cannot be undone.")) return;
        setDeleting(id);
        setActionMsg(null);
        try {
            const res = await fetch(`/api/ratings/formula-template/${id}`, { method: "DELETE" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setActionMsg(`✓ Template deleted.`);
            await loadData();
        } catch (e: any) {
            setActionMsg(`✗ ${e.message}`);
        } finally {
            setDeleting(null);
        }
    };

    const runPreview = async () => {
        if (!previewUserId || !previewMonth) return;
        setPreviewing(true);
        setPreviewResult(null);
        setPreviewError(null);
        try {
            const body: any = { userId: parseInt(previewUserId), month: previewMonth };
            if (previewTemplateId) body.templateId = previewTemplateId;
            const res = await fetch("/api/ratings/formula-template/preview", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Preview failed");
            setPreviewResult(data);
        } catch (e: any) {
            setPreviewError(e.message);
        } finally {
            setPreviewing(false);
        }
    };

    const roleTemplates = templates.filter((t) => t.roleType === activeRole);
    const activeTemplate = roleTemplates.find((t) => t.isActive);

    if (view === "create") {
        return (
            <CreateTemplateView
                variables={variables}
                existingTemplates={templates}
                onCreated={async () => { await loadData(); setView("list"); }}
                onCancel={() => setView("list")}
            />
        );
    }

    if (view === "edit" && editingTemplate) {
        return (
            <CreateTemplateView
                variables={variables}
                existingTemplates={templates}
                editTemplate={editingTemplate}
                onCreated={async () => { await loadData(); setView("list"); setEditingTemplate(null); }}
                onCancel={() => { setView("list"); setEditingTemplate(null); }}
            />
        );
    }

    return (
        <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-6">
            <div className="max-w-5xl mx-auto space-y-7">

                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Formula Templates</h1>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                            Version-controlled rating formulas. Changing a formula never overwrites old ratings.
                        </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                        <a href="/dashboard/scores/admin" className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2">
                            ← Back
                        </a>
                        <button
                            onClick={() => { setView("create"); setActionMsg(null); }}
                            className="text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-2 font-medium"
                        >
                            + New Template
                        </button>
                    </div>
                </div>

                {actionMsg && (
                    <div className={`text-sm rounded-lg px-4 py-3 border ${actionMsg.startsWith("✓") ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-red-500/10 border-red-500/30 text-red-300"}`}>
                        {actionMsg}
                    </div>
                )}
                {error && (
                    <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-4 py-3 text-sm">{error}</div>
                )}

                {/* Department tabs + sub-role tabs */}
                {(() => {
                    const ROLE_LABEL: Record<string, string> = {
                        writer: "Writer", editor: "Editor", production_manager: "CM / PM",
                        hr_manager: "HR Manager",
                        researcher_manager: "Research Manager",
                        researcher_foia: "FOIA", researcher_rtc: "RTC", researcher_foia_pitching: "FOIA Pitching",
                    };
                    const DEPTS = [
                        { key: "production", label: "Production", roles: ["writer", "editor", "production_manager"] },
                        { key: "hr", label: "HR Dept.", roles: ["hr_manager"] },
                        {
                            key: "researchers",
                            label: "Researchers Dept.",
                            roles: ["researcher_manager", "researcher_foia", "researcher_rtc", "researcher_foia_pitching"],
                        },
                    ];
                    const activeDept = DEPTS.find((d) => d.roles.includes(activeRole)) ?? DEPTS[0];
                    return (
                        <div className="space-y-3">
                            {/* Department-level tabs */}
                            <div className="flex gap-2">
                                {DEPTS.map((dept) => {
                                    const isActive = dept.key === activeDept.key;
                                    return (
                                        <button key={dept.key}
                                            onClick={() => setActiveRole(dept.roles[0] as any)}
                                            className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${isActive
                                                ? "bg-violet-600 text-white shadow-md"
                                                : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"}`}>
                                            {dept.label}
                                        </button>
                                    );
                                })}
                            </div>
                            {/* Sub-role tabs within active department */}
                            {activeDept.roles.length > 1 && (
                                <div className="flex gap-1.5 pl-1">
                                    {activeDept.roles.map((role) => {
                                        const act = templates.find((t) => t.roleType === role && t.isActive);
                                        return (
                                            <button key={role} onClick={() => setActiveRole(role as any)}
                                                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all border ${activeRole === role
                                                    ? "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30"
                                                    : "bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-violet-300 dark:hover:border-violet-500/30 hover:text-violet-500"}`}>
                                                {ROLE_LABEL[role] ?? role}
                                                {act
                                                    ? <span className="ml-1.5 text-[10px] bg-emerald-500/20 text-emerald-400 px-1 py-0.5 rounded">v{act.version}</span>
                                                    : <span className="ml-1.5 text-[10px] bg-amber-500/20 text-amber-400 px-1 py-0.5 rounded">—</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })()}

                {loading ? (
                    <div className="text-slate-500 dark:text-slate-400 text-sm">Loading...</div>
                ) : (
                    <div className="space-y-5">

                        {/* Template list */}
                        {roleTemplates.length === 0 ? (
                            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center">
                                <p className="text-slate-500 dark:text-slate-400 text-sm mb-1">No templates yet for <strong>{activeRole}</strong>.</p>
                                <p className="text-slate-500 dark:text-slate-500 text-xs mb-4">Create one below, or click "+ New Template" to build from scratch.</p>
                                <button
                                    onClick={() => setView("create")}
                                    className="bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2 rounded-lg"
                                >
                                    + Create First Template
                                </button>
                            </div>
                        ) : (
                            roleTemplates
                                .sort((a, b) => b.version - a.version)
                                .map((tpl) => (
                                    <TemplateCard
                                        key={tpl.id}
                                        template={tpl}
                                        onActivate={activateTemplate}
                                        activating={activating}
                                        onDelete={deleteTemplate}
                                        deleting={deleting}
                                        onEdit={(t) => { setEditingTemplate(t); setView("edit"); }}
                                    />
                                ))
                        )}

                        {/* Preview panel */}
                        <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Preview Formula</h3>
                                <p className="text-xs text-slate-500 mt-0.5">Dry-run against real data — nothing is saved.</p>
                            </div>
                            <div className="flex flex-wrap gap-3">
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs text-slate-500 dark:text-slate-400">User ID</label>
                                    <input type="number" placeholder="e.g. 42" value={previewUserId}
                                        onChange={(e) => setPreviewUserId(e.target.value)}
                                        className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2 w-28" />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Month</label>
                                    <input type="month" value={previewMonth}
                                        onChange={(e) => setPreviewMonth(e.target.value)}
                                        className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2" />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Template</label>
                                    <select value={previewTemplateId ?? ""} onChange={(e) => setPreviewTemplateId(e.target.value ? parseInt(e.target.value) : null)}
                                        className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2">
                                        <option value="">Active template</option>
                                        {templates.filter((t) => t.roleType === activeRole).map((t) => (
                                            <option key={t.id} value={t.id}>v{t.version} — {t.label}{t.isActive ? " (active)" : " (draft)"}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex flex-col justify-end">
                                    <button onClick={runPreview} disabled={previewing || !previewUserId}
                                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg">
                                        {previewing ? "Running..." : "Run Preview"}
                                    </button>
                                </div>
                            </div>
                            {previewError && (
                                <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">{previewError}</div>
                            )}
                            {previewResult && <PreviewResultPanel result={previewResult} />}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════
// Template Card
// ═══════════════════════════════════════════════════════

function TemplateCard({ template, onActivate, activating, onDelete, deleting, onEdit }: {
    template: FormulaTemplate;
    onActivate: (id: number) => void;
    activating: number | null;
    onDelete: (id: number) => void;
    deleting: number | null;
    onEdit: (t: FormulaTemplate) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const totalWeight = template.sections.reduce((s, sec) => s + (sec.weight ?? 0), 0);

    return (
        <div className={`bg-slate-50 dark:bg-slate-900 border rounded-xl overflow-hidden ${template.isActive ? "border-emerald-500/40" : "border-slate-200 dark:border-slate-800"}`}>
            <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-mono font-bold ${template.isActive ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400"}`}>
                        v{template.version}
                    </span>
                    {template.isActive && (
                        <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">● ACTIVE</span>
                    )}
                    <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{template.label}</p>
                        {template.description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{template.description}</p>}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{new Date(template.updatedAt).toLocaleDateString()}</span>
                    <button onClick={() => setExpanded((e) => !e)}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1">
                        {expanded ? "Hide" : "View"} Sections
                    </button>
                    {/* Edit — always available */}
                    <button
                        onClick={() => onEdit(template)}
                        title={template.isActive ? "Clone as new version" : "Edit this draft"}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-700 hover:border-slate-500 rounded-lg px-3 py-1 transition-colors"
                    >
                        {template.isActive ? "Clone" : "Edit"}
                    </button>

                    {/* Delete — only inactive with no usage */}
                    {!template.isActive && (
                        <button
                            onClick={() => onDelete(template.id)}
                            disabled={deleting === template.id}
                            className="text-xs text-rose-400 hover:text-white border border-rose-500/30 hover:bg-rose-500/20 disabled:opacity-50 rounded-lg px-3 py-1 transition-colors"
                        >
                            {deleting === template.id ? "Deleting..." : "Delete"}
                        </button>
                    )}

                    {!template.isActive && (
                        <button onClick={() => onActivate(template.id)} disabled={activating === template.id}
                            className="text-xs bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg px-3 py-1">
                            {activating === template.id ? "Activating..." : "Activate"}
                        </button>
                    )}
                </div>
            </div>

            {expanded && (
                <div className="border-t border-slate-200 dark:border-slate-800 px-5 py-4 space-y-3">
                    <div className="flex justify-between mb-1">
                        <span className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">Sections ({template.sections.length})</span>
                        <span className={`text-xs ${Math.abs(totalWeight - 1) < 0.01 ? "text-emerald-400" : "text-red-400"}`}>
                            Weights total: {(totalWeight * 100).toFixed(0)}%{Math.abs(totalWeight - 1) > 0.01 ? " ⚠ must be 100%" : ""}
                        </span>
                    </div>
                    {template.sections.map((sec, i) => (
                        <div key={i} className="flex items-start gap-3 bg-slate-100/50 dark:bg-slate-800/50 rounded-lg px-3 py-2.5">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium text-slate-900 dark:text-white">{sec.label}</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded border ${SOURCE_COLORS[sec.source] ?? ""}`}>{sec.source}</span>
                                    <span className="text-xs bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded">{sec.type}</span>
                                    {sec.blocks_final_score && <span className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded">blocks score</span>}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 space-y-0.5">
                                    {sec.variable && <p>Variable: <code className="text-violet-300">{sec.variable}</code></p>}
                                    {sec.question_keys && <p>Questions: <code className="text-blue-300">{sec.question_keys.join(", ")}</code></p>}
                                    {sec.variable_x && <p>X: <code className="text-violet-300">{sec.variable_x}</code> · Y-section: <code className="text-violet-300">{sec.variable_y_section}</code></p>}
                                    {sec.brackets && <p>Brackets: {sec.brackets.map((b) => `${b.min}–${b.max}→${b.stars}★`).join(" · ")}</p>}
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                <div className="text-lg font-bold text-slate-900 dark:text-white">{(sec.weight * 100).toFixed(0)}%</div>
                            </div>
                        </div>
                    ))}
                    {template.guardrails?.length > 0 && (
                        <div className="pt-2 border-t border-slate-300 dark:border-slate-700 space-y-1">
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Guardrails</p>
                            {template.guardrails.map((g, i) => (
                                <div key={i} className="text-xs bg-orange-500/10 border border-orange-500/30 text-orange-300 rounded px-2 py-1">
                                    If {g.condition_section} {g.condition_operator} {g.condition_value} → {g.action} {g.action_value ?? ""} · {g.message}
                                </div>
                            ))}
                        </div>
                    )}
                    <p className="text-xs text-slate-500 pt-1 border-t border-slate-200 dark:border-slate-800">
                        Template ID: <code className="text-slate-500 dark:text-slate-400">{template.id}</code> · Created: {new Date(template.createdAt).toLocaleString()}
                    </p>
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════
// Create Template View — full interactive form
// ═══════════════════════════════════════════════════════

function CreateTemplateView({
    variables,
    existingTemplates,
    editTemplate,
    onCreated,
    onCancel,
}: {
    variables: Variable[];
    existingTemplates: FormulaTemplate[];
    editTemplate?: FormulaTemplate;
    onCreated: () => void;
    onCancel: () => void;
}) {
    const isEditMode = !!editTemplate;
    // Active templates cannot be edited in-place — clone as new version instead
    const willClone  = isEditMode && editTemplate!.isActive;

    const [roleType, setRoleType]     = useState<"writer" | "editor" | "hr_manager" | "production_manager" | "researcher_manager" | "researcher_foia" | "researcher_rtc" | "researcher_foia_pitching">(
        (editTemplate?.roleType as "writer" | "editor" | "hr_manager" | "production_manager" | "researcher_manager" | "researcher_foia" | "researcher_rtc" | "researcher_foia_pitching") ?? "writer"
    );
    const [label, setLabel]           = useState(
        editTemplate ? (willClone ? `${editTemplate.label} (v${editTemplate.version + 1})` : editTemplate.label) : ""
    );
    const [description, setDescription] = useState(editTemplate?.description ?? "");
    const [sections, setSections]     = useState<Section[]>(
        editTemplate ? JSON.parse(JSON.stringify(editTemplate.sections)) : []
    );
    const [guardrails, setGuardrails] = useState<Guardrail[]>(
        editTemplate ? JSON.parse(JSON.stringify(editTemplate.guardrails ?? [])) : []
    );
    const [roundOff, setRoundOff]     = useState(editTemplate?.roundOff ?? false);
    const [assignedUserIds, setAssignedUserIds] = useState<number[]>(
        Array.isArray((editTemplate as any)?.assignedUserIds) ? (editTemplate as any).assignedUserIds : []
    );
    const [allResearchers, setAllResearchers] = useState<{ id: number; name: string }[]>([]);
    const [saving, setSaving]         = useState(false);
    const [saveError, setSaveError]   = useState<string | null>(null);
    const [activateAfter, setActivateAfter] = useState(true);

    /** FOIA/RTC researcher templates — assign which `researcher` users use this formula (not Research Manager). */
    const isResearcherAssignableRole = ["researcher_foia", "researcher_rtc", "researcher_foia_pitching"].includes(roleType);

    // Fetch all researchers when a researcher role is selected
    useEffect(() => {
        if (isResearcherAssignableRole && allResearchers.length === 0) {
            fetch("/api/users?all=true")
                .then((r) => r.json())
                .then((data) => {
                    const users = Array.isArray(data) ? data : [];
                    const researchers = users.filter((u: any) => u.role === "researcher");
                    setAllResearchers(researchers.map((u: any) => ({ id: u.id, name: u.name })));
                })
                .catch(() => {});
        }
    }, [isResearcherAssignableRole]);

    // Load defaults from active template for selected role (only in create mode)
    const loadDefaults = () => {
        if (isEditMode) return;
        const active = existingTemplates.find((t) => t.roleType === roleType && t.isActive);
        if (active) {
            setSections(JSON.parse(JSON.stringify(active.sections)));
            setLabel(`${active.label} (copy)`);
            setDescription(active.description ?? "");
        } else {
            setSections([newBlankSection()]);
            setLabel("");
        }
    };

    useEffect(() => { if (!isEditMode) loadDefaults(); }, [roleType]);

    const addSection = () => setSections((s) => [...s, newBlankSection()]);

    const removeSection = (i: number) =>
        setSections((s) => s.filter((_, idx) => idx !== i));

    const updateSection = (i: number, patch: Partial<Section>) =>
        setSections((s) => s.map((sec, idx) => idx === i ? { ...sec, ...patch } : sec));

    const moveSection = (i: number, dir: -1 | 1) => {
        setSections((s) => {
            const arr = [...s];
            const j = i + dir;
            if (j < 0 || j >= arr.length) return arr;
            [arr[i], arr[j]] = [arr[j], arr[i]];
            return arr;
        });
    };

    const totalWeight = sections.reduce((s, sec) => s + (Number(sec.weight) || 0), 0);
    const weightOk    = Math.abs(totalWeight - 1) < 0.01;

    const save = async () => {
        setSaveError(null);
        if (!label.trim()) { setSaveError("Label is required."); return; }
        if (!weightOk) { setSaveError(`Weights must sum to 100%. Currently: ${(totalWeight * 100).toFixed(1)}%`); return; }

        setSaving(true);
        try {
            let savedId: number;

            if (isEditMode && !willClone) {
                // Edit inactive draft in-place (PUT)
                const res = await fetch(`/api/ratings/formula-template/${editTemplate!.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ label: label.trim(), description: description.trim() || null, sections, guardrails, roundOff, assignedUserIds: isResearcherAssignableRole ? assignedUserIds : null }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error ?? "Save failed");
                savedId = editTemplate!.id;
            } else {
                // Create new version (POST) — used for brand-new templates and cloning active ones
                const res = await fetch("/api/ratings/formula-template", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ roleType, label: label.trim(), description: description.trim() || null, sections, guardrails, roundOff, assignedUserIds: isResearcherAssignableRole ? assignedUserIds : null }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error ?? "Save failed");
                savedId = data.id;
            }

            if (activateAfter) {
                const actRes = await fetch(`/api/ratings/formula-template/${savedId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "activate" }),
                });
                if (!actRes.ok) {
                    const actData = await actRes.json();
                    throw new Error(`Saved but activation failed: ${actData.error}`);
                }
            }
            onCreated();
        } catch (e: any) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-6">
            <div className="max-w-4xl mx-auto space-y-6">

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                            {isEditMode
                                ? willClone
                                    ? `Clone Template — ${editTemplate!.label} (v${editTemplate!.version})`
                                    : `Edit Draft — ${editTemplate!.label} (v${editTemplate!.version})`
                                : "New Formula Template"}
                        </h1>
                        <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
                            {willClone
                                ? "Active templates cannot be edited in-place. This will save as a new version."
                                : "Build a version-controlled rating formula. It saves as a draft unless you activate it."}
                        </p>
                    </div>
                    <button onClick={onCancel} className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2">
                        ← Cancel
                    </button>
                </div>

                {/* Meta */}
                <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                    <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Template Details</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs text-slate-500 dark:text-slate-400">Role *</label>
                            <select value={roleType} onChange={(e) => setRoleType(e.target.value as any)}
                                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2">
                                <option value="writer">Writer</option>
                                <option value="editor">Editor</option>
                                <option value="hr_manager">HR Manager</option>
                                <option value="production_manager">CM / Production Manager</option>
                                <option value="researcher_manager">Research Manager</option>
                                <option value="researcher_foia">FOIA Researcher</option>
                                <option value="researcher_rtc">RTC Researcher</option>
                                <option value="researcher_foia_pitching">FOIA Pitching Researcher</option>
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-slate-500 dark:text-slate-400">Label *</label>
                            <input value={label} onChange={(e) => setLabel(e.target.value)}
                                placeholder="e.g. Writer Rating v2 — Updated Weights"
                                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2" />
                        </div>
                        <div className="md:col-span-2 space-y-1">
                            <label className="text-xs text-slate-500 dark:text-slate-400">Description (optional)</label>
                            <input value={description} onChange={(e) => setDescription(e.target.value)}
                                placeholder="What changed in this version?"
                                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2" />
                        </div>

                        {/* Assigned Researchers — only for researcher roles */}
                        {isResearcherAssignableRole && (
                            <div className="md:col-span-2 space-y-2">
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                    Assigned Researchers *
                                    <span className="ml-1 text-slate-400">({assignedUserIds.length} selected)</span>
                                </label>
                                <div className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-3 max-h-48 overflow-y-auto space-y-1">
                                    {allResearchers.length === 0 ? (
                                        <p className="text-xs text-slate-500">Loading researchers...</p>
                                    ) : (
                                        allResearchers.map((u) => (
                                            <label key={u.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded px-2 py-1">
                                                <input
                                                    type="checkbox"
                                                    checked={assignedUserIds.includes(u.id)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) setAssignedUserIds((ids) => [...ids, u.id]);
                                                        else setAssignedUserIds((ids) => ids.filter((id) => id !== u.id));
                                                    }}
                                                    className="w-3.5 h-3.5 rounded accent-violet-500"
                                                />
                                                <span className="text-sm text-slate-700 dark:text-slate-300">{u.name}</span>
                                                <span className="text-xs text-slate-400">#{u.id}</span>
                                            </label>
                                        ))
                                    )}
                                </div>
                                <p className="text-[10px] text-slate-500">Select which researchers belong to this formula group. Only selected users will be rated with this template.</p>
                            </div>
                        )}
                    </div>
                    <button onClick={loadDefaults}
                        className="text-xs text-violet-400 hover:text-violet-300 border border-violet-500/30 rounded-lg px-3 py-1.5">
                        ↺ Load from active {roleType} template
                    </button>
                </div>

                {/* Sections */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Sections (Pillars)</h2>
                            <p className="text-xs text-slate-500 mt-0.5">Each section is a rating pillar. Weights must sum to 100%.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className={`text-sm font-bold ${weightOk ? "text-emerald-400" : "text-red-400"}`}>
                                {(totalWeight * 100).toFixed(0)}% / 100%
                            </span>
                            <button onClick={addSection}
                                className="text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5">
                                + Add Section
                            </button>
                        </div>
                    </div>

                    {sections.length === 0 && (
                        <div className="text-center py-8 text-slate-500 text-sm border border-dashed border-slate-300 dark:border-slate-700 rounded-xl">
                            No sections yet. Click "+ Add Section" to start.
                        </div>
                    )}

                    {sections.map((sec, i) => (
                        <SectionEditor
                            key={i}
                            index={i}
                            section={sec}
                            variables={variables}
                            allSections={sections}
                            existingTemplates={existingTemplates}
                            currentRoleType={roleType}
                            onChange={(patch) => updateSection(i, patch)}
                            onRemove={() => removeSection(i)}
                            onMoveUp={i > 0 ? () => moveSection(i, -1) : undefined}
                            onMoveDown={i < sections.length - 1 ? () => moveSection(i, 1) : undefined}
                        />
                    ))}
                </div>

                {/* Guardrails */}
                <GuardrailEditor
                    guardrails={guardrails}
                    sections={sections}
                    onChange={setGuardrails}
                />

                {/* Save */}
                <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                    <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Save &amp; Activate</h2>

                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={roundOff} onChange={(e) => setRoundOff(e.target.checked)}
                            className="w-4 h-4 rounded accent-violet-500" />
                        <span className="text-sm text-slate-600 dark:text-slate-300">Round off pillar stars</span>
                        <span className="text-xs text-slate-500">(when off, pillar stars keep decimal values like 3.67)</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={activateAfter} onChange={(e) => setActivateAfter(e.target.checked)}
                            className="w-4 h-4 rounded accent-violet-500" />
                        <span className="text-sm text-slate-600 dark:text-slate-300">Activate immediately after saving</span>
                        <span className="text-xs text-slate-500">(deactivates the current active template for {roleType})</span>
                    </label>

                    {saveError && (
                        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-lg px-4 py-3">
                            {saveError}
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button onClick={save} disabled={saving || sections.length === 0}
                            className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm px-6 py-2.5 rounded-lg font-medium">
                            {saving ? "Saving..." : activateAfter ? "Save & Activate" : "Save as Draft"}
                        </button>
                        <button onClick={onCancel} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 px-4 py-2.5">
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════
// Guardrail Editor
// ═══════════════════════════════════════════════════════

const OPERATORS = ["<", "<=", "==", ">=", ">", "is_null", "is_not_null"] as const;
const GUARDRAIL_ACTIONS = [
    { value: "cap_final",   label: "Cap final score at" },
    { value: "floor_final", label: "Floor final score at" },
    { value: "block_final", label: "Block final score entirely" },
] as const;

function newGuardrail(): Guardrail {
    return { conditions: [{ section: "", operator: "<", value: 4 }], condition_logic: "AND", action: "cap_final", action_value: 4, message: "" };
}

function GuardrailEditor({
    guardrails,
    sections,
    onChange,
}: {
    guardrails: Guardrail[];
    sections: Section[];
    onChange: (g: Guardrail[]) => void;
}) {
    const sectionKeys = sections.map((s) => ({ key: s.key, label: s.label || s.key }));
    const updateGuardrail = (i: number, patch: Partial<Guardrail>) =>
        onChange(guardrails.map((g, idx) => idx === i ? { ...g, ...patch } : g));
    const updateCondition = (gi: number, ci: number, patch: Partial<GuardrailCondition>) => {
        const conditions = (guardrails[gi].conditions ?? []).map((c, idx) => idx === ci ? { ...c, ...patch } : c);
        updateGuardrail(gi, { conditions });
    };
    const addCondition = (gi: number) =>
        updateGuardrail(gi, { conditions: [...(guardrails[gi].conditions ?? []), { section: "", operator: "<", value: 4 }] });
    const removeCondition = (gi: number, ci: number) =>
        updateGuardrail(gi, { conditions: (guardrails[gi].conditions ?? []).filter((_, idx) => idx !== ci) });

    const inp = "bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500";

    return (
        <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Guardrails</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Rules that cap, floor, or block the final score based on section results.</p>
                </div>
                <button type="button" onClick={() => onChange([...guardrails, newGuardrail()])}
                    className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg">
                    + Add Rule
                </button>
            </div>

            {guardrails.length === 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg px-4 py-3 text-center">
                    No guardrails. Click "+ Add Rule" to add one.
                </p>
            )}

            {guardrails.map((g, gi) => {
                const conditions = g.conditions ?? [];
                return (
                    <div key={gi} className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Rule {gi + 1}</span>
                            <button type="button" onClick={() => onChange(guardrails.filter((_, i) => i !== gi))}
                                className="text-xs text-rose-400 hover:text-rose-300">Remove</button>
                        </div>

                        {/* Conditions */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">Conditions</span>
                                {conditions.length > 1 && (
                                    <div className="flex gap-1">
                                        {(["AND", "OR"] as const).map((l) => (
                                            <button key={l} type="button"
                                                onClick={() => updateGuardrail(gi, { condition_logic: l })}
                                                className={`text-[10px] px-2 py-0.5 rounded font-bold transition-colors ${(g.condition_logic ?? "AND") === l ? "bg-violet-600 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>
                                                {l}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <button type="button" onClick={() => addCondition(gi)}
                                    className="text-[10px] text-violet-500 hover:text-violet-400 ml-auto">+ condition</button>
                            </div>

                            {conditions.map((cond, ci) => (
                                <div key={ci} className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] text-slate-500 w-6 text-right font-medium">
                                        {ci === 0 ? "IF" : (g.condition_logic ?? "AND")}
                                    </span>
                                    <select value={cond.section} onChange={(e) => updateCondition(gi, ci, { section: e.target.value })} className={inp}>
                                        <option value="">— section —</option>
                                        {sectionKeys.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                                    </select>
                                    <select value={cond.operator} onChange={(e) => updateCondition(gi, ci, { operator: e.target.value })} className={inp}>
                                        {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
                                    </select>
                                    {cond.operator !== "is_null" && cond.operator !== "is_not_null" && (
                                        <input type="number" step="0.5" min="0" max="5"
                                            value={cond.value ?? ""} onChange={(e) => updateCondition(gi, ci, { value: parseFloat(e.target.value) })}
                                            className={`${inp} w-16`} placeholder="★" />
                                    )}
                                    {conditions.length > 1 && (
                                        <button type="button" onClick={() => removeCondition(gi, ci)} className="text-[10px] text-rose-400 hover:text-rose-300">✕</button>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Action */}
                        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-slate-200 dark:border-slate-700">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">→ THEN</span>
                            <select value={g.action} onChange={(e) => updateGuardrail(gi, { action: e.target.value as any })} className={inp}>
                                {GUARDRAIL_ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                            </select>
                            {g.action !== "block_final" && (
                                <input type="number" step="0.5" min="0" max="5"
                                    value={g.action_value ?? ""} onChange={(e) => updateGuardrail(gi, { action_value: parseFloat(e.target.value) })}
                                    className={`${inp} w-16`} placeholder="★" />
                            )}
                        </div>

                        {/* Message */}
                        <input type="text" placeholder="Reason shown in audit (optional)"
                            value={g.message ?? ""} onChange={(e) => updateGuardrail(gi, { message: e.target.value })}
                            className={`${inp} w-full`} />
                    </div>
                );
            })}
        </div>
    );
}

type CmTargetRow = { id: string; name: string; target: string };

function newRowId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function recordToRows(value: Record<string, number> | undefined): CmTargetRow[] {
    const entries = Object.entries(value ?? {});
    if (entries.length === 0) {
        return [{ id: newRowId(), name: "", target: "" }];
    }
    return entries.map(([k, v]) => ({
        id: newRowId(),
        name: k,
        target: Number.isFinite(v) ? String(v) : "",
    }));
}

function rowsToRecord(rows: CmTargetRow[]): Record<string, number> {
    const o: Record<string, number> = {};
    for (const r of rows) {
        const name = r.name.trim();
        if (!name) continue;
        const n = parseFloat(r.target);
        if (!Number.isFinite(n)) continue;
        o[name] = n;
    }
    return o;
}

/** Simple name → target rows; saved as `cm_delivery_target_by_manager_name` on the template (same JSON shape as before). */
function CmDeliveryTargetByManagerList({
    value,
    onApply,
}: {
    value: Record<string, number> | undefined;
    onApply: (o: Record<string, number>) => void;
}) {
    const serialized = JSON.stringify(value ?? {});
    const [rows, setRows] = useState<CmTargetRow[]>(() => recordToRows(value));

    useEffect(() => {
        setRows(recordToRows(value));
    }, [serialized]);

    const commit = (next: CmTargetRow[]) => {
        setRows(next);
        onApply(rowsToRecord(next));
    };

    const updateRow = (id: string, patch: Partial<Pick<CmTargetRow, "name" | "target">>) => {
        commit(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    };

    const addRow = () => {
        commit([...rows, { id: newRowId(), name: "", target: "" }]);
    };

    const removeRow = (id: string) => {
        const next = rows.filter((r) => r.id !== id);
        commit(next.length > 0 ? next : [{ id: newRowId(), name: "", target: "" }]);
    };

    return (
        <div className="space-y-2">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700 overflow-hidden bg-white dark:bg-slate-800/50">
                <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 bg-slate-100/80 dark:bg-slate-900/50 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <span>Manager name (as in User profile)</span>
                    <span className="text-right pr-1">Target cases</span>
                    <span className="w-16 text-center" aria-hidden />
                </div>
                {rows.map((r) => (
                    <div key={r.id} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 items-center">
                        <input
                            type="text"
                            placeholder="e.g. Bhoomika Sharma"
                            value={r.name}
                            onChange={(e) => updateRow(r.id, { name: e.target.value })}
                            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2"
                        />
                        <input
                            type="number"
                            min={0}
                            step={1}
                            placeholder="9"
                            value={r.target}
                            onChange={(e) => updateRow(r.id, { target: e.target.value })}
                            className="w-full sm:w-28 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2"
                        />
                        <div className="flex justify-end sm:justify-center">
                            <button
                                type="button"
                                onClick={() => removeRow(r.id)}
                                className="text-xs px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-500/30"
                                title="Remove row"
                            >
                                Remove
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            <button
                type="button"
                onClick={addRow}
                className="text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline"
            >
                + Add manager
            </button>
        </div>
    );
}

// ═══════════════════════════════════════════════════════
// Section Editor
// ═══════════════════════════════════════════════════════

function SectionEditor({
    index, section, variables, allSections, existingTemplates, currentRoleType,
    onChange, onRemove, onMoveUp, onMoveDown,
}: {
    index: number;
    section: Section;
    variables: Variable[];
    allSections: Section[];
    existingTemplates: FormulaTemplate[];
    currentRoleType: string;
    onChange: (patch: Partial<Section>) => void;
    onRemove: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
}) {
    const [open, setOpen] = useState(true);

    const handleTypeChange = (type: Section["type"]) => {
        const patch: Partial<Section> = { type };
        // Auto-set source and defaults when type changes
        if (type === "bracket_lookup")        { patch.source = "clickup"; patch.brackets = [...DEFAULT_QUALITY_BRACKETS]; patch.variable = ""; }
        if (type === "manager_questions_avg") { patch.source = "manager"; patch.question_keys = ["q1", "q2", "q3", "q4", "q5"]; }
        if (type === "manager_direct_rating") { patch.source = "manager"; patch.rating_key = ""; }
        if (type === "matrix_lookup")         { patch.source = "formula"; patch.variable_x = "cases_completed"; patch.variable_y_section = ""; patch.matrix = JSON.parse(JSON.stringify(DEFAULT_MATRIX)); }
        if (type === "yt_baseline_ratio")     { patch.source = "youtube"; patch.brackets = [...DEFAULT_YT_BRACKETS]; patch.yt_fallback_stars = 3; }
        if (type === "passthrough") {
            patch.source = "formula";
            patch.variable = "";
            patch.passthrough_scale_min = undefined;
            patch.passthrough_scale_max = undefined;
            patch.passthrough_manager_adjustment_key = undefined;
        }
        if (type === "team_quality_avg")      { patch.source = "clickup"; patch.variable = "cm_team_production_quality_avg"; patch.brackets = [...DEFAULT_QUALITY_BRACKETS]; }
        if (type === "combined_team_manager_rating") {
            patch.source = "manager";
            patch.manager_question_keys = ["cm_collab_mgr_q1", "cm_collab_mgr_q2", "cm_collab_mgr_q3", "cm_collab_mgr_q4", "cm_collab_mgr_q5"];
            patch.team_question_keys = ["cm_collab_team_q1", "cm_collab_team_q2", "cm_collab_team_q3", "cm_collab_team_q4", "cm_collab_team_q5"];
            patch.team_question_options = Array.from({ length: 5 }, () => ["Disagree", "Neutral", "Agree"]);
        }
        if (type === "rm_pipeline_targets_avg") {
            patch.source = "formula";
            patch.rm_target_rtc = 15;
            patch.rm_target_foia = 15;
            patch.rm_target_foia_pitched = 10;
        }
        onChange(patch);
    };

    const siblingKeys = allSections
        .filter((_, i) => i < index)
        .map((s) => s.key)
        .filter(Boolean);

    return (
        <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            {/* Section header bar */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex flex-col gap-0.5">
                    <button onClick={onMoveUp} disabled={!onMoveUp} className="text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-30 text-xs leading-none">▲</button>
                    <button onClick={onMoveDown} disabled={!onMoveDown} className="text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-30 text-xs leading-none">▼</button>
                </div>
                <span className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs flex items-center justify-center font-bold">{index + 1}</span>
                <span className="flex-1 text-sm font-medium text-slate-900 dark:text-white">{section.label || <span className="text-slate-500 italic">Untitled section</span>}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded border ${SOURCE_COLORS[section.source] ?? ""}`}>{section.source}</span>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{(Number(section.weight) * 100).toFixed(0)}%</span>
                <button onClick={() => setOpen((o) => !o)} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 text-xs border border-slate-300 dark:border-slate-700 rounded px-2 py-1">
                    {open ? "Collapse" : "Expand"}
                </button>
                <button onClick={onRemove} className="text-red-400 hover:text-red-300 text-xs border border-red-500/30 rounded px-2 py-1">✕</button>
            </div>

            {open && (
                <div className="p-5 space-y-4">
                    {/* Row 1: key, label, weight */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs text-slate-500 dark:text-slate-400">Key (unique ID) *</label>
                            <input value={section.key} onChange={(e) => onChange({ key: e.target.value.replace(/\s+/g, "_") })}
                                placeholder="e.g. writerQuality"
                                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2 font-mono" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-slate-500 dark:text-slate-400">Label (display name) *</label>
                            <input value={section.label} onChange={(e) => onChange({ label: e.target.value })}
                                placeholder="e.g. Writer Quality Score"
                                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-slate-500 dark:text-slate-400">Weight (0–1) *</label>
                            <input type="number" min="0" max="1" step="0.05" value={section.weight}
                                onChange={(e) => onChange({ weight: parseFloat(e.target.value) || 0 })}
                                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2" />
                            <p className="text-xs text-slate-500">= {(Number(section.weight) * 100).toFixed(0)}%</p>
                        </div>
                    </div>

                    {/* Row 2: type, source, flags */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs text-slate-500 dark:text-slate-400">Type *</label>
                            <select value={section.type} onChange={(e) => handleTypeChange(e.target.value as Section["type"])}
                                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2">
                                {SECTION_TYPES.map((t) => (
                                    <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                            </select>
                            <p className="text-xs text-slate-500">{SECTION_TYPES.find((t) => t.value === section.type)?.desc}</p>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-slate-500 dark:text-slate-400">Source</label>
                            <select value={section.source} onChange={(e) => onChange({ source: e.target.value as Section["source"] })}
                                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2">
                                {SOURCE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                        </div>
                        <div className="space-y-2 pt-5">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={!!section.blocks_final_score}
                                    onChange={(e) => onChange({ blocks_final_score: e.target.checked })}
                                    className="w-4 h-4 rounded accent-amber-500" />
                                <span className="text-xs text-slate-600 dark:text-slate-300">Blocks final score if null</span>
                            </label>
                            <p className="text-xs text-slate-500 pl-6">If checked, the overall rating won't be computed until this section has a value (e.g. manager input pending)</p>
                        </div>
                    </div>

                    {/* Type-specific fields */}
                    {section.type === "rm_pipeline_targets_avg" && (
                        <div className="space-y-3 rounded-lg border border-teal-500/25 bg-teal-500/5 p-4">
                            <p className="text-xs text-slate-600 dark:text-slate-300">
                                Uses <code className="text-teal-600 dark:text-teal-400">rm_pipeline_rtc_count</code>,{" "}
                                <code className="text-teal-600 dark:text-teal-400">rm_pipeline_foia_count</code>,{" "}
                                <code className="text-teal-600 dark:text-teal-400">rm_foia_pitched_count</code>. Each
                                line: min(5, actual÷target×5)★; pillar = average of the three.
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500 dark:text-slate-400">RTC target *</label>
                                    <input
                                        type="number"
                                        min={0.01}
                                        step={1}
                                        value={section.rm_target_rtc ?? ""}
                                        onChange={(e) =>
                                            onChange({
                                                rm_target_rtc:
                                                    e.target.value === "" ? undefined : parseFloat(e.target.value),
                                            })
                                        }
                                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm rounded-lg px-3 py-2"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500 dark:text-slate-400">FOIA target *</label>
                                    <input
                                        type="number"
                                        min={0.01}
                                        step={1}
                                        value={section.rm_target_foia ?? ""}
                                        onChange={(e) =>
                                            onChange({
                                                rm_target_foia:
                                                    e.target.value === "" ? undefined : parseFloat(e.target.value),
                                            })
                                        }
                                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm rounded-lg px-3 py-2"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500 dark:text-slate-400">FOIA pitched target *</label>
                                    <input
                                        type="number"
                                        min={0.01}
                                        step={1}
                                        value={section.rm_target_foia_pitched ?? ""}
                                        onChange={(e) =>
                                            onChange({
                                                rm_target_foia_pitched:
                                                    e.target.value === "" ? undefined : parseFloat(e.target.value),
                                            })
                                        }
                                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm rounded-lg px-3 py-2"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {(section.type === "bracket_lookup") && (
                        <BracketEditor
                            label="Brackets (value → stars)"
                            brackets={section.brackets ?? []}
                            onChange={(brackets) => onChange({ brackets })}
                            variableField={
                                <VariableSelect
                                    value={section.variable ?? ""}
                                    onChange={(v) => onChange({ variable: v, ...(v === "cm_delivery_pct" ? { source: "formula" as const } : {}) })}
                                    variables={variables}
                                />
                            }
                        />
                    )}

                    {(section.type === "bracket_lookup") && section.variable === "cm_delivery_pct" && (
                        <div className="space-y-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                            <p className="text-xs font-medium text-amber-800 dark:text-amber-200/90">
                                CM Monthly Delivery % — uses ClickUp <code className="text-amber-700 dark:text-amber-300">Case.caseType</code> on the main task; Video QA1 subtask still gates which cases qualify.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Quality threshold (both writer &amp; editor &gt;)</label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={50}
                                        step={1}
                                        value={section.qualify_threshold ?? 32}
                                        onChange={(e) => onChange({ qualify_threshold: parseInt(e.target.value, 10) || 0 })}
                                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Hero case multiplier</label>
                                    <input
                                        type="number"
                                        min={0}
                                        step={0.1}
                                        value={section.cm_delivery_hero_multiplier === undefined ? "" : section.cm_delivery_hero_multiplier}
                                        onChange={(e) => {
                                            const raw = e.target.value;
                                            if (raw === "") {
                                                onChange({ cm_delivery_hero_multiplier: undefined });
                                                return;
                                            }
                                            const n = parseFloat(raw);
                                            if (!Number.isNaN(n)) onChange({ cm_delivery_hero_multiplier: n });
                                        }}
                                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2"
                                    />
                                    <p className="text-[10px] text-slate-500">Leave empty for unweighted case count (legacy). Example: 1.3 for Hero.</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Default / non-hero multiplier</label>
                                    <input
                                        type="number"
                                        min={0}
                                        step={0.1}
                                        value={section.cm_delivery_default_multiplier ?? 1}
                                        onChange={(e) => onChange({ cm_delivery_default_multiplier: parseFloat(e.target.value) })}
                                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-slate-500 dark:text-slate-400">Hero case type labels (comma-separated, match Case type)</label>
                                <input
                                    type="text"
                                    placeholder="hero"
                                    value={(section.cm_delivery_hero_case_type_labels ?? ["hero"]).join(", ")}
                                    onChange={(e) => onChange({
                                        cm_delivery_hero_case_type_labels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                                    })}
                                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                    Target by manager name — optional; overrides profile <code className="text-slate-600 dark:text-slate-400">monthlyDeliveryTargetCases</code> when <code className="text-slate-600 dark:text-slate-400">User.name</code> matches (case-insensitive)
                                </label>
                                <CmDeliveryTargetByManagerList
                                    value={section.cm_delivery_target_by_manager_name}
                                    onApply={(o) => onChange({ cm_delivery_target_by_manager_name: o })}
                                />
                                <p className="text-[10px] text-slate-500">
                                    One row per CM: enter the display name and monthly target case count. Saved as structured data on the template — no JSON needed.
                                </p>
                            </div>
                        </div>
                    )}

                    {section.type === "manager_direct_rating" && (
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <label className="text-xs text-slate-500 dark:text-slate-400">Rating key <span className="text-slate-500 dark:text-slate-600">(stored in ratingsJson)</span></label>
                                <input
                                    type="text"
                                    placeholder="e.g. research_quality"
                                    value={section.rating_key ?? ""}
                                    onChange={(e) => onChange({ rating_key: e.target.value || undefined })}
                                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-blue-600 dark:text-blue-300 font-mono text-sm rounded-lg px-3 py-2 placeholder-slate-400 dark:placeholder-slate-600"
                                />
                                <p className="text-[10px] text-slate-500">Must be unique across all sections in this template.</p>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-slate-500 dark:text-slate-400">Description <span className="text-slate-500 dark:text-slate-600">(shown to manager — explain what to rate)</span></label>
                                <textarea
                                    rows={3}
                                    placeholder="e.g. Rate how well the writer researches topics. Consider depth of research, accuracy of facts, quality of sources, and how well data supports arguments..."
                                    value={section.description ?? ""}
                                    onChange={(e) => onChange({ description: e.target.value || undefined })}
                                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2 placeholder-slate-400 dark:placeholder-slate-600 resize-none"
                                />
                            </div>
                            <RatingCriteriaEditor
                                value={section.rating_criteria}
                                onChange={(rating_criteria) => onChange({ rating_criteria })}
                                sectionKey={section.key}
                                existingTemplates={existingTemplates}
                                currentRoleType={currentRoleType}
                            />
                        </div>
                    )}

                    {section.type === "manager_questions_avg" && (
                        <div className="space-y-3">
                            {/* Section description shown to manager in rating form */}
                            <div className="space-y-1">
                                <label className="text-xs text-slate-500 dark:text-slate-400">Section description <span className="text-slate-500 dark:text-slate-600">(shown to manager)</span></label>
                                <textarea
                                    rows={2}
                                    placeholder="e.g. Rate the script quality based on creativity, research, structure..."
                                    value={section.description ?? ""}
                                    onChange={(e) => onChange({ description: e.target.value || undefined })}
                                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2 placeholder-slate-400 dark:placeholder-slate-600 resize-none"
                                />
                            </div>
                            <RatingCriteriaEditor
                                value={section.rating_criteria}
                                onChange={(rating_criteria) => onChange({ rating_criteria })}
                                sectionKey={section.key}
                                existingTemplates={existingTemplates}
                                currentRoleType={currentRoleType}
                            />
                            <QuestionKeysEditor
                                keys={section.question_keys ?? []}
                                labels={section.question_labels ?? []}
                                onChangeKeys={(question_keys) => onChange({ question_keys })}
                                onChangeLabels={(question_labels) => onChange({ question_labels })}
                            />
                        </div>
                    )}

                    {section.type === "matrix_lookup" && (
                        <div className="space-y-3">
                            <MatrixEditor
                                variableX={section.variable_x ?? "cases_completed"}
                                variableYSection={section.variable_y_section ?? ""}
                                matrix={section.matrix ?? JSON.parse(JSON.stringify(DEFAULT_MATRIX))}
                                siblingKeys={siblingKeys}
                                onChangeX={(v) => onChange({ variable_x: v })}
                                onChangeY={(v) => onChange({ variable_y_section: v })}
                                onChangeMatrix={(matrix) => onChange({ matrix })}
                            />
                            {(section.variable_x === "qualified_writer_cases" || section.variable_x === "qualified_editor_cases") && (
                                <div className="flex items-center gap-3 pt-1">
                                    <label className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                        Quality threshold <span className="text-slate-500 dark:text-slate-600">(out of 50)</span>
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        max="50"
                                        step="1"
                                        value={section.qualify_threshold ?? 32}
                                        onChange={(e) => onChange({ qualify_threshold: parseInt(e.target.value) })}
                                        className="w-20 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2"
                                    />
                                    <span className="text-xs text-slate-500">
                                        Only scripts with quality score &gt; this value count towards targets
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    {section.type === "yt_baseline_ratio" && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <label className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">Fallback stars</label>
                                <input type="number" min="1" max="5" step="1" value={section.yt_fallback_stars ?? 3}
                                    onChange={(e) => onChange({ yt_fallback_stars: parseInt(e.target.value) })}
                                    className="w-20 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2" />
                                <span className="text-xs text-slate-500">Used when video &lt;30 days old or no link</span>
                            </div>
                            <BracketEditor
                                label="YouTube ratio brackets (% of baseline → stars)"
                                brackets={section.brackets ?? [...DEFAULT_YT_BRACKETS]}
                                onChange={(brackets) => onChange({ brackets })}
                            />
                            {/* Manager adjustment key */}
                            <div className="pt-1 space-y-1">
                                <label className="text-xs text-slate-500 dark:text-slate-400">Manager adjustment key <span className="text-slate-500 dark:text-slate-600">(optional)</span></label>
                                <input
                                    type="text"
                                    placeholder="e.g. yt_adjustment"
                                    value={section.yt_manager_adjustment_key ?? ""}
                                    onChange={(e) => onChange({ yt_manager_adjustment_key: e.target.value || undefined })}
                                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2 placeholder-slate-400 dark:placeholder-slate-600"
                                />
                                <p className="text-[10px] text-slate-500">
                                    If set, the manager rating form will show a ±0.5 adjustment control. The value is stored under this key in ratingsJson and applied to the YT star average before rounding. Set to <code className="text-amber-400">yt_adjustment</code> to match the form.
                                </p>
                            </div>
                        </div>
                    )}

                    {section.type === "team_quality_avg" && (
                        <div className="space-y-3">
                            <VariableSelect
                                value={section.variable ?? ""}
                                onChange={(v) => onChange({ variable: v })}
                                variables={variables}
                            />
                            <BracketEditor
                                label="Quality Brackets (team avg → stars)"
                                brackets={section.brackets ?? []}
                                onChange={(b) => onChange({ brackets: b })}
                            />
                        </div>
                    )}

                    {section.type === "combined_team_manager_rating" && (
                        <div className="space-y-3">
                            <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20 text-xs text-sky-400 space-y-1">
                                <p>50% from manager-rated questions + 50% from team members&apos; anonymous ratings.</p>
                                <p className="text-sky-300/90">
                                    Add any number of manager rows and team rows below — each row is one question with its own 1–5 score. Final pillar uses the average across each side&apos;s questions.
                                </p>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-slate-500 dark:text-slate-400">Section description <span className="text-slate-500 dark:text-slate-600">(shown when criteria are disabled)</span></label>
                                <textarea
                                    rows={2}
                                    placeholder="Short summary shown when structured rating criteria are not used..."
                                    value={section.description ?? ""}
                                    onChange={(e) => onChange({ description: e.target.value || undefined })}
                                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2 placeholder-slate-400 dark:placeholder-slate-600 resize-none"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                    Manager rating criteria <span className="text-slate-500 dark:text-slate-600">(CEO/HOD — manager rating form, manager questions)</span>
                                </label>
                                <RatingCriteriaEditor
                                    value={section.manager_rating_criteria ?? section.rating_criteria}
                                    onChange={(manager_rating_criteria) => onChange({ manager_rating_criteria })}
                                    sectionKey={section.key}
                                    existingTemplates={existingTemplates}
                                    currentRoleType={currentRoleType}
                                    audienceHint="CEO/HOD manager form — your questions for this CM/PM"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                    Team rating criteria <span className="text-slate-500 dark:text-slate-600">(anonymous Rate Manager page, team questions)</span>
                                </label>
                                <RatingCriteriaEditor
                                    value={section.team_rating_criteria ?? section.rating_criteria}
                                    onChange={(team_rating_criteria) => onChange({ team_rating_criteria })}
                                    sectionKey={section.key}
                                    existingTemplates={existingTemplates}
                                    currentRoleType={currentRoleType}
                                    audienceHint="anonymous team feedback — how direct reports rate their manager"
                                />
                            </div>
                            <p className="text-[10px] text-slate-500 pl-0.5">
                                If only the legacy <span className="font-mono text-slate-400">rating_criteria</span> field is set (older templates), both sides fall back to it. Enabling manager or team criteria here stores separate pointer structures.
                            </p>
                            <QuestionKeysEditor
                                keys={section.manager_question_keys ?? []}
                                labels={section.manager_question_labels ?? []}
                                onChangeKeys={(manager_question_keys) => onChange({ manager_question_keys })}
                                onChangeLabels={(manager_question_labels) => onChange({ manager_question_labels })}
                                subtitle="(CEO/HOD manager form — unique key + label per row; add as many questions as you need)"
                                addLabel="+ Manager question"
                                keyPrefix="cm_collab_mgr"
                            />
                            <QuestionKeysEditor
                                keys={section.team_question_keys ?? []}
                                labels={section.team_question_labels ?? []}
                                onChangeKeys={(team_question_keys) =>
                                    onChange({
                                        team_question_keys,
                                        team_question_options: padTeamQuestionOptions(
                                            team_question_keys.length,
                                            section.team_question_options,
                                        ),
                                    })
                                }
                                onChangeLabels={(team_question_labels) => onChange({ team_question_labels })}
                                subtitle="(anonymous Rate Manager — each row: 3 choices + 1–5 stars; keys must stay stable)"
                                addLabel="+ Team question"
                                keyPrefix="cm_collab_team"
                            />
                            {(section.team_question_keys ?? []).length > 0 && (
                                <div className="space-y-3 rounded-lg border border-violet-200 dark:border-violet-500/20 bg-violet-50/40 dark:bg-violet-500/[0.06] p-4">
                                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                                        3 answer choices per team question
                                    </p>
                                    <p className="text-[10px] text-slate-500">
                                        Shown as selectable buttons above the star row on Rate Manager. Stored separately from the star score.
                                    </p>
                                    {(section.team_question_keys ?? []).map((qk, qi) => {
                                        const opts = padTeamQuestionOptions(
                                            (section.team_question_keys ?? []).length,
                                            section.team_question_options,
                                        )[qi] ?? ["Option 1", "Option 2", "Option 3"];
                                        const setOpt = (oi: number, val: string) => {
                                            const full = padTeamQuestionOptions(
                                                (section.team_question_keys ?? []).length,
                                                section.team_question_options,
                                            );
                                            const row = [...(full[qi] ?? ["", "", ""])];
                                            row[oi] = val;
                                            full[qi] = [row[0] ?? "", row[1] ?? "", row[2] ?? ""];
                                            onChange({ team_question_options: full });
                                        };
                                        return (
                                            <div key={`${qk}-${qi}`} className="space-y-1.5">
                                                <span className="text-[10px] text-slate-500 font-mono">{qk}</span>
                                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                                    {([0, 1, 2] as const).map((oi) => (
                                                        <input
                                                            key={oi}
                                                            type="text"
                                                            value={opts[oi] ?? ""}
                                                            onChange={(e) => setOpt(oi, e.target.value)}
                                                            placeholder={["Choice 1", "Choice 2", "Choice 3"][oi]}
                                                            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-xs rounded-lg px-2 py-1.5"
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            <div className={`space-y-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4 ${section.team_pillar_team_rules_enabled === false ? "opacity-60" : ""}`}>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={section.team_pillar_team_rules_enabled !== false}
                                        onChange={(e) => onChange({ team_pillar_team_rules_enabled: e.target.checked })}
                                        className="w-4 h-4 rounded accent-amber-500"
                                    />
                                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                        Team-avg pillar rules
                                    </span>
                                </label>
                                <p className="text-[11px] text-slate-500 leading-relaxed pl-6">
                                    Uses the aggregated <span className="font-mono text-slate-400">teamAvg</span> (average of team question scores for the month). Only runs when team feedback exists. Does not apply when only the manager half is present.
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pl-6">
                                    <div className="space-y-1">
                                        <label className="text-[10px] text-slate-500 uppercase tracking-wide">Force 0★ if team avg &lt;</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            max="5"
                                            disabled={section.team_pillar_team_rules_enabled === false}
                                            value={section.team_pillar_zero_below_team_avg ?? 2}
                                            onChange={(e) =>
                                                onChange({
                                                    team_pillar_zero_below_team_avg: parseFloat(e.target.value) || 0,
                                                })
                                            }
                                            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm rounded-lg px-3 py-2 disabled:opacity-50"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] text-slate-500 uppercase tracking-wide">Cap pillar if team avg &lt;</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            max="5"
                                            disabled={section.team_pillar_team_rules_enabled === false}
                                            value={section.team_pillar_cap_below_team_avg ?? 3}
                                            onChange={(e) =>
                                                onChange({
                                                    team_pillar_cap_below_team_avg: parseFloat(e.target.value) || 0,
                                                })
                                            }
                                            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm rounded-lg px-3 py-2 disabled:opacity-50"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] text-slate-500 uppercase tracking-wide">Max ★ when capped</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            max="5"
                                            disabled={section.team_pillar_team_rules_enabled === false}
                                            value={section.team_pillar_cap_max_stars ?? 3.5}
                                            onChange={(e) =>
                                                onChange({
                                                    team_pillar_cap_max_stars: parseFloat(e.target.value) || 0,
                                                })
                                            }
                                            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm rounded-lg px-3 py-2 disabled:opacity-50"
                                        />
                                    </div>
                                </div>
                                <p className="text-[10px] text-slate-500 pl-6">
                                    Default: team avg &lt; 2 → pillar 0★; team avg &lt; 3 (and ≥ 2) → pillar at most 3.5★. Adjust thresholds as needed.
                                </p>
                            </div>
                        </div>
                    )}

                    {section.type === "passthrough" && (
                        <div className="space-y-4 rounded-lg border border-violet-500/20 bg-violet-500/5 p-4">
                            <VariableSelect
                                value={section.variable ?? ""}
                                onChange={(v) => onChange({ variable: v })}
                                variables={variables}
                            />
                            <p className="text-[10px] text-slate-500">
                                Optional: map variable range linearly to 1–5★ (no brackets). Leave min/max empty only if the variable is already on a 1–5 scale.
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Scale min (e.g. 0 for Case Rating)</label>
                                    <input
                                        type="number"
                                        step="any"
                                        placeholder="—"
                                        value={section.passthrough_scale_min ?? ""}
                                        onChange={(e) =>
                                            onChange({
                                                passthrough_scale_min:
                                                    e.target.value === "" ? undefined : parseFloat(e.target.value),
                                            })
                                        }
                                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm rounded-lg px-3 py-2"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Scale max (e.g. 50)</label>
                                    <input
                                        type="number"
                                        step="any"
                                        placeholder="—"
                                        value={section.passthrough_scale_max ?? ""}
                                        onChange={(e) =>
                                            onChange({
                                                passthrough_scale_max:
                                                    e.target.value === "" ? undefined : parseFloat(e.target.value),
                                            })
                                        }
                                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm rounded-lg px-3 py-2"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                    Manager adjustment key <span className="text-slate-500">(±0.5 in Rate manager)</span>
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. rm_case_quality_adjustment"
                                    value={section.passthrough_manager_adjustment_key ?? ""}
                                    onChange={(e) =>
                                        onChange({
                                            passthrough_manager_adjustment_key: e.target.value.trim() || undefined,
                                        })
                                    }
                                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono text-sm rounded-lg px-3 py-2"
                                />
                            </div>
                        </div>
                    )}

                    {/* Optional star clamps */}
                    <div className="flex items-center gap-4 pt-1">
                        <span className="text-xs text-slate-500">Optional star clamps:</span>
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-slate-500 dark:text-slate-400">Min ★</label>
                            <input type="number" min="1" max="5" placeholder="—" value={section.min_stars ?? ""}
                                onChange={(e) => onChange({ min_stars: e.target.value ? parseInt(e.target.value) : undefined })}
                                className="w-16 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-xs rounded px-2 py-1" />
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-slate-500 dark:text-slate-400">Max ★</label>
                            <input type="number" min="1" max="5" placeholder="—" value={section.max_stars ?? ""}
                                onChange={(e) => onChange({ max_stars: e.target.value ? parseInt(e.target.value) : undefined })}
                                className="w-16 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-xs rounded px-2 py-1" />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════
// Sub-editors
// ═══════════════════════════════════════════════════════

function VariableSelect({ value, onChange, variables }: {
    value: string;
    onChange: (v: string) => void;
    variables: Variable[];
}) {
    return (
        <div className="space-y-1">
            <label className="text-xs text-slate-500 dark:text-slate-400">Variable *</label>
            <select value={value} onChange={(e) => onChange(e.target.value)}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2">
                <option value="">— select variable —</option>
                {variables.map((v) => (
                    <option key={v.key} value={v.key}>{v.key} — {v.label}</option>
                ))}
            </select>
            {value && (
                <p className="text-xs text-slate-500">{variables.find((v) => v.key === value)?.description}</p>
            )}
        </div>
    );
}

function BracketEditor({ label, brackets, onChange, variableField }: {
    label: string;
    brackets: Bracket[];
    onChange: (b: Bracket[]) => void;
    variableField?: React.ReactNode;
}) {
    const update = (i: number, field: keyof Bracket, val: string) => {
        const next = brackets.map((b, idx) =>
            idx === i ? { ...b, [field]: field === "stars" ? parseFloat(val) : Number(val) } : b
        );
        onChange(next);
    };
    const add    = () => onChange([...brackets, { min: 0, max: 100, stars: 3 }]);
    const remove = (i: number) => onChange(brackets.filter((_, idx) => idx !== i));

    return (
        <div className="space-y-2">
            {variableField}
            <div className="flex items-center justify-between">
                <label className="text-xs text-slate-500 dark:text-slate-400">{label}</label>
                <button onClick={add} className="text-xs text-violet-400 hover:text-violet-300">+ Row</button>
            </div>
            <div className="space-y-1.5">
                {brackets.map((b, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <input type="number" placeholder="Min" value={b.min}
                            onChange={(e) => update(i, "min", e.target.value)}
                            className="w-24 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-xs rounded px-2 py-1.5" />
                        <span className="text-slate-500 text-xs">–</span>
                        <input type="number" placeholder="Max" value={b.max}
                            onChange={(e) => update(i, "max", e.target.value)}
                            className="w-24 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-xs rounded px-2 py-1.5" />
                        <span className="text-slate-500 text-xs">→</span>
                        <input type="number" min="1" max="5" step="0.5" placeholder="★" value={b.stars}
                            onChange={(e) => update(i, "stars", e.target.value)}
                            className="w-16 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-xs rounded px-2 py-1.5" />
                        <span className="text-slate-500 dark:text-slate-400 text-xs">★</span>
                        <button onClick={() => remove(i)} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function RatingCriteriaEditor({
    value,
    onChange,
    sectionKey,
    existingTemplates,
    currentRoleType,
    audienceHint = "structured star guide shown to manager",
}: {
    value: RatingCriteria | undefined;
    onChange: (v: RatingCriteria | undefined) => void;
    sectionKey: string;
    existingTemplates: FormulaTemplate[];
    currentRoleType: string;
    /** Overrides the default subtitle under "Rating Criteria" */
    audienceHint?: string;
}) {
    const empty: RatingCriteria = { levels: [5, 4, 3, 2, 1].map((s) => ({ stars: s, bullets: [""] })) };
    const criteria = value ?? empty;

    const otherRole = currentRoleType === "writer" ? "editor" : "writer";
    const otherTemplate = existingTemplates.find((t) => t.roleType === otherRole && t.isActive);
    const otherSection = otherTemplate?.sections.find((s) => s.key === sectionKey) as (Section & { rating_criteria?: RatingCriteria }) | undefined;
    const otherCriteria = otherSection?.rating_criteria;

    const updateLevel = (stars: number, bullets: string[]) => {
        const levels = criteria.levels.map((l) => (l.stars === stars ? { ...l, bullets } : l));
        onChange({ ...criteria, levels });
    };

    const addBullet = (stars: number) => {
        const level = criteria.levels.find((l) => l.stars === stars);
        if (!level) return;
        updateLevel(stars, [...level.bullets, ""]);
    };

    const updateBullet = (stars: number, bi: number, val: string) => {
        const level = criteria.levels.find((l) => l.stars === stars);
        if (!level) return;
        const bullets = level.bullets.map((b, idx) => (idx === bi ? val : b));
        updateLevel(stars, bullets);
    };

    const removeBullet = (stars: number, bi: number) => {
        const level = criteria.levels.find((l) => l.stars === stars);
        if (!level) return;
        updateLevel(stars, level.bullets.filter((_, idx) => idx !== bi));
    };

    const isEnabled = !!value;

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <label className="text-xs text-slate-500 dark:text-slate-400">
                    Rating Criteria <span className="text-slate-500 dark:text-slate-600">({audienceHint})</span>
                </label>
                <div className="flex items-center gap-2">
                    {otherCriteria && (
                        <button
                            type="button"
                            onClick={() => onChange(JSON.parse(JSON.stringify(otherCriteria)))}
                            className="text-xs px-2 py-0.5 rounded-full border border-sky-500/40 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 transition-colors"
                            title={`Copy rating criteria from the active ${otherRole} template's matching section`}
                        >
                            ↓ Copy from {otherRole}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => onChange(isEnabled ? undefined : empty)}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                            isEnabled
                                ? "text-amber-400 border-amber-500/40 bg-amber-500/10"
                                : "text-slate-500 border-slate-300 dark:border-slate-600 hover:text-slate-700 dark:hover:text-slate-300"
                        }`}
                    >
                        {isEnabled ? "Enabled" : "Disabled"}
                    </button>
                </div>
            </div>

            {isEnabled && (
                <div className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                    {/* Intro tagline */}
                    <div className="space-y-1">
                        <label className="text-[10px] text-slate-500 uppercase tracking-wide">Intro tagline (optional)</label>
                        <input
                            type="text"
                            value={criteria.intro ?? ""}
                            onChange={(e) => onChange({ ...criteria, intro: e.target.value || undefined })}
                            placeholder='e.g. "This is your future leader detector pillar"'
                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-xs rounded-lg px-3 py-1.5 placeholder-slate-400 dark:placeholder-slate-600"
                        />
                    </div>

                    {/* Per-star levels */}
                    {criteria.levels.map((level) => (
                        <div key={level.stars} className="space-y-1.5">
                            <div className="flex items-center gap-1.5">
                                {Array.from({ length: level.stars }).map((_, i) => (
                                    <svg key={i} className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                    </svg>
                                ))}
                                <span className="text-[10px] text-slate-400">({level.stars})</span>
                                <button
                                    type="button"
                                    onClick={() => addBullet(level.stars)}
                                    className="ml-auto text-[10px] text-violet-400 hover:text-violet-300"
                                >
                                    + bullet
                                </button>
                            </div>
                            <div className="space-y-1 pl-1">
                                {level.bullets.map((bullet, bi) => (
                                    <div key={bi} className="flex items-center gap-1.5">
                                        <span className="text-slate-600 text-xs">•</span>
                                        <input
                                            type="text"
                                            value={bullet}
                                            onChange={(e) => updateBullet(level.stars, bi, e.target.value)}
                                            placeholder={`Bullet ${bi + 1} for ${level.stars}★`}
                                            className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-xs rounded-lg px-2 py-1 placeholder-slate-400 dark:placeholder-slate-600"
                                        />
                                        {level.bullets.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => removeBullet(level.stars, bi)}
                                                className="text-slate-600 hover:text-red-400 text-xs"
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}

                    {/* Important rule */}
                    <div className="space-y-1">
                        <label className="text-[10px] text-slate-500 uppercase tracking-wide">Important rule (optional)</label>
                        <input
                            type="text"
                            value={criteria.important_rule ?? ""}
                            onChange={(e) => onChange({ ...criteria, important_rule: e.target.value || undefined })}
                            placeholder='e.g. "0 ideas this month → max rating = 3"'
                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-xs rounded-lg px-3 py-1.5 placeholder-slate-400 dark:placeholder-slate-600"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

function QuestionKeysEditor({
    keys,
    labels,
    onChangeKeys,
    onChangeLabels,
    subtitle = "(key + label shown to manager)",
    addLabel = "+ Question",
    keyPrefix,
}: {
    keys: string[];
    labels: string[];
    onChangeKeys: (k: string[]) => void;
    onChangeLabels: (l: string[]) => void;
    /** Shown next to “Questions” */
    subtitle?: string;
    addLabel?: string;
    /** New rows get keys like `{prefix}_q1`, `{prefix}_q2`, … (omit for generic `q1`, `q2`) */
    keyPrefix?: string;
}) {
    const updateKey   = (i: number, val: string) => onChangeKeys(keys.map((k, idx) => idx === i ? val : k));
    const updateLabel = (i: number, val: string) => {
        const next = [...labels];
        next[i] = val;
        onChangeLabels(next);
    };
    const add = () => {
        const n = keys.length + 1;
        const nextKey = keyPrefix ? `${keyPrefix}_q${n}` : `q${n}`;
        onChangeKeys([...keys, nextKey]);
        onChangeLabels([...labels, ""]);
    };
    const remove = (i: number) => {
        onChangeKeys(keys.filter((_, idx) => idx !== i));
        onChangeLabels(labels.filter((_, idx) => idx !== i));
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <label className="text-xs text-slate-500 dark:text-slate-400 leading-snug">
                    Questions <span className="text-slate-500 dark:text-slate-600">{subtitle}</span>
                </label>
                <button type="button" onClick={add} className="text-xs text-violet-400 hover:text-violet-300 shrink-0">{addLabel}</button>
            </div>
            <div className="space-y-1.5">
                {keys.map((k, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <input
                            value={k}
                            onChange={(e) => updateKey(i, e.target.value)}
                            placeholder="key e.g. script_q1"
                            className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-blue-300 text-xs font-mono rounded-lg px-2 py-1.5 w-36 outline-none focus:border-violet-500"
                        />
                        <input
                            value={labels[i] ?? ""}
                            onChange={(e) => updateLabel(i, e.target.value)}
                            placeholder="Label e.g. Creativity"
                            className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-xs rounded-lg px-2 py-1.5 flex-1 outline-none focus:border-violet-500"
                        />
                        <button onClick={() => remove(i)} className="text-slate-500 hover:text-red-400 text-xs flex-shrink-0">✕</button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function MatrixEditor({ variableX, variableYSection, matrix, siblingKeys, onChangeX, onChangeY, onChangeMatrix }: {
    variableX: string;
    variableYSection: string;
    matrix: Record<string, Record<string, number>>;
    siblingKeys: string[];
    onChangeX: (v: string) => void;
    onChangeY: (v: string) => void;
    onChangeMatrix: (m: Record<string, Record<string, number>>) => void;
}) {
    const caseKeys   = Object.keys(matrix).sort((a, b) => Number(a) - Number(b));
    const qualityKeys = ["1", "2", "3", "4", "5"];

    const updateCell = (caseKey: string, qualKey: string, val: string) => {
        const next = JSON.parse(JSON.stringify(matrix));
        next[caseKey][qualKey] = Number(val);
        onChangeMatrix(next);
    };

    const addRow = () => {
        const next = JSON.parse(JSON.stringify(matrix));
        const maxKey = Math.max(...caseKeys.map(Number), 0);
        next[String(maxKey + 1)] = { "1": 1, "2": 1, "3": 2, "4": 3, "5": 4 };
        onChangeMatrix(next);
    };

    const removeRow = (caseKey: string) => {
        const next = JSON.parse(JSON.stringify(matrix));
        delete next[caseKey];
        onChangeMatrix(next);
    };

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                    <label className="text-xs text-slate-500 dark:text-slate-400">X-axis variable (cases count)</label>
                    <input value={variableX} onChange={(e) => onChangeX(e.target.value)}
                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-violet-600 dark:text-violet-300 text-sm font-mono rounded-lg px-3 py-2" />
                </div>
                <div className="space-y-1">
                    <label className="text-xs text-slate-500 dark:text-slate-400">Y-axis: sibling section key (quality stars) *</label>
                    <select value={variableYSection} onChange={(e) => onChangeY(e.target.value)}
                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg px-3 py-2">
                        <option value="">— select a section above —</option>
                        {siblingKeys.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                </div>
            </div>

            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-slate-500 dark:text-slate-400">Matrix (rows = cases completed, cols = quality ★)</label>
                    <button onClick={addRow} className="text-xs text-violet-400 hover:text-violet-300">+ Row</button>
                </div>
                <div className="overflow-x-auto">
                    <table className="text-xs text-slate-600 dark:text-slate-300">
                        <thead>
                            <tr>
                                <th className="text-left pr-4 pb-2 text-slate-500 font-normal">Cases ≥</th>
                                {qualityKeys.map((q) => (
                                    <th key={q} className="px-3 pb-2 text-slate-500 dark:text-slate-400 font-medium text-center">{q}★ quality</th>
                                ))}
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {caseKeys.map((ck) => (
                                <tr key={ck}>
                                    <td className="pr-4 py-1 font-bold text-slate-800 dark:text-slate-200">{ck}</td>
                                    {qualityKeys.map((qk) => (
                                        <td key={qk} className="px-2 py-1">
                                            <input type="number" min="0" max="5" value={matrix[ck]?.[qk] ?? ""}
                                                onChange={(e) => updateCell(ck, qk, e.target.value)}
                                                className="w-14 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-center text-slate-900 dark:text-slate-100 rounded px-1 py-1" />
                                        </td>
                                    ))}
                                    <td className="pl-2">
                                        <button onClick={() => removeRow(ck)} className="text-red-400 hover:text-red-300">✕</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="text-xs text-slate-500 mt-1">Score = 0 if cases ≤ 1. Best matching row is used (highest row key where cases ≥ key).</p>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════
// Preview Result Panel
// ═══════════════════════════════════════════════════════

function PreviewResultPanel({ result }: { result: PreviewResult }) {
    const { user, month, result: r } = result;
    return (
        <div className="bg-slate-100/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{user.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{user.role} · {month}</p>
                </div>
                <div className="text-right">
                    {r.manualRatingsPending
                        ? <span className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-1 rounded-full">Pending manager input</span>
                        : <div><StarDisplay stars={r.finalStars} /><p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Score: {r.finalScore?.toFixed(2) ?? "—"} / 5</p></div>}
                </div>
            </div>
            <div className="space-y-2">
                {r.sections.map((sec) => (
                    <div key={sec.key} className="flex items-start justify-between gap-3 text-xs">
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <span className="text-slate-800 dark:text-slate-200 font-medium">{sec.label}</span>
                                <span className="text-slate-500">({(sec.weight * 100).toFixed(0)}%)</span>
                                {sec.blocksScore && sec.stars === null && <span className="text-amber-400">⚠ blocking</span>}
                            </div>
                            <p className="text-slate-500 dark:text-slate-400 mt-0.5">{sec.details}</p>
                        </div>
                        <StarDisplay stars={sec.stars} />
                    </div>
                ))}
            </div>
            {r.guardrailsApplied.length > 0 && (
                <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg px-3 py-2">
                    <p className="text-xs text-orange-300 font-medium">Guardrails Applied:</p>
                    {r.guardrailsApplied.map((g, i) => <p key={i} className="text-xs text-orange-400">{g}</p>)}
                </div>
            )}
            <p className="text-xs text-slate-500">Cases completed: <strong className="text-slate-600 dark:text-slate-300">{r.casesCompleted}</strong></p>
        </div>
    );
}
