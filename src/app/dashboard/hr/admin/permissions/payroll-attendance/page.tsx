"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { fetcher } from "@/lib/swr";
import { brandFromSlug, inBrandScope } from "@/lib/hr-brand-scope";
import { ChevronLeft, Search, X, Wallet, Clock, RefreshCcw, AlertCircle } from "lucide-react";

// Per-employee Attendance + Payroll toggles. CEO + developers default
// OFF (no row in DB → role default applies); flipping a toggle stores
// an explicit override that always wins. Disabling Attendance:
//   • blocks clock-in/clock-out for that user
//   • drops them from the attendance dashboards + 10:05 HR summary
//   • suppresses the 09:50 / 19:00 reminder emails
// Disabling Payroll currently just stores intent — gates land when the
// payroll job runs.

type PolicyRow = {
  id: number; name: string; email: string; department: string | null;
  businessUnit: string | null;
  role: string | null; orgLevel: string | null; isDeveloper: boolean;
  profilePictureUrl: string | null;
  attendanceEnabled: boolean; payrollEnabled: boolean;
  source: "override" | "default";
};

const URL = "/api/hr/admin/notification-policy";

export default function PayrollAttendancePermissionsPage() {
  const { data, isLoading, error } = useSWR<{ users: PolicyRow[] }>(URL, fetcher);
  const users = data?.users ?? [];
  const searchParams = useSearchParams();
  // Auto-scope to the brand of the HR sub-dashboard you came from (the rail
  // link carries ?brand=). Super-admins on the "all" dashboard (or no param)
  // see every brand. UI-only filter — the API still returns org-wide rows.
  const brand = brandFromSlug(searchParams?.get("brand"));
  const brandUsers = useMemo(() => users.filter((u) => inBrandScope(u.businessUnit, brand)), [users, brand]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "overridden" | "att_off" | "pay_off">("all");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const filtered = useMemo(() => {
    let xs = brandUsers;
    if (filter === "overridden") xs = xs.filter((u) => u.source === "override");
    else if (filter === "att_off") xs = xs.filter((u) => !u.attendanceEnabled);
    else if (filter === "pay_off") xs = xs.filter((u) => !u.payrollEnabled);
    const q = query.trim().toLowerCase();
    if (!q) return xs;
    return xs.filter((u) =>
      u.name.toLowerCase().includes(q)
      || (u.email || "").toLowerCase().includes(q)
      || (u.department || "").toLowerCase().includes(q),
    );
  }, [brandUsers, query, filter]);

  const counts = useMemo(() => ({
    total:        brandUsers.length,
    attDisabled:  brandUsers.filter((u) => !u.attendanceEnabled).length,
    payDisabled:  brandUsers.filter((u) => !u.payrollEnabled).length,
    overridden:   brandUsers.filter((u) => u.source === "override").length,
  }), [brandUsers]);

  const flip = async (u: PolicyRow, key: "attendanceEnabled" | "payrollEnabled") => {
    setBusyId(u.id);
    try {
      const res = await fetch(URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: u.id, [key]: !u[key] }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j?.error || "Failed to update");
        return;
      }
      await mutate(URL);
    } finally { setBusyId(null); }
  };

  const resetOne = async (u: PolicyRow) => {
    if (!confirm(`Restore ${u.name}'s policy to role defaults? Their override row will be removed.`)) return;
    setBusyId(u.id);
    try {
      const res = await fetch(`${URL}?userId=${u.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j?.error || "Failed to reset");
        return;
      }
      await mutate(URL);
    } finally { setBusyId(null); }
  };

  const resetAll = async () => {
    if (!confirm(`Reset ALL ${counts.overridden} overrides? Every employee will fall back to their role defaults (CEO + developers off, everyone else on).`)) return;
    setBulkBusy(true);
    try {
      const res = await fetch(URL, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j?.error || "Bulk reset failed");
        return;
      }
      await mutate(URL);
    } finally { setBulkBusy(false); }
  };

  return (
    <div className="min-h-screen bg-[#f4f7f8]">
      {/* ── Top bar ── */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3">
        <Link
          href="/dashboard/hr/admin"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
          aria-label="Back to HR Dashboard"
        >
          <ChevronLeft size={16} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] font-bold text-slate-800">Payroll &amp; Attendance Permissions</h1>
            {brand && brand !== "all" && (
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${brand === "YT Labs" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"}`}>
                {brand}
              </span>
            )}
          </div>
          <p className="text-[11.5px] text-slate-500">
            Per-employee toggles for the attendance + payroll modules. Overrides win over role defaults.
            {brand && brand !== "all" ? ` Showing ${brand} employees only.` : ""}
          </p>
        </div>
      </div>

      <div className="px-6 py-6 max-w-6xl mx-auto">
        {/* Stats strip */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          <StatCard label="Active" value={counts.total} tone="slate" />
          <StatCard label="Attendance disabled" value={counts.attDisabled} tone="rose" />
          <StatCard label="Payroll disabled"    value={counts.payDisabled} tone="violet" />
          <StatCard label="Manual overrides"     value={counts.overridden} tone="amber" />
        </div>

        {/* Toolbar */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 mb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email, or department…"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-8 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/20"
            />
            {query ? (
              <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                <X size={12} />
              </button>
            ) : null}
          </div>
          <FilterChip active={filter === "all"}        onClick={() => setFilter("all")}>All</FilterChip>
          <FilterChip active={filter === "overridden"} onClick={() => setFilter("overridden")}>Overridden</FilterChip>
          <FilterChip active={filter === "att_off"}    onClick={() => setFilter("att_off")}>Attendance off</FilterChip>
          <FilterChip active={filter === "pay_off"}    onClick={() => setFilter("pay_off")}>Payroll off</FilterChip>
          <div className="flex-1" />
          <button
            onClick={resetAll}
            disabled={bulkBusy || counts.overridden === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-[12.5px] font-semibold text-slate-700 hover:border-amber-300 hover:text-amber-700 disabled:opacity-50"
          >
            <RefreshCcw size={13} />
            {bulkBusy ? "Resetting…" : `Reset all (${counts.overridden})`}
          </button>
        </div>

        {/* Table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          {error && (
            <div className="p-4 text-[12.5px] text-red-700 bg-red-50 border-b border-red-200 flex items-center gap-2">
              <AlertCircle size={14} /> Failed to load: {String(error.message ?? error)}
            </div>
          )}
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500 px-5 py-3">Employee</th>
                <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500 px-3 py-3">Department</th>
                <th className="text-center text-[10.5px] font-bold uppercase tracking-wider text-slate-500 px-3 py-3">
                  <div className="inline-flex items-center gap-1 text-emerald-600"><Clock size={12} /> Attendance</div>
                </th>
                <th className="text-center text-[10.5px] font-bold uppercase tracking-wider text-slate-500 px-3 py-3">
                  <div className="inline-flex items-center gap-1 text-violet-600"><Wallet size={12} /> Payroll</div>
                </th>
                <th className="text-right text-[10.5px] font-bold uppercase tracking-wider text-slate-500 px-3 py-3">Source</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-[12.5px] text-slate-400">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-[12.5px] text-slate-400">
                  {users.length === 0 ? "No active employees." : `No employee matches "${query}".`}
                </td></tr>
              ) : filtered.map((u, i) => (
                <tr key={u.id} className={`border-t border-slate-100 ${i % 2 === 0 ? "" : "bg-slate-50/40"} hover:bg-[#f8fbff]`}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} url={u.profilePictureUrl} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-800 truncate">
                          {u.name}
                          {u.isDeveloper && (
                            <span className="ml-2 text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-800 text-white">Dev</span>
                          )}
                          {u.orgLevel === "ceo" && (
                            <span className="ml-2 text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">CEO</span>
                          )}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-[12px] text-slate-600">{u.department || "—"}</td>
                  <td className="px-3 py-3 text-center">
                    <Toggle on={u.attendanceEnabled} disabled={busyId === u.id} onClick={() => flip(u, "attendanceEnabled")} accent="emerald" />
                  </td>
                  <td className="px-3 py-3 text-center">
                    <Toggle on={u.payrollEnabled} disabled={busyId === u.id} onClick={() => flip(u, "payrollEnabled")} accent="violet" />
                  </td>
                  <td className="px-3 py-3 text-right">
                    {u.source === "override" ? (
                      <button
                        onClick={() => resetOne(u)}
                        disabled={busyId === u.id}
                        title="Reset to role default — removes the explicit override row"
                        className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 hover:bg-amber-100"
                      >
                        Override · Reset
                      </button>
                    ) : (
                      <span className="text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200">
                        Default
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-[11px] text-slate-400 leading-relaxed">
          <strong className="text-slate-600">Defaults:</strong> CEO and Developers (DEVELOPER_EMAILS env) start with both modules <strong>OFF</strong>; everyone else starts with both <strong>ON</strong>. Flipping a toggle creates an explicit override that wins over the role default until you click <em>Reset</em>.
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "slate" | "rose" | "violet" | "amber" }) {
  const palette = {
    slate:  { bg: "bg-white",    text: "text-slate-800", subtle: "text-slate-500" },
    rose:   { bg: "bg-rose-50",  text: "text-rose-700",  subtle: "text-rose-500" },
    violet: { bg: "bg-violet-50",text: "text-violet-700",subtle: "text-violet-500" },
    amber:  { bg: "bg-amber-50", text: "text-amber-700", subtle: "text-amber-500" },
  }[tone];
  return (
    <div className={`${palette.bg} border border-slate-200 rounded-xl px-4 py-3`}>
      <p className={`text-[10.5px] font-bold uppercase tracking-wider ${palette.subtle}`}>{label}</p>
      <p className={`mt-1 text-[20px] font-bold ${palette.text}`}>{value}</p>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-9 px-3 rounded-lg text-[12px] font-semibold transition-colors ${
        active ? "bg-[#008CFF] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >{children}</button>
  );
}

function Toggle({ on, disabled, onClick, accent }: { on: boolean; disabled?: boolean; onClick: () => void; accent: "emerald" | "violet" }) {
  const onCls = accent === "emerald" ? "bg-emerald-500" : "bg-violet-500";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        on ? onCls : "bg-slate-300"
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
        on ? "translate-x-[24px]" : "translate-x-[3px]"
      }`} />
    </button>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-8 w-8 rounded-full object-cover ring-1 ring-slate-200" />;
  }
  const ch = (name || "?").trim().slice(0, 1).toUpperCase();
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e8f1fc] text-[11px] font-semibold text-[#0f4e93] ring-1 ring-[#cfdef5]">
      {ch}
    </span>
  );
}
