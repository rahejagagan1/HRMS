"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import Link from "next/link";
// Lazy: ScoreCard pulls in recharts — defer it out of the initial bundle.
const ScoreCard = dynamic(() => import("@/components/scores/score-card"), { ssr: false });

// Helper: get last month in "YYYY-MM" format
function getLastMonth(): string {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function UserScorePage() {
    const params = useParams();
    const userId = params.userId as string;
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedMonth, setSelectedMonth] = useState<string>(getLastMonth());
    const [availableMonths, setAvailableMonths] = useState<string[]>([]);

    const fetchData = useCallback((month: string) => {
        setLoading(true);
        setError(null);
        fetch(`/api/scores/${userId}?month=${month}`)
            .then((res) => {
                if (!res.ok) throw new Error(res.status === 403 ? "Access denied" : "Failed to load");
                return res.json();
            })
            .then((d) => {
                setData(d);
                if (d.availableMonths?.length) {
                    setAvailableMonths(d.availableMonths);
                }
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [userId]);

    useEffect(() => {
        fetchData(selectedMonth);
    }, [selectedMonth, fetchData]);

    if (loading) {
        return (
            <div className="space-y-6 max-w-5xl mx-auto">
                <div className="h-48 rounded-2xl bg-slate-200 dark:bg-[#12122a] border border-slate-200 dark:border-white/5 animate-pulse" />
                <div className="h-64 rounded-2xl bg-slate-200 dark:bg-[#12122a] border border-slate-200 dark:border-white/5 animate-pulse" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <div className="w-16 h-16 rounded-2xl bg-rose-500/10 flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                </div>
                <p className="text-slate-900 dark:text-white font-semibold">{error}</p>
                <Link href="/dashboard/scores" className="text-violet-400 text-sm mt-2 hover:underline">
                    ← Back to Scorecards
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-xs text-slate-500">
                <Link href="/dashboard/scores" className="hover:text-violet-400 transition-colors">
                    Scorecards
                </Link>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-slate-700 dark:text-slate-300 font-medium">{data?.user?.name}</span>
            </div>

            <ScoreCard
                user={data?.user}
                monthlyRatings={data?.monthlyRatings || []}
                managerRatings={data?.managerRatings || []}
                selectedMonth={selectedMonth}
                availableMonths={availableMonths}
                onMonthChange={setSelectedMonth}
            />
        </div>
    );
}
