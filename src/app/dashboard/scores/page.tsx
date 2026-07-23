"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import ManagerRatingForm from "@/components/scores/manager-rating-form";
import UserAvatar from "@/components/ui/user-avatar";
import { canSeeReports } from "@/lib/access";

// Helper: get last month in "YYYY-MM" format
function getLastMonth(): string {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Helper: format "YYYY-MM" to readable label
function formatMonthLabel(ym: string): string {
    const [year, month] = ym.split("-").map(Number);
    const d = new Date(year, month - 1, 1);
    return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

const ROLE_LABELS: Record<string, string> = {
    writer: "Writers",
    editor: "Editors",
    researcher: "Researchers",
    qa: "QA",
    gc: "GC",
    vo_artist: "VO Artists",
    manager: "Managers",
    admin: "Admins",
    member: "Members",
    publisher: "Publishers",
    production_manager: "Production Managers",
    lead: "Leads",
    sub_lead: "Sub Leads",
    hr_manager: "HR Managers",
    researcher_manager: "Research Managers",
};

// Display order for role groups on the scorecards page
const ROLE_ORDER: string[] = [
    "admin",            // Developer & CEO
    "hr_manager",       // Special Access & HR
    "researcher_manager",
    "production_manager", // Managers
    "manager",
    "lead",
    "sub_lead",
    "qa",               // QA Team
    "gc",
    "editor",           // Editors
    "writer",           // Writers
    "researcher",       // Researchers
    "publisher",
    "vo_artist",
    "member",           // Members
];

const ROLE_COLORS: Record<string, string> = {
    writer: "from-violet-500 to-fuchsia-500",
    editor: "from-blue-500 to-cyan-500",
    researcher: "from-emerald-500 to-green-500",
    qa: "from-amber-500 to-orange-500",
    manager: "from-rose-500 to-pink-500",
    gc: "from-teal-500 to-cyan-500",
    vo_artist: "from-indigo-500 to-violet-500",
    admin: "from-slate-500 to-slate-400",
    member: "from-slate-600 to-slate-500",
    publisher: "from-orange-500 to-amber-500",
    production_manager: "from-red-500 to-rose-500",
    lead: "from-blue-500 to-blue-400",
    sub_lead: "from-purple-500 to-purple-400",
    hr_manager: "from-pink-500 to-rose-500",
    researcher_manager: "from-teal-500 to-emerald-600",
};

export default function ScoreHubPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const sessionUser = session?.user as any;
    // Defer to the shared helper so the page-level gate stays in sync
    // with the sidebar — admin tier + manager + hod + hr_manager.
    const canAccess = canSeeReports(sessionUser);

    useEffect(() => {
        if (status === "loading") return;
        if (!canAccess) {
            router.replace("/dashboard/youtube");
        }
    }, [status, canAccess]);

    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [showRatingForm, setShowRatingForm] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState<string>(getLastMonth());
    const [availableMonths, setAvailableMonths] = useState<string[]>([]);

    const fetchData = useCallback((month: string) => {
        setLoading(true);
        fetch(`/api/scores/hub?month=${month}`)
            .then((res) => res.json())
            .then((d) => {
                setData(d);
                if (d.availableMonths?.length) {
                    setAvailableMonths(d.availableMonths);
                }
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        fetchData(selectedMonth);
    }, [selectedMonth, fetchData]);

    const handleSubmitRating = async (ratingData: any) => {
        const res = await fetch("/api/scores/manager-rating", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ratingData),
        });
        if (!res.ok) throw new Error("Failed to submit rating");
    };

    if (status === "loading") return null;
    if (!canAccess) return null;

    if (loading) {
        return (
            <div className="space-y-6">
                <div className="h-8 w-48 rounded-lg bg-slate-200 dark:bg-white/5 animate-pulse" />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={i} className="h-32 rounded-2xl bg-slate-200 dark:bg-[#12122a] border border-slate-200 dark:border-white/5 animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    const roleGroups = data?.roleGroups || {};
    const currentUser = data?.currentUser || {};
    const isManager = ["ceo", "special_access", "hod", "manager", "lead", "sub_lead"].includes(currentUser.orgLevel) || currentUser.isDeveloper;
    const isAdmin = ["ceo", "special_access"].includes(currentUser.orgLevel) || currentUser.isDeveloper;
    const isCeoOrDev = currentUser.orgLevel === "ceo" || currentUser.isDeveloper;

    // Collect team members for manager rating form (exclude self)
    const allUsers = (Object.values(roleGroups).flat() as any[]).filter((u: any) => u.id !== currentUser.dbId);

    // Safety net — dedupe the month list on the client so a legacy API
    // response that still has duplicates never crashes the <select>. The API
    // already dedupes, but belt-and-suspenders is cheap here.
    const uniqueMonths = Array.from(new Set(availableMonths));

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Scorecards</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Team performance scores &amp; ratings • {formatMonthLabel(selectedMonth)}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {/* Month Selector */}
                    <div className="relative">
                        <select
                            value={selectedMonth}
                            onChange={(e) => setSelectedMonth(e.target.value)}
                            className="appearance-none pl-9 pr-8 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
                        >
                            {(uniqueMonths.length > 0 ? uniqueMonths : [selectedMonth]).map((m) => (
                                <option key={m} value={m} className="bg-white dark:bg-[#1a1a2e] dark:text-slate-200">
                                    {formatMonthLabel(m)}
                                </option>
                            ))}
                        </select>
                        {/* Calendar icon */}
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {/* Chevron icon */}
                        <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                    {isManager && (
                        <button
                            onClick={() => setShowRatingForm(true)}
                            className="px-4 py-2.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 rounded-xl text-sm font-medium text-white transition-all flex items-center gap-2 shadow-lg shadow-violet-500/20"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                            </svg>
                            Rate Team
                        </button>
                    )}
                    <Link
                        href="/dashboard/scores/rate-manager"
                        className="px-4 py-2.5 bg-sky-500/10 border border-sky-500/30 rounded-xl text-sm font-medium text-sky-500 hover:bg-sky-500/20 transition-all flex items-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        Rate Manager
                    </Link>
                    {isAdmin && (
                        <Link
                            href="/dashboard/scores/admin"
                            className="px-4 py-2.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 transition-all flex items-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            Audit Panel
                        </Link>
                    )}
                    {isCeoOrDev && (
                        <Link
                            href="/dashboard/scores/config"
                            className="px-4 py-2.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 transition-all flex items-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            Config
                        </Link>
                    )}
                </div>
            </div>

            {/* Role Groups */}
            {Object.entries(roleGroups).sort(([a], [b]) => {
                const ai = ROLE_ORDER.indexOf(a);
                const bi = ROLE_ORDER.indexOf(b);
                return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
            }).map(([role, users]: [string, any]) => (
                <div key={role}>
                    <div className="flex items-center gap-3 mb-3">
                        <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${ROLE_COLORS[role] || "from-slate-500 to-slate-400"}`} />
                        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                            {ROLE_LABELS[role] || role}
                        </h2>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 border border-slate-200 dark:border-white/10">
                            {(users as any[]).length}
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {(users as any[]).map((user: any) => {
                            const latestRating = user.latestRatings?.[0];
                            const score = latestRating?.overallRating ? Number(latestRating.overallRating) : null;
                            const scoreColor =
                                score === null ? "text-slate-600" :
                                    score >= 4 ? "text-emerald-400" :
                                        score >= 3 ? "text-blue-400" :
                                            score >= 2 ? "text-amber-400" :
                                                "text-rose-400";

                            return (
                                <Link
                                    key={user.id}
                                    href={`/dashboard/scores/${user.id}`}
                                    className="group rounded-2xl bg-white dark:bg-[#12122a] border border-slate-200 dark:border-white/5 p-4 hover:border-violet-500/30 hover:shadow-lg hover:shadow-violet-500/5 transition-all duration-300"
                                >
                                    <div className="flex items-start gap-3">
                                        {/* Avatar */}
                                        <UserAvatar
                                            name={user.name}
                                            src={user.profilePictureUrl}
                                            gradient={ROLE_COLORS[role] || "from-slate-500 to-slate-400"}
                                            className="ring-2 ring-slate-200 dark:ring-white/10 group-hover:ring-violet-500/30 transition-all"
                                        />

                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-slate-900 dark:text-white truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                                                {user.name}
                                            </p>
                                            {user.teamCapsule && (
                                                <p className="text-[10px] text-slate-500 mt-0.5 truncate">{user.teamCapsule}</p>
                                            )}
                                            {user.manager && (
                                                <p className="text-[10px] text-slate-500">↳ {user.manager.name}</p>
                                            )}
                                        </div>

                                        {/* Score */}
                                        <div className="text-right flex-shrink-0">
                                            {score !== null ? (
                                                <p className={`text-lg font-bold ${scoreColor}`}>
                                                    {score.toFixed(1)}
                                                </p>
                                            ) : (
                                                <p className="text-lg font-bold text-slate-600">—</p>
                                            )}
                                        </div>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            ))}

            {Object.keys(roleGroups).length === 0 && (
                <div className="text-center py-20">
                    <div className="w-20 h-20 rounded-2xl bg-slate-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-4">
                        <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                    </div>
                    <p className="text-slate-500 text-sm">No team members visible</p>
                </div>
            )}

            {/* Manager Rating Form Modal */}
            {showRatingForm && (
                <ManagerRatingForm
                    teamMembers={allUsers}
                    onSubmit={handleSubmitRating}
                    onClose={() => setShowRatingForm(false)}
                />
            )}
        </div>
    );
}
