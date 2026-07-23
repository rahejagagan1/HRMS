"use client";

// Employee-side panel: per-channel quarterly view targets vs current views.
//
// Compact tabbed layout — instead of stacking all channels vertically (which
// got tall fast with 4+ channels), the active channel is shown in a single
// detail block and the others are reachable via a horizontal tab strip.
// The first tab is "All" — it sums views + targets across every channel
// for an at-a-glance organisation-wide number.
//
// Period toggle (top right) flips every number + the active progress bar
// between the current quarter (Q1-Q4) and the full calendar year.

import { useState } from "react";
import useSWR from "swr";
import { ArrowUp, ArrowDown } from "lucide-react";
import { fetcher } from "@/lib/swr";

type ChannelRow = {
  channelId: string;
  channelName: string;
  quarterViews: number;
  quarterTarget: number | null;
  yearViews: number;
  yearTarget: number | null;
};

type AllTotals = {
  quarterViews: number;
  quarterTarget: number | null;
  yearViews: number;
  yearTarget: number | null;
};

type Payload = {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  channels: ChannelRow[];
  // Company-wide totals across EVERY channel (not just the ones this viewer
  // can see individually). Drives the "All channels" tab.
  allTotals?: AllTotals;
};

type Mode = "quarter" | "year";

const QUARTER_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: "Jan-Mar",
  2: "Apr-Jun",
  3: "Jul-Sep",
  4: "Oct-Dec",
};

// Channel-initial chip palette — keep the active tab readable on a white
// background. Same hash → same colour across reloads.
const CIRCLE_PALETTE: Array<{ bg: string; text: string }> = [
  { bg: "bg-blue-100",    text: "text-blue-700"    },
  { bg: "bg-violet-100",  text: "text-violet-700"  },
  { bg: "bg-rose-100",    text: "text-rose-700"    },
  { bg: "bg-amber-100",   text: "text-amber-700"   },
  { bg: "bg-emerald-100", text: "text-emerald-700" },
  { bg: "bg-cyan-100",    text: "text-cyan-700"    },
];

function hashToPalette(name: string): { bg: string; text: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CIRCLE_PALETTE[h % CIRCLE_PALETTE.length];
}

function initials(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "··";
  return trimmed.replace(/\s+/g, "").slice(0, 2).toUpperCase();
}

function formatLocale(n: number): string {
  return Number(n || 0).toLocaleString("en-IN");
}

function formatAbbrev(n: number): string {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(v);
}

function rawPct(views: number, target: number | null): number {
  if (!target || target <= 0) return 0;
  const pct = (views / target) * 100;
  return Number.isFinite(pct) ? pct : 0;
}

function clampPct(views: number, target: number | null): number {
  const pct = rawPct(views, target);
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

// Synthesises an "All channels" aggregate row from the per-channel data.
// Views / targets are summed straight. Percent is computed from the sums,
// not averaged, so a channel that's hit 200% and one that's at 0% net to
// 100% only if their target weights match.
function aggregateAll(rows: ChannelRow[]): ChannelRow {
  let qv = 0, qt = 0, yv = 0, yt = 0;
  let qtHasAny = false, ytHasAny = false;
  for (const r of rows) {
    qv += r.quarterViews;
    yv += r.yearViews;
    if (r.quarterTarget && r.quarterTarget > 0) { qt += r.quarterTarget; qtHasAny = true; }
    if (r.yearTarget    && r.yearTarget    > 0) { yt += r.yearTarget;    ytHasAny = true; }
  }
  return {
    channelId: "__ALL__",
    channelName: "All channels",
    quarterViews:  qv,
    quarterTarget: qtHasAny ? qt : null,
    yearViews:     yv,
    yearTarget:    ytHasAny ? yt : null,
  };
}

export default function ChannelViewsTargetsPanel() {
  const { data, error, isLoading } = useSWR<Payload>(
    "/api/me/view-targets",
    fetcher,
    { refreshInterval: 300_000 },
  );

  const [mode,      setMode]      = useState<Mode>("quarter");
  const [activeTab, setActiveTab] = useState<string>("__ALL__");

  const year     = data?.year ?? new Date().getFullYear();
  const quarter  = (data?.quarter ?? 1) as 1 | 2 | 3 | 4;
  const subtitle = `Q${quarter} ${year} · ${QUARTER_LABEL[quarter]}`;

  const channels = data?.channels ?? [];
  // "All channels" aggregate: prefer the server's company-wide totals (every
  // channel, even ones this viewer can't see individually); fall back to
  // summing the visible channels if the API didn't send it.
  const allRow: ChannelRow = data?.allTotals
    ? {
        channelId: "__ALL__",
        channelName: "All channels",
        quarterViews:  data.allTotals.quarterViews,
        quarterTarget: data.allTotals.quarterTarget,
        yearViews:     data.allTotals.yearViews,
        yearTarget:    data.allTotals.yearTarget,
      }
    : aggregateAll(channels);
  // Tabs = "All" + every configured channel. Aggregate stays on top.
  const tabs: ChannelRow[] = channels.length > 0
    ? [allRow, ...channels]
    : [];
  const active = tabs.find((c) => c.channelId === activeTab) ?? tabs[0];

  // Capsule-based visibility (api/me/view-targets) returns an empty
  // channel list for employees not assigned to any channel. Hide the
  // whole panel for them instead of showing an empty "No channels
  // configured yet." card. HR-admin / CEO / Developer always get
  // channels back, so they still see the panel.
  if (data && !error && channels.length === 0) return null;

  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 overflow-hidden">
      {/* ── Header strip ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-slate-900">Quarterly Targets</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        <div
          role="tablist"
          aria-label="Targets period"
          className="inline-flex items-center rounded-full bg-slate-100 p-0.5 text-[11px] font-medium shrink-0"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "quarter"}
            onClick={() => setMode("quarter")}
            className={
              "px-2.5 py-1 rounded-full transition-all " +
              (mode === "quarter"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700")
            }
          >
            Quarter
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "year"}
            onClick={() => setMode("year")}
            className={
              "px-2.5 py-1 rounded-full transition-all " +
              (mode === "year"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700")
            }
          >
            Year
          </button>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────── */}
      {isLoading && !data ? (
        <Skeleton />
      ) : error ? (
        <div className="px-5 py-8 text-center text-[12.5px] text-rose-600">
          Could not load targets right now.
        </div>
      ) : !data || tabs.length === 0 ? (
        <div className="px-5 py-8 text-center text-[12.5px] text-slate-500">
          No channels configured yet.
        </div>
      ) : (
        <>
          {/* ── Channel tabs (horizontal scroll on mobile) ── */}
          <div
            role="tablist"
            aria-label="Channels"
            className="no-scrollbar flex items-center gap-1 px-2 pt-2 border-b border-slate-100 overflow-x-auto"
          >
            {tabs.map((t) => {
              const isActive = active?.channelId === t.channelId;
              const palette  = t.channelId === "__ALL__"
                ? { bg: "bg-slate-100", text: "text-slate-700" }
                : hashToPalette(t.channelName);
              return (
                <button
                  key={t.channelId}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(t.channelId)}
                  className={
                    "relative inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium whitespace-nowrap transition-colors " +
                    (isActive
                      ? "text-slate-900"
                      : "text-slate-500 hover:text-slate-800")
                  }
                >
                  <span
                    className={
                      "inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold " +
                      palette.bg + " " + palette.text
                    }
                    aria-hidden
                  >
                    {t.channelId === "__ALL__" ? "★" : initials(t.channelName)}
                  </span>
                  <span className="truncate max-w-[120px]">{t.channelName}</span>
                  {isActive ? (
                    <span
                      aria-hidden
                      className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-[#3b82f6]"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* ── Active channel detail ── */}
          {active ? <Detail row={active} mode={mode} /> : null}
        </>
      )}
    </div>
  );
}

function Detail({ row, mode }: { row: ChannelRow; mode: Mode }) {
  const views    = mode === "quarter" ? row.quarterViews  : row.yearViews;
  const target   = mode === "quarter" ? row.quarterTarget : row.yearTarget;
  const hasTarget = !!target && target > 0;
  const pctClamped = clampPct(views, target);
  const pctRaw     = rawPct(views, target);
  const reached    = hasTarget && pctRaw >= 100;
  const remaining  = hasTarget ? Math.max(0, (target as number) - views) : 0;

  return (
    <div className="px-5 py-5">
      {/* Headline number + status pill */}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div
            className="text-[34px] sm:text-[40px] font-bold text-slate-900 leading-none tabular-nums"
            title={formatLocale(views)}
          >
            {formatAbbrev(views)}
          </div>
          <div className="mt-1 text-[11.5px] uppercase tracking-wider text-slate-500 font-semibold">
            {mode === "quarter" ? "Views this quarter" : "Views this year"}
          </div>
        </div>
        {hasTarget ? (
          <div
            className={
              "shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold " +
              (reached
                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                : pctRaw >= 70
                  ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
                  : "bg-amber-50 text-amber-700 ring-1 ring-amber-200")
            }
          >
            {reached
              ? <ArrowUp size={12} strokeWidth={2.5} />
              : <ArrowDown size={12} strokeWidth={2.5} className="opacity-60" />}
            {Math.round(pctRaw)}%
          </div>
        ) : (
          <div className="shrink-0 text-[11px] italic text-slate-400">No target set</div>
        )}
      </div>

      {/* Progress bar + target footer */}
      {hasTarget ? (
        <>
          <div
            className="mt-3 h-2.5 rounded-full bg-slate-100 overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pctClamped)}
            aria-label={`${row.channelName} progress`}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pctClamped}%`,
                background: reached
                  ? "linear-gradient(90deg, #10b981 0%, #34d399 100%)"
                  : "linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)",
              }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11.5px]">
            <span className="text-slate-500">
              Target <span className="font-semibold text-slate-700">{formatAbbrev(target as number)}</span>
            </span>
            <span className="text-slate-500">
              {reached
                ? <span className="text-emerald-700 font-semibold">Goal reached!</span>
                : <>
                    <span className="font-semibold text-slate-700">{formatAbbrev(remaining)}</span>
                    {" to go"}
                  </>
              }
            </span>
          </div>
        </>
      ) : (
        <div className="mt-3 h-2.5 rounded-full bg-slate-100" aria-hidden />
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="px-5 py-5 animate-pulse">
      <div className="flex items-center gap-1 mb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-7 w-20 rounded-md bg-slate-100" />
        ))}
      </div>
      <div className="h-10 w-32 rounded bg-slate-100" />
      <div className="mt-3 h-2.5 w-full rounded-full bg-slate-100" />
      <div className="mt-2 h-3 w-40 rounded bg-slate-100" />
    </div>
  );
}
