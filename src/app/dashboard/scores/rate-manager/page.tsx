"use client";

import { useEffect, useState } from "react";
import { RatingCriteriaPanel, type RatingCriteria } from "@/components/scores/rating-criteria-panel";

interface TeamQuestion {
    key: string;
    label: string;
    /** Three labels from template (always shown with star row). */
    options: [string, string, string];
}

function optStorageKey(questionKey: string): string {
    return `${questionKey}_opt`;
}

function commentStorageKey(questionKey: string): string {
    return `${questionKey}_comment`;
}

interface ManagerInfo {
    id: number;
    name: string;
    role: string;
    profilePictureUrl: string | null;
}

function getLastMonth(): string {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function RateManagerPage() {
    const [manager, setManager] = useState<ManagerInfo | null>(null);
    const [questions, setQuestions] = useState<TeamQuestion[]>([]);
    const [sectionLabel, setSectionLabel] = useState<string | null>(null);
    const [sectionDescription, setSectionDescription] = useState<string | null>(null);
    const [ratingCriteria, setRatingCriteria] = useState<RatingCriteria | null>(null);
    const [ratings, setRatings] = useState<Record<string, number | string>>({});
    const [comments, setComments] = useState("");
    const [period, setPeriod] = useState(getLastMonth());
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [alreadySubmitted, setAlreadySubmitted] = useState(false);

    useEffect(() => {
        loadManagerAndQuestions();
    }, [period]);

    const loadManagerAndQuestions = async () => {
        setLoading(true);
        setError(null);
        try {
            // Fetch current user's info (includes manager relation)
            const userRes = await fetch("/api/users/me");
            if (!userRes.ok) { setError("Failed to load user info"); setLoading(false); return; }
            const userData = await userRes.json();

            if (!userData.managerId || !userData.manager) {
                setError("You don't have a manager assigned.");
                setLoading(false);
                return;
            }

            setManager(userData.manager);

            const managerRole = userData.manager?.role as string | undefined;
            const formulaRoleType =
                managerRole === "researcher_manager" ? "researcher_manager" : "production_manager";

            // Fetch CM/PM or Research Manager template to get team questions for "Rate your manager"
            const tmplRes = await fetch(`/api/ratings/formula-template/active?roleType=${formulaRoleType}`);
            if (tmplRes.ok) {
                const tmpl = await tmplRes.json();
                if (tmpl?.sections) {
                    const combinedSection = (tmpl.sections as any[]).find(
                        (s) => s.type === "combined_team_manager_rating"
                    );
                    if (combinedSection?.team_question_keys?.length) {
                        const qs: TeamQuestion[] = combinedSection.team_question_keys.map(
                            (key: string, i: number) => {
                                const row = combinedSection.team_question_options?.[i] as string[] | undefined;
                                const o0 = row?.[0]?.trim();
                                const o1 = row?.[1]?.trim();
                                const o2 = row?.[2]?.trim();
                                const options: [string, string, string] =
                                    o0 && o1 && o2
                                        ? [o0, o1, o2]
                                        : ["Disagree", "Neutral", "Agree"];
                                return {
                                    key,
                                    label: combinedSection.team_question_labels?.[i] || key.replace(/_/g, " "),
                                    options,
                                };
                            }
                        );
                        setQuestions(qs);
                        setSectionLabel(combinedSection.label ?? "Team feedback");
                        setSectionDescription(combinedSection.description ?? null);
                        const teamCrit =
                            (combinedSection.team_rating_criteria as RatingCriteria | undefined) ??
                            (combinedSection.rating_criteria as RatingCriteria | undefined) ??
                            null;
                        setRatingCriteria(teamCrit);
                    } else {
                        setQuestions([]);
                        setSectionLabel(null);
                        setSectionDescription(null);
                        setRatingCriteria(null);
                    }
                } else {
                    setQuestions([]);
                    setSectionLabel(null);
                    setSectionDescription(null);
                    setRatingCriteria(null);
                }
            } else {
                setQuestions([]);
                setSectionLabel(null);
                setSectionDescription(null);
                setRatingCriteria(null);
            }

            // Check if already submitted
            const existRes = await fetch(
                `/api/scores/team-manager-rating?mode=my_submissions&managerId=${userData.manager.id}&period=${period}`
            );
            if (existRes.ok) {
                const existing = await existRes.json();
                if (existing.length > 0) {
                    setAlreadySubmitted(true);
                    const rj = existing[0].ratingsJson as Record<string, number | string>;
                    setRatings(rj);
                    setComments(existing[0].comments || "");
                } else {
                    setAlreadySubmitted(false);
                    setRatings({});
                    setComments("");
                }
            }
        } catch {
            setError("Failed to load data");
        } finally {
            setLoading(false);
        }
    };

    function isQuestionComplete(q: TeamQuestion): boolean {
        const star = ratings[q.key];
        if (typeof star !== "number" || star < 1 || star > 5) return false;
        const o = ratings[optStorageKey(q.key)];
        if (o !== "0" && o !== "1" && o !== "2") return false;
        const c = ratings[commentStorageKey(q.key)];
        if (typeof c !== "string" || c.trim().length === 0) return false;
        return true;
    }

    const answeredCount = questions.filter(isQuestionComplete).length;
    const allQuestionsAnswered = questions.length > 0 && questions.every(isQuestionComplete);

    const setQuestionRating = (qKey: string, star: number) => {
        setError(null);
        setRatings((prev) => ({ ...prev, [qKey]: star }));
    };

    const setOptionChoice = (qKey: string, idx: 0 | 1 | 2) => {
        setError(null);
        setRatings((prev) => ({ ...prev, [optStorageKey(qKey)]: String(idx) }));
    };

    const setQuestionComment = (qKey: string, text: string) => {
        setError(null);
        setRatings((prev) => ({ ...prev, [commentStorageKey(qKey)]: text }));
    };

    const handleSubmit = async () => {
        if (!manager || questions.length === 0) return;
        if (!allQuestionsAnswered) {
            setError(
                `Complete every question: pick one of the three choices, assign 1–5 stars, and fill the explanation for each (${questions.length} question${questions.length === 1 ? "" : "s"}).`
            );
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch("/api/scores/team-manager-rating", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    managerId: manager.id,
                    period,
                    ratingsJson: ratings,
                    comments,
                }),
            });
            if (res.ok) {
                setSubmitted(true);
            } else {
                const data = await res.json().catch(() => ({}));
                setError(data.error || `Submission failed (${res.status})`);
            }
        } catch {
            setError("Network error — please try again");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#0d0d1f]">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-sm text-slate-500">Loading...</p>
                </div>
            </div>
        );
    }

    if (submitted) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#0d0d1f]">
                <div className="max-w-md text-center space-y-4 px-6">
                    <span className="text-5xl">✅</span>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Thank you!</h2>
                    <p className="text-sm text-slate-500">
                        Your anonymous feedback for <span className="font-semibold text-slate-700 dark:text-slate-300">{manager?.name}</span> has been submitted.
                    </p>
                    <button
                        onClick={() => window.history.back()}
                        className="mt-4 px-6 py-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-sm font-medium rounded-xl"
                    >
                        Go Back
                    </button>
                </div>
            </div>
        );
    }

    if (error && !manager) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#0d0d1f]">
                <div className="max-w-md text-center space-y-4 px-6">
                    <span className="text-5xl">⚠️</span>
                    <p className="text-sm text-slate-500">{error}</p>
                    <button
                        onClick={() => window.history.back()}
                        className="mt-4 px-6 py-3 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium rounded-xl"
                    >
                        Go Back
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white dark:bg-[#0d0d1f]">
            <div className="max-w-2xl mx-auto px-6 py-10">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <svg className="w-6 h-6 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                        Rate Your Manager
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Your responses are <span className="font-semibold text-emerald-500">anonymous</span> — individual ratings are never shared.
                    </p>
                </div>

                {/* Manager info */}
                {manager && (
                    <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 mb-6">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white font-bold text-lg">
                            {manager.name.charAt(0)}
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">{manager.name}</p>
                            <p className="text-xs text-slate-500">{manager.role.replace(/_/g, " ")}</p>
                        </div>
                        <div className="ml-auto">
                            <input
                                type="month"
                                value={period}
                                onClick={(e) => (e.target as HTMLInputElement).showPicker()}
                                onChange={(e) => {
                                    setPeriod(e.target.value);
                                    setAlreadySubmitted(false);
                                    setRatings({});
                                    setComments("");
                                }}
                                className="px-3 py-2 bg-slate-100 dark:bg-[#1a1a35] border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white cursor-pointer"
                            />
                        </div>
                    </div>
                )}

                {alreadySubmitted && (
                    <div className="mb-6 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-500 font-medium flex items-center gap-2">
                        <span>✓</span> You&apos;ve already submitted feedback for this period. You can update your responses below.
                    </div>
                )}

                {questions.length === 0 ? (
                    <div className="text-center py-16 text-slate-500">
                        <p>No feedback questions configured yet.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {sectionLabel && (
                            <div className="rounded-2xl border border-violet-200 dark:border-violet-500/20 overflow-hidden bg-violet-50/40 dark:bg-violet-500/[0.04]">
                                <div className="px-5 py-4 border-b border-violet-200 dark:border-violet-500/20 bg-violet-500/10">
                                    <h2 className="text-sm font-bold uppercase tracking-wider text-violet-600 dark:text-violet-300">
                                        {sectionLabel}
                                    </h2>
                                    <p className="text-xs text-slate-500 mt-1">
                                        For each question: choose one of the three options, assign 1–5 stars (1 = lowest), then explain your rating in the box below (required).
                                    </p>
                                </div>
                                {(ratingCriteria || sectionDescription) && (
                                    <div className="px-5 py-4">
                                        <RatingCriteriaPanel
                                            rating_criteria={ratingCriteria}
                                            description={sectionDescription}
                                            headerBorder="border-violet-300 dark:border-violet-500/20"
                                            headerText="text-violet-600 dark:text-violet-400"
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        <p className="text-sm text-slate-500">
                            Progress: <span className="font-semibold text-violet-600 dark:text-violet-400">{answeredCount}</span> / {questions.length} questions rated
                        </p>

                        {questions.map((q, qi) => {
                            const optSel = ratings[optStorageKey(q.key)];
                            const starRaw = ratings[q.key];
                            const starVal = typeof starRaw === "number" ? starRaw : 0;
                            return (
                                <div
                                    key={q.key}
                                    className="space-y-4 py-4 px-5 rounded-xl bg-violet-100/80 dark:bg-violet-500/10 border border-violet-300 dark:border-violet-500/20"
                                >
                                    <div>
                                        <span className="text-base font-bold text-violet-700 dark:text-violet-300 leading-snug">
                                            <span className="text-violet-500/80 font-mono text-xs mr-2">{qi + 1}.</span>
                                            {q.label}
                                        </span>
                                        <p className="text-xs text-slate-500 mt-1.5">
                                            Select one answer, rate with stars, then explain your rating (required).
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {q.options.map((optLabel, oi) => {
                                            const selected = optSel === String(oi);
                                            return (
                                                <button
                                                    key={oi}
                                                    type="button"
                                                    onClick={() => setOptionChoice(q.key, oi as 0 | 1 | 2)}
                                                    className={`px-3 py-2.5 rounded-xl text-sm font-medium border text-left max-w-full transition-all ${
                                                        selected
                                                            ? "border-violet-500 bg-violet-500/25 text-violet-900 dark:text-violet-100 shadow-sm"
                                                            : "border-violet-300/60 dark:border-violet-500/30 bg-white/50 dark:bg-[#1a1a35]/80 text-slate-700 dark:text-slate-300 hover:border-violet-400"
                                                    }`}
                                                >
                                                    {optLabel}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-1 border-t border-violet-300/40 dark:border-violet-500/20">
                                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                            Star rating (this question)
                                        </span>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {[1, 2, 3, 4, 5].map((star) => (
                                                <button
                                                    key={star}
                                                    type="button"
                                                    onClick={() => setQuestionRating(q.key, star)}
                                                    className="transition-transform hover:scale-110"
                                                >
                                                    <svg
                                                        className={`w-9 h-9 transition-colors ${
                                                            star <= starVal ? "text-amber-400" : "text-slate-300 dark:text-slate-700"
                                                        }`}
                                                        fill="currentColor"
                                                        viewBox="0 0 20 20"
                                                    >
                                                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                                    </svg>
                                                </button>
                                            ))}
                                            {starVal > 0 && (
                                                <span className="text-base font-bold text-violet-600 dark:text-violet-400 ml-1">
                                                    {starVal}★
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="pt-3 border-t border-violet-300/40 dark:border-violet-500/20">
                                        <label
                                            htmlFor={`comment-${q.key}`}
                                            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
                                        >
                                            Explain in detail what made you to give the above rating?
                                            <span className="text-rose-500 ml-1" aria-hidden>
                                                *
                                            </span>
                                        </label>
                                        <textarea
                                            id={`comment-${q.key}`}
                                            value={typeof ratings[commentStorageKey(q.key)] === "string" ? (ratings[commentStorageKey(q.key)] as string) : ""}
                                            onChange={(e) => setQuestionComment(q.key, e.target.value)}
                                            placeholder="Write your explanation here — it is required to submit."
                                            rows={3}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1a1a35] text-sm text-slate-700 dark:text-slate-300 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 resize-y min-h-[5rem]"
                                        />
                                    </div>
                                </div>
                            );
                        })}

                        <div className="mt-4">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                Additional Comments <span className="text-slate-400 normal-case font-normal">(optional, anonymous)</span>
                            </label>
                            <textarea
                                value={comments}
                                onChange={(e) => setComments(e.target.value)}
                                placeholder="Any additional feedback for your manager..."
                                rows={3}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#1a1a35] text-sm text-slate-700 dark:text-slate-300 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 resize-none"
                            />
                        </div>

                        {error && (
                            <p className="text-sm text-rose-500 font-medium">{error}</p>
                        )}

                        <div className="flex gap-3 pt-4">
                            <button
                                onClick={() => window.history.back()}
                                className="px-5 py-3 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-sm rounded-xl hover:bg-slate-50 dark:hover:bg-white/5"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={submitting || !allQuestionsAnswered}
                                className="flex-1 px-5 py-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-sm font-medium rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {submitting ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        Submitting...
                                    </>
                                ) : (
                                    alreadySubmitted ? "Update Feedback" : "Submit Feedback"
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
