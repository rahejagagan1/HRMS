"use client";

// HR-admin panel — per-employee WFH balance for the chosen month.
// Mirrors the layout of LeaveBalancesPanel / RegularizationBalancePanel:
// month picker, brand sub-tabs, search box, sticky-header table.

import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { Home, Search, ChevronLeft, ChevronRight, AlertCircle, Pencil, X, Check, Clock } from "lucide-react";

type Row = {
  userId: number;
  name: string;
  email: string;
  department: string | null;
  businessUnit: "NB Media" | "YT Labs" | null;
  credited: number;
  used: number;
  remaining: number;
  hasRow: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};
type Payload = {
  monthKey: string;
  brand: "NB Media" | "YT Labs" | null;
  limitEnabled: boolean;
  totals: { credited: number; used: number; remaining: number; employees: number };
  rows: Row[];
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function currentMonthKey(): string {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  return `${ist.getUTCFullYear()}-M${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
}
function shiftMonth(key: string, by: number): string {
  const m = key.match(/^(\d{4})-M(\d{2})$/); if (!m) return key;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + by, 1));
  return `${d.getUTCFullYear()}-M${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function prettyMonth(key: string): string {
  const m = key.match(/^(\d{4})-M(\d{2})$/); if (!m) return key;
  return `${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}`;
}

export default function WfhBalancesPanel({ initialBrand }: { initialBrand?: "NB Media" | "YT Labs" | "all" | null } = {}) {
  const [monthKey, setMonthKey] = useState<string>(currentMonthKey());
  // Brand is derived from the URL (?brand=…) via initialBrand. No
  // inline brand sub-tabs — the outer HR Dashboard brand tab is
  // the single brand control. "all" only kicks in when the outer
  // brand is "all" (e.g. when the URL has no ?brand param).
  const brand: "NB Media" | "YT Labs" | "all" =
    initialBrand === "NB Media" ? "NB Media"
  : initialBrand === "YT Labs"  ? "YT Labs"
  : "all";
  const [q, setQ] = useState<string>("");

  const apiKey = useMemo(() => {
    const params = new URLSearchParams({ monthKey });
    if (brand !== "all") params.set("brand", brand);
    if (q.trim()) params.set("q", q.trim());
    return `/api/hr/wfh/balances?${params.toString()}`;
  }, [monthKey, brand, q]);

  const { data, isLoading, mutate } = useSWR<Payload>(apiKey, fetcher, { revalidateOnFocus: false });
  const [editing, setEditing] = useState<Row | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[16px] font-bold text-slate-800 inline-flex items-center gap-2">
            <Home size={16} className="text-[#008CFF]" />
            WFH Balances
          </h2>
          <p className="text-[12px] text-slate-500 mt-0.5 max-w-2xl">
            Per-employee monthly WFH quota and usage. Credited automatically on the 1st of each month from the policy on <span className="font-semibold">/admin → Attendance Policies</span>. New joiners show their quota even before the cron creates a row.
          </p>
        </div>
      </div>

      {data && !data.limitEnabled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 inline-flex items-center gap-2">
          <AlertCircle size={14} />
          <span>
            <strong>WFH limit is currently OFF.</strong> Numbers below are shown for reference but quotas are not enforced. Flip the switch on <span className="font-semibold">/admin → Attendance Policies</span> to re-enable.
          </span>
        </div>
      )}

      {/* Filters row */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Month nav */}
        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white">
          <button
            onClick={() => setMonthKey(shiftMonth(monthKey, -1))}
            className="h-8 w-8 inline-flex items-center justify-center text-slate-500 hover:bg-slate-50 rounded-l-lg"
            aria-label="Previous month"
          >
            <ChevronLeft size={14} />
          </button>
          <div className="px-3 text-[12.5px] font-semibold text-slate-700 tabular-nums">
            {prettyMonth(monthKey)}
          </div>
          <button
            onClick={() => setMonthKey(shiftMonth(monthKey, +1))}
            className="h-8 w-8 inline-flex items-center justify-center text-slate-500 hover:bg-slate-50 rounded-r-lg"
            aria-label="Next month"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* (Brand tabs removed — outer HR Dashboard brand tab in
            the page header is the single brand control.) */}

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or email…"
            className="h-8 pl-8 pr-3 rounded-lg border border-slate-200 bg-white text-[12.5px] text-slate-700 placeholder-slate-400 w-64 focus:outline-none focus:border-[#008CFF]"
          />
        </div>
      </div>

      {/* Totals card */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <Stat label="Employees" value={data.totals.employees} accent="slate" />
          <Stat label="Total credited" value={data.totals.credited} accent="blue" />
          <Stat label="Total used" value={data.totals.used} accent="amber" />
          <Stat label="Total remaining" value={data.totals.remaining} accent="emerald" />
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full min-w-[760px]">
            <thead className="sticky top-0 bg-slate-50/95 backdrop-blur border-b border-slate-200">
              <tr className="text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5">Employee</th>
                <th className="px-4 py-2.5">Department</th>
                <th className="px-4 py-2.5">Brand</th>
                <th className="px-4 py-2.5 text-right">Credited</th>
                <th className="px-4 py-2.5 text-right">Used</th>
                <th className="px-4 py-2.5 text-right">Remaining</th>
                <th className="px-4 py-2.5 text-right w-16">Edit</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-[12.5px] text-slate-400">Loading…</td></tr>
              ) : !data || data.rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-[12.5px] text-slate-400">No employees match.</td></tr>
              ) : data.rows.map((r) => {
                const exhausted = r.remaining <= 0;
                const oneLeft   = r.remaining === 1;
                return (
                  <tr key={r.userId} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50">
                    <td className="px-4 py-2.5">
                      <div className="text-[13px] font-semibold text-slate-800 leading-tight inline-flex items-center gap-1.5">
                        {r.name}
                        {/* Pencil dot — marks a row that's been
                            manually edited (updatedByName populated). */}
                        {r.updatedByName && (
                          <span
                            className="inline-flex items-center justify-center h-3 w-3 rounded-full bg-amber-100 text-amber-700 text-[7px]"
                            title={`Edited by ${r.updatedByName}${r.updatedAt ? ` · ${new Date(r.updatedAt).toLocaleDateString("en-IN", { day:"numeric", month:"short" })}` : ""}`}
                          >
                            ✎
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{r.email}</div>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-slate-600">{r.department || "—"}</td>
                    <td className="px-4 py-2.5">
                      {r.businessUnit === "YT Labs" ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#d4143d]/10 text-[#d4143d]">YT Labs</span>
                      ) : r.businessUnit === "NB Media" ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#008CFF]/10 text-[#008CFF]">NB Media</span>
                      ) : (
                        <span className="text-[11px] text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[13px] font-semibold tabular-nums text-slate-800">
                      {r.credited}
                      {!r.hasRow && (
                        <span className="ml-1 text-[10px] font-medium text-slate-400" title="No DB row yet — will be created on next cron firing">*</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[13px] tabular-nums text-slate-700">
                      {r.used}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`inline-flex items-center justify-center min-w-[36px] px-2 py-0.5 rounded-md text-[12px] font-bold tabular-nums ${
                        exhausted ? "bg-rose-50 text-rose-700"
                          : oneLeft ? "bg-amber-50 text-amber-700"
                          : "bg-emerald-50 text-emerald-700"
                      }`}>
                        {r.remaining}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setEditing(r)}
                        className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF] transition-colors"
                        title="Edit balance"
                        aria-label={`Edit balance for ${r.name}`}
                      >
                        <Pencil size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data && data.rows.some((r) => !r.hasRow) && (
          <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/60 text-[11px] text-slate-500">
            <span className="text-slate-400">*</span> No DB row yet — values shown are what the next cron firing will credit. Run a force-credit from VPS to materialise them now.
          </div>
        )}
      </div>

      {/* Edit modal — overrides credited / used for one (user,
          month) pair. ON CONFLICT upsert on the server so editing
          a synthetic row materialises it. */}
      {editing && (
        <EditBalanceModal
          row={editing}
          monthKey={monthKey}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); mutate(); }}
        />
      )}
    </div>
  );
}

function EditBalanceModal({
  row, monthKey, onClose, onSaved,
}: {
  row: Row;
  monthKey: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [credited, setCredited] = useState<string>(String(row.credited));
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string>("");

  const cNum = Number(credited);
  // `used` is auto-computed (half-day weighted) from the employee's WFH
  // requests — read-only here. Only `credited` (the allowance) is editable.
  const usedVal = row.used;
  const valid = Number.isInteger(cNum) && cNum >= 0 && cNum <= 31;
  const remaining = Math.max(0, cNum - usedVal);
  const dirty = cNum !== row.credited;

  const save = async () => {
    if (!valid || !dirty) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch(`/api/hr/wfh/balances/${row.userId}?monthKey=${encodeURIComponent(monthKey)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credited: cNum }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Save failed (${res.status})`);
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog" aria-modal="true"
    >
      <div
        className="w-full max-w-[440px] bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-slate-900 leading-tight">Edit WFH balance</h2>
            <p className="text-[12px] text-slate-500 mt-0.5">
              {row.name} · <span className="text-slate-400">{prettyMonth(monthKey)}</span>
              {row.businessUnit && (
                <>
                  {" · "}
                  <span className={row.businessUnit === "YT Labs" ? "text-[#d4143d]" : "text-[#008CFF]"}>{row.businessUnit}</span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </header>

        <div className="px-5 pb-1 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10.5px] uppercase tracking-[0.08em] font-bold text-slate-500 mb-1">Credited</label>
            <input
              type="number" min={0} max={31}
              value={credited}
              onChange={(e) => setCredited(e.target.value)}
              autoFocus
              disabled={busy}
              className="h-10 w-full px-3 border border-slate-200 rounded-md text-[15px] font-bold text-slate-900 tabular-nums focus:outline-none focus:border-[#008CFF] disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-[10.5px] uppercase tracking-[0.08em] font-bold text-slate-500 mb-1">
              Used <span className="normal-case font-medium text-slate-400">(auto)</span>
            </label>
            <div
              className="h-10 w-full px-3 border border-slate-100 bg-slate-50 rounded-md text-[15px] font-bold text-slate-700 tabular-nums flex items-center"
              title="Auto-calculated from this employee's WFH requests (half-days count as 0.5). Not manually editable."
            >
              {usedVal}
            </div>
            <p className="mt-1 text-[10px] text-slate-400 leading-tight">From WFH requests · half-day = 0.5</p>
          </div>
        </div>

        {/* Live preview of remaining */}
        <div className="px-5 mt-2">
          <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-[12.5px] font-semibold ${
            remaining === 0 ? "bg-rose-50 text-rose-800"
              : remaining === 1 ? "bg-amber-50 text-amber-800"
              : "bg-emerald-50 text-emerald-800"
          }`}>
            <span>Remaining after save</span>
            <span className="text-[16px] font-bold tabular-nums">{remaining}</span>
          </div>
        </div>

        {row.updatedByName && (
          <div className="px-5 pt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
            <Clock size={11} />
            <span>
              Last edited by <span className="font-semibold text-slate-600">{row.updatedByName}</span>
              {row.updatedAt ? ` · ${new Date(row.updatedAt).toLocaleString("en-IN", { day:"numeric", month:"short", hour:"numeric", minute:"2-digit", hour12: true })}` : ""}
            </span>
          </div>
        )}

        {err && (
          <div className="mx-5 mt-3 rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-[11.5px] text-rose-700 inline-flex items-center gap-1.5">
            <AlertCircle size={12} /> {err}
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 px-5 py-3 mt-3 border-t border-slate-100 bg-slate-50/60">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-9 px-3 rounded-md border border-slate-200 bg-white text-[12.5px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !valid || !dirty}
            className="h-9 px-4 rounded-md bg-[#008CFF] text-[12.5px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {busy ? "Saving…" : (<><Check size={13} /> Save changes</>)}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: "slate" | "blue" | "amber" | "emerald" }) {
  const tone = {
    slate:   "bg-slate-50  text-slate-700",
    blue:    "bg-[#008CFF]/10 text-[#008CFF]",
    amber:   "bg-amber-50  text-amber-800",
    emerald: "bg-emerald-50 text-emerald-700",
  }[accent];
  return (
    <div className={`rounded-lg ${tone} px-3 py-2.5`}>
      <p className="text-[10px] uppercase tracking-wider font-bold opacity-80">{label}</p>
      <p className="text-[18px] font-bold tabular-nums leading-tight mt-0.5">{value}</p>
    </div>
  );
}
