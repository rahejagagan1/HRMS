"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { isAdmin as isAdminUser, canSeeReports } from "@/lib/access";

export default function AllReportsPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const sessionUser = session?.user as any;
    // Was: ceo | dev | special_access (missing role=admin). Use the
    // central helpers so adding a role to admin-tier in one place
    // doesn't require remembering to update each report page too.
    const isCeoOrAdmin = isAdminUser(sessionUser);
    const canAccessReports = canSeeReports(sessionUser);

    const [allowedManagerIds, setAllowedManagerIds] = useState<number[]>([]);
    const [accessChecked, setAccessChecked] = useState(false);

    // Redirect users who don't have access
    useEffect(() => {
        if (status === "loading") return;
        if (!canAccessReports) {
            router.replace("/dashboard");
            return;
        }
        if (isCeoOrAdmin) { setAccessChecked(true); return; }
        if (!sessionUser?.dbId) return;

        fetch("/api/user/report-access")
            .then(r => r.json())
            .then(d => {
                const ids: number[] = d.allowedManagerIds ?? [];
                setAllowedManagerIds(ids);
                setAccessChecked(true);
                // If no specific access, redirect to own report page
                if (ids.length === 0) {
                    router.replace(`/dashboard/reports/${sessionUser.dbId}`);
                }
            })
            .catch(() => {
                setAccessChecked(true);
                router.replace(`/dashboard/reports/${sessionUser.dbId}`);
            });
    }, [status, canAccessReports, isCeoOrAdmin, sessionUser?.dbId]);

    const [reports, setReports] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filterType, setFilterType] = useState<"all" | "weekly" | "monthly">("all");

    useEffect(() => {
        if (!accessChecked) return;
        if (!isCeoOrAdmin && allowedManagerIds.length === 0) return;
        fetch("/api/admin/reports")
            .then(r => r.json())
            .then(d => { setReports(Array.isArray(d) ? d : []); setLoading(false); })
            .catch(() => setLoading(false));
    }, [isCeoOrAdmin, accessChecked, allowedManagerIds.length]);

    const filtered = reports.filter(r => {
        const matchSearch = !search || r.managerName?.toLowerCase().includes(search.toLowerCase()) || r.period?.toLowerCase().includes(search.toLowerCase());
        const matchType = filterType === "all" || (filterType === "monthly" && r.isMonthly) || (filterType === "weekly" && !r.isMonthly);
        const matchAccess = isCeoOrAdmin || allowedManagerIds.includes(Number(r.managerId));
        return matchSearch && matchType && r.isLocked && matchAccess;
    });

    // Group by manager
    const grouped: Record<string, any[]> = {};
    filtered.forEach(r => {
        if (!grouped[r.managerName]) grouped[r.managerName] = [];
        grouped[r.managerName].push(r);
    });

    if (!accessChecked) {
        return <div className="flex items-center justify-center min-h-[40vh] text-slate-400 text-sm">Loading…</div>;
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-white">Submitted Reports</h1>
                    <p className="text-xs text-slate-400 mt-0.5">
                        {isCeoOrAdmin ? "All submitted weekly and monthly reports — view only" : "Reports you have been given access to — view only"}
                    </p>
                </div>
                {isCeoOrAdmin && (
                    <Link
                        href="/admin"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 text-xs font-medium transition-colors"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Manage in Admin
                    </Link>
                )}
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search by manager or period…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                    />
                </div>
                <div className="flex gap-1 bg-white/5 border border-white/10 rounded-lg p-1">
                    {(["all", "weekly", "monthly"] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => setFilterType(t)}
                            className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors ${filterType === t ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"}`}
                        >
                            {t}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            {loading ? (
                <div className="space-y-3">
                    {[1,2,3].map(i => <div key={i} className="h-20 rounded-xl bg-white/5 animate-pulse" />)}
                </div>
            ) : Object.keys(grouped).length === 0 ? (
                <div className="text-center py-16 text-slate-500 text-sm">
                    No submitted reports found.
                </div>
            ) : (
                <div className="space-y-5">
                    {Object.entries(grouped).map(([managerName, managerReports]) => (
                        <div key={managerName} className="rounded-xl border border-white/10 bg-[#12122a] overflow-hidden">
                            <div className="px-5 py-3 border-b border-white/5 flex items-center gap-3 bg-white/[0.02]">
                                <div className="w-7 h-7 rounded-full bg-violet-600/30 flex items-center justify-center text-white text-xs font-bold">
                                    {managerName.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-sm font-semibold text-white">{managerName}</span>
                                <span className="ml-auto text-[11px] text-slate-500">{managerReports.length} report{managerReports.length !== 1 ? "s" : ""}</span>
                            </div>
                            <div className="divide-y divide-white/[0.04]">
                                {managerReports.map(r => (
                                    <div key={r.id} className="flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-2 h-2 rounded-full ${r.isMonthly ? "bg-violet-400" : "bg-amber-400"}`} />
                                            <div>
                                                <p className="text-sm text-slate-200 font-medium">{r.period}</p>
                                                <p className="text-[11px] text-slate-500 mt-0.5">
                                                    Submitted {new Date(r.submittedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400">
                                                ✓ Submitted
                                            </span>
                                            <Link
                                                href={r.viewUrl}
                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 text-xs font-medium transition-colors"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                </svg>
                                                View Report
                                            </Link>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
