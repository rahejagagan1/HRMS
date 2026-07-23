"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { canViewFeedbackInbox } from "@/lib/feedback-inbox-access";
import { canUseFeedback } from "@/lib/access";

const CATEGORY_LABELS: Record<string, string> = {
    // Current categories
    people_team_dynamics:     "People & Team Dynamics",
    work_culture_environment: "Work Culture & Environment",
    ideas_improvements:       "Ideas & Improvements",
    processes_policies:       "Processes & Policies",
    compensation_support:     "Compensation & Support",
    unfiltered_unsaid:        "Unfiltered / Something Unsaid",
    anything_else:            "Anything Else",
    // Legacy categories — kept so historical entries still render a friendly label
    general_issue:     "General issue",
    attendance_issue:  "Attendance issue",
    policy_issue:      "Policy issue",
    finance_issue:     "Finance issue",
    salary_issue:      "Salary issue",
    feature_requested: "Feature requested",
    others:            "Others",
};

type Row = {
    id: number;
    category: string;
    message: string;
    createdAt: string;
};

export default function FeedbackInboxPage() {
    const { data: session, status } = useSession();
    const user = session?.user as any;
    // Stack the role gate with the brand gate — Feedback is an NB Media
    // program, so YT Labs admins (e.g. the YT Labs CEO) don't see the
    // inbox even though they otherwise pass canViewFeedbackInbox.
    const allowed = canViewFeedbackInbox(user) && canUseFeedback(user);

    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (status !== "authenticated" || !allowed) {
            setLoading(false);
            return;
        }
        fetch("/api/feedback", { credentials: "include" })
            .then(async (r) => {
                const data = await r.json().catch(() => null);
                if (r.status === 403) {
                    setError("Access denied");
                    return;
                }
                if (!r.ok) {
                    setError(typeof data?.error === "string" ? data.error : `Could not load (${r.status})`);
                    return;
                }
                if (!Array.isArray(data)) {
                    setError("Unexpected response from server");
                    return;
                }
                setRows(data);
            })
            .catch(() => setError("Could not load feedback"))
            .finally(() => setLoading(false));
    }, [status, allowed]);

    if (status === "loading") {
        return (
            <div className="p-8 text-slate-400 text-sm">Loading…</div>
        );
    }

    if (!allowed) {
        return (
            <div className="p-8 max-w-lg">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Feedback inbox</h1>
                <p className="text-slate-500 dark:text-slate-400 text-sm">You don&apos;t have access to this page.</p>
                <Link href="/dashboard/hr/home" className="text-violet-600 dark:text-violet-400 text-sm mt-4 inline-block hover:underline">
                    ← Back to HR Home
                </Link>
            </div>
        );
    }

    return (
        <div className="p-6 mx-auto max-w-7xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                    <Link href="/dashboard/feedback" className="text-xs text-violet-600 dark:text-violet-400 hover:underline mb-2 inline-block">
                        ← Feedback
                    </Link>
                    <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">NB Unplugged inbox</h1>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                        Submissions from the Feedback page. Entries are anonymous in this view.
                    </p>
                </div>
            </div>

            {loading ? (
                <p className="text-slate-500 text-sm">Loading entries…</p>
            ) : error ? (
                <p className="text-rose-600 dark:text-rose-400 text-sm">{error}</p>
            ) : rows.length === 0 ? (
                <p className="text-slate-500 text-sm">No submissions yet.</p>
            ) : (
                <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#12122a] overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-white/10 text-[10px] uppercase tracking-wider text-slate-500">
                                    <th className="px-4 py-3 font-semibold">Date</th>
                                    <th className="px-4 py-3 font-semibold">Category</th>
                                    <th className="px-4 py-3 font-semibold">Message</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                                {rows.map((r) => (
                                    <tr key={r.id} className="text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                                        <td className="px-4 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400 align-top">
                                            {new Date(r.createdAt).toLocaleString(undefined, {
                                                dateStyle: "medium",
                                                timeStyle: "short",
                                            })}
                                        </td>
                                        <td className="px-4 py-3 text-violet-600 dark:text-violet-300 whitespace-nowrap align-top">
                                            {CATEGORY_LABELS[r.category] ?? r.category}
                                        </td>
                                        <td className="px-4 py-3 text-slate-800 dark:text-slate-200 max-w-lg md:max-w-3xl align-top">
                                            <span className="whitespace-pre-wrap break-words">{r.message}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
