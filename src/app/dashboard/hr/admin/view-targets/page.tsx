"use client";

// HR admin → YouTube View Targets.
//
// Sets per-channel quarterly + yearly view targets (calendar quarters:
// Q1 = Jan–Mar). The page lists every channel known to the cron-refreshed
// YoutubeDashboardQuarterMetrics view, alongside the current live views so
// HR has the context of where the channel actually stands when picking a
// target. Each cell saves independently via PUT so a typo on Q3 doesn't
// blow away the year target someone else just set.
//
// HR-admin tier only — mirrors the master-sheet page's gate.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import useSWR, { mutate } from "swr";
import { AlertCircle, ArrowLeft, Target, Check } from "lucide-react";
import { isHRAdmin } from "@/lib/access";
import { fetcher } from "@/lib/swr";
import SelectField from "@/components/ui/SelectField";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

// One row per channel as returned by /api/hr/admin/view-targets?year=YYYY.
// `targets` is keyed by quarter (0 = year-level, 1..4 = calendar quarters).
type ChannelTargetRow = {
  channelId:   string;
  channelName: string;
  year:        number;
  targets:     Partial<Record<0 | 1 | 2 | 3 | 4, number | null>>;
};

// /api/me/view-targets returns the same channel list with live current
// views attached — used as the "currently …" line under each input.
type CurrentViewsRow = {
  channelId:   string;
  channelName: string;
  year:        number;
  // Current cumulative views in each bucket (0 = full year so far).
  currentViews: Partial<Record<0 | 1 | 2 | 3 | 4, number | null>>;
};

type Quarter = 0 | 1 | 2 | 3 | 4;

const QUARTERS: Array<{ key: Quarter; label: string; sub: string }> = [
  { key: 0, label: "YEAR TARGET", sub: "Full year" },
  { key: 1, label: "Q1",          sub: "Jan – Mar" },
  { key: 2, label: "Q2",          sub: "Apr – Jun" },
  { key: 3, label: "Q3",          sub: "Jul – Sep" },
  { key: 4, label: "Q4",          sub: "Oct – Dec" },
];

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function ViewTargetsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const user = session?.user as any;

  const now = new Date();
  const thisYear = now.getFullYear();

  // current-1 .. current+2 — gives HR room to set next year's targets in
  // Q4, and to back-fill last year's if the cron filled a missing row.
  const yearOptions = useMemo(
    () =>
      [thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => ({
        value: String(y),
        label: String(y),
      })),
    [thisYear],
  );

  const [selectedYear, setSelectedYear] = useState<number>(thisYear);

  // SWR keys are kept as constants so child cells can mutate the exact
  // same key after a successful PUT — string drift here = stale UI.
  const targetsKey = `/api/hr/admin/view-targets?year=${selectedYear}`;
  const currentKey = `/api/me/view-targets`;

  const { data: targetsData, isLoading: targetsLoading } = useSWR<{
    rows: ChannelTargetRow[];
  }>(targetsKey, fetcher);
  const { data: currentData } = useSWR<{ rows: CurrentViewsRow[] }>(
    currentKey,
    fetcher,
  );

  // Index current views by channelId for O(1) lookup inside the rows.
  const currentByChannel = useMemo(() => {
    const m = new Map<string, CurrentViewsRow>();
    for (const r of currentData?.rows ?? []) m.set(r.channelId, r);
    return m;
  }, [currentData]);

  /* ---------------------------------------------------------------------- */
  /*  Auth gate — friendly block, identical pattern to master-sheet page    */
  /* ---------------------------------------------------------------------- */
  if (status === "loading") {
    return <div className="p-6 text-[13px] text-slate-500">Loading…</div>;
  }
  if (!user || !isHRAdmin(user)) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-10 h-10 text-slate-400 mx-auto mb-2" />
          <p className="text-[14px] font-semibold text-slate-600 dark:text-slate-300">
            HR-admin access required
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="mt-3 text-[12px] text-[#008CFF] hover:underline"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  const rows: ChannelTargetRow[] = targetsData?.rows ?? [];

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">
      {/* Sticky header — matches the rest of the HR admin pages */}
      <div className="sticky top-[68px] z-20 bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/dashboard/hr/admin"
              className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-700"
              aria-label="Back to HR Dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <Target className="w-5 h-5 text-[#008CFF]" />
            <div className="min-w-0">
              <h1 className="text-[15px] font-bold text-slate-800 dark:text-white truncate">
                YouTube View Targets
              </h1>
              <p className="text-[12px] text-slate-500 dark:text-slate-400">
                Set quarterly + yearly targets per channel. Calendar quarters (Q1 = Jan-Mar).
              </p>
            </div>
          </div>
          <div className="w-full sm:w-40">
            <SelectField
              value={String(selectedYear)}
              onChange={(v) => setSelectedYear(Number(v))}
              options={yearOptions}
            />
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {targetsLoading && rows.length === 0 ? (
          <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-10 text-center">
            <p className="text-[13px] text-slate-500">Loading channels…</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-10 text-center">
            <p className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">
              No channels found
            </p>
            <p className="mt-1 text-[12px] text-slate-500">
              Either the YOUTUBE_CHANNELS env var isn't set, or the dev server hasn't picked it up yet.
              Restart <code className="px-1 py-0.5 rounded bg-slate-100 text-slate-700">npm run dev</code> and reload.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
            {/* Desktop: column header strip. Hidden on mobile where each row
                stacks the channel name + label-per-input vertically. */}
            <div className="hidden lg:grid grid-cols-[1.4fr_repeat(5,1fr)] gap-3 px-5 py-3 bg-slate-50 dark:bg-white/[0.02] border-b border-slate-200 dark:border-white/[0.06]">
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                Channel
              </div>
              {QUARTERS.map((q) => (
                <div
                  key={q.key}
                  className="text-right text-[10.5px] font-bold uppercase tracking-wider text-slate-500"
                >
                  <div>{q.label}</div>
                  <div className="text-[9.5px] font-medium tracking-normal normal-case text-slate-400">
                    {q.sub}
                  </div>
                </div>
              ))}
            </div>

            <div className="divide-y divide-slate-200 dark:divide-white/[0.06]">
              {rows.map((row) => (
                <ChannelRow
                  key={row.channelId}
                  row={row}
                  current={currentByChannel.get(row.channelId)}
                  targetsKey={targetsKey}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Row                                                                       */
/* -------------------------------------------------------------------------- */

function ChannelRow({
  row,
  current,
  targetsKey,
}: {
  row:        ChannelTargetRow;
  current:    CurrentViewsRow | undefined;
  targetsKey: string;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_repeat(5,1fr)] gap-3 lg:gap-3 px-5 py-4 lg:items-start">
      {/* Channel name */}
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-slate-800 dark:text-white truncate">
          {row.channelName}
        </p>
        <p className="text-[10.5px] text-slate-400 font-mono truncate">
          {row.channelId}
        </p>
      </div>

      {/* 5 inputs (year + Q1-Q4) */}
      {QUARTERS.map((q) => (
        <TargetCell
          key={q.key}
          channelId={row.channelId}
          channelName={row.channelName}
          year={row.year}
          quarter={q.key}
          quarterLabel={q.label}
          initial={row.targets?.[q.key] ?? null}
          currentViews={current?.currentViews?.[q.key] ?? null}
          targetsKey={targetsKey}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Cell                                                                      */
/* -------------------------------------------------------------------------- */

function TargetCell({
  channelId,
  channelName,
  year,
  quarter,
  quarterLabel,
  initial,
  currentViews,
  targetsKey,
}: {
  channelId:    string;
  channelName:  string;
  year:         number;
  quarter:      Quarter;
  quarterLabel: string;
  initial:      number | null;
  currentViews: number | null;
  targetsKey:   string;
}) {
  const [value, setValue]   = useState<string>(initial != null ? String(initial) : "");
  const [busy,  setBusy]    = useState(false);
  const [saved, setSaved]   = useState(false);
  const [err,   setErr]     = useState<string>("");

  // Track the last saved value so the Save button can disable when the
  // input matches the server state (no spurious PUTs on every render).
  const [lastSaved, setLastSaved] = useState<number | null>(initial ?? null);

  const parsed = (() => {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed.replace(/[, _]/g, ""));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
  })();

  const invalid = Number.isNaN(parsed as number);
  const dirty = !invalid && parsed !== lastSaved;

  const onSave = async () => {
    if (invalid) { setErr("Enter a non-negative number"); return; }
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/hr/admin/view-targets", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          channelName,
          year,
          quarter,
          target: parsed,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Server returned ${res.status}`);
      }
      setLastSaved(parsed as number | null);
      setSaved(true);
      // Fade the "Saved" pill after a beat so HR knows it took.
      window.setTimeout(() => setSaved(false), 1600);
      // Refresh the table so other tabs / accidental dupes stay in sync.
      mutate(targetsKey);
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-0">
      {/* Mobile-only label — on lg+ the column header does this job */}
      <div className="lg:hidden text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1">
        {quarterLabel}
      </div>

      <div className="flex items-stretch gap-1.5">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => { setValue(e.target.value); setErr(""); }}
          onKeyDown={(e) => { if (e.key === "Enter" && dirty && !busy && !invalid) onSave(); }}
          placeholder="—"
          className={`h-9 min-w-0 flex-1 rounded-lg border bg-white dark:bg-white/[0.02] px-2.5 text-right text-[13px] tabular-nums text-slate-800 dark:text-white placeholder-slate-300 focus:outline-none focus:ring-2 transition-colors ${
            invalid
              ? "border-rose-300 focus:border-rose-400 focus:ring-rose-200"
              : "border-slate-200 dark:border-white/[0.06] focus:border-[#008CFF] focus:ring-[#008CFF]/15"
          }`}
        />
        <button
          type="button"
          onClick={onSave}
          disabled={busy || !dirty || invalid}
          className="shrink-0 h-9 px-2.5 rounded-lg bg-[#008CFF] hover:bg-[#0077dd] text-white text-[11.5px] font-bold disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "…" : "Save"}
        </button>
      </div>

      {/* Status line: Saved pill > error > "currently …" context */}
      <div className="mt-1 min-h-[14px] text-[10.5px] leading-tight">
        {saved ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold">
            <Check className="w-3 h-3" />
            Saved
          </span>
        ) : err ? (
          <span className="text-rose-600">{err}</span>
        ) : (
          <span className="text-slate-400 tabular-nums">
            currently {currentViews != null ? currentViews.toLocaleString() : "—"}
          </span>
        )}
      </div>
    </div>
  );
}
