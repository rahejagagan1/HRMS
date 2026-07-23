"use client";

// HR Offboarding — Keka-parity pipeline view.
//
//   ┌─ Under Review (3)  Exits In Progress (5)  Exited Employees (12) ─┐
//   │  [search]  [Department ▾]  [Last working day ▾]      Reset  Total │
//   │ ─────────────────────────────────────────────────────────────────  │
//   │   ☐  Avatar  Employee + designation        LWD          Notice ⋮  │
//   │      ...                                                          │
//
// Status is a segmented control (one active tab at a time) rather than
// three parallel columns — matches Keka's layout. Filter chips scope the
// active tab. Clicking a row opens the detail drawer (sibling).

import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import {
  Search, X, ChevronRight, Filter,
  CheckCircle2, Clock3, UsersRound,
} from "lucide-react";
import ExitDetailDrawer from "./ExitDetailDrawer";

type Exit = {
  id: number; userId: number; userName: string; userEmail: string;
  designation: string | null; department: string | null;
  exitType: string; resignationDate: string; lastWorkingDay: string;
  noticePeriodDays: number; reason: string | null; notes: string | null;
  status: string;
  assetsReturned: boolean; documentsHandled: boolean;
  finalSettlementDone: boolean; exitInterviewDone: boolean;
  okToRehire: boolean;
  createdAt: string;
};

// The "Under Review" stage was retired — all new exits land directly
// in "Exits in Progress" (see POST /api/hr/exits). Legacy under_review
// rows are bucketed into in_progress by `normaliseStatus` below so
// they remain visible. Keep the AlertCircle import in case we revive
// a third lane later.
const TABS = [
  { key: "in_progress", label: "Exits in Progress", Icon: Clock3,     accent: "sky"   },
  { key: "exited",      label: "Exited Employees",  Icon: UsersRound, accent: "slate" },
] as const;
type TabKey = typeof TABS[number]["key"];

const accentClasses: Record<string, { active: string; chip: string; bar: string }> = {
  amber: {
    active: "border-amber-500 text-amber-700",
    chip:   "bg-amber-50 text-amber-700 ring-amber-200",
    bar:    "bg-amber-500",
  },
  sky: {
    active: "border-sky-500 text-sky-700",
    chip:   "bg-sky-50 text-sky-700 ring-sky-200",
    bar:    "bg-sky-500",
  },
  slate: {
    active: "border-slate-500 text-slate-800",
    chip:   "bg-slate-100 text-slate-700 ring-slate-200",
    bar:    "bg-slate-400",
  },
};

const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function daysFromNow(iso: string): number {
  const target = new Date(iso); target.setUTCHours(0, 0, 0, 0);
  const now = new Date(); now.setUTCHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / (24 * 3600_000));
}

// Map every status value (legacy + retired "under_review") to one of
// the two live lanes. Anything in-progress-ish — including the now-
// retired under_review state, plus the legacy notice_period / cleared
// — collapses into "in_progress" so old rows stay visible.
function normaliseStatus(raw: string): TabKey {
  if (raw === "exited" || raw === "offboarded") return "exited";
  return "in_progress";
}

type BrandProp = "NB Media" | "YT Labs" | "all";

export default function ExitPipeline({ initialBrand = "all" }: { initialBrand?: BrandProp } = {}) {
  // Brand tab — drives the ?brand= query param on /api/hr/exits.
  // Initial value comes from the page's `?brand=` URL param (the
  // HR Dashboard context — NB Media tab vs YT Labs tab). HR Managers
  // can flip the in-component brand tabs to view either brand.
  //
  // If the dashboard URL passes `brand=all` (rare — direct visits
  // without a brand context), seed the tab with NB Media as a sane
  // default for the visible list. HR can still click "YT Labs" or
  // pass `?brand=all` in the URL to override.
  const initial: "NB Media" | "YT Labs" =
    initialBrand === "YT Labs" ? "YT Labs" : "NB Media";
  const [brand, setBrand] = useState<"NB Media" | "YT Labs">(initial);
  const apiKey = `/api/hr/exits?brand=${encodeURIComponent(brand)}`;
  const { data: rows, isLoading } = useSWR<Exit[]>(apiKey, fetcher);
  const [drawerExitId, setDrawerExitId] = useState<number | null>(null);

  // UI state — default lane is "Exits in Progress" (the only place
  // new exits land now that "Under Review" is retired).
  const [tab, setTab] = useState<TabKey>("in_progress");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState<string>("");
  const [exitedWindow, setExitedWindow] = useState<"7" | "30" | "90" | "all">("all");

  // Bucket all rows by the (normalised) status so tab counts are stable
  // regardless of which tab is active.
  const buckets = useMemo(() => {
    const acc: Record<TabKey, Exit[]> = { in_progress: [], exited: [] };
    for (const r of rows ?? []) acc[normaliseStatus(r.status)].push(r);
    return acc;
  }, [rows]);

  const departments = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows ?? []) if (r.department) s.add(r.department);
    return Array.from(s).sort();
  }, [rows]);

  // Filter the active tab's rows.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return buckets[tab].filter(r => {
      if (department && r.department !== department) return false;
      if (q && !(r.userName.toLowerCase().includes(q) || r.userEmail.toLowerCase().includes(q))) return false;
      if (tab === "exited" && exitedWindow !== "all") {
        const cutoff = -Number(exitedWindow);
        if (daysFromNow(r.lastWorkingDay) < cutoff) return false;
      }
      return true;
    });
  }, [buckets, tab, search, department, exitedWindow]);

  const hasAnyRows = (rows ?? []).length > 0;
  const activeAccent = TABS.find(t => t.key === tab)!.accent;

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="p-8 space-y-3">
          <div className="h-5 w-48 bg-slate-100 rounded animate-pulse" />
          <div className="h-12 w-full bg-slate-100 rounded animate-pulse" />
          <div className="h-12 w-full bg-slate-100 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!hasAnyRows) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white py-16 text-center">
        <UsersRound size={28} className="mx-auto text-slate-300 mb-2" />
        <p className="text-[13px] font-semibold text-slate-700">No exits recorded yet.</p>
        <p className="text-[11.5px] text-slate-500 mt-1">
          Use the <strong>Initiate Exit</strong> tab to record the first one.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Brand tabs — switch between brands. Initial selection is
          driven by the HR Dashboard URL's `?brand=` (NB Media vs
          YT Labs). Each tab keeps the list visually clean —
          never mixed-brand rows. */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-slate-100 bg-white">
        <span className="text-[10.5px] uppercase tracking-[0.08em] font-bold text-slate-400 mr-2">Brand</span>
        {(["NB Media", "YT Labs"] as const).map((b) => {
          const active = brand === b;
          return (
            <button
              key={b}
              type="button"
              onClick={() => setBrand(b)}
              className={`h-7 px-3 rounded-md text-[11.5px] font-semibold transition-colors ${
                active
                  ? "bg-[#008CFF] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {b}
            </button>
          );
        })}
      </div>

      {/* Status sub-tabs */}
      <nav className="flex border-b border-slate-200 bg-slate-50/50">
        {TABS.map(t => {
          const active = tab === t.key;
          const count  = buckets[t.key].length;
          const Icon   = t.Icon;
          const acc    = accentClasses[t.accent];
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 px-5 py-3 inline-flex items-center justify-center gap-2 text-[12.5px] font-semibold transition-all border-b-2 -mb-px ${
                active
                  ? `bg-white ${acc.active}`
                  : "border-transparent text-slate-500 hover:bg-white/60 hover:text-slate-700"
              }`}
            >
              <Icon size={14} className={active ? "" : "opacity-70"} />
              <span>{t.label}</span>
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10.5px] font-bold tabular-nums ring-1 ring-inset ${
                active ? acc.chip : "bg-slate-100 text-slate-500 ring-slate-200"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="h-9 w-64 pl-8 pr-3 rounded-lg border border-slate-200 bg-white text-[12.5px] placeholder-slate-400 focus:outline-none focus:border-[#0f6ecd]"
          />
        </div>

        <div className="inline-flex items-center gap-1.5 text-slate-400">
          <Filter size={12} />
        </div>

        {departments.length > 0 && (
          <Dropdown
            value={department}
            onChange={setDepartment}
            placeholder="Department"
            options={departments}
          />
        )}

        {tab === "exited" && (
          <div className="inline-flex rounded-lg ring-1 ring-slate-200 bg-white overflow-hidden">
            {([
              ["all", "Any time"],
              ["7",   "Last 7 days"],
              ["30",  "Last 30 days"],
              ["90",  "Last 90 days"],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setExitedWindow(k)}
                className={`px-2.5 h-9 text-[11.5px] font-semibold transition-colors border-r border-slate-200 last:border-r-0 ${
                  exitedWindow === k ? "bg-[#0f6ecd] text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {(search || department || (tab === "exited" && exitedWindow !== "all")) && (
          <button
            onClick={() => { setSearch(""); setDepartment(""); setExitedWindow("all"); }}
            className="inline-flex items-center gap-1 h-9 px-2.5 rounded-lg text-[11.5px] font-medium text-slate-500 hover:bg-slate-100"
          >
            <X size={12} /> Reset
          </button>
        )}

        <div className="ml-auto text-[11.5px] text-slate-500">
          Showing <strong className="text-slate-700">{visible.length}</strong> of <strong className="text-slate-700">{buckets[tab].length}</strong>
        </div>
      </div>

      {/* Table */}
      {visible.length === 0 ? (
        <div className="py-16 text-center text-[12.5px] text-slate-400">
          {buckets[tab].length === 0
            ? "No employees in this stage."
            : "No employees match the current filters."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50/60 border-b border-slate-200 text-[10.5px] font-bold uppercase tracking-[0.06em] text-slate-500">
                <th className="text-left px-5 py-2.5 w-[34%]">Employee</th>
                <th className="text-left px-5 py-2.5">Department</th>
                <th className="text-left px-5 py-2.5">Last Working Day</th>
                <th className="text-left px-5 py-2.5">{tab === "exited" ? "Exit Type" : "Notice"}</th>
                <th className="text-left px-5 py-2.5 w-[140px]">Clearance</th>
                <th className="text-right px-5 py-2.5 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const cleared = [r.assetsReturned, r.documentsHandled, r.finalSettlementDone, r.exitInterviewDone].filter(Boolean).length;
                const days = daysFromNow(r.lastWorkingDay);
                const isExited = tab === "exited";
                return (
                  <tr
                    key={r.id}
                    onClick={() => setDrawerExitId(r.id)}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={r.userName} />
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-slate-800 truncate">{r.userName}</p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {r.designation || r.userEmail}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-[12.5px] text-slate-700 truncate">
                      {r.department || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-[12.5px]">
                      <p className="font-medium text-slate-800 tabular-nums">{fmtDate(r.lastWorkingDay)}</p>
                      {!isExited && (
                        <p className={`text-[10.5px] mt-0.5 ${
                          days < 0 ? "text-rose-600 font-semibold"
                          : days === 0 ? "text-rose-600 font-semibold"
                          : days <= 7 ? "text-amber-600"
                          : "text-slate-500"
                        }`}>
                          {days < 0 ? `Overdue by ${Math.abs(days)}d`
                            : days === 0 ? "Last day today"
                            : `${days}d remaining`}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {isExited ? (
                        <span className="text-[12px] text-slate-700 capitalize">
                          {r.exitType.replace(/_/g, " ")}
                        </span>
                      ) : (
                        <span className="text-[12px] text-slate-700 tabular-nums">
                          {r.noticePeriodDays}d
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full transition-[width] ${accentClasses[activeAccent].bar}`}
                            style={{ width: `${(cleared / 4) * 100}%` }}
                          />
                        </div>
                        <span className={`text-[10.5px] font-bold tabular-nums ${
                          cleared === 4 ? "text-emerald-600" : "text-slate-500"
                        }`}>
                          {cleared}/4
                        </span>
                        {cleared === 4 && <CheckCircle2 size={12} className="text-emerald-500 -ml-1" />}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <ChevronRight size={14} className="inline text-slate-300" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {drawerExitId != null && (
        <ExitDetailDrawer
          exitId={drawerExitId}
          onClose={() => setDrawerExitId(null)}
          onChanged={() => {
            // Pattern-match so the brand-keyed variants
            // (?brand=NB Media / ?brand=YT Labs) also refresh.
            mutate((k: any) => typeof k === "string" && k.startsWith("/api/hr/exits"));
            mutate((k: any) => typeof k === "string" && (
              k.startsWith("/api/hr/employees") ||
              k.startsWith("/api/search") ||
              k.startsWith(`/api/hr/exits/${drawerExitId}`)
            ));
          }}
        />
      )}
    </div>
  );
}

/* ── Avatar with initials fallback ────────────────────────────────────── */

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0]).join("").toUpperCase();

  // Deterministic tint based on the name so two avatars next to each
  // other don't clash. Keeps things calm — pastel ring + bold text.
  const palette = [
    "bg-sky-50 text-sky-700 ring-sky-200",
    "bg-violet-50 text-violet-700 ring-violet-200",
    "bg-emerald-50 text-emerald-700 ring-emerald-200",
    "bg-amber-50 text-amber-700 ring-amber-200",
    "bg-rose-50 text-rose-700 ring-rose-200",
    "bg-indigo-50 text-indigo-700 ring-indigo-200",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const tone = palette[hash % palette.length];

  return (
    <span
      className={`h-9 w-9 rounded-full ring-1 ring-inset inline-flex items-center justify-center text-[11px] font-bold shrink-0 ${tone}`}
    >
      {initials || "·"}
    </span>
  );
}

/* ── Compact dropdown (matches the existing app aesthetic) ───────────── */

function Dropdown({
  value, onChange, options, placeholder,
}: { value: string; onChange: (v: string) => void; options: string[]; placeholder: string }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-9 pl-3 pr-8 rounded-lg border border-slate-200 bg-white text-[12.5px] text-slate-700 focus:outline-none focus:border-[#0f6ecd] appearance-none cursor-pointer min-w-[140px]"
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <svg
        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}
