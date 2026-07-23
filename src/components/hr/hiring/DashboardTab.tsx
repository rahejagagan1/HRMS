"use client";

// Hiring Dashboard — the landing view (mirrors Keka's Home → Dashboard).
// Top: Hiring Health card + 5 metric tiles.
// Below: Departments breakdown (left) + Offers tabbed list (right).
// Everything fetched in one round-trip via /api/hr/hiring/dashboard.

import { useMemo } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { useUrlTab } from "@/lib/hooks/useUrlTab";
import { Info } from "lucide-react";

type OfferLite = {
  id: number;
  candidateName: string;
  jobTitle: string;
  ctcAnnual?: string | null;
  joiningDate?: string | null;
  acceptedAt?: string | null;
  declinedAt?: string | null;
  revokedAt?: string | null;
  createdAt?: string | null;
  fullName?: string;
  updatedAt?: string | null;
};

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const fmtCtc = (v: string | null | undefined) => {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `₹ ${n.toLocaleString("en-IN")}`;
};

export default function DashboardTab() {
  const { data, isLoading } = useSWR<any>("/api/hr/hiring/dashboard", fetcher, {
    revalidateOnFocus: false,
  });
  // URL-synced — refreshing on Accepted/Rejected stays put.
  const [offerTab, setOfferTab] = useUrlTab<"pending" | "accepted" | "rejected" | "newHires">(
    "offers", "pending",
    ["pending", "accepted", "rejected", "newHires"] as const,
  );

  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-slate-200 bg-white h-24 animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white h-24 animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white h-72 animate-pulse" />
          <div className="rounded-xl border border-slate-200 bg-white h-72 animate-pulse" />
        </div>
      </div>
    );
  }

  const health = data.hiringHealth || { openPositions: 0, hiredLast12m: 0, targetLast12m: 0 };
  const pct = health.targetLast12m > 0 ? (health.hiredLast12m / health.targetLast12m) * 100 : 0;

  const lists = data.offers || { pending: [], accepted: [], rejected: [], newHires: [] };
  const activeList: OfferLite[] = lists[offerTab] || [];

  return (
    <div className="space-y-4">
      <h2 className="text-[16px] font-semibold text-slate-800">
        Explore, evaluate, and elevate your team with Hire
      </h2>

      {/* Hiring Health */}
      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">Hiring health</h3>
            <p className="mt-0.5 text-[12.5px] text-[#008CFF] font-medium">
              {health.openPositions} positions to be hired
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11.5px] text-slate-500">
              <strong className="text-slate-800">{health.hiredLast12m}</strong> of {health.targetLast12m} Hired in last 12 months
            </p>
            <div className="mt-2 w-[280px] h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#008CFF] to-[#7c3aed] transition-all"
                style={{ width: `${Math.min(100, pct).toFixed(1)}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* 5 Metric tiles */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <MetricCard
          label="Offer acceptance rate"
          value={data.offerAcceptanceRate != null ? `${data.offerAcceptanceRate.toFixed(0)}%` : "—"}
          sub="(Last 3 months)"
          hint="Accepted offers ÷ offers sent in the last 3 months."
        />
        <MetricCard
          label="Positions overdue"
          value={String(data.positionsOverdue ?? 0)}
          sub="Open >30 days"
          hint="Jobs that have been open for more than 30 days without a hire."
        />
        <MetricCard
          label="Source to hire %"
          value={data.sourceToHirePct != null ? `${data.sourceToHirePct.toFixed(2)}%` : "—"}
          sub="(Last 6 months)"
          hint="Hires ÷ total candidates added in the last 6 months — your conversion funnel."
        />
        <MetricCard
          label="Time to hire"
          value={data.timeToHireDays != null ? `${data.timeToHireDays} days` : "—"}
          sub="(Last 6 months)"
          hint="Average days from application to hired status."
        />
        <MetricCard
          label="Pending review"
          value={String(data.pendingReview ?? 0)}
          sub="(Last 3 months)"
          hint="Candidates in active pipeline stages added in the last 3 months."
          badge="New"
        />
      </section>

      {/* Departments + Offers split */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DepartmentsCard departments={data.departments || []} />
        <OffersCard
          tab={offerTab}
          onTab={setOfferTab}
          counts={{
            pending:  lists.pending.length,
            accepted: lists.accepted.length,
            rejected: lists.rejected.length,
            newHires: lists.newHires.length,
          }}
          list={activeList}
        />
      </section>
    </div>
  );
}

function MetricCard({
  label, value, sub, hint, badge,
}: {
  label: string;
  value: string;
  sub: string;
  hint: string;
  badge?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 relative group">
      <div className="flex items-center gap-1.5">
        <p className="text-[12.5px] text-slate-600">{label}</p>
        {badge && (
          <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-[#008CFF]/10 text-[#008CFF]">{badge}</span>
        )}
        <span className="ml-auto text-slate-300" title={hint}><Info size={12} /></span>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[26px] font-bold text-slate-800 leading-none tabular-nums">{value}</span>
        <span className="text-[11px] text-slate-400">{sub}</span>
      </div>
    </div>
  );
}

function DepartmentsCard({ departments }: { departments: any[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <header className="px-5 py-3 border-b border-slate-100 flex items-center gap-1.5">
        <h3 className="text-[13.5px] font-semibold text-slate-800">Departments</h3>
        <Info size={12} className="text-slate-300" />
      </header>
      <div className="overflow-y-auto max-h-[380px]">
        <table className="w-full">
          <thead className="bg-slate-50/60 border-b border-slate-100 sticky top-0">
            <tr>
              <th className="px-5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">Name</th>
              <th className="px-5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">Jobs</th>
              <th className="px-5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">Positions hired</th>
            </tr>
          </thead>
          <tbody>
            {departments.length === 0 ? (
              <tr><td colSpan={3} className="px-5 py-8 text-center text-[12px] text-slate-400">No active departments.</td></tr>
            ) : departments.map((d, i) => {
              const total = Math.max(1, d.target ?? d.jobs ?? 1);
              const filled = (d.positionsHired / total) * 100;
              return (
                <tr key={`${d.name}-${i}`} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-5 py-3 text-[12.5px] text-[#008CFF] font-medium">{d.name}</td>
                  <td className="px-5 py-3 text-[12.5px] text-slate-700">{d.jobs}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3 max-w-[260px]">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full bg-amber-400 transition-all"
                          style={{ width: `${Math.min(100, filled).toFixed(1)}%` }}
                        />
                      </div>
                      <span className="text-[11.5px] text-slate-600 tabular-nums whitespace-nowrap">
                        {d.positionsHired} of {d.target ?? d.jobs}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OffersCard({
  tab, onTab, counts, list,
}: {
  tab: "pending" | "accepted" | "rejected" | "newHires";
  onTab: (t: "pending" | "accepted" | "rejected" | "newHires") => void;
  counts: { pending: number; accepted: number; rejected: number; newHires: number };
  list: OfferLite[];
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <header className="px-5 py-3 border-b border-slate-100">
        <div className="flex items-center gap-4 text-[12px] font-semibold">
          <TabBtn label="Pending Offers" count={counts.pending}  active={tab === "pending"}  onClick={() => onTab("pending")}  />
          <TabBtn label="Accepted Offers" count={counts.accepted} active={tab === "accepted"} onClick={() => onTab("accepted")} />
          <TabBtn label="Rejected Offers" count={counts.rejected} active={tab === "rejected"} onClick={() => onTab("rejected")} />
          <TabBtn label="New Hires"       count={counts.newHires} active={tab === "newHires"} onClick={() => onTab("newHires")} />
        </div>
      </header>
      <div className="px-5 py-4 max-h-[380px] overflow-y-auto">
        {list.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-[13px] text-slate-700">No data at the moment!</p>
            <p className="text-[11.5px] text-slate-500 mt-1">
              {tab === "pending"  && "List of offers pending for acceptance will be shown here"}
              {tab === "accepted" && "Accepted offers will be shown here"}
              {tab === "rejected" && "Rejected / declined offers will be shown here"}
              {tab === "newHires" && "Recently hired candidates will be shown here"}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {list.map((o) => (
              <li key={o.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5 hover:border-slate-200 transition-colors">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-slate-800 truncate">{o.candidateName || o.fullName || `#${o.id}`}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">{o.jobTitle || "—"}</p>
                </div>
                <div className="text-right shrink-0">
                  {tab === "pending"  && o.ctcAnnual && <p className="text-[11.5px] font-semibold text-slate-800">{fmtCtc(o.ctcAnnual)}</p>}
                  {tab === "pending"  && o.joiningDate && <p className="text-[10.5px] text-slate-400 mt-0.5">Joins {fmtDate(o.joiningDate)}</p>}
                  {tab === "accepted" && o.acceptedAt && <p className="text-[10.5px] text-emerald-600 font-medium">Accepted {fmtDate(o.acceptedAt)}</p>}
                  {tab === "rejected" && <p className="text-[10.5px] text-rose-600 font-medium">{fmtDate(o.declinedAt || o.revokedAt)}</p>}
                  {tab === "newHires" && <p className="text-[10.5px] text-emerald-600 font-medium">{fmtDate(o.updatedAt)}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TabBtn({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`pb-2 -mb-3 border-b-2 transition-colors ${
        active
          ? "border-[#008CFF] text-[#008CFF]"
          : "border-transparent text-slate-500 hover:text-slate-800"
      }`}
    >
      {label} ({count})
    </button>
  );
}
