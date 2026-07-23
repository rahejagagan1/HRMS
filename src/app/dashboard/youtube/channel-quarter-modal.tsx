"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

type UploadSnippet = { publishedAt: string; title: string; videoId: string };

export type AnalysisBucket = {
    key: string;
    label: string;
    endDay: string;
    views: number;
    uploads: UploadSnippet[];
};

type AnalysisPayload = {
    channelName: string;
    analyticsStartStr: string;
    analyticsEndStr: string;
    buckets: AnalysisBucket[];
    headlineViews: number;
    uploadsTotal: number;
    fetchedAt?: string | null;
    dataSource?: string;
    /** YoutubeDashboardQuarterMetrics — same as channel strip "quarter views". */
    viewsGainedInQuarter: number | null;
    quarterAnalyticsStartStr: string | null;
    quarterAnalyticsEndStr: string | null;
    quarterMetricsFetchedAt: string | null;
};

function formatViews(n: number): string {
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatCompact(n: number | null): string {
    if (n == null) return "—";
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
    return String(Math.round(n));
}

function scopeKeyFor(channelId: string, year: number, quarter: number) {
    return `${channelId}:${year}:${quarter}`;
}

export type UserQuarterContribution = {
    videoCount: number;
    viewsOnVideos: number;
};

type MetricKey = "views" | "watchTime" | "subscribers";

const METRIC_DEFS: { key: MetricKey; label: string }[] = [
    { key: "views", label: "Views" },
    { key: "watchTime", label: "Watch time (hours)" },
    { key: "subscribers", label: "Subscribers" },
];

export default function ChannelQuarterAnalysisSection({
    channelId,
    channelLabel,
    year,
    quarter,
    quarterLabel,
    onDismiss,
    embedded,
    userContribution,
    subscriberCount,
}: {
    channelId: string;
    channelLabel: string;
    year: number;
    quarter: number;
    quarterLabel: string;
    onDismiss: () => void;
    embedded?: boolean;
    userContribution?: UserQuarterContribution | null;
    subscriberCount?: number | null;
}) {
    const gradientId = `ytAreaFill-${useId().replace(/:/g, "")}`;
    const scopeKey = useMemo(() => scopeKeyFor(channelId, year, quarter), [channelId, year, quarter]);

    const [data, setData] = useState<AnalysisPayload | null>(null);
    const [dataScopeKey, setDataScopeKey] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedMetric, setSelectedMetric] = useState<MetricKey>("views");

    // Reset metric tab when channel/quarter changes
    useEffect(() => {
        setSelectedMetric("views");
    }, [channelId, year, quarter]);

    useEffect(() => {
        const ac = new AbortController();
        setLoading(true);
        setErr(null);

        (async () => {
            try {
                const res = await fetch(
                    `/api/dashboard/youtube/channel-analysis?channelId=${encodeURIComponent(channelId)}&year=${year}&quarter=${quarter}`,
                    { credentials: "include", signal: ac.signal }
                );
                const json = await res.json().catch(() => null);
                if (ac.signal.aborted) return;
                if (!res.ok) {
                    setErr(typeof json?.error === "string" ? json.error : `Failed (${res.status})`);
                    setData(null);
                    setDataScopeKey(null);
                    return;
                }
                setData(json as AnalysisPayload);
                setDataScopeKey(scopeKeyFor(channelId, year, quarter));
            } catch {
                if (ac.signal.aborted) return;
                setErr("Network error");
                setData(null);
                setDataScopeKey(null);
            } finally {
                if (!ac.signal.aborted) setLoading(false);
            }
        })();

        return () => ac.abort();
    }, [channelId, year, quarter]);

    const chartData = useMemo(() => {
        const buckets = data?.buckets ?? [];
        const totalBucketViews = buckets.reduce((s, b) => s + b.views, 0);
        const contribTotal = userContribution?.viewsOnVideos ?? 0;

        return buckets.map((b) => ({
            label: b.label,
            views: b.views,
            // Rough estimate: 5-min avg watch time converted to hours
            watchTime: Math.round((b.views * 5) / 60),
            // Actual subscriber gains per bucket (stored by sync; 0 until re-synced)
            subscribers: (b as any).subscribersGained ?? 0,
            uploads: b.uploads,
            contribution:
                contribTotal > 0 && totalBucketViews > 0
                    ? Math.round((b.views / totalBucketViews) * contribTotal)
                    : 0,
        }));
    }, [data?.buckets, userContribution?.viewsOnVideos]);

    // Metric totals
    const viewsTotal = data?.viewsGainedInQuarter ?? null;
    // Estimated watch time in hours (5-min average per view)
    const watchTimeTotal = viewsTotal != null ? Math.round((viewsTotal * 5) / 60) : null;

    const metricTotals: Record<MetricKey, number | null> = {
        views: viewsTotal,
        watchTime: watchTimeTotal,
        subscribers: subscriberCount ?? null,
    };

    // Map metric key to chart data field
    const activeDataKey: "views" | "watchTime" | "subscribers" =
        selectedMetric === "views" ? "views"
        : selectedMetric === "watchTime" ? "watchTime"
        : "subscribers";

    const contentReady = !loading && !err && data && dataScopeKey === scopeKey;
    const showSkeleton = loading && dataScopeKey !== scopeKey;

    const shellClass = embedded
        ? "w-full"
        : "mt-4 w-full rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#12122a]";

    return (
        <div className={shellClass}>
            {/* Header */}
            {embedded ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5 dark:border-white/10">
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            Analytics · {channelLabel}
                        </p>
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{quarterLabel}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="shrink-0 text-xs font-semibold text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
                    >
                        Clear selection
                    </button>
                </div>
            ) : (
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-white/10">
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Quarterly analysis</p>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{channelLabel}</h2>
                        <p className="mt-0.5 text-xs text-slate-500">{quarterLabel}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="text-xs font-semibold text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
                    >
                        Clear selection
                    </button>
                </div>
            )}

            <div className={embedded ? "px-4 pb-5 pt-4 sm:px-5 sm:pb-6" : "p-5 sm:p-6"}>
                {/* Skeleton while loading initial fetch */}
                {showSkeleton && (
                    <div
                        className="space-y-4 motion-safe:animate-yt-skeleton motion-reduce:animate-none"
                        aria-hidden
                    >
                        <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200/80 dark:border-white/10">
                            {[0, 1, 2].map((i) => (
                                <div
                                    key={i}
                                    className={cn(
                                        "flex flex-col gap-2 px-4 py-3",
                                        i < 2 && "border-r border-slate-200/80 dark:border-white/10"
                                    )}
                                >
                                    <div className="h-2.5 w-20 rounded bg-slate-300/70 dark:bg-white/15" />
                                    <div className="h-6 w-14 rounded bg-slate-300/60 dark:bg-white/10" />
                                </div>
                            ))}
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-100/60 pb-3 pt-4 dark:border-white/10 dark:bg-white/[0.05]">
                            <div className="mx-auto h-[240px] max-w-full rounded-lg bg-gradient-to-b from-slate-200/50 to-slate-100/30 dark:from-white/10 dark:to-white/[0.03]" />
                        </div>
                    </div>
                )}

                {!showSkeleton && loading && (
                    <div className="flex flex-col items-center justify-center py-16 text-sm text-slate-500 transition-opacity duration-300">
                        <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
                        Loading channel analytics…
                    </div>
                )}

                {!loading && err && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 motion-safe:animate-yt-section-reveal motion-reduce:animate-none dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                        {err}
                    </div>
                )}

                {contentReady && data && (
                    <div
                        key={scopeKey}
                        className="space-y-4 motion-safe:animate-yt-section-reveal motion-reduce:animate-none"
                    >
                        {/* ── YT Studio–style 3-metric selector tabs ── */}
                        <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200/80 dark:border-white/10">
                            {METRIC_DEFS.map((m, idx) => {
                                const isSelected = m.key === selectedMetric;
                                const total = metricTotals[m.key];
                                return (
                                    <button
                                        key={m.key}
                                        type="button"
                                        onClick={() => setSelectedMetric(m.key)}
                                        className={cn(
                                            "relative flex flex-col items-start px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/40",
                                            idx < 2 && "border-r border-slate-200/80 dark:border-white/10",
                                            isSelected
                                                ? "bg-white dark:bg-[#1a1a2e]"
                                                : "bg-slate-50 dark:bg-[#0d0d1a] hover:bg-slate-100/70 dark:hover:bg-white/[0.04]"
                                        )}
                                        aria-pressed={isSelected}
                                        aria-label={`Show ${m.label}`}
                                    >
                                        {isSelected && (
                                            <span
                                                className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-[#065fd4]"
                                                aria-hidden
                                            />
                                        )}
                                        <span
                                            className={cn(
                                                "text-[11px] font-semibold leading-none",
                                                isSelected
                                                    ? "text-slate-700 dark:text-slate-200"
                                                    : "text-slate-500 dark:text-slate-400"
                                            )}
                                        >
                                            {m.label}
                                        </span>
                                        <span
                                            className={cn(
                                                "mt-2 text-xl font-bold tabular-nums tracking-tight leading-none",
                                                isSelected
                                                    ? "text-slate-900 dark:text-white"
                                                    : "text-slate-500 dark:text-slate-400"
                                            )}
                                        >
                                            {total != null ? formatCompact(total) : "—"}
                                        </span>
                                        {m.key === "watchTime" && total != null && (
                                            <span className="mt-0.5 text-[9px] text-slate-400 dark:text-slate-500">
                                                est.
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* ── Area chart — switches by selected metric ── */}
                        {/* Show empty state when subscriber gain data hasn't been synced yet */}
                        {selectedMetric === "subscribers" && chartData.every((r) => r.subscribers === 0) ? (
                            <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-100 bg-gradient-to-b from-slate-50/80 to-white py-16 text-center dark:border-white/10 dark:from-white/[0.03] dark:to-[#12122a]">
                                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                                    Subscriber growth chart not available yet
                                </p>
                                <p className="mt-1 max-w-xs text-xs text-slate-400 dark:text-slate-500">
                                    Re-run <span className="font-semibold">Admin → Crons → YouTube dashboard sync</span> to populate weekly subscriber data.
                                </p>
                            </div>
                        ) : (
                        <div className="rounded-2xl border border-slate-100 bg-gradient-to-b from-slate-50/80 to-white pb-2 pt-4 dark:border-white/10 dark:from-white/[0.03] dark:to-[#12122a]">
                            <ResponsiveContainer
                                width="100%"
                                height={280}
                                className="[&_.recharts-surface]:outline-none"
                            >
                                <AreaChart
                                    data={chartData}
                                    margin={{ top: 12, right: 12, left: 4, bottom: 52 }}
                                >
                                    <defs>
                                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.4} />
                                            <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
                                        </linearGradient>
                                        <linearGradient id={`${gradientId}-contrib`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid
                                        strokeDasharray="4 4"
                                        stroke="rgba(148,163,184,0.25)"
                                        vertical={false}
                                    />
                                    <XAxis
                                        dataKey="label"
                                        tick={(props: any) => {
                                            const { x, y, payload } = props;
                                            const v = payload?.value ?? payload?.payload;
                                            if (v == null) return <g />;
                                            return (
                                                <g transform={`translate(${x},${y})`}>
                                                    <text
                                                        textAnchor="end"
                                                        fill="#64748b"
                                                        fontSize={9}
                                                        transform="translate(-2,6) rotate(-32)"
                                                    >
                                                        {String(v).replace(/ – /g, "–")}
                                                    </text>
                                                </g>
                                            );
                                        }}
                                        height={48}
                                        interval={0}
                                    />
                                    <YAxis
                                        width={52}
                                        tick={{ fontSize: 10, fill: "#64748b" }}
                                        tickLine={false}
                                        axisLine={{ stroke: "rgba(148,163,184,0.25)" }}
                                        tickFormatter={(v) =>
                                            v >= 1_000_000
                                                ? `${(v / 1_000_000).toFixed(1)}M`
                                                : v >= 1_000
                                                ? `${(v / 1_000).toFixed(0)}k`
                                                : String(v)
                                        }
                                    />
                                    <Tooltip
                                        content={({ active, payload }) => {
                                            if (!active || !payload?.length) return null;
                                            const row = payload[0].payload as (typeof chartData)[0];
                                            const value = row[activeDataKey] as number;
                                            const metricLabel =
                                                METRIC_DEFS.find((m) => m.key === selectedMetric)?.label ??
                                                selectedMetric;
                                            return (
                                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-white/10 dark:bg-[#1a1a30]">
                                                    <p className="font-semibold text-slate-900 dark:text-white">
                                                        {row.label}
                                                    </p>
                                                    <p className="mt-1 tabular-nums text-sky-700 dark:text-sky-300">
                                                        {formatViews(value)}{" "}
                                                        {metricLabel.toLowerCase()}
                                                    </p>
                                                    {selectedMetric === "views" &&
                                                        userContribution != null &&
                                                        row.contribution > 0 && (
                                                            <p className="mt-0.5 tabular-nums text-violet-600 dark:text-violet-300">
                                                                {formatViews(row.contribution)} your contribution
                                                            </p>
                                                        )}
                                                </div>
                                            );
                                        }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey={activeDataKey}
                                        stroke="#0ea5e9"
                                        strokeWidth={2}
                                        fill={`url(#${gradientId})`}
                                        dot={{ r: 3, fill: "#0ea5e9", strokeWidth: 0 }}
                                        activeDot={{ r: 5 }}
                                        isAnimationActive
                                        animationDuration={520}
                                        animationEasing="ease-out"
                                    />
                                    {selectedMetric === "views" &&
                                        userContribution != null &&
                                        userContribution.viewsOnVideos > 0 && (
                                            <Area
                                                type="monotone"
                                                dataKey="contribution"
                                                stroke="#8b5cf6"
                                                strokeWidth={2}
                                                fill={`url(#${gradientId}-contrib)`}
                                                dot={{ r: 3, fill: "#8b5cf6", strokeWidth: 0 }}
                                                activeDot={{ r: 5 }}
                                                isAnimationActive
                                                animationDuration={520}
                                                animationEasing="ease-out"
                                            />
                                        )}
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                        )}

                        {/* ── Footer row ── */}
                        <div className="flex items-center justify-end gap-4">
                            {userContribution != null && userContribution.viewsOnVideos > 0 && (
                                <div className="flex items-center gap-3 text-[11px]">
                                    <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400">
                                        <span className="inline-block h-2 w-4 rounded-full bg-sky-400" />
                                        Channel views
                                    </span>
                                    <span className="flex items-center gap-1 text-violet-600 dark:text-violet-400">
                                        <span className="inline-block h-2 w-4 rounded-full bg-violet-400" />
                                        Your contribution
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
