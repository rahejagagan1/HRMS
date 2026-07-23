"use client";

import { Fragment, useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

interface SectionResult {
    key: string;
    label: string;
    weight: number;
    source: string;
    rawValue: number | null;
    stars: number | null;
    details: string;
    blocksScore: boolean;
    caseCount?: number;
    qualityBreakdown?: { rtc: number | null; foia: number | null; foia_pitched: number | null };
}

interface RatingEntry {
    id: number;
    userId: number;
    month: string;
    roleType: string;
    casesCompleted: number;
    overallRating: number | string | null;
    totalViews: number | string | null;
    rankInRole: number | null;
    isManualOverride: boolean;
    parametersJson?: SectionResult[];
    manualRatingsPending?: boolean;
    finalStars?: number | null;
    user: {
        id: number;
        name: string;
        role: string;
        orgLevel: string;
        profilePictureUrl: string | null;
        teamCapsule: string | null;
        manager: { id: number; name: string } | null;
    };
    editLogs: any[];
}

function StarsBadge({ stars, isOverridden }: { stars: number | null | undefined; isOverridden?: boolean }) {
    if (stars == null) return <span className="text-[10px] text-amber-500 font-medium">Pending</span>;
    const n = Number(stars);
    const color = n >= 4 ? "text-emerald-500" : n >= 3 ? "text-blue-500" : n >= 2 ? "text-amber-500" : "text-rose-500";
    return (
        <span className={`font-bold text-xs ${color}`}>
            {n.toFixed(1)}★
            {isOverridden && <span className="ml-0.5 text-[8px] text-amber-400" title="Manually overridden">✎</span>}
        </span>
    );
}

function EditableCell({
    ratingId, sectionKey, currentValue, fieldName, canEdit, isOverridden, onSave, children,
    step = "0.1", min, max, inputWidth = "w-16",
}: {
    ratingId: number;
    sectionKey: string | null;
    currentValue: number | null;
    fieldName: string;
    canEdit: boolean;
    isOverridden?: boolean;
    onSave: (ratingId: number, sectionKey: string | null, fieldName: string, newValue: number) => Promise<void>;
    children: React.ReactNode;
    step?: string;
    min?: string;
    max?: string;
    inputWidth?: string;
}) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState("");
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const startEdit = () => {
        if (!canEdit) return;
        setValue(currentValue != null ? String(currentValue) : "");
        setEditing(true);
        setTimeout(() => inputRef.current?.select(), 0);
    };

    const cancel = () => { setEditing(false); setValue(""); };

    const save = async () => {
        const num = parseFloat(value);
        if (isNaN(num)) { cancel(); return; }
        if (currentValue != null && Math.abs(num - currentValue) < 0.001) { cancel(); return; }
        setSaving(true);
        try {
            await onSave(ratingId, sectionKey, fieldName, num);
            setEditing(false);
            setValue("");
        } catch {
            // onSave failed — keep edit mode so the user can fix or retry after the alert
        } finally {
            setSaving(false);
        }
    };

    if (editing) {
        return (
            <input
                ref={inputRef}
                type="number"
                step={step}
                min={min}
                max={max}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
                onBlur={save}
                disabled={saving}
                className={`${inputWidth} px-1.5 py-0.5 text-xs text-center bg-amber-50 dark:bg-amber-500/10 border border-amber-400/50 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-400 text-slate-900 dark:text-white`}
                autoFocus
            />
        );
    }

    return (
        <span
            onClick={startEdit}
            className={canEdit ? "cursor-pointer hover:bg-white/10 rounded px-1 py-0.5 transition-colors group" : ""}
            title={canEdit ? "Click to edit" : undefined}
        >
            {children}
            {canEdit && !editing && (
                <span className="ml-0.5 text-[8px] text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
            )}
            {isOverridden && (
                <span className="ml-0.5 text-[8px] text-amber-400" title="Manually overridden">✎</span>
            )}
        </span>
    );
}

// Derive a consistent column list from all ratings' parametersJson
function deriveColumns(ratings: RatingEntry[]): { key: string; label: string; weight: number; source: string }[] {
    const seen = new Map<string, { key: string; label: string; weight: number; source: string }>();
    for (const r of ratings) {
        if (!Array.isArray(r.parametersJson)) continue;
        for (const s of r.parametersJson) {
            if (!seen.has(s.key)) {
                seen.set(s.key, { key: s.key, label: s.label, weight: s.weight, source: s.source });
            }
        }
    }
    return [...seen.values()];
}

/** RTC + FOIA + FOIA pitched actuals from pipeline pillar `breakdown` (Research Manager template). */
function sumResearchManagerPipelineCases(parametersJson: RatingEntry["parametersJson"]): number | null {
    if (!Array.isArray(parametersJson)) return null;
    for (const s of parametersJson as Array<{
        breakdown?: { rtc?: { actual: number }; foia?: { actual: number }; foia_pitched?: { actual: number } };
    }>) {
        const b = s.breakdown;
        if (b?.rtc != null && b?.foia != null && b?.foia_pitched != null) {
            return Number(b.rtc.actual) + Number(b.foia.actual) + Number(b.foia_pitched.actual);
        }
    }
    return null;
}

function auditCasesDisplay(rating: RatingEntry): number {
    if (rating.roleType === "researcher_manager") {
        const sum = sumResearchManagerPipelineCases(rating.parametersJson);
        if (sum != null) return sum;
    }
    return rating.casesCompleted;
}

function formatRmCaseQualityAuditValue(q: { rtc: number | null; foia: number | null; foia_pitched: number | null }): string {
    const f = (n: number | null) =>
        n != null && Number.isFinite(Number(n)) ? Number(n).toFixed(1) : "—";
    const parts = [`RTC ${f(q.rtc)}`, `FOIA ${f(q.foia)}`];
    if (q.foia_pitched != null && Number.isFinite(Number(q.foia_pitched))) {
        parts.push(`Pitched ${f(q.foia_pitched)}`);
    }
    return parts.join(" · ");
}

const SOURCE_BG: Record<string, string> = {
    clickup: "bg-violet-50/80 dark:bg-violet-500/[0.05]",
    manager: "bg-blue-50/80 dark:bg-blue-500/[0.05]",
    youtube: "bg-rose-50/80 dark:bg-rose-500/[0.05]",
    formula: "bg-emerald-50/80 dark:bg-emerald-500/[0.05]",
};
const SOURCE_HEAD_BG: Record<string, string> = {
    clickup: "bg-violet-100/60 dark:bg-violet-500/[0.08] text-violet-600 dark:text-violet-400 border-violet-400/50",
    manager: "bg-blue-100/60 dark:bg-blue-500/[0.08] text-blue-600 dark:text-blue-400 border-blue-400/50",
    youtube: "bg-rose-100/60 dark:bg-rose-500/[0.08] text-rose-600 dark:text-rose-400 border-rose-400/50",
    formula: "bg-emerald-100/60 dark:bg-emerald-500/[0.08] text-emerald-600 dark:text-emerald-400 border-emerald-400/50",
};
const SOURCE_COL: Record<string, string> = {
    clickup: "text-violet-500 dark:text-violet-400",
    manager: "text-blue-500 dark:text-blue-400",
    youtube: "text-rose-500 dark:text-rose-400",
    formula: "text-emerald-500 dark:text-emerald-400",
};

function getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function ScoreAdminPage() {
    const [ratings, setRatings] = useState<RatingEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filterRole, setFilterRole] = useState<string>("");
    const [filterMonth, setFilterMonth] = useState<string>("");
    const [calcMonth, setCalcMonth] = useState<string>(getCurrentMonth);
    const [calculatingEditors, setCalculatingEditors] = useState(false);
    const [calculatingWriters, setCalculatingWriters] = useState(false);
    const [calculatingHR, setCalculatingHR] = useState(false);
    const [calculatingResearcherManager, setCalculatingResearcherManager] = useState(false);
    const [calculatingPM, setCalculatingPM] = useState(false);
    const [calcStatus, setCalcStatus] = useState<string>("");
    const [allUsers, setAllUsers] = useState<{ id: number; name: string; role: string }[]>([]);
    const [showAddEntry, setShowAddEntry] = useState(false);
    const [addUserId, setAddUserId] = useState<string>("");
    const [addRole, setAddRole] = useState<string>("");
    const [addingEntry, setAddingEntry] = useState(false);

    const { data: session } = useSession();
    const sessionUser = session?.user as any;
    const canEdit = sessionUser?.orgLevel === "ceo" || sessionUser?.orgLevel === "special_access" || sessionUser?.isDeveloper === true;

    const handleAddEntry = async () => {
        if (!addUserId || !filterMonth) return;
        const roleToUse = addRole || filterRole;
        if (!roleToUse) return;
        setAddingEntry(true);
        try {
            const res = await fetch("/api/scores/admin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: parseInt(addUserId), month: filterMonth, roleType: roleToUse }),
            });
            if (!res.ok) {
                const err = await res.json();
                alert(err.error || "Failed to add entry");
                return;
            }
            setShowAddEntry(false);
            setAddUserId("");
            setAddRole("");
            fetchData();
        } catch {
            alert("Failed to add entry");
        } finally {
            setAddingEntry(false);
        }
    };

    const handleCellSave = async (ratingId: number, sectionKey: string | null, fieldName: string, newValue: number) => {
        const body = sectionKey
            ? { monthlyRatingId: ratingId, fieldName, sectionKey, newValue }
            : { monthlyRatingId: ratingId, fieldName: "overallRating", newValue };

        const res = await fetch("/api/scores/admin", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        let payload: { error?: string } | null = null;
        try {
            payload = await res.json();
        } catch {
            // non-JSON body
        }

        if (!res.ok) {
            const msg =
                typeof payload?.error === "string"
                    ? payload.error
                    : `Save failed (${res.status}${res.statusText ? `: ${res.statusText}` : ""})`;
            alert(msg);
            throw new Error(msg);
        }

        const updated = payload as {
            overallRating: RatingEntry["overallRating"];
            parametersJson: RatingEntry["parametersJson"];
            isManualOverride: boolean;
            editLogs?: RatingEntry["editLogs"];
        };

        // Update local state with the returned data
        setRatings((prev) =>
            prev.map((r) =>
                r.id === ratingId
                    ? {
                        ...r,
                        overallRating: updated.overallRating,
                        parametersJson: updated.parametersJson,
                        isManualOverride: updated.isManualOverride,
                        editLogs: updated.editLogs ?? r.editLogs,
                    }
                    : r
            )
        );
    };

    const fetchData = () => {
        const params = new URLSearchParams();
        if (filterMonth) params.set("month", filterMonth);
        setLoading(true);
        fetch(`/api/scores/admin?${params}`)
            .then((res) => {
                if (!res.ok) throw new Error(res.status === 403 ? "Access denied" : "Failed to load");
                return res.json();
            })
            .then((data) => {
                setRatings(data.ratings || []);
                if (data.allUsers) setAllUsers(data.allUsers);
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    };

    useEffect(() => { fetchData(); }, [filterMonth]);

    const roleFiltered = filterRole ? ratings.filter((r) => r.roleType === filterRole) : ratings;
    // Hide zero-case writer/editor rows unless an admin manually overrode them.
    // Managers (CM/PM/HR/Researcher) are always shown — they can legitimately have 0 cases.
    const filteredRatings = roleFiltered.filter((r) => {
        const isCaseBased = r.roleType === "writer" || r.roleType === "editor";
        if (!isCaseBased) return true;
        const cases = (r as any).casesCompleted ?? 0;
        if (cases > 0) return true;
        return (r as any).isManualOverride === true;
    });
    const uniqueRoles = [...new Set(ratings.map((r) => r.roleType))];
    const columns = deriveColumns(filteredRatings);

    // Users who already have a rating for the selected month+role
    const existingUserIds = new Set(filteredRatings.map((r) => r.userId));
    const missingUsers = allUsers.filter((u) => !existingUserIds.has(u.id));

    // Count total <th> cells per row for proper alignment:
    // Basic Info = 4 cols  |  sep  |  per dynamic col = 2 (raw + stars) + 1 sep between  |  sep  |  Final = 2 cols
    // separators between dynamic columns use rowSpan={2}, so sub-header row must NOT add extra <th> for those

    const handleCalculateRole = async (role: "editor" | "writer" | "hr_manager" | "researcher_manager" | "production_manager") => {
        const setters: Record<string, (v: boolean) => void> = {
            editor: setCalculatingEditors, writer: setCalculatingWriters,
            hr_manager: setCalculatingHR, researcher_manager: setCalculatingResearcherManager, production_manager: setCalculatingPM,
        };
        setters[role](true);
        try {
            setCalcStatus(`Calculating ${role.replace("_", " ")}s...`);
            await fetch(`/api/ratings/calculate?month=${calcMonth}&role=${role}`);
            setCalcStatus("Done! Refreshing...");
            setFilterMonth(calcMonth);
            fetchData();
            setTimeout(() => setCalcStatus(""), 3000);
        } catch {
            setCalcStatus("Error!");
        } finally {
            setters[role](false);
        }
    };

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <p className="text-slate-900 dark:text-white font-semibold">{error}</p>
            </div>
        );
    }

    const isCalculating = calculatingEditors || calculatingWriters || calculatingHR || calculatingResearcherManager || calculatingPM;
    const ghBase = "text-center px-2 py-2.5 text-[9px] uppercase tracking-widest font-semibold border-b-2";
    const chBase = "px-3 py-2.5 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap";

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                    <Link href="/dashboard/scores" className="hover:text-violet-400 transition-colors">Scorecards</Link>
                    <span>›</span>
                    <span className="text-slate-700 dark:text-slate-300 font-medium">Audit Panel</span>
                </div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">📊 Rating Audit</h1>
                <p className="text-sm text-slate-500 mt-1">Full breakdown — every pillar, every parameter</p>
                <Link
                    href="/dashboard/scores/formula"
                    className="inline-flex items-center gap-1.5 mt-2 text-xs bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30 px-3 py-1.5 rounded-lg transition-colors"
                >
                    ⚙ Formula Templates
                </Link>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap">
                <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)}
                    className="px-3 py-2 bg-white dark:bg-[#1a1a35] border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500/40">
                    <option value="">All Roles</option>
                    {uniqueRoles.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
                    onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                    className="px-3 py-2 bg-white dark:bg-[#1a1a35] border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500/40 cursor-pointer" />
                {(filterRole || filterMonth) && (
                    <button onClick={() => { setFilterRole(""); setFilterMonth(""); }}
                        className="px-3 py-2 text-xs text-slate-500 hover:text-white border border-slate-200 dark:border-white/10 rounded-xl hover:bg-white/5 transition-all">
                        Clear
                    </button>
                )}
                <span className="text-xs text-slate-500 ml-auto">{filteredRatings.length} records</span>
                {canEdit && filterMonth && (
                    <button
                        onClick={() => { setShowAddEntry(!showAddEntry); if (!showAddEntry && filterRole) setAddRole(filterRole); }}
                        className="px-3 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition-all flex items-center gap-1.5"
                    >
                        + Add Entry
                    </button>
                )}
            </div>

            {/* Add Missing User Entry */}
            {showAddEntry && filterMonth && (
                <div className="flex items-center gap-3 flex-wrap rounded-2xl bg-emerald-50/50 dark:bg-emerald-500/[0.05] border border-emerald-200 dark:border-emerald-500/20 p-4">
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Add missing user for {filterMonth}:</span>
                    <select
                        value={addUserId}
                        onChange={(e) => setAddUserId(e.target.value)}
                        className="px-3 py-2 bg-white dark:bg-[#1a1a35] border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 min-w-[200px]"
                    >
                        <option value="">Select User</option>
                        {missingUsers.map((u) => (
                            <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                        ))}
                    </select>
                    <select
                        value={addRole || filterRole}
                        onChange={(e) => setAddRole(e.target.value)}
                        className="px-3 py-2 bg-white dark:bg-[#1a1a35] border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    >
                        <option value="">Select Role</option>
                        <option value="writer">Writer</option>
                        <option value="editor">Editor</option>
                        <option value="hr_manager">HR Manager</option>
                        <option value="researcher_manager">Research Manager</option>
                        <option value="production_manager">Production Manager</option>
                    </select>
                    <button
                        onClick={handleAddEntry}
                        disabled={addingEntry || !addUserId || (!addRole && !filterRole)}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                        {addingEntry && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                        {addingEntry ? "Adding..." : "Add"}
                    </button>
                    <button
                        onClick={() => { setShowAddEntry(false); setAddUserId(""); setAddRole(""); }}
                        className="px-3 py-2 text-xs text-slate-500 hover:text-white border border-slate-200 dark:border-white/10 rounded-xl hover:bg-white/5 transition-all"
                    >
                        Cancel
                    </button>
                    {missingUsers.length === 0 && (
                        <span className="text-[10px] text-slate-500">No missing users for this filter</span>
                    )}
                </div>
            )}

            {/* Calculate Scores */}
            <div className="flex items-center gap-3 flex-wrap rounded-2xl bg-white dark:bg-[#12122a] border border-slate-200 dark:border-white/5 p-4">
                <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Calculate Scores</span>
                </div>
                <input type="month" value={calcMonth}
                    onClick={(e) => (e.target as HTMLInputElement).showPicker()}
                    onChange={(e) => setCalcMonth(e.target.value)}
                    className="px-3 py-2 bg-white dark:bg-[#1a1a35] border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500/40 cursor-pointer"
                />
                <button disabled={isCalculating || !calcMonth} onClick={() => handleCalculateRole("editor")}
                    className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-xs font-medium rounded-xl transition-all disabled:opacity-50 flex items-center gap-2">
                    {calculatingEditors && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {calculatingEditors ? "Calculating..." : "Calculate Editors"}
                </button>
                <button disabled={isCalculating || !calcMonth} onClick={() => handleCalculateRole("writer")}
                    className="px-4 py-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-xs font-medium rounded-xl transition-all disabled:opacity-50 flex items-center gap-2">
                    {calculatingWriters && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {calculatingWriters ? "Calculating..." : "Calculate Writers"}
                </button>
                <button disabled={isCalculating || !calcMonth} onClick={() => handleCalculateRole("hr_manager")}
                    className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-medium rounded-xl transition-all disabled:opacity-50 flex items-center gap-2">
                    {calculatingHR && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {calculatingHR ? "Calculating..." : "Calculate HR"}
                </button>
                <button disabled={isCalculating || !calcMonth} onClick={() => handleCalculateRole("researcher_manager")}
                    className="px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-xs font-medium rounded-xl transition-all disabled:opacity-50 flex items-center gap-2">
                    {calculatingResearcherManager && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {calculatingResearcherManager ? "Calculating..." : "Calculate Research Mgr"}
                </button>
                <button disabled={isCalculating || !calcMonth} onClick={() => handleCalculateRole("production_manager")}
                    className="px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white text-xs font-medium rounded-xl transition-all disabled:opacity-50 flex items-center gap-2">
                    {calculatingPM && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {calculatingPM ? "Calculating..." : "Calculate Managers"}
                </button>
                {calcStatus && (
                    <span className={`text-xs font-medium ${calcStatus.includes("Error") ? "text-rose-400" : calcStatus.includes("Done") ? "text-emerald-400" : "text-violet-400"}`}>
                        {calcStatus}
                    </span>
                )}
            </div>

            {/* Table */}
            <div className="rounded-2xl bg-white dark:bg-[#12122a] border border-slate-200 dark:border-white/5 overflow-hidden shadow-sm dark:shadow-none">
                {loading ? (
                    <div className="p-8 text-center">
                        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
                        <p className="text-xs text-slate-500 mt-3">Loading…</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="text-xs border-collapse w-full" style={{ minWidth: `${400 + columns.length * 160}px` }}>
                            <thead>
                                {/* ── GROUP HEADERS (row 1) ── */}
                                <tr>
                                    {/* Basic Info: 4 columns */}
                                    <th colSpan={4} className={`${ghBase} text-slate-500 border-slate-300 dark:border-white/15 bg-slate-100/80 dark:bg-white/[0.04]`}
                                        style={{ minWidth: "360px" }}>
                                        Basic Info
                                    </th>

                                    {/* Separator between Basic Info and first dynamic column */}
                                    <th className="w-px bg-slate-200 dark:bg-white/10" rowSpan={2} />

                                    {/* Dynamic column group headers */}
                                    {columns.map((col, i) => (
                                        <Fragment key={col.key}>
                                            <th
                                                colSpan={2}
                                                className={`${ghBase} ${SOURCE_HEAD_BG[col.source] ?? SOURCE_HEAD_BG.clickup}`}>
                                                {col.label} ({Math.round(col.weight * 100)}%)
                                            </th>
                                            {/* Separator between dynamic columns */}
                                            {i < columns.length - 1 && (
                                                <th className="w-px bg-slate-200 dark:bg-white/10" rowSpan={2} />
                                            )}
                                        </Fragment>
                                    ))}

                                    {/* Separator before Final */}
                                    <th className="w-px bg-slate-200 dark:bg-white/10" rowSpan={2} />

                                    {/* Final: 2 columns */}
                                    <th colSpan={2} className={`${ghBase} text-amber-600 dark:text-amber-400 border-amber-400/50 bg-amber-100/60 dark:bg-amber-500/[0.08]`}>
                                        Final
                                    </th>
                                </tr>

                                {/* ── COLUMN HEADERS (row 2) ── */}
                                <tr className="border-b border-slate-200 dark:border-white/10">
                                    {/* Basic Info sub-headers */}
                                    <th className={`${chBase} text-left text-slate-500`} style={{ minWidth: "160px" }}>User</th>
                                    <th className={`${chBase} text-left text-slate-500`} style={{ minWidth: "60px" }}>Role</th>
                                    <th className={`${chBase} text-left text-slate-500`} style={{ minWidth: "80px" }}>Month</th>
                                    <th className={`${chBase} text-center text-slate-500`} style={{ minWidth: "50px" }}>Cases</th>

                                    {/* Dynamic column sub-headers (no extra separators — rowSpan=2 covers them) */}
                                    {columns.map((col) => (
                                        <Fragment key={`sub-${col.key}`}>
                                            <th
                                                className={`${chBase} text-right ${SOURCE_COL[col.source] ?? SOURCE_COL.clickup} ${SOURCE_BG[col.source] ?? SOURCE_BG.clickup}`}
                                                style={{ minWidth: "80px" }}>
                                                {col.source === "youtube" ? "30d Views" : col.source === "manager" ? "Rating" : "Value"}
                                            </th>
                                            <th
                                                className={`${chBase} text-center ${SOURCE_COL[col.source] ?? SOURCE_COL.clickup} ${SOURCE_BG[col.source] ?? SOURCE_BG.clickup}`}
                                                style={{ minWidth: "60px" }}>
                                                Stars
                                            </th>
                                        </Fragment>
                                    ))}

                                    {/* Final sub-headers */}
                                    <th className={`${chBase} text-center text-amber-500 dark:text-amber-400 bg-amber-50/80 dark:bg-amber-500/[0.06]`} style={{ minWidth: "70px" }}>Score</th>
                                    <th className={`${chBase} text-center text-amber-500 dark:text-amber-400 bg-amber-50/80 dark:bg-amber-500/[0.06]`} style={{ minWidth: "50px" }}>★</th>
                                </tr>
                            </thead>

                            <tbody>
                                {filteredRatings.map((rating) => {
                                    const sections = Array.isArray(rating.parametersJson) ? rating.parametersJson : [];
                                    const getSection = (key: string) => sections.find((s) => s.key === key);
                                    const sep = <td className="bg-slate-200 dark:bg-white/[0.08]" style={{ width: "2px" }} />;

                                    // Compute final stars from overallRating
                                    const finalScore = rating.overallRating != null ? Number(rating.overallRating) : null;
                                    const finalStars = (rating as any).finalStars ?? (finalScore != null
                                        ? (finalScore >= 4.25 ? 5 : finalScore >= 3.75 ? 4 : finalScore >= 3.25 ? 3 : finalScore >= 2.25 ? 2 : 1)
                                        : null);

                                    return (
                                        <tr key={rating.id} className="border-b border-slate-100 dark:border-white/[0.03] hover:bg-slate-50/50 dark:hover:bg-white/[0.015] transition-colors">
                                            {/* ── Basic Info ── */}
                                            <td className="px-4 py-3">
                                                <Link href={`/dashboard/scores/${rating.userId}`} className="hover:text-violet-400 transition-colors">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0">
                                                            {rating.user.name?.charAt(0)?.toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <p className="text-xs font-semibold text-slate-800 dark:text-white leading-tight">{rating.user.name}</p>
                                                            {rating.user.manager && (
                                                                <p className="text-[10px] text-slate-400 leading-tight">↳ {rating.user.manager.name}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </Link>
                                            </td>
                                            <td className="px-3 py-3">
                                                <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 capitalize font-medium">
                                                    {rating.roleType}
                                                </span>
                                            </td>
                                            <td className="px-3 py-3 text-xs text-slate-500 whitespace-nowrap">
                                                {new Date(rating.month).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{auditCasesDisplay(rating)}</span>
                                            </td>

                                            {sep}

                                            {/* ── Dynamic section columns ── */}
                                            {columns.map((col, i) => {
                                                const sec = getSection(col.key);
                                                const bg = SOURCE_BG[col.source] ?? SOURCE_BG.clickup;

                                                // For monthly targets (formula source), show cases above threshold
                                                const getDisplayValue = () => {
                                                    if (!sec) return null;
                                                    const b = (sec as { breakdown?: { rtc: { actual: number; target: number }; foia: { actual: number; target: number }; foia_pitched: { actual: number; target: number } } }).breakdown;
                                                    if (b?.rtc != null) {
                                                        return `RTC ${b.rtc.actual}/${b.rtc.target} · FOIA ${b.foia.actual}/${b.foia.target} · Pitched ${b.foia_pitched.actual}/${b.foia_pitched.target}`;
                                                    }
                                                    if (sec.qualityBreakdown != null) {
                                                        return formatRmCaseQualityAuditValue(sec.qualityBreakdown);
                                                    }
                                                    if (sec.rawValue == null) return null;
                                                    if (col.source === "youtube") {
                                                        return Number(rating.totalViews ?? 0).toLocaleString();
                                                    }
                                                    if (col.source === "formula" && sec.details) {
                                                        // Legacy calculators store caseCount directly
                                                        if ((sec as any).caseCount != null) {
                                                            return String((sec as any).caseCount);
                                                        }
                                                        // Unified calculator: parse from details like "3 cases × 5★ quality → 5★ (matrix)"
                                                        const match = sec.details.match(/^(\d+)\s*cases/);
                                                        if (match) return match[1];
                                                    }
                                                    return Number(sec.rawValue).toFixed(1);
                                                };
                                                const displayValue = getDisplayValue();

                                                return (
                                                    <Fragment key={col.key}>
                                                        {/* Raw value */}
                                                        <td className={`px-3 py-3 text-right ${bg}`}>
                                                            <EditableCell
                                                                ratingId={rating.id}
                                                                sectionKey={col.key}
                                                                currentValue={sec?.rawValue ?? null}
                                                                fieldName="section_value"
                                                                canEdit={canEdit && !!sec}
                                                                isOverridden={!!(sec as any)?.isOverridden}
                                                                onSave={handleCellSave}
                                                                step="0.01"
                                                                inputWidth="w-20"
                                                            >
                                                                {displayValue != null ? (
                                                                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                                                                        {displayValue}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-[10px] text-slate-400">—</span>
                                                                )}
                                                            </EditableCell>
                                                        </td>
                                                        {/* Stars */}
                                                        <td className={`px-3 py-3 text-center ${bg}`}>
                                                            <EditableCell
                                                                ratingId={rating.id}
                                                                sectionKey={col.key}
                                                                currentValue={sec?.stars ?? null}
                                                                fieldName="section_stars"
                                                                canEdit={canEdit && !!sec}
                                                                isOverridden={!!(sec as any)?.isOverridden}
                                                                onSave={handleCellSave}
                                                                step="0.1"
                                                                min="0"
                                                                max="5"
                                                            >
                                                                <StarsBadge stars={sec?.stars} />
                                                            </EditableCell>
                                                        </td>
                                                        {/* Separator between dynamic columns */}
                                                        {i < columns.length - 1 && sep}
                                                    </Fragment>
                                                );
                                            })}

                                            {sep}

                                            {/* ── Final ── */}
                                            <td className="px-3 py-3 text-center bg-amber-50/60 dark:bg-amber-500/[0.04]">
                                                <EditableCell
                                                    ratingId={rating.id}
                                                    sectionKey={null}
                                                    currentValue={finalScore}
                                                    fieldName="overallRating"
                                                    canEdit={canEdit}
                                                    isOverridden={rating.isManualOverride}
                                                    onSave={handleCellSave}
                                                    step="0.01"
                                                    inputWidth="w-16"
                                                >
                                                    {finalScore != null ? (
                                                        <span className="text-sm font-bold text-amber-500">{finalScore.toFixed(2)}</span>
                                                    ) : (
                                                        <span className="text-[10px] text-slate-400">
                                                            {rating.manualRatingsPending ? "Pending" : "—"}
                                                        </span>
                                                    )}
                                                </EditableCell>
                                            </td>
                                            <td className="px-3 py-3 text-center bg-amber-50/60 dark:bg-amber-500/[0.04]">
                                                {finalScore != null ? (
                                                    <span className="text-sm font-bold text-amber-500">{finalStars}★</span>
                                                ) : (
                                                    <span className="text-slate-400">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>

                        {filteredRatings.length === 0 && (
                            <div className="py-12 text-center">
                                <p className="text-sm text-slate-500">No rating records found</p>
                                <p className="text-xs text-slate-600 mt-1">Select a month and run the calculation first</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
