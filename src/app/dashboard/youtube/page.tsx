"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
    userCanAccessYoutubeDeveloperAnalytics,
    type YoutubeDashUserLike,
} from "@/lib/youtube-dashboard-access";
import ChannelQuarterAnalysisSection from "./channel-quarter-modal";
import { useUrlTab } from "@/lib/hooks/useUrlTab";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

type ChannelRow = {
    name: string;
    channelId: string;
    viewsGainedInQuarter: number | null;
    viewsPreviousQuarter?: number | null;
    quarterOverQuarterDelta?: number | null;
    subscriberCount?: number | null;
    error: string | null;
    /** Logged-in user: cases in this quarter on this channel (writer/editor) + sum of stored video views. */
    me?: { videoCount: number; viewsOnVideos: number };
};

type QuarterlyPayload = {
    year: number;
    quarter: number;
    label: string;
    startStr: string;
    endStr: string;
    configured: boolean;
    dataSource?: "database";
    lastQuarterViewsSyncedAt?: string | null;
    note?: string;
    channels: ChannelRow[];
    totalViewsGainedInQuarter?: number | null;
    analyticsStartStr?: string;
    analyticsEndStr?: string;
    analyticsNote?: string;
    message?: string;
};

function formatViews(n: number | null | undefined): string {
    if (n == null) return "—";
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** YouTube Studio–style compact metric (e.g. 3.4K) */
function formatCompactViews(n: number | null | undefined): string {
    if (n == null) return "—";
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
    if (abs >= 1000) return `${(n / 1000).toFixed(abs >= 10000 ? 0 : 1)}K`;
    return String(Math.round(n));
}

function studioComparisonLine(ch: ChannelRow): string {
    const cur = ch.viewsGainedInQuarter;
    if (cur == null) return "No quarter data yet.";
    if (ch.quarterOverQuarterDelta == null) return "No prior quarter to compare.";
    const d = ch.quarterOverQuarterDelta;
    if (d === 0) return "Flat vs last quarter.";
    const prev = cur - d;
    if (prev <= 0) return d > 0 ? "New this quarter" : "Flat vs last quarter.";
    const pct = Math.round((Math.abs(d) / prev) * 100);
    if (d > 0) return `${pct}% more than last quarter`;
    return `${pct}% less than last quarter`;
}

const BAR_PALETTE = ["#7c3aed", "#8b5cf6", "#a78bfa", "#c4b5fd", "#a855f7", "#9333ea", "#6d28d9"];

function useChartTheme() {
    const [isDark, setIsDark] = useState(false);
    useEffect(() => {
        const el = document.documentElement;
        const sync = () => setIsDark(el.classList.contains("dark"));
        sync();
        const obs = new MutationObserver(sync);
        obs.observe(el, { attributes: true, attributeFilter: ["class"] });
        return () => obs.disconnect();
    }, []);
    return {
        tick: isDark ? "#94a3b8" : "#64748b",
        grid: isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)",
        tooltipBg: isDark ? "#12122a" : "#ffffff",
        tooltipBorder: isDark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.1)",
        tooltipLabel: isDark ? "#f1f5f9" : "#0f172a",
        mutedBar: isDark ? "#475569" : "#94a3b8",
    };
}

function truncateLabel(s: string, max = 22): string {
    if (s.length <= max) return s;
    return `${s.slice(0, max - 1)}…`;
}

/** YouTube Studio–style horizontal channel tab bar (matches Overview / Content / Audience / Trends look). */
function StudioStyleChannelStrip({
    channels,
    periodLabel,
    quarter,
    onSelectChannel,
    selectedChannelId,
    children,
    headerRight,
}: {
    channels: ChannelRow[];
    periodLabel: string;
    quarter: number;
    onSelectChannel?: (ch: ChannelRow) => void;
    selectedChannelId?: string | null;
    children?: ReactNode;
    headerRight?: ReactNode;
}) {
    return (
        <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0f0f0f] shadow-sm overflow-hidden">
            {/* Top bar: period label + year/quarter selectors */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/60 dark:border-white/[0.08] bg-white dark:bg-[#0f0f0f] px-5 py-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Q{quarter} · {periodLabel}
                </span>
                {headerRight && <div className="flex items-center gap-2">{headerRight}</div>}
            </div>

            {/* YT Studio–style channel name tab bar */}
            <div className="flex overflow-x-auto border-b border-slate-200/60 dark:border-white/[0.08] bg-white dark:bg-[#0f0f0f] px-2">
                {channels.map((ch) => {
                    const selected = ch.channelId === selectedChannelId;
                    const hasContribution = ch.me && ch.me.viewsOnVideos > 0;
                    return (
                        <button
                            key={ch.channelId}
                            type="button"
                            onClick={() => onSelectChannel?.(ch)}
                            className={cn(
                                "relative shrink-0 px-4 py-3.5 text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/30",
                                selected
                                    ? "text-slate-900 dark:text-white"
                                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                            )}
                            aria-pressed={selected}
                            aria-label={`${selected ? "Selected" : "Select"} ${ch.name}`}
                        >
                            {ch.name}
                            {hasContribution && (
                                <span
                                    className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-violet-500 align-middle"
                                    title="You contributed to this channel"
                                />
                            )}
                            {selected && (
                                <span
                                    className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-slate-900 dark:bg-white"
                                    aria-hidden
                                />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Analytics content for the selected channel */}
            {children != null && (
                <div className="bg-white dark:bg-[#0f0f0f]">{children}</div>
            )}
        </div>
    );
}

export default function YoutubeDashboardPage() {
    const { data: session } = useSession();
    const sessionUser = session?.user as YoutubeDashUserLike | undefined;
    const showDeveloperTab = userCanAccessYoutubeDeveloperAnalytics(sessionUser);
    const [viewMode, setViewMode] = useUrlTab<"production" | "developer">("view", "production", ["production", "developer"] as const);

    const chartTheme = useChartTheme();
    const now = useMemo(() => new Date(), []);
    const defaultYear = now.getUTCFullYear();
    const defaultQuarter = Math.floor(now.getUTCMonth() / 3) + 1;

    const [year, setYear] = useState(defaultYear);
    const [quarter, setQuarter] = useState(defaultQuarter);
    const [data, setData] = useState<QuarterlyPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [analysisChannel, setAnalysisChannel] = useState<ChannelRow | null>(null);

    const yearOptions = useMemo(() => {
        const ys: number[] = [];
        for (let y = defaultYear; y >= defaultYear - 5; y--) ys.push(y);
        return ys;
    }, [defaultYear]);

    const load = useCallback(async () => {
        setLoading(true);
        setFetchError(null);
        try {
            const res = await fetch(
                `/api/dashboard/youtube/quarterly?year=${year}&quarter=${quarter}`,
                { credentials: "include" }
            );
            const json = await res.json().catch(() => null);
            if (!res.ok) {
                setFetchError(typeof json?.error === "string" ? json.error : `Request failed (${res.status})`);
                setData(null);
                return;
            }
            setData(json as QuarterlyPayload);
        } catch {
            setFetchError("Network error");
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [year, quarter]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        setAnalysisChannel(null);
    }, [year, quarter]);

    // Auto-open the quarterly chart: prefer a channel the user contributed to, else open the first
    useEffect(() => {
        if (!data?.configured || analysisChannel) return;
        const contributed = data.channels.filter((ch) => ch.me && ch.me.viewsOnVideos > 0);
        if (contributed.length >= 1) {
            setAnalysisChannel(contributed[0]);
        } else if (data.channels.length > 0) {
            setAnalysisChannel(data.channels[0]);
        }
    }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

    const periodNote =
        data && data.configured
            ? `${data.startStr} → ${data.endStr} (UTC).`
            : null;

    const lastQuarterViewsLabel = data?.lastQuarterViewsSyncedAt
        ? new Date(data.lastQuarterViewsSyncedAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
        })
        : "Never — run Admin → Crons → YouTube dashboard quarter sync";

    const barChartData = useMemo(() => {
        if (!data?.configured || !data.channels.length) return [];
        return [...data.channels]
            .map((c) => ({
                name: truncateLabel(c.name),
                fullName: c.name,
                gainedInQuarter: c.error ? 0 : c.viewsGainedInQuarter ?? 0,
                gainedOk: !c.error && c.viewsGainedInQuarter != null,
            }))
            .sort((a, b) => b.gainedInQuarter - a.gainedInQuarter);
    }, [data]);

    const pieData = useMemo(() => {
        if (!data?.configured) return [];
        return data.channels
            .filter((c) => !c.error && c.viewsGainedInQuarter != null && c.viewsGainedInQuarter > 0)
            .map((c, i) => ({
                name: truncateLabel(c.name, 18),
                fullName: c.name,
                value: c.viewsGainedInQuarter as number,
                fill: BAR_PALETTE[i % BAR_PALETTE.length],
            }));
    }, [data]);

    const pieSum = useMemo(() => pieData.reduce((s, p) => s + p.value, 0), [pieData]);

    const barChartHeight = Math.min(420, Math.max(200, barChartData.length * 44));

    return (
        <div className="min-h-[calc(100vh-4rem)] w-full">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-8 pb-8 md:pt-10 md:pb-10 space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                        YouTube dashboard
                    </h1>
                    {showDeveloperTab && (
                        <div className="inline-flex rounded-lg border border-slate-300 dark:border-white/10 bg-slate-200/70 dark:bg-[#12122a]/90 p-0.5">
                            <button
                                type="button"
                                onClick={() => setViewMode("production")}
                                className={cn(
                                    "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                                    viewMode === "production"
                                        ? "bg-violet-600 text-white shadow-sm"
                                        : "text-slate-600 hover:text-slate-800 hover:bg-slate-300/60 dark:text-slate-400 dark:hover:bg-white/5"
                                )}
                            >
                                Production
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode("developer")}
                                className={cn(
                                    "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                                    viewMode === "developer"
                                        ? "bg-violet-600 text-white shadow-sm"
                                        : "text-slate-600 hover:text-slate-800 hover:bg-slate-300/60 dark:text-slate-400 dark:hover:bg-white/5"
                                )}
                            >
                                Developer analytics
                            </button>
                        </div>
                    )}
                </div>

                <div className="space-y-8">
                {fetchError && (
                    <div className="rounded-2xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 px-5 py-4 text-sm text-rose-800 dark:text-rose-200">
                        {fetchError}
                    </div>
                )}

                {data && !data.configured && (
                    <div className="rounded-2xl border border-amber-200/80 dark:border-amber-500/25 bg-amber-50/90 dark:bg-amber-500/10 px-6 py-5">
                        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Channels not configured</h2>
                        <p className="mt-2 text-sm text-amber-800/90 dark:text-amber-100/80 max-w-xl">
                            {data.message ||
                                "Add the YOUTUBE_CHANNELS JSON to your environment (same setup as Admin → YT Views) to see quarterly totals here."}
                        </p>
                    </div>
                )}

                {data?.configured && (
                    <>
                        {(viewMode === "production" || !showDeveloperTab) && (
                            <div className="space-y-4">
                                <StudioStyleChannelStrip
                                    channels={data.channels}
                                    periodLabel={data.label}
                                    quarter={quarter}
                                    selectedChannelId={analysisChannel?.channelId ?? null}
                                    onSelectChannel={(ch) => setAnalysisChannel(ch)}
                                    headerRight={
                                        <div className="flex items-center gap-2">
                                            <select
                                                value={year}
                                                onChange={(e) => {
                                                    const y = Number(e.target.value);
                                                    setYear(y);
                                                    if (y === defaultYear) {
                                                        setQuarter(defaultQuarter);
                                                    } else {
                                                        setQuarter(1);
                                                    }
                                                }}
                                                className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1a1a30] px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                                            >
                                                {yearOptions.map((y) => (
                                                    <option key={y} value={y}>{y}</option>
                                                ))}
                                            </select>
                                            <select
                                                value={quarter}
                                                onChange={(e) => setQuarter(Number(e.target.value))}
                                                className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1a1a30] px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                                            >
                                                {[1, 2, 3, 4]
                                                    .filter((q) => year < defaultYear || q <= defaultQuarter)
                                                    .map((q) => (
                                                        <option key={q} value={q}>Q{q}</option>
                                                    ))}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={() => load()}
                                                disabled={loading}
                                                className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
                                            >
                                                {loading ? "…" : "Refresh"}
                                            </button>
                                        </div>
                                    }
                                >
                                    {analysisChannel ? (
                                        <ChannelQuarterAnalysisSection
                                            embedded
                                            channelId={analysisChannel.channelId}
                                            channelLabel={analysisChannel.name}
                                            year={year}
                                            quarter={quarter}
                                            quarterLabel={data.label}
                                            userContribution={analysisChannel.me ?? null}
                                            subscriberCount={analysisChannel.subscriberCount ?? null}
                                            onDismiss={() => setAnalysisChannel(null)}
                                        />
                                    ) : null}
                                </StudioStyleChannelStrip>
                                {data.analyticsNote && (
                                    <p className="rounded-xl border border-sky-200/80 bg-sky-50/90 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-100/90">
                                        {data.analyticsNote}
                                    </p>
                                )}
                                {data.note && (
                                    <p className="rounded-xl border border-slate-200/80 bg-slate-100/80 px-4 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                                        {data.note}
                                    </p>
                                )}
                                
                            </div>
                        )}

                        {showDeveloperTab && viewMode === "developer" && (
                            <>
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            <div className="rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white dark:bg-[#12122a] p-5 shadow-sm">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Period</p>
                                <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{data.label}</p>
                                <p className="mt-1 text-xs text-slate-500 leading-relaxed">{periodNote}</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white dark:bg-[#12122a] p-5 shadow-sm">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Channels</p>
                                <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{data.channels.length}</p>
                                <p className="mt-1 text-xs text-slate-500">From YOUTUBE_CHANNELS</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white dark:bg-[#12122a] p-5 shadow-sm">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Last Analytics sync (cron)</p>
                                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                                    <span className="font-semibold text-slate-800 dark:text-slate-200">Quarter metrics:</span>{" "}
                                    <span className="text-slate-900 dark:text-white">{lastQuarterViewsLabel}</span>
                                </p>
                                <p className="mt-2 text-xs text-slate-500">Written by Admin → Crons</p>
                            </div>
                            <div className="rounded-2xl border border-emerald-200/80 dark:border-emerald-500/20 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-500/10 dark:to-[#12122a] p-5 shadow-sm xl:col-span-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                                    Quarter views 
                                </p>
                                <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-900 dark:text-emerald-100">
                                    {formatViews(data.totalViewsGainedInQuarter ?? undefined)}
                                </p>
                                <p className="mt-1 text-xs text-emerald-800/70 dark:text-emerald-200/70">
                                    Stored Analytics range {data.analyticsStartStr ?? "—"} → {data.analyticsEndStr ?? "—"} (UTC; range is from last sync)
                                </p>
                            </div>
                        </div>

                        {data.note && (
                            <p className="text-sm text-slate-600 dark:text-slate-400 bg-slate-100/80 dark:bg-white/5 rounded-xl px-4 py-3 border border-slate-200/80 dark:border-white/10">
                                {data.note}
                            </p>
                        )}
                        {data.analyticsNote && (
                            <p className="text-sm text-sky-900 dark:text-sky-100/90 bg-sky-50/90 dark:bg-sky-500/10 rounded-xl px-4 py-3 border border-sky-200/80 dark:border-sky-500/25">
                                {data.analyticsNote}
                            </p>
                        )}

                        {/* Charts */}
                        {barChartData.length > 0 && (
                            <div className="grid gap-6 lg:grid-cols-2">
                                <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#12122a] p-5 shadow-sm">
                                    <div className="mb-1 flex items-start justify-between gap-2">
                                        <div>
                                            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                                                Quarter views by channel
                                            </h2>
                                            <p className="mt-0.5 text-xs text-slate-500">
                                                YouTube Analytics for {data.label} (stored on last cron sync).
                                            </p>
                                        </div>
                                    </div>
                                    <ResponsiveContainer width="100%" height={barChartHeight} className="mt-2 [&_.recharts-surface]:outline-none">
                                        <BarChart
                                            layout="vertical"
                                            data={barChartData}
                                            margin={{ top: 8, right: 16, left: 4, bottom: 8 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} horizontal={false} />
                                            <XAxis
                                                type="number"
                                                tick={{ fill: chartTheme.tick, fontSize: 11 }}
                                                tickLine={false}
                                                axisLine={{ stroke: chartTheme.grid }}
                                                tickFormatter={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
                                            />
                                            <YAxis
                                                type="category"
                                                dataKey="name"
                                                width={108}
                                                tick={{ fill: chartTheme.tick, fontSize: 11 }}
                                                tickLine={false}
                                                axisLine={{ stroke: chartTheme.grid }}
                                            />
                                            <Tooltip
                                                cursor={{ fill: "rgba(5, 150, 105, 0.06)" }}
                                                content={({ active, payload }) => {
                                                    if (!active || !payload?.length) return null;
                                                    const row = payload[0].payload as (typeof barChartData)[0];
                                                    return (
                                                        <div
                                                            className="rounded-lg border px-3 py-2 text-xs shadow-lg"
                                                            style={{
                                                                backgroundColor: chartTheme.tooltipBg,
                                                                borderColor: chartTheme.tooltipBorder,
                                                                color: chartTheme.tooltipLabel,
                                                            }}
                                                        >
                                                            <p className="font-semibold">{row.fullName}</p>
                                                            <p className="mt-1 tabular-nums opacity-90">
                                                                Quarter views:{" "}
                                                                {row.gainedOk ? formatViews(row.gainedInQuarter) : "—"}
                                                            </p>
                                                        </div>
                                                    );
                                                }}
                                            />
                                            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                                            <Bar
                                                dataKey="gainedInQuarter"
                                                name="Quarter views (Analytics)"
                                                fill="#059669"
                                                radius={[0, 4, 4, 0]}
                                                maxBarSize={22}
                                            >
                                                {barChartData.map((entry, i) => (
                                                    <Cell
                                                        key={`gain-${entry.fullName}-${i}`}
                                                        fill={entry.gainedOk ? "#059669" : chartTheme.mutedBar}
                                                        fillOpacity={entry.gainedOk ? 0.85 : 0.35}
                                                    />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#12122a] p-5 shadow-sm">
                                    <div className="mb-1">
                                        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Share of quarter views</h2>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            YouTube Analytics channel views in {data.label} (where data loaded)
                                        </p>
                                    </div>
                                    {pieData.length === 0 ? (
                                        <div className="flex h-[240px] items-center justify-center text-sm text-slate-500">
                                            No Analytics quarter views to chart — check OAuth tokens in YOUTUBE_CHANNELS.
                                        </div>
                                    ) : (
                                        <ResponsiveContainer width="100%" height={260} className="mt-2 [&_.recharts-surface]:outline-none">
                                            <PieChart>
                                                <Pie
                                                    data={pieData}
                                                    dataKey="value"
                                                    nameKey="name"
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={58}
                                                    outerRadius={88}
                                                    paddingAngle={2}
                                                >
                                                    {pieData.map((entry, i) => (
                                                        <Cell key={`pie-${entry.fullName}-${i}`} fill={entry.fill} stroke="transparent" />
                                                    ))}
                                                </Pie>
                                                <Tooltip
                                                    content={({ active, payload }) => {
                                                        if (!active || !payload?.length) return null;
                                                        const p = payload[0].payload as (typeof pieData)[0];
                                                        const pct =
                                                            pieSum > 0
                                                                ? ((p.value / pieSum) * 100).toFixed(1)
                                                                : null;
                                                        return (
                                                            <div
                                                                className="rounded-lg border px-3 py-2 text-xs shadow-lg"
                                                                style={{
                                                                    backgroundColor: chartTheme.tooltipBg,
                                                                    borderColor: chartTheme.tooltipBorder,
                                                                    color: chartTheme.tooltipLabel,
                                                                }}
                                                            >
                                                                <p className="font-semibold">{p.fullName}</p>
                                                                <p className="mt-1 tabular-nums">{formatViews(p.value)} quarter views</p>
                                                                {pct != null && (
                                                                    <p className="mt-0.5 opacity-70">{pct}% of total</p>
                                                                )}
                                                            </div>
                                                        );
                                                    }}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#12122a] shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between gap-4 border-b border-slate-100 dark:border-white/5 px-5 py-4">
                                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Quarterly metrics by channel</h2>
                                <span className="text-[10px] uppercase tracking-wider text-slate-400">YouTube Analytics (DB)</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-100 dark:border-white/5 text-[10px] uppercase tracking-wider text-slate-500">
                                            <th className="px-5 py-3 font-semibold">Channel</th>
                                            <th className="px-5 py-3 font-semibold text-right">Quarter views (YT Analytics)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                                        {loading ? (
                                            <tr>
                                                <td colSpan={2} className="px-5 py-12 text-center text-slate-500">
                                                    Loading…
                                                </td>
                                            </tr>
                                        ) : (
                                            data.channels.map((row) => (
                                                <tr
                                                    key={row.channelId}
                                                    className="text-slate-800 dark:text-slate-200 hover:bg-slate-50/80 dark:hover:bg-white/[0.02]"
                                                >
                                                    <td className="px-5 py-4">
                                                        <div className="font-medium text-slate-900 dark:text-white">{row.name}</div>
                                                        <div className="text-[11px] text-slate-400 font-mono truncate max-w-[280px]">
                                                            {row.channelId}
                                                        </div>
                                                    </td>
                                                    <td className="px-5 py-4 text-right tabular-nums text-base font-semibold text-emerald-700 dark:text-emerald-300">
                                                        {row.viewsGainedInQuarter == null
                                                            ? "—"
                                                            : formatViews(row.viewsGainedInQuarter)}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            {!loading && !data.lastQuarterViewsSyncedAt && (
                                <div className="border-t border-slate-100 dark:border-white/5 px-5 py-3 text-xs text-amber-700 dark:text-amber-200/90">
                                    No quarter metrics yet — open <strong>Admin → Crons</strong> to run manually or enable auto-sync, or POST{" "}
                                    <code className="text-[10px]">/api/cron/youtube-dashboard-sync</code> with{" "}
                                    <code className="text-[10px]">CRON_SECRET</code>.
                                </div>
                            )}
                        </div>
                            </>
                        )}

                    </>
                )}

                {loading && !data && (
                    <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#12122a] px-5 py-16 text-center text-slate-500 text-sm">
                        Loading dashboard…
                    </div>
                )}
                </div>
            </div>
        </div>
    );
}
