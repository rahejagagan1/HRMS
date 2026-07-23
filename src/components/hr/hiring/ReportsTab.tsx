"use client";

// Reports tab — hiring funnel + time-to-hire + source breakdown.
// Pulls from /api/hr/hiring/reports which aggregates server-side.

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { DateField } from "@/components/ui/date-field";
import { TrendingUp, Users, Briefcase, Clock } from "lucide-react";

const STAGE_COLORS: Record<string, string> = {
  slate: "#94a3b8", blue: "#3b82f6", cyan: "#06b6d4", violet: "#8b5cf6",
  amber: "#f59e0b", pink: "#ec4899", emerald: "#10b981", rose: "#f43f5e",
};

export default function ReportsTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to)   qs.set("to", to);
  const { data, isLoading } = useSWR<any>(`/api/hr/hiring/reports?${qs.toString()}`, fetcher);

  const funnel = data?.funnel ?? [];
  const tt = data?.timeToHire ?? { avgDays: null, p50: null, p90: null, n: 0 };
  const sources = data?.sources ?? [];
  const headline = data?.headline ?? { openJobs: 0, totalJobs: 0, candidatesAdded: 0 };

  const maxFunnel = Math.max(1, ...funnel.map((f: any) => f.count));

  return (
    <div className="space-y-5">
      {/* Date filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[11.5px] text-slate-500">Date range:</span>
        <DateField value={from} onChange={setFrom} placeholder="From" />
        <span className="text-slate-400">to</span>
        <DateField value={to} onChange={setTo} placeholder="To" />
        {(from || to) && (
          <button onClick={() => { setFrom(""); setTo(""); }} className="text-[11.5px] text-slate-500 hover:text-[#008CFF]">Clear</button>
        )}
      </div>

      {/* Headline cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <HeadlineCard icon={<Briefcase size={16} />} label="Open jobs" value={headline.openJobs} tint="#008CFF" />
        <HeadlineCard icon={<Users    size={16} />} label="Candidates added" value={headline.candidatesAdded} tint="#10b981" />
        <HeadlineCard icon={<Clock    size={16} />} label="Avg time to hire" value={tt.avgDays != null ? `${tt.avgDays} d` : "—"} tint="#8b5cf6" />
        <HeadlineCard icon={<TrendingUp size={16} />} label="Total hires" value={tt.n ?? 0} tint="#f59e0b" />
      </div>

      {/* Hiring funnel */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-[14px] font-semibold text-slate-800 mb-1">Hiring funnel</h3>
        <p className="text-[11.5px] text-slate-500 mb-4">Candidate count per pipeline stage.</p>
        {isLoading ? (
          <p className="text-[12px] text-slate-400">Loading…</p>
        ) : funnel.length === 0 ? (
          <p className="text-[12px] text-slate-400 text-center py-8">No data yet.</p>
        ) : (
          <div className="space-y-2">
            {funnel.map((f: any) => (
              <div key={f.stageKey} className="flex items-center gap-3">
                <span className="text-[11.5px] text-slate-700 w-32 shrink-0">{f.stageLabel}</span>
                <div className="flex-1 h-6 rounded bg-slate-100 relative overflow-hidden">
                  <div
                    className="h-full rounded transition-all"
                    style={{
                      width: `${(f.count / maxFunnel) * 100}%`,
                      background: STAGE_COLORS[f.color] || "#94a3b8",
                    }}
                  />
                </div>
                <span className="text-[11.5px] font-semibold text-slate-700 w-10 text-right">{f.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Time to hire detail */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-[14px] font-semibold text-slate-800 mb-1">Time to hire</h3>
        <p className="text-[11.5px] text-slate-500 mb-4">Days from application to hired stage.</p>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Average" value={tt.avgDays != null ? `${tt.avgDays} d` : "—"} />
          <Stat label="Median (p50)" value={tt.p50 != null ? `${tt.p50} d` : "—"} />
          <Stat label="90th percentile" value={tt.p90 != null ? `${tt.p90} d` : "—"} />
        </div>
        <p className="mt-3 text-[10.5px] text-slate-400">Based on {tt.n} hire{tt.n === 1 ? "" : "s"} in the selected window.</p>
      </div>

      {/* Source breakdown */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-[14px] font-semibold text-slate-800 mb-1">Source breakdown</h3>
        <p className="text-[11.5px] text-slate-500 mb-4">Where applicants came from.</p>
        {sources.length === 0 ? (
          <p className="text-[12px] text-slate-400">No source data yet.</p>
        ) : (
          <div className="space-y-2">
            {sources.map((s: any) => (
              <div key={s.source} className="flex items-center justify-between text-[12.5px]">
                <span className="text-slate-700">{s.source}</span>
                <span className="font-semibold text-slate-800">{s.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HeadlineCard({ icon, label, value, tint }: { icon: React.ReactNode; label: string; value: any; tint: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <span className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${tint}18`, color: tint }}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-slate-500 leading-none">{label}</p>
          <p className="text-[22px] font-extrabold text-slate-800 mt-1 leading-none tabular-nums">{value}</p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-3">
      <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{label}</p>
      <p className="text-[18px] font-bold text-slate-800 mt-1">{value}</p>
    </div>
  );
}
