"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { fetcher, swrConfig } from "@/lib/swr";
import CasesTable from "@/components/dashboard/cases-table";
import { STATUSES as FALLBACK_STATUSES } from "@/lib/constants";
import { Skeleton } from "@/components/ui/loading-spinner";

type StatusOption = { value: string; label: string; count?: number };

export default function CasesListPage() {
    const [capsules, setCapsules] = useState<{ id: number; name: string; capsule: string | null }[]>([]);
    const [filters, setFilters] = useState({
        page: 1,
        status: "",
        channel: "",
        capsule: "",
        search: "",
    });

    // Build the API URL from filters — SWR auto-refetches when this changes
    const params = new URLSearchParams();
    params.set("page", String(filters.page));
    params.set("limit", "50");
    if (filters.status) params.set("status", filters.status);
    if (filters.channel) params.set("channel", filters.channel);
    if (filters.capsule) params.set("capsule", filters.capsule);
    if (filters.search) params.set("search", filters.search);

    const { data, error, isLoading } = useSWR(
        `/api/cases?${params}`,
        fetcher,
        { ...swrConfig, keepPreviousData: true }
    );

    // Fetch the live status list — pulled from distinct values in the
    // Case table so any new status syncing in from ClickUp auto-shows
    // here. Falls back to the hardcoded list on first paint / failure.
    const { data: statusData } = useSWR<{ statuses: StatusOption[] }>(
        "/api/cases/statuses",
        fetcher,
        { ...swrConfig, dedupingInterval: 60000 }, // 1 min — cheap query
    );
    const statusOptions: StatusOption[] =
        statusData?.statuses && statusData.statuses.length > 0
            ? statusData.statuses
            : FALLBACK_STATUSES.map((s) => ({ value: s.value, label: s.label }));

    // Fetch capsules for filter dropdown (one-time)
    const { data: capsuleData } = useSWR("/api/capsules", fetcher, {
        ...swrConfig,
        revalidateOnMount: true,
        dedupingInterval: 300000, // 5 minutes for rarely changing data
    });

    useEffect(() => {
        if (Array.isArray(capsuleData)) setCapsules(capsuleData);
    }, [capsuleData]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setFilters((f) => ({ ...f, page: 1 }));
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white">Cases</h1>
                <p className="text-sm text-slate-500 mt-1">
                    Browse and filter all production cases
                </p>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
                <form onSubmit={handleSearch} className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search cases..."
                        value={filters.search}
                        onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                        className="w-64 pl-10 pr-4 py-2 bg-[#12122a] border border-white/10 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                    />
                </form>

                <select
                    value={filters.status}
                    onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}
                    className="px-3 py-2 bg-[#12122a] border border-white/10 rounded-xl text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                >
                    <option value="">All Statuses</option>
                    {statusOptions.map((s) => (
                        <option key={s.value} value={s.value}>
                            {s.label}{typeof s.count === "number" ? ` (${s.count})` : ""}
                        </option>
                    ))}
                </select>

                <select
                    value={filters.channel}
                    onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value, page: 1 }))}
                    className="px-3 py-2 bg-[#12122a] border border-white/10 rounded-xl text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                >
                    <option value="">All Channels</option>
                    <option value="M7">M7</option>
                    <option value="M7CS">M7CS</option>
                    <option value="Bodycam">Bodycam</option>
                    <option value="New Channel">New Channel</option>
                    <option value="3D Documentry">3D Documentary</option>
                </select>

                <select
                    value={filters.capsule}
                    onChange={(e) => setFilters((f) => ({ ...f, capsule: e.target.value, page: 1 }))}
                    className="px-3 py-2 bg-[#12122a] border border-white/10 rounded-xl text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                >
                    <option value="">All Capsules</option>
                    {capsules.map(c => (
                        <option key={c.id} value={c.id}>
                            {c.capsule ? `${c.capsule} — ${c.name}` : c.name}
                        </option>
                    ))}
                </select>
            </div>

            {error ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3">
                    <p className="text-sm text-red-400">Failed to load cases.</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs text-white transition-colors"
                    >
                        Retry
                    </button>
                </div>
            ) : isLoading ? (
                <Skeleton className="h-96" />
            ) : (
                <>
                    <CasesTable cases={data?.cases || []} />

                    {/* Pagination */}
                    {data?.pagination && data.pagination.totalPages > 1 && (
                        <div className="flex items-center justify-between">
                            <p className="text-xs text-slate-500">
                                Showing {(data.pagination.page - 1) * data.pagination.limit + 1}–
                                {Math.min(data.pagination.page * data.pagination.limit, data.pagination.total)} of{" "}
                                {data.pagination.total}
                            </p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setFilters((f) => ({ ...f, page: Math.max(1, f.page - 1) }))}
                                    disabled={filters.page <= 1}
                                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-white disabled:opacity-30 transition-colors"
                                >
                                    Previous
                                </button>
                                <button
                                    onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
                                    disabled={filters.page >= data.pagination.totalPages}
                                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-white disabled:opacity-30 transition-colors"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
