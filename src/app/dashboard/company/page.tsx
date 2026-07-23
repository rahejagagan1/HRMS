"use client";

import { useState } from "react";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { fetcher, swrConfig } from "@/lib/swr";
import SummaryCards from "@/components/dashboard/summary-cards";
import Leaderboard from "@/components/dashboard/leaderboard";
import { formatNumber } from "@/lib/utils";
import { DashboardSkeleton } from "@/components/ui/loading-spinner";

export default function CompanyDashboardPage() {
    const { data, error, isLoading, mutate } = useSWR(
        "/api/dashboard/company",
        fetcher,
        swrConfig
    );
    const [syncing, setSyncing] = useState(false);
    // Sync Now is dev-only — only show the button to users flagged as
    // developers via DEVELOPER_EMAILS in env. Everyone else just sees
    // the dashboard without the button.
    const { data: session } = useSession();
    const isDeveloper = (session?.user as any)?.isDeveloper === true;

    const handleSync = async () => {
        setSyncing(true);
        try {
            await fetch("/api/sync/all", { method: "POST" });
            // Revalidate the SWR cache after sync
            await mutate();
        } catch (err) {
            console.error("Sync failed:", err);
        } finally {
            setSyncing(false);
        }
    };

    if (isLoading) {
        return <DashboardSkeleton cards={4} />;
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
                <p className="text-sm text-red-400">Failed to load company dashboard.</p>
                <button
                    onClick={() => mutate()}
                    className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs text-white transition-colors"
                >
                    Retry
                </button>
            </div>
        );
    }

    const kpis = data?.kpis || {};

    const cards = [
        {
            title: "Total Cases",
            value: kpis.totalCases || 0,
            subtitle: "Across all capsules",
            gradient: "from-violet-500 to-fuchsia-500",
            icon: <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>,
        },
        {
            title: "Active Pipeline",
            value: kpis.activeCases || 0,
            subtitle: "Cases in progress",
            gradient: "from-blue-500 to-cyan-500",
            icon: <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>,
        },
        {
            title: "Completed",
            value: kpis.completedCases || 0,
            gradient: "from-emerald-500 to-green-500",
            icon: <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
        },
        {
            title: "Team Members",
            value: kpis.totalUsers || 0,
            gradient: "from-amber-500 to-orange-500",
            icon: <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
        },
    ];

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Company Dashboard</h1>
                    <p className="text-sm text-slate-500 mt-1">Company-wide production analytics</p>
                </div>
                {isDeveloper && (
                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className="px-4 py-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                        {syncing && (
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                        )}
                        {syncing ? "Syncing..." : "Sync Now"}
                    </button>
                )}
            </div>

            <SummaryCards cards={cards} />

            {/* Channel Performance */}
            <div className="rounded-2xl bg-[#12122a] border border-white/5 overflow-hidden">
                <div className="px-5 py-4 border-b border-white/5">
                    <h3 className="text-sm font-medium text-white">Channel Performance</h3>
                </div>
                <div className="grid grid-cols-5 divide-x divide-white/5">
                    {(data?.channelStats || []).map((ch: any) => (
                        <div key={ch.channel} className="p-5 text-center hover:bg-white/[0.02] transition-colors">
                            <p className="text-xs text-slate-500 font-medium">{ch.channel}</p>
                            <p className="text-xl font-bold text-white mt-1">{ch.casesCount}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">cases</p>
                            <p className="text-sm font-semibold text-emerald-400 mt-2">
                                {formatNumber(ch.totalViews)}
                            </p>
                            <p className="text-[11px] text-slate-500">total views</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Leaderboards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Leaderboard title="Top Writers" entries={data?.leaderboard?.topWriters || []} />
                <Leaderboard title="Top Editors" entries={data?.leaderboard?.topEditors || []} />
            </div>

            {/* Sync Status */}
            {data?.lastSync && (
                <div className="rounded-2xl bg-[#12122a] border border-white/5 p-5">
                    <h3 className="text-sm font-medium text-white mb-3">Last Sync</h3>
                    <div className="flex items-center gap-6 text-xs">
                        <div>
                            <span className="text-slate-500">Status: </span>
                            <span className={data.lastSync.status === "success" ? "text-emerald-400" : "text-amber-400"}>
                                {data.lastSync.status}
                            </span>
                        </div>
                        <div>
                            <span className="text-slate-500">Records: </span>
                            <span className="text-white">{data.lastSync.recordsSynced || 0}</span>
                        </div>
                        <div>
                            <span className="text-slate-500">Time: </span>
                            <span className="text-white">
                                {new Date(data.lastSync.startedAt).toLocaleString("en-IN")}
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
