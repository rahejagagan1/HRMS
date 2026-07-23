"use client";

import useSWR from "swr";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { fetcher, swrConfig } from "@/lib/swr";
import SummaryCards from "@/components/dashboard/summary-cards";
import CasesTable from "@/components/dashboard/cases-table";
// Lazy: keeps recharts out of the dashboard landing bundle — only fetched
// when the rating chart actually renders.
const RatingChart = dynamic(() => import("@/components/dashboard/rating-chart"), { ssr: false });
import { DashboardSkeleton } from "@/components/ui/loading-spinner";

export default function DashboardPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const sessionUser = session?.user as any;
    // Dashboard (cases analytics) is developer-only. Everyone else —
    // including CEO and admins — gets redirected to the HR home which
    // works for every role.
    const canAccess = sessionUser?.isDeveloper === true;

    useEffect(() => {
        if (status === "loading") return;
        if (!canAccess) {
            router.replace("/dashboard/hr/home");
        }
    }, [status, canAccess]);

    const { data, error, isLoading } = useSWR(canAccess ? "/api/dashboard/my" : null, fetcher, swrConfig);

    if (status === "loading" || isLoading) {
        return <DashboardSkeleton cards={4} />;
    }

    if (!canAccess) return null;

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
                <p className="text-sm text-red-400">Failed to load dashboard data.</p>
                <button
                    onClick={() => window.location.reload()}
                    className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs text-white transition-colors"
                >
                    Retry
                </button>
            </div>
        );
    }

    const summary = data?.summary || {};

    const cards = [
        {
            title: "Total Cases",
            value: summary.totalCases || 0,
            subtitle: "All production cases",
            gradient: "from-violet-500 to-fuchsia-500",
            icon: (
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
            ),
        },
        {
            title: "Active Cases",
            value: summary.activeCases || 0,
            subtitle: "Currently in pipeline",
            trend: "up" as const,
            change: "In progress",
            gradient: "from-blue-500 to-cyan-500",
            icon: (
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
            ),
        },
        {
            title: "Completed",
            value: summary.completedCases || 0,
            subtitle: "Cases done",
            trend: "up" as const,
            change: "Published + Done",
            gradient: "from-emerald-500 to-green-500",
            icon: (
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            ),
        },
        {
            title: "Completion Rate",
            value: summary.totalCases > 0
                ? `${Math.round((summary.completedCases / summary.totalCases) * 100)}%`
                : "0%",
            subtitle: "Overall pipeline",
            gradient: "from-amber-500 to-orange-500",
            icon: (
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                </svg>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white">My Dashboard</h1>
                <p className="text-sm text-slate-500 mt-1">Overview of your production activity</p>
            </div>

            <SummaryCards cards={cards} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <RatingChart data={[]} />
                </div>
                <div className="rounded-2xl bg-[#12122a] border border-white/5 p-5">
                    <h3 className="text-sm font-medium text-white mb-4">Recent Activity</h3>
                    <div className="space-y-3">
                        {(data?.recentActivity || []).slice(0, 8).map((activity: any, i: number) => (
                            <div key={i} className="flex items-start gap-3 py-2">
                                <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0" />
                                <div>
                                    <p className="text-xs text-white">{activity.name}</p>
                                    <p className="text-[11px] text-slate-500">
                                        {activity.case?.name} • {activity.assignee?.name || "Unassigned"}
                                    </p>
                                </div>
                            </div>
                        ))}
                        {(!data?.recentActivity || data.recentActivity.length === 0) && (
                            <p className="text-xs text-slate-500 py-4 text-center">No recent activity</p>
                        )}
                    </div>
                </div>
            </div>

            <div>
                <h3 className="text-sm font-medium text-white mb-3">Recent Cases</h3>
                <CasesTable cases={data?.recentCases || []} />
            </div>
        </div>
    );
}
