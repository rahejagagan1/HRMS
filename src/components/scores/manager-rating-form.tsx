"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { RatingCriteriaPanel, type RatingCriteria } from "./rating-criteria-panel";

interface TeamMember {
    id: number;
    name: string;
    role: string;
    profilePictureUrl: string | null;
}

interface TemplateSection {
    key: string;
    label: string;
    weight: number;
    type: string;
    source: string;
    passthrough_manager_adjustment_key?: string;
    description?: string;
    rating_criteria?: RatingCriteria | null;
    question_keys?: string[];
    question_labels?: string[];
    rating_key?: string;
    blocks_final_score?: boolean;
    manager_question_keys?: string[];
    manager_question_labels?: string[];
    team_question_keys?: string[];
    team_question_labels?: string[];
    manager_rating_criteria?: RatingCriteria | null;
    team_rating_criteria?: RatingCriteria | null;
}

interface ManagerRatingFormProps {
    teamMembers: TeamMember[];
    onSubmit: (data: {
        userId: number;
        period: string;
        periodType: string;
        ratingsJson: Record<string, number | string>;
        overallScore: number;
        comments: string;
    }) => Promise<void>;
    onClose: () => void;
}



export default function ManagerRatingForm({ teamMembers, onSubmit, onClose }: ManagerRatingFormProps) {
    const [selectedUser, setSelectedUser] = useState<number | "">("");
    const [period, setPeriod] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    });
    const [ratings, setRatings] = useState<Record<string, number>>({});
    const [sectionComments, setSectionComments] = useState<Record<string, string>>({});
    const [comments, setComments] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [autoStars, setAutoStars] = useState<any>(null);
    const [loadingStars, setLoadingStars] = useState(false);
    const [existingDate, setExistingDate] = useState<string | null>(null);
    const [templateSections, setTemplateSections] = useState<TemplateSection[]>([]);
    const [loadingTemplate, setLoadingTemplate] = useState(false);
    const [templateMissing, setTemplateMissing] = useState(false);
    const [ytAdjustmentKey, setYtAdjustmentKey] = useState<string | null>(null);
    /** Passthrough pillars with ±0.5 manager adjustment (e.g. Case Quality). */
    const [passthroughAdjPanels, setPassthroughAdjPanels] = useState<{ key: string; label: string }[]>([]);
    /** Aggregated anonymous team → manager ratings (CM/PM & Research Manager), for HOD sidebar */
    const [teamFeedbackAgg, setTeamFeedbackAgg] = useState<{
        totalResponses: number;
        /** Active writer + editor users with managerId = this CM. */
        expectedDirectReports: number;
        /** True while submittedCount &lt; expected (score stays pending). */
        teamFeedbackPending: boolean;
        /** Mean of each member’s avg across team star questions; only set when !teamFeedbackPending. */
        teamOverallScore: number | null;
    } | null>(null);
    const [loadingTeamFeedback, setLoadingTeamFeedback] = useState(false);
    const templateCacheRef = useRef<
        Record<
            string,
            {
                sections: TemplateSection[];
                missing: boolean;
                ytAdjKey: string | null;
                passthroughAdjPanels: { key: string; label: string }[];
            }
        >
    >({});
    // Tracks the (userId-period) pair of the last loadData call.
    // fetchExistingRating compares against this to discard stale responses.
    const activeFetchKeyRef = useRef("");
    const teamAggFetchGenRef = useRef(0);

    const selectedMember = teamMembers.find((m) => m.id === selectedUser);
    // Show rating sections for any role that has a formula template
    const hasRatingTemplate = !!selectedMember && !["admin", "manager"].includes(selectedMember.role);

    // Map a User.role to the FormulaTemplate.roleType the rating system
    // actually has templates for. Mirrors the same mapping the
    // /api/scores/manager-rating POST handler uses when triggering
    // calculation, so the form and the save path agree on which
    // template to render. Anything not explicitly listed (writer,
    // researcher, qa, member, lead, sub_lead, …) falls through to
    // "writer", which is the generic content-team template.
    const normaliseRoleType = (role: string): string => {
        if (role === "editor")              return "editor";
        if (role === "production_manager")  return "production_manager";
        if (role === "hr_manager")          return "hr_manager";
        if (role === "researcher_manager")  return "researcher_manager";
        return "writer";
    };

    // Fetch active template sections for the selected user's role
    const fetchTemplateSections = async (role: string) => {
        const roleType = normaliseRoleType(role);
        const cached = templateCacheRef.current[roleType];
        if (cached) {
            setTemplateSections(cached.sections);
            setTemplateMissing(cached.missing);
            setYtAdjustmentKey(cached.ytAdjKey);
            setPassthroughAdjPanels(cached.passthroughAdjPanels ?? []);
            return;
        }
        setLoadingTemplate(true);
        setTemplateMissing(false);
        try {
            const res = await fetch(`/api/ratings/formula-template/active?roleType=${roleType}`);
            if (res.ok) {
                const tmpl = await res.json();
                if (tmpl) {
                    const allSections = tmpl.sections as TemplateSection[];
                    const sections: TemplateSection[] = allSections.filter(
                        (s) => s.type === "manager_questions_avg" ||
                               s.type === "manager_direct_rating" ||
                               s.type === "combined_team_manager_rating"
                    );
                    // Extract yt_manager_adjustment_key from any yt_baseline_ratio section
                    const ytSection = allSections.find((s: any) => s.type === "yt_baseline_ratio" && s.yt_manager_adjustment_key);
                    const ytAdjKey = (ytSection as any)?.yt_manager_adjustment_key ?? null;
                    const passthroughAdjPanels = (allSections as any[])
                        .filter((s) => s.type === "passthrough" && s.passthrough_manager_adjustment_key)
                        .map((s) => ({
                            key: String(s.passthrough_manager_adjustment_key),
                            label: String(s.label || s.key || "Pillar"),
                        }));
                    templateCacheRef.current[roleType] = {
                        sections,
                        missing: false,
                        ytAdjKey,
                        passthroughAdjPanels,
                    };
                    setTemplateSections(sections);
                    setTemplateMissing(false);
                    setYtAdjustmentKey(ytAdjKey);
                    setPassthroughAdjPanels(passthroughAdjPanels);
                } else {
                    // No active template for this role
                    templateCacheRef.current[roleType] = {
                        sections: [],
                        missing: true,
                        ytAdjKey: null,
                        passthroughAdjPanels: [],
                    };
                    setYtAdjustmentKey(null);
                    setPassthroughAdjPanels([]);
                    setTemplateSections([]);
                    setTemplateMissing(true);
                }
            } else {
                setTemplateSections([]);
                setTemplateMissing(true);
                setPassthroughAdjPanels([]);
            }
        } catch {
            setTemplateSections([]);
            setTemplateMissing(true);
            setPassthroughAdjPanels([]);
        } finally {
            setLoadingTemplate(false);
        }
    };

    // Fetch auto-calculated stars when user or period changes
    const fetchAutoStars = async (userId: number, month: string) => {
        setLoadingStars(true);
        try {
            const res = await fetch(`/api/scores/user-stars?userId=${userId}&month=${month}`);
            if (res.ok) {
                const data = await res.json();
                setAutoStars(data);
            } else {
                setAutoStars(null);
            }
        } catch {
            setAutoStars(null);
        } finally {
            setLoadingStars(false);
        }
    };

    /** Anonymous aggregate of direct reports’ “Rate your manager” scores (API allows HOD/CEO). */
    const fetchTeamFeedbackAggregate = useCallback(async (userId: number, month: string, teamQuestionKeys?: string[]) => {
        const fetchKey = `${userId}-${month}`;
        const gen = ++teamAggFetchGenRef.current;
        setLoadingTeamFeedback(true);
        setTeamFeedbackAgg(null);
        try {
            const keysParam =
                teamQuestionKeys && teamQuestionKeys.length > 0
                    ? `&teamQuestionKeys=${encodeURIComponent(teamQuestionKeys.join(","))}`
                    : "";
            const res = await fetch(
                `/api/scores/team-manager-rating?mode=received&managerId=${userId}&period=${encodeURIComponent(month)}${keysParam}`
            );
            if (activeFetchKeyRef.current !== fetchKey || gen !== teamAggFetchGenRef.current) return;
            if (res.ok) {
                const data = await res.json();
                const tos = data.teamOverallScore;
                const exp = data.expectedDirectReports;
                if (gen !== teamAggFetchGenRef.current) return;
                setTeamFeedbackAgg({
                    totalResponses: typeof data.totalResponses === "number" ? data.totalResponses : 0,
                    expectedDirectReports: typeof exp === "number" && Number.isFinite(exp) ? exp : 0,
                    teamFeedbackPending: !!data.teamFeedbackPending,
                    teamOverallScore:
                        typeof tos === "number" && Number.isFinite(tos) ? tos : null,
                });
            } else {
                if (gen !== teamAggFetchGenRef.current) return;
                setTeamFeedbackAgg(null);
            }
        } catch {
            if (activeFetchKeyRef.current === fetchKey && gen === teamAggFetchGenRef.current) setTeamFeedbackAgg(null);
        } finally {
            if (gen === teamAggFetchGenRef.current && activeFetchKeyRef.current === fetchKey) {
                setLoadingTeamFeedback(false);
            }
        }
    }, []);

    // Fetch existing manager rating to pre-fill form
    const fetchExistingRating = async (userId: number, month: string) => {
        const fetchKey = `${userId}-${month}`;
        try {
            const res = await fetch(`/api/scores/manager-rating?userId=${userId}&period=${month}`);
            // Discard if the user or period changed while we were waiting
            if (activeFetchKeyRef.current !== fetchKey) return;
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    const existing = data[0];
                    if (existing.ratingsJson && Object.keys(existing.ratingsJson).length > 0) {
                        const numericRatings: Record<string, number> = {};
                        const parsedSectionComments: Record<string, string> = {};
                        for (const [k, v] of Object.entries(existing.ratingsJson as Record<string, unknown>)) {
                            if (k.startsWith("__comment_")) {
                                parsedSectionComments[k.replace("__comment_", "")] = v as string;
                            } else {
                                numericRatings[k] = v as number;
                            }
                        }
                        setRatings(numericRatings);
                        setSectionComments(parsedSectionComments);
                    }
                    if (existing.comments) {
                        setComments(existing.comments);
                    }
                    if (existing.submittedAt) {
                        setExistingDate(existing.isDraft ? `draft:${existing.submittedAt}` : existing.submittedAt);
                    }
                } else {
                    setRatings({});
                    setSectionComments({});
                    setComments("");
                    setExistingDate(null);
                }
            }
        } catch {
            // silent — form stays empty if fetch fails
        }
    };

    const loadData = (userId: number, month: string, role?: string) => {
        activeFetchKeyRef.current = `${userId}-${month}`;
        setAutoStars(null);
        setRatings({});
        setSectionComments({});
        setExistingDate(null);
        setTeamFeedbackAgg(null);
        const memberRole = role ?? teamMembers.find((m) => m.id === userId)?.role;
        fetchAutoStars(userId, month);
        fetchExistingRating(userId, month);
        if (memberRole) fetchTemplateSections(memberRole);
        if (memberRole !== "production_manager" && memberRole !== "researcher_manager") {
            setTeamFeedbackAgg(null);
            setLoadingTeamFeedback(false);
        }
    };

    // Team → manager aggregate (refetch when template loads so team_question_keys filter the API)
    useEffect(() => {
        if (!selectedUser || (selectedMember?.role !== "production_manager" && selectedMember?.role !== "researcher_manager")) return;
        const combined = templateSections.find((s) => s.type === "combined_team_manager_rating");
        const keys = combined?.team_question_keys?.filter(Boolean) ?? [];
        fetchTeamFeedbackAggregate(selectedUser as number, period, keys.length > 0 ? keys : undefined);
    }, [selectedUser, period, selectedMember?.role, templateSections, fetchTeamFeedbackAggregate]);

    const setRating = (key: string, value: number) => {
        setRatings((prev) => ({ ...prev, [key]: value }));
    };

    const overallScore =
        Object.values(ratings).length > 0
            ? Object.values(ratings).reduce((sum, v) => sum + v, 0) / Object.values(ratings).length
            : 0;

    const [calcResult, setCalcResult] = useState<any>(null);
    const [calculating, setCalculating] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [savingDraft, setSavingDraft] = useState(false);
    const [draftSaved, setDraftSaved] = useState(false);
    const [draftError, setDraftError] = useState<string | null>(null);

    const buildRatingsPayload = () => {
        const commentEntries = Object.fromEntries(
            Object.entries(sectionComments)
                .filter(([, v]) => v.trim() !== "")
                .map(([k, v]) => [`__comment_${k}`, v])
        );
        return { ...ratings, ...commentEntries };
    };

    const handleSaveDraft = async () => {
        if (!selectedUser) return;
        setSavingDraft(true);
        setDraftError(null);
        try {
            const res = await fetch("/api/scores/manager-rating", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId: selectedUser,
                    period,
                    periodType: "monthly",
                    ratingsJson: buildRatingsPayload(),
                    overallScore: parseFloat(overallScore.toFixed(2)),
                    comments,
                    isDraft: true,
                }),
            });
            if (res.ok) {
                setDraftSaved(true);
                setTimeout(() => setDraftSaved(false), 3000);
            } else {
                const data = await res.json().catch(() => ({}));
                setDraftError(data.error || `Save failed (${res.status})`);
                setTimeout(() => setDraftError(null), 4000);
            }
        } catch (e: any) {
            setDraftError(e?.message || "Network error — draft not saved");
            setTimeout(() => setDraftError(null), 4000);
        } finally {
            setSavingDraft(false);
        }
    };

    const handleSubmit = async () => {
        if (!selectedUser || Object.keys(ratings).length === 0) return;
        setSubmitting(true);
        try {
            await onSubmit({
                userId: selectedUser as number,
                period,
                periodType: "monthly",
                ratingsJson: buildRatingsPayload(),
                overallScore: parseFloat(overallScore.toFixed(2)),
                comments,
            });
            setSubmitting(false);

            // Trigger calculation
            setCalculating(true);
            const role = selectedMember?.role || "writer";
            try {
                const calcRes = await fetch(`/api/ratings/calculate?month=${period}&role=${role}`);
                if (calcRes.ok) {
                    await calcRes.json(); // wait for calculation to complete
                }
            } catch {
                // Calculation may fail but rating was saved
            }

            // Fetch the updated monthly rating for full details
            try {
                const starRes = await fetch(`/api/scores/user-stars?userId=${selectedUser}&month=${period}`);
                const starData = starRes.ok ? await starRes.json() : null;
                setCalcResult({
                    name: selectedMember?.name || "User",
                    role: selectedMember?.role || role,
                    score: starData?.overallRating ?? null,
                    stars: starData,
                });
            } catch {
                // Show result with whatever we have
                setCalcResult({
                    name: selectedMember?.name || "User",
                    role: selectedMember?.role || role,
                    score: null,
                    stars: null,
                    error: true,
                });
            }
            setCalculating(false);
        } catch (err) {
            console.error("Submit failed:", err);
            setSubmitting(false);
            setCalculating(false);
        }
    };

    // Helper: render star icons
    const renderStars = (count: number | null | undefined) => {
        if (count == null) return <span className="text-xs text-slate-400">—</span>;
        const n = Math.round(Number(count));
        return (
            <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((s) => (
                    <svg key={s} className={`w-4 h-4 ${s <= n ? "text-amber-400" : "text-slate-300 dark:text-slate-700"}`} fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                ))}
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300 ml-1">{n}</span>
            </div>
        );
    };

    // If calculating or showing results, show that instead
    if (calculating || calcResult) {
        return (
            <div className="fixed inset-0 z-50 bg-white dark:bg-[#0d0d1f] flex items-center justify-center">
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="absolute top-4 right-4 z-10 flex items-center justify-center w-10 h-10 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                <div className="w-full max-w-lg px-6 py-8">
                    {calculating ? (
                        <div className="text-center">
                            <div className="w-14 h-14 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-5" />
                            <p className="text-base font-semibold text-slate-700 dark:text-white">Calculating ratings...</p>
                            <p className="text-sm text-slate-400 mt-1">Running full calculation for all {selectedMember?.role}s</p>
                        </div>
                    ) : calcResult && (
                        <div className="space-y-3">
                            <div className="text-center mb-6">
                                <span className="text-4xl">✅</span>
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mt-3">Calculation Complete</h2>
                                <p className="text-sm text-slate-400 mt-1">
                                    {calcResult.name} ({calcResult.role}) — {new Date(period + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" })}
                                </p>
                            </div>

                            {calcResult.stars?.parameters?.map((p: any) => {
                                const pKey = p.key ?? p.name ?? "";
                                const isManualAvg = p.source === "manager";
                                const pipeB = p.breakdown as
                                    | {
                                          rtc: { actual: number; target: number };
                                          foia: { actual: number; target: number };
                                          foia_pitched: { actual: number; target: number };
                                      }
                                    | undefined;
                                const qB = p.qualityBreakdown as
                                    | { rtc: number | null; foia: number | null; foia_pitched: number | null }
                                    | undefined;
                                const fmtQ = (n: number | null) =>
                                    n != null && Number.isFinite(Number(n)) ? Number(n).toFixed(1) : "—";
                                const showPitchedQuality =
                                    qB != null &&
                                    qB.foia_pitched != null &&
                                    Number.isFinite(Number(qB.foia_pitched));
                                return (
                                    <div key={pKey} className="flex items-center justify-between py-2.5 px-4 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
                                        <div className="flex flex-col gap-0.5 min-w-0 flex-1 pr-2">
                                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{p.label || pKey}</span>
                                            {qB != null && (
                                                <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                                                    RTC {fmtQ(qB.rtc)} · FOIA {fmtQ(qB.foia)}
                                                    {showPitchedQuality ? ` · Pitched ${fmtQ(qB.foia_pitched)}` : ""}
                                                </span>
                                            )}
                                            {pipeB?.rtc != null && (
                                                <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                                                    RTC {pipeB.rtc.actual}/{pipeB.rtc.target} · FOIA {pipeB.foia.actual}/{pipeB.foia.target} · Pitched{" "}
                                                    {pipeB.foia_pitched.actual}/{pipeB.foia_pitched.target}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {isManualAvg ? (
                                                p.rawValue != null ? (
                                                    <span className="text-sm font-bold text-violet-500 dark:text-violet-400">
                                                        {Number(p.rawValue).toFixed(2)} <span className="text-xs text-slate-400">/5</span>
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-amber-500 font-medium">Pending</span>
                                                )
                                            ) : (
                                                <>
                                                    {p.rawValue != null && (
                                                        <span className="text-xs font-bold text-slate-700 dark:text-white">
                                                            {Number(p.rawValue).toFixed(1)}
                                                        </span>
                                                    )}
                                                    {renderStars(p.stars)}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}

                            <div className="py-6 rounded-2xl bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 border border-violet-500/20 text-center mt-2">
                                <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Overall Rating</p>
                                {calcResult.score != null ? (
                                    <>
                                        <p className="text-4xl font-bold text-violet-400 mt-1">
                                            {Number(calcResult.score).toFixed(2)}
                                            <span className="text-lg text-slate-500 ml-1">/5</span>
                                        </p>
                                        {calcResult.stars?.finalStars != null && (
                                            <div className="flex items-center justify-center gap-1.5 mt-3">
                                                {[1, 2, 3, 4, 5].map(s => (
                                                    <svg key={s} className={`w-7 h-7 ${s <= calcResult.stars.finalStars ? "text-amber-400" : "text-slate-600"}`} fill="currentColor" viewBox="0 0 20 20">
                                                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                                    </svg>
                                                ))}
                                                <span className="text-sm font-bold text-amber-400 ml-1">{calcResult.stars.finalStars}★</span>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <p className="text-3xl font-bold text-slate-500">—</p>
                                )}
                            </div>

                            <button
                                onClick={onClose}
                                className="w-full px-4 py-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-sm font-medium rounded-xl transition-all"
                            >
                                Done
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 bg-white dark:bg-[#0d0d1f] flex flex-col">
            {/* Full-screen header */}
            <div className="shrink-0 bg-white dark:bg-[#0d0d1f] border-b border-slate-200 dark:border-white/5 px-6 lg:px-8 py-4">
                <div className="max-w-[1400px] mx-auto flex items-center gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <svg className="w-5 h-5 text-violet-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                            </svg>
                            Rate Team Member
                        </h2>
                        {existingDate && (() => {
                            const isDraftBadge = existingDate.startsWith("draft:");
                            const dateStr = isDraftBadge ? existingDate.slice(6) : existingDate;
                            const d = new Date(dateStr);
                            const formatted = `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })} at ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}`;
                            return isDraftBadge ? (
                                <p className="text-[10px] text-amber-500 mt-1 font-medium flex items-center gap-1">
                                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
                                    Draft saved: {formatted} — not yet submitted
                                </p>
                            ) : (
                                <p className="text-[10px] text-emerald-500 mt-1 font-medium">
                                    ✓ Last submitted: {formatted}
                                </p>
                            );
                        })()}
                    </div>
                    <button
                        onClick={onClose}
                        className="flex items-center justify-center w-9 h-9 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all shrink-0"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-[1400px] mx-auto p-6 lg:p-8">
                    <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-8 items-start">

                        {/* ── LEFT PANEL: context (sticky) ── */}
                        <div className="lg:sticky lg:top-6 space-y-5">

                            {/* Member + Period */}
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                        Team Member
                                    </label>
                                    <select
                                        value={selectedUser}
                                        onChange={(e) => {
                                            const uid = e.target.value ? parseInt(e.target.value) : "";
                                            setSelectedUser(uid);
                                            const member = teamMembers.find(m => m.id === Number(e.target.value));
                                            if (uid && period) loadData(uid as number, period, member?.role);
                                            else {
                                                setRatings({});
                                                setAutoStars(null);
                                                setExistingDate(null);
                                                setTemplateSections([]);
                                                setTemplateMissing(false);
                                                setYtAdjustmentKey(null);
                                                setTeamFeedbackAgg(null);
                                                setLoadingTeamFeedback(false);
                                            }
                                        }}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-[#1a1a35] border border-slate-200 dark:border-white/10 rounded-xl text-base text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                                    >
                                        <option value="">Select member</option>
                                        {teamMembers.map((m) => (
                                            <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                        Rating Period
                                    </label>
                                    <input
                                        type="month"
                                        value={period}
                                        onClick={(e) => (e.target as HTMLInputElement).showPicker()}
                                        onChange={(e) => {
                                            const newPeriod = e.target.value;
                                            setPeriod(newPeriod);
                                            if (selectedUser && newPeriod) {
                                                const m = teamMembers.find((x) => x.id === selectedUser);
                                                loadData(selectedUser as number, newPeriod, m?.role);
                                            }
                                        }}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-[#1a1a35] border border-slate-200 dark:border-white/10 rounded-xl text-base text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500/40 cursor-pointer"
                                    />
                                </div>
                            </div>

                            {/* Auto-Calculated Scores */}
                            {hasRatingTemplate && selectedUser && (
                                <div>
                                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                                        Auto-Calculated Scores
                                    </p>
                                    {loadingStars ? (
                                        <div className="flex items-center gap-3 py-4 px-4 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5">
                                            <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                                            <span className="text-sm text-slate-500">Loading scores...</span>
                                        </div>
                                    ) : autoStars ? (
                                        <div className="space-y-2">
                                            {(autoStars.parameters || []).filter((p: any) => p.source !== "manager").map((p: any) => {
                                                const starColor = p.stars >= 4 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                                                    : p.stars >= 3 ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400"
                                                        : p.stars >= 2 ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                                                            : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400";
                                                const detailText =
                                                    p.source === "youtube"
                                                        ? "-"
                                                        : (p.details || "")
                                                              .replace(/\s*→\s*\d+(\.\d+)?★.*$/, "")
                                                              .replace(/\s*=\s*\d+(\.\d+)?★\s*$/, "")
                                                              .trim()
                                                              .replace(/\bPassthrough\b[:\s]*/gi, "")
                                                              .replace(/\s{2,}/g, " ")
                                                              .trim();
                                                const pipeB = p.breakdown as
                                                    | {
                                                          rtc: { actual: number; target: number };
                                                          foia: { actual: number; target: number };
                                                          foia_pitched: { actual: number; target: number };
                                                      }
                                                    | undefined;
                                                const qB = p.qualityBreakdown as
                                                    | { rtc: number | null; foia: number | null; foia_pitched: number | null }
                                                    | undefined;
                                                const fmtCaseQualityAvg = (n: number | null) =>
                                                    n != null && Number.isFinite(Number(n)) ? Number(n).toFixed(1) : "—";
                                                const showPitchedQuality =
                                                    qB != null &&
                                                    qB.foia_pitched != null &&
                                                    Number.isFinite(Number(qB.foia_pitched));
                                                return (
                                                    <div key={p.key ?? p.name} className="flex items-center justify-between py-3 px-4 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-dashed border-slate-300 dark:border-white/10">
                                                        <div className="flex flex-col gap-1">
                                                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{p.label}</span>
                                                            {qB != null && (
                                                                <span className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                                                                    <span className="font-semibold text-violet-600 dark:text-violet-400">RTC</span>{" "}
                                                                    {fmtCaseQualityAvg(qB.rtc)}
                                                                    <span className="text-slate-400 mx-1">·</span>
                                                                    <span className="font-semibold text-sky-600 dark:text-sky-400">FOIA</span>{" "}
                                                                    {fmtCaseQualityAvg(qB.foia)}
                                                                    {showPitchedQuality ? (
                                                                        <>
                                                                            <span className="text-slate-400 mx-1">·</span>
                                                                            <span className="font-semibold text-teal-600 dark:text-teal-400">Pitched</span>{" "}
                                                                            {fmtCaseQualityAvg(qB.foia_pitched)}
                                                                        </>
                                                                    ) : null}
                                                                </span>
                                                            )}
                                                            {pipeB?.rtc != null && (
                                                                <span className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                                                                    <span className="font-semibold text-teal-600 dark:text-teal-400">RTC</span>{" "}
                                                                    {pipeB.rtc.actual}/{pipeB.rtc.target}
                                                                    <span className="text-slate-400 mx-1">·</span>
                                                                    <span className="font-semibold text-teal-600 dark:text-teal-400">FOIA</span>{" "}
                                                                    {pipeB.foia.actual}/{pipeB.foia.target}
                                                                    <span className="text-slate-400 mx-1">·</span>
                                                                    <span className="font-semibold text-teal-600 dark:text-teal-400">Pitched</span>{" "}
                                                                    {pipeB.foia_pitched.actual}/{pipeB.foia_pitched.target}
                                                                </span>
                                                            )}
                                                            {detailText &&
                                                                detailText !== "-" &&
                                                                pipeB?.rtc == null && (
                                                                    <span className="text-xs text-slate-500">{detailText}</span>
                                                                )}
                                                        </div>
                                                        <span className={`text-sm font-bold px-3 py-1 rounded-lg ${starColor}`}>
                                                            {p.stars !== null ? `${p.stars} ★` : "N/A"}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-slate-500 py-3 px-4 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-dashed border-slate-300 dark:border-white/10">
                                            No scores yet for this period.
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Team → manager (aggregated from direct reports) — visible to HOD/CEO when rating a CM / Research Manager */}
                            {hasRatingTemplate && selectedUser && (selectedMember?.role === "production_manager" || selectedMember?.role === "researcher_manager") && (
                                <div>
                                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                                        Team → manager (aggregated)
                                    </p>
                                    <p className="text-[10px] text-slate-500 dark:text-slate-500 mb-3 leading-snug">
                                        Overall score from anonymous &quot;Rate your manager&quot; feedback by this manager&apos;s direct reports (this period).
                                    </p>
                                    {loadingTeamFeedback ? (
                                        <div className="flex items-center gap-3 py-4 px-4 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5">
                                            <div className="w-5 h-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                                            <span className="text-sm text-slate-500">Loading team feedback...</span>
                                        </div>
                                    ) : teamFeedbackAgg ? (
                                        <div className="space-y-3">
                                            {teamFeedbackAgg.expectedDirectReports > 0 ? (
                                                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                                                    {teamFeedbackAgg.totalResponses} / {teamFeedbackAgg.expectedDirectReports}{" "}
                                                    <span className="font-normal text-slate-500 dark:text-slate-400">direct reports submitted</span>
                                                </p>
                                            ) : (
                                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                                    No active writer/editor direct reports assigned to this manager.
                                                </p>
                                            )}

                                            {teamFeedbackAgg.teamFeedbackPending ? (
                                                <div className="rounded-xl border border-amber-400/50 dark:border-amber-500/35 bg-amber-500/[0.08] px-4 py-3">
                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-200/90 mb-1">
                                                        Team score (overall)
                                                    </p>
                                                    <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">Pending</p>
                                                    <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-2 leading-snug">
                                                        The overall team score is shown only after every direct report has submitted &quot;Rate your manager&quot;
                                                        for this period.
                                                    </p>
                                                </div>
                                            ) : teamFeedbackAgg.teamOverallScore != null ? (
                                                <div className="rounded-xl border border-teal-400/40 dark:border-teal-500/30 bg-teal-500/[0.08] px-4 py-3">
                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300 mb-1">
                                                        Team score (overall)
                                                    </p>
                                                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                                                        <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                                                            {teamFeedbackAgg.teamOverallScore.toFixed(2)}
                                                            <span className="text-sm font-medium text-slate-500 dark:text-slate-400 ml-1">/ 5</span>
                                                        </p>
                                                        <span
                                                            className={`text-sm font-bold px-3 py-1 rounded-lg shrink-0 ${
                                                                Math.round(teamFeedbackAgg.teamOverallScore) >= 4
                                                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                                                                    : Math.round(teamFeedbackAgg.teamOverallScore) >= 3
                                                                      ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400"
                                                                      : Math.round(teamFeedbackAgg.teamOverallScore) >= 2
                                                                        ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                                                                        : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"
                                                            }`}
                                                        >
                                                            {Math.min(5, Math.max(1, Math.round(teamFeedbackAgg.teamOverallScore)))} ★
                                                        </span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <p className="text-xs text-slate-500 px-1 py-2">
                                                    {teamFeedbackAgg.totalResponses > 0
                                                        ? "Everyone has submitted, but the overall score could not be computed (check template team question keys)."
                                                        : teamFeedbackAgg.expectedDirectReports > 0
                                                          ? "Waiting for all direct reports to submit."
                                                          : "No team feedback for this period."}
                                                </p>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-slate-500 py-3 px-4 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-dashed border-slate-300 dark:border-white/10">
                                            Could not load team feedback.
                                        </p>
                                    )}
                                </div>
                            )}

                        </div>

                        {/* ── RIGHT PANEL: rating sections ── */}
                        <div className="space-y-6">
                            {!selectedUser && (
                                <div className="flex flex-col items-center justify-center py-24 text-center">
                                    <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center mb-4">
                                        <svg className="w-8 h-8 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                    </div>
                                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-300">Select a team member</p>
                                    <p className="text-sm text-slate-400 mt-1">Choose a member on the left to start rating</p>
                                </div>
                            )}

                            {/* YouTube Views Adjustment — only shown when template has yt_manager_adjustment_key */}
                            {hasRatingTemplate && selectedUser && ytAdjustmentKey && !loadingTemplate && (() => {
                                const current = ratings[ytAdjustmentKey] ?? 0;
                                const opts = [
                                    { value: -0.5, label: "−0.5★", sublabel: "Title/Thumbnail hurt views", icon: "↓", color: "rose" as const },
                                    { value: 0,    label: "No Adjust", sublabel: "Views reflect content quality", icon: "=", color: "slate" as const },
                                    { value: 0.5,  label: "+0.5★", sublabel: "Title/Thumbnail boosted views", icon: "↑", color: "emerald" as const },
                                ];
                                return (
                                    <div className="rounded-2xl border border-sky-500/20 bg-sky-500/[0.04] overflow-hidden">
                                        <div className="px-6 py-4 bg-sky-500/10 border-b border-sky-500/20 flex items-center justify-between">
                                            <div className="flex items-center gap-2.5">
                                                <svg className="w-5 h-5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                                                </svg>
                                                <span className="text-sm font-bold uppercase tracking-wider text-sky-400">YouTube Views Adjustment</span>
                                            </div>
                                            {current !== 0 && (
                                                <span className={`text-xs font-bold px-3 py-1 rounded-full border ${current > 0 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" : "text-rose-400 bg-rose-500/10 border-rose-500/30"}`}>
                                                    {current > 0 ? `+${current}★ applied` : `${current}★ applied`}
                                                </span>
                                            )}
                                        </div>
                                        <div className="px-6 py-5 space-y-4">
                                            <p className="text-sm text-slate-400 leading-relaxed">
                                                Did the <span className="text-sky-300 font-medium">title or thumbnail</span> unfairly hurt or boost the view count?
                                                Adjust by ±0.5 stars if views don&apos;t reflect the content itself.
                                            </p>
                                            <div className="grid grid-cols-3 gap-3">
                                                {opts.map((opt) => {
                                                    const sel = current === opt.value;
                                                    const cls = opt.color === "rose"
                                                        ? sel ? "border-rose-500 bg-rose-500/15 text-rose-400" : "border-white/10 text-slate-500 hover:border-rose-500/40 hover:text-rose-400"
                                                        : opt.color === "emerald"
                                                        ? sel ? "border-emerald-500 bg-emerald-500/15 text-emerald-400" : "border-white/10 text-slate-500 hover:border-emerald-500/40 hover:text-emerald-400"
                                                        : sel ? "border-sky-500 bg-sky-500/15 text-sky-300" : "border-white/10 text-slate-500 hover:border-sky-500/40 hover:text-sky-400";
                                                    return (
                                                        <button key={opt.value} type="button" onClick={() => setRating(ytAdjustmentKey!, opt.value)}
                                                            className={`flex flex-col items-center gap-2 py-5 px-3 rounded-xl border transition-all ${cls}`}>
                                                            <span className="text-2xl font-black leading-none">{opt.icon}</span>
                                                            <span className="text-base font-bold leading-none">{opt.label}</span>
                                                            <span className="text-xs text-center leading-tight opacity-70">{opt.sublabel}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Passthrough pillar adjustments (e.g. Case Quality ±0.5) */}
                            {hasRatingTemplate &&
                                selectedUser &&
                                passthroughAdjPanels.length > 0 &&
                                !loadingTemplate &&
                                passthroughAdjPanels.map((panel) => {
                                    const adjKey = panel.key;
                                    const current = ratings[adjKey] ?? 0;
                                    const opts = [
                                        { value: -0.5, label: "−0.5★", sublabel: "Adjust down", icon: "↓", color: "rose" as const },
                                        { value: 0, label: "No adjust", sublabel: "Use formula value", icon: "=", color: "slate" as const },
                                        { value: 0.5, label: "+0.5★", sublabel: "Adjust up", icon: "↑", color: "emerald" as const },
                                    ];
                                    return (
                                        <div
                                            key={adjKey}
                                            className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] overflow-hidden"
                                        >
                                            <div className="px-6 py-4 bg-violet-500/10 border-b border-violet-500/20 flex items-center justify-between">
                                                <div className="flex items-center gap-2.5">
                                                    <span className="text-sm font-bold uppercase tracking-wider text-violet-400">
                                                        {panel.label} — manager adjustment
                                                    </span>
                                                </div>
                                                {current !== 0 && (
                                                    <span
                                                        className={`text-xs font-bold px-3 py-1 rounded-full border ${
                                                            current > 0
                                                                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                                                                : "text-rose-400 bg-rose-500/10 border-rose-500/30"
                                                        }`}
                                                    >
                                                        {current > 0 ? `+${current}★ applied` : `${current}★ applied`}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="px-6 py-5 space-y-4">
                                                <p className="text-sm text-slate-400 leading-relaxed">
                                                    Fine-tune this pillar by up to half a star after the automated score
                                                    (e.g. average Case Rating from ClickUp).
                                                </p>
                                                <div className="grid grid-cols-3 gap-3">
                                                    {opts.map((opt) => {
                                                        const sel = current === opt.value;
                                                        const cls =
                                                            opt.color === "rose"
                                                                ? sel
                                                                    ? "border-rose-500 bg-rose-500/15 text-rose-400"
                                                                    : "border-white/10 text-slate-500 hover:border-rose-500/40 hover:text-rose-400"
                                                                : opt.color === "emerald"
                                                                  ? sel
                                                                      ? "border-emerald-500 bg-emerald-500/15 text-emerald-400"
                                                                      : "border-white/10 text-slate-500 hover:border-emerald-500/40 hover:text-emerald-400"
                                                                  : sel
                                                                    ? "border-violet-500 bg-violet-500/15 text-violet-300"
                                                                    : "border-white/10 text-slate-500 hover:border-violet-500/40 hover:text-violet-400";
                                                        return (
                                                            <button
                                                                key={opt.value}
                                                                type="button"
                                                                onClick={() => setRating(adjKey, opt.value)}
                                                                className={`flex flex-col items-center gap-2 py-5 px-3 rounded-xl border transition-all ${cls}`}
                                                            >
                                                                <span className="text-2xl font-black leading-none">{opt.icon}</span>
                                                                <span className="text-base font-bold leading-none">{opt.label}</span>
                                                                <span className="text-xs text-center leading-tight opacity-70">
                                                                    {opt.sublabel}
                                                                </span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}

                            {/* Empty state: no scoring template for this role */}
                            {hasRatingTemplate && selectedUser && templateMissing && !loadingTemplate && (
                                <div className="flex flex-col items-center justify-center py-16 text-center rounded-2xl border-2 border-dashed border-slate-200 dark:border-white/10">
                                    <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-4">
                                        <svg className="w-8 h-8 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                    </div>
                                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-300">No Scoring Template Available</p>
                                    <p className="text-sm text-slate-400 mt-1 max-w-sm">
                                        A scoring template for the <span className="font-medium text-amber-400">{selectedMember?.role}</span> role hasn't been created yet.
                                        Rating will be available once the template is configured.
                                    </p>
                                </div>
                            )}

                            {/* Loading template */}
                            {hasRatingTemplate && selectedUser && loadingTemplate && (
                                <div className="flex items-center justify-center gap-3 py-16">
                                    <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                                    <span className="text-sm text-slate-500">Loading scoring template...</span>
                                </div>
                            )}

                            {/* Dynamic manager sections */}
                            {hasRatingTemplate && selectedUser && !templateMissing && !loadingTemplate && templateSections.map((section, sIdx) => {
                                const isDirect = section.type === "manager_direct_rating";
                                const isCombined = section.type === "combined_team_manager_rating";
                                const directKey = section.rating_key || section.key;
                                const keys = isCombined
                                    ? (section.manager_question_keys ?? [])
                                    : (section.question_keys ?? []);
                                const labels = isCombined
                                    ? (section.manager_question_labels ?? [])
                                    : (section.question_labels ?? []);
                                const filledKeys = keys.filter(k => ratings[k] != null);
                                const avg = isDirect
                                    ? (directKey && ratings[directKey] != null ? ratings[directKey] : null)
                                    : filledKeys.length > 0
                                        ? filledKeys.reduce((sum, k) => sum + ratings[k], 0) / filledKeys.length
                                        : null;
                                const sectionStars = avg !== null ? Math.min(5, Math.max(1, Math.round(avg))) : null;

                                const SECTION_COLORS = [
                                    { bg: "bg-violet-50/60 dark:bg-violet-500/[0.04]", border: "border-violet-200 dark:border-violet-500/15", text: "text-violet-700 dark:text-violet-300", star: "text-violet-500", avgBg: "bg-violet-100/80 dark:bg-violet-500/10", avgBorder: "border-violet-300 dark:border-violet-500/20", avgText: "text-violet-600 dark:text-violet-400", headerBg: "bg-violet-500/10", headerText: "text-violet-400", headerBorder: "border-violet-500/20" },
                                    { bg: "bg-emerald-50/60 dark:bg-emerald-500/[0.04]", border: "border-emerald-200 dark:border-emerald-500/15", text: "text-emerald-700 dark:text-emerald-300", star: "text-emerald-500", avgBg: "bg-emerald-100/80 dark:bg-emerald-500/10", avgBorder: "border-emerald-300 dark:border-emerald-500/20", avgText: "text-emerald-600 dark:text-emerald-400", headerBg: "bg-emerald-500/10", headerText: "text-emerald-400", headerBorder: "border-emerald-500/20" },
                                    { bg: "bg-blue-50/60 dark:bg-blue-500/[0.04]", border: "border-blue-200 dark:border-blue-500/15", text: "text-blue-700 dark:text-blue-300", star: "text-blue-500", avgBg: "bg-blue-100/80 dark:bg-blue-500/10", avgBorder: "border-blue-300 dark:border-blue-500/20", avgText: "text-blue-600 dark:text-blue-400", headerBg: "bg-blue-500/10", headerText: "text-blue-400", headerBorder: "border-blue-500/20" },
                                    { bg: "bg-amber-50/60 dark:bg-amber-500/[0.04]", border: "border-amber-200 dark:border-amber-500/15", text: "text-amber-700 dark:text-amber-300", star: "text-amber-500", avgBg: "bg-amber-100/80 dark:bg-amber-500/10", avgBorder: "border-amber-300 dark:border-amber-500/20", avgText: "text-amber-600 dark:text-amber-400", headerBg: "bg-amber-500/10", headerText: "text-amber-400", headerBorder: "border-amber-500/20" },
                                ];
                                const c = SECTION_COLORS[sIdx % SECTION_COLORS.length];

                                return (
                                    <div key={section.key} className={`rounded-2xl border ${c.border} overflow-hidden`}>
                                        {/* Section header */}
                                        <div className={`px-6 py-4 ${c.headerBg} border-b ${c.headerBorder}`}>
                                            <div className="flex items-center justify-between mb-1">
                                                <div className="flex items-center gap-3">
                                                    <span className={`text-sm font-bold uppercase tracking-wider ${c.headerText}`}>
                                                        {section.label}
                                                    </span>
                                                    <span className="text-xs text-slate-500">· {Math.round(section.weight * 100)}% weight</span>
                                                </div>
                                                {section.blocks_final_score && (
                                                    <span className="text-xs text-amber-400 border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 rounded-full font-semibold">
                                                        Required
                                                    </span>
                                                )}
                                            </div>
                                            <RatingCriteriaPanel
                                                rating_criteria={
                                                    section.type === "combined_team_manager_rating"
                                                        ? (section.manager_rating_criteria ?? section.rating_criteria ?? undefined)
                                                        : (section.rating_criteria ?? undefined)
                                                }
                                                description={section.description}
                                                headerBorder={c.headerBorder}
                                                headerText={c.headerText}
                                            />
                                        </div>

                                        {/* Rating inputs */}
                                        <div className="p-5 space-y-3">
                                            {isDirect ? (
                                                directKey && (
                                                    <div className={`flex items-center justify-between py-4 px-5 rounded-xl ${c.avgBg} border ${c.avgBorder}`}>
                                                        <span className={`text-base font-bold ${c.avgText}`}>{section.label}</span>
                                                        <div className="flex items-center gap-2">
                                                            {[1, 2, 3, 4, 5].map((star) => (
                                                                <button key={star} type="button" onClick={() => setRating(directKey, star)} className="transition-transform hover:scale-110">
                                                                    <svg className={`w-9 h-9 transition-colors ${star <= (ratings[directKey] || 0) ? "text-amber-400" : "text-slate-300 dark:text-slate-700"}`} fill="currentColor" viewBox="0 0 20 20">
                                                                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                                                    </svg>
                                                                </button>
                                                            ))}
                                                            {ratings[directKey] != null && (
                                                                <span className={`text-base font-bold ml-1 ${c.avgText}`}>{ratings[directKey]}★</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            ) : (
                                                <>
                                                    {keys.map((qKey, qi) => {
                                                        const useDirectStyle = isCombined;
                                                        return (
                                                        <div
                                                            key={qKey}
                                                            className={
                                                                useDirectStyle
                                                                    ? `flex items-center justify-between py-4 px-5 rounded-xl ${c.avgBg} border ${c.avgBorder}`
                                                                    : `flex items-center justify-between py-3 px-4 rounded-xl ${c.bg} border ${c.border}`
                                                            }
                                                        >
                                                            <span
                                                                className={
                                                                    useDirectStyle
                                                                        ? `text-base font-bold ${c.avgText}`
                                                                        : `text-sm font-medium ${c.text}`
                                                                }
                                                            >
                                                                {labels[qi] || qKey.replace(/_/g, " ")}
                                                            </span>
                                                            <div className={`flex items-center ${useDirectStyle ? "gap-2" : "gap-1.5"}`}>
                                                                {[1, 2, 3, 4, 5].map((star) => (
                                                                    <button key={star} type="button" onClick={() => setRating(qKey, star)} className="transition-transform hover:scale-110">
                                                                        <svg
                                                                            className={`${useDirectStyle ? "w-9 h-9" : "w-7 h-7"} transition-colors ${
                                                                                star <= (ratings[qKey] || 0)
                                                                                    ? useDirectStyle
                                                                                        ? "text-amber-400"
                                                                                        : c.star
                                                                                    : "text-slate-300 dark:text-slate-700"
                                                                            }`}
                                                                            fill="currentColor"
                                                                            viewBox="0 0 20 20"
                                                                        >
                                                                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                                                        </svg>
                                                                    </button>
                                                                ))}
                                                                {useDirectStyle && ratings[qKey] != null && (
                                                                    <span className={`text-base font-bold ml-1 ${c.avgText}`}>{ratings[qKey]}★</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        );
                                                    })}
                                                    {/* Hide aggregate score for combined pillars — it is only the manager half; final pillar is 50% + team. */}
                                                    {avg !== null && !isCombined && (
                                                        <div className={`flex items-center justify-between py-3 px-4 rounded-xl ${c.avgBg} border ${c.avgBorder} mt-2`}>
                                                            <div className="flex items-center gap-3">
                                                                <span className={`text-sm font-bold ${c.avgText}`}>{section.label} Score</span>
                                                                <span className="text-xs text-slate-500">({filledKeys.length}/{keys.length} answered)</span>
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                <span className={`text-base font-bold ${c.avgText}`}>
                                                                    {avg.toFixed(2)} <span className="text-xs text-slate-500">/5</span>
                                                                </span>
                                                                {sectionStars !== null && (
                                                                    <div className="flex items-center gap-0.5">
                                                                        {[1,2,3,4,5].map(s => (
                                                                            <svg key={s} className={`w-4 h-4 ${s <= sectionStars ? "text-amber-400" : "text-slate-600"}`} fill="currentColor" viewBox="0 0 20 20">
                                                                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                                                            </svg>
                                                                        ))}
                                                                        <span className={`text-sm font-bold ml-1 ${c.avgText}`}>{sectionStars}★</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>

                                        {/* Combined section: show note about team feedback portion */}
                                        {isCombined && (
                                            <div className="px-5 pb-2">
                                                <div className="flex items-start gap-2 p-3 rounded-xl bg-sky-500/10 border border-sky-500/20">
                                                    <span className="text-sky-400 text-sm shrink-0">ℹ️</span>
                                                    <div>
                                                        <p className="text-xs font-bold text-sky-400">50/50 Split</p>
                                                        <p className="text-sm text-sky-300/80 mt-0.5 leading-relaxed">
                                                            Your rating above counts for 50% of this pillar. The remaining 50% comes from
                                                            anonymous team member feedback (collected separately).
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Section comment box for all manager-rated pillars */}
                                        <div className="px-5 pb-5">
                                            <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${c.headerText}`}>
                                                Comments for {section.label} <span className="text-slate-500 normal-case font-normal">(optional)</span>
                                            </label>
                                            <textarea
                                                value={sectionComments[section.key] ?? ""}
                                                onChange={(e) => setSectionComments(prev => ({ ...prev, [section.key]: e.target.value }))}
                                                placeholder={`Add specific feedback or notes for ${section.label}...`}
                                                rows={3}
                                                className={`w-full px-4 py-3 rounded-xl border ${c.border} bg-slate-50 dark:bg-[#1a1a35] text-sm text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40 resize-none leading-relaxed`}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Draft saved toast */}
                {draftSaved && (
                    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl shadow-xl flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        Draft saved successfully
                    </div>
                )}

                {/* Draft error toast */}
                {draftError && (
                    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 bg-rose-600 text-white text-sm font-medium rounded-xl shadow-xl flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        {draftError}
                    </div>
                )}

                {/* Confirm submit dialog */}
                {showConfirm && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                        <div className="bg-white dark:bg-[#1a1a35] border border-slate-200 dark:border-white/10 rounded-2xl w-[380px] shadow-2xl p-6 space-y-4">
                            <div className="flex items-start gap-3">
                                <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
                                    <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Submit Rating?</h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                                        You&apos;re about to submit the rating for <span className="font-semibold text-slate-700 dark:text-slate-200">{selectedMember?.name}</span>.
                                        This will trigger the score calculation. Are you sure?
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => setShowConfirm(false)}
                                    className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-sm rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => { setShowConfirm(false); handleSubmit(); }}
                                    className="flex-1 px-4 py-2.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2"
                                >
                                    Yes, Submit
                                </button>
                            </div>
                        </div>
                    </div>
                )}

            </div>{/* closes flex-1 overflow-y-auto */}

            {/* Sticky footer actions */}
            <div className="shrink-0 bg-white dark:bg-[#0d0d1f] border-t border-slate-200 dark:border-white/5 px-6 py-4">
                <div className="max-w-3xl mx-auto flex gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2.5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-sm rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSaveDraft}
                        disabled={!selectedUser || savingDraft || submitting || templateMissing}
                        className="flex-1 px-4 py-2.5 border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 text-sm font-medium rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {savingDraft && (
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                        )}
                        {savingDraft ? "Saving..." : "Save as Draft"}
                    </button>
                    <button
                        onClick={() => setShowConfirm(true)}
                        disabled={!selectedUser || Object.keys(ratings).length === 0 || submitting || savingDraft || templateMissing}
                        className="flex-1 px-4 py-2.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {submitting && (
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                        )}
                        {submitting ? "Submitting..." : "Submit Rating"}
                    </button>
                </div>
            </div>
        </div>
    );
}
