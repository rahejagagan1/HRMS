"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import Link from "next/link";
import { Target, Plus, ChevronDown, TrendingUp, AlertTriangle, Clock, CheckCircle2, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import SelectField from "@/components/ui/SelectField";
import { useUrlTab } from "@/lib/hooks/useUrlTab";

const TOP_TABS = [
  { key: "home",        label: "HOME",              href: "/dashboard/hr/home"  },
  { key: "attendance",  label: "ATTENDANCE",        href: "/dashboard/hr/attendance" },
  { key: "leave",       label: "LEAVE",             href: "/dashboard/hr/leaves"     },
  { key: "performance", label: "PERFORMANCE",       href: "/dashboard/hr/goals"      },
  { key: "apps",        label: "APPS",              href: "/dashboard/hr/apps"       },
];

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  on_track:  { label: "On Track",  color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-500/10",  icon: TrendingUp   },
  at_risk:   { label: "At Risk",   color: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-50 dark:bg-amber-500/10",      icon: AlertTriangle },
  behind:    { label: "Behind",    color: "text-red-500 dark:text-red-400",         bg: "bg-red-50 dark:bg-red-500/10",          icon: Clock        },
  completed: { label: "Completed", color: "text-[#008CFF]",                         bg: "bg-[#008CFF]/10",                       icon: CheckCircle2 },
};

function ProgressRing({ pct, size = 48, stroke = 4 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const color = pct >= 90 ? "#10b981" : pct >= 50 ? "#008CFF" : pct >= 20 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-slate-100 dark:text-white/5" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ - (pct / 100) * circ} className="transition-all duration-500" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-slate-700 dark:text-white">{pct}%</span>
    </div>
  );
}

function GoalCard({ goal, onUpdate, onDelete }: { goal: any; onUpdate: (id: number, data: any) => void; onDelete: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const meta = STATUS_META[goal.status] || STATUS_META.on_track;
  const StatusIcon = meta.icon;

  return (
    <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden hover:shadow-sm transition-shadow">
      {/* Header */}
      <div className="px-5 py-4">
        <div className="flex items-start gap-3">
          <ProgressRing pct={goal.progress} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold text-slate-800 dark:text-white leading-snug">{goal.title}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {goal.cycle?.name} · {goal.owner?.name}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
                  <StatusIcon size={11} strokeWidth={2} />
                  {meta.label}
                </span>
                <div className="relative">
                  <button onClick={() => setShowMenu(v => !v)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-400">
                    <MoreHorizontal size={15} strokeWidth={1.75} />
                  </button>
                  {showMenu && (
                    <div className="absolute right-0 top-7 z-10 w-36 bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-lg shadow-lg py-1">
                      {Object.entries(STATUS_META).map(([k, v]) => (
                        <button key={k} onClick={() => { onUpdate(goal.id, { status: k }); setShowMenu(false); }}
                          className="w-full text-left px-3 py-1.5 text-[12px] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05]">
                          {v.label}
                        </button>
                      ))}
                      <div className="border-t border-slate-100 dark:border-white/[0.05] mt-1 pt-1">
                        <button onClick={() => { onDelete(goal.id); setShowMenu(false); }}
                          className="w-full text-left px-3 py-1.5 text-[12px] text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-1.5">
                          <Trash2 size={11} /> Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {goal.description && (
              <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1.5 line-clamp-2">{goal.description}</p>
            )}

            {/* Progress bar */}
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Progress</span>
                <span className="text-[11px] font-bold text-slate-700 dark:text-white">{goal.progress}%</span>
              </div>
              <div className="h-1.5 bg-slate-100 dark:bg-white/[0.06] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${goal.progress}%`, backgroundColor: goal.progress >= 90 ? "#10b981" : goal.progress >= 50 ? "#008CFF" : "#f59e0b" }} />
              </div>
            </div>
          </div>
        </div>

        {/* Key Results toggle */}
        {goal.keyResults?.length > 0 && (
          <button onClick={() => setExpanded(v => !v)}
            className="mt-3 flex items-center gap-1 text-[11px] text-slate-500 hover:text-[#008CFF] transition-colors">
            <ChevronDown size={13} strokeWidth={2} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
            {goal.keyResults.length} Key Result{goal.keyResults.length !== 1 ? "s" : ""}
          </button>
        )}
      </div>

      {/* Key Results */}
      {expanded && goal.keyResults?.length > 0 && (
        <div className="border-t border-slate-100 dark:border-white/[0.04] px-5 py-3 bg-slate-50/50 dark:bg-white/[0.015] space-y-3">
          {goal.keyResults.map((kr: any) => (
            <div key={kr.id} className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-[12px] font-medium text-slate-700 dark:text-slate-300">{kr.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1.5 bg-slate-200 dark:bg-white/[0.08] rounded-full overflow-hidden">
                    <div className="h-full bg-[#00BCD4] rounded-full" style={{ width: `${kr.progress}%` }} />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 shrink-0">
                    {kr.currentValue}/{kr.targetValue} {kr.unit}
                  </span>
                </div>
              </div>
              <input type="number" min="0" max={kr.targetValue}
                defaultValue={kr.currentValue}
                onBlur={(e) => onUpdate(goal.id, { keyResultId: kr.id, currentValue: parseFloat(e.target.value) })}
                className="w-16 h-7 text-center text-[12px] border border-slate-200 dark:border-white/[0.08] rounded bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewGoalModal({ cycles, onClose, onSave }: { cycles: any[]; onClose: () => void; onSave: (data: any) => void }) {
  const [form, setForm] = useState({ title: "", description: "", cycleId: cycles[0]?.id || "", visibility: "personal", status: "on_track" });
  const [krs, setKRs] = useState([{ title: "", targetValue: 100, unit: "%" }]);

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.08] rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
          <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">Add New Goal</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Objective / Goal Title *</label>
            <input value={form.title} onChange={e => set("title", e.target.value)}
              className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white bg-white dark:bg-[#0a1526] focus:outline-none focus:border-[#008CFF]"
              placeholder="e.g. Improve content quality score" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Goal Cycle</label>
              <SelectField
                value={String(form.cycleId ?? "")}
                onChange={(v) => set("cycleId", v)}
                options={cycles.map((c: any) => ({ value: String(c.id), label: c.name }))}
                className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white bg-white dark:bg-[#0a1526]"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Visibility</label>
              <SelectField
                value={form.visibility}
                onChange={(v) => set("visibility", v)}
                options={[
                  { value: "personal", label: "Personal" },
                  { value: "team",     label: "Team" },
                  { value: "company",  label: "Company" },
                ]}
                className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white bg-white dark:bg-[#0a1526]"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Description</label>
            <textarea value={form.description} onChange={e => set("description", e.target.value)} rows={2}
              className="mt-1 w-full px-3 py-2 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white bg-white dark:bg-[#0a1526] focus:outline-none focus:border-[#008CFF] resize-none"
              placeholder="What do you want to achieve?" />
          </div>

          {/* Key Results */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Key Results</label>
              <button onClick={() => setKRs(k => [...k, { title: "", targetValue: 100, unit: "%" }])}
                className="text-[11px] text-[#008CFF] hover:underline flex items-center gap-1">
                <Plus size={11} /> Add KR
              </button>
            </div>
            <div className="space-y-2">
              {krs.map((kr, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={kr.title} onChange={e => setKRs(k => k.map((r, j) => j === i ? { ...r, title: e.target.value } : r))}
                    className="flex-1 h-8 px-2.5 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-800 dark:text-white bg-white dark:bg-[#0a1526] focus:outline-none focus:border-[#008CFF]"
                    placeholder={`Key Result ${i + 1}`} />
                  <input type="number" value={kr.targetValue} onChange={e => setKRs(k => k.map((r, j) => j === i ? { ...r, targetValue: parseFloat(e.target.value) } : r))}
                    className="w-14 h-8 text-center border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-800 dark:text-white bg-white dark:bg-[#0a1526] focus:outline-none" />
                  <SelectField
                    value={kr.unit}
                    onChange={(v) => setKRs(k => k.map((r, j) => j === i ? { ...r, unit: v } : r))}
                    options={["%", "count", "₹", "bool"]}
                    className="w-16 h-8 px-2 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-800 dark:text-white bg-white dark:bg-[#0a1526]"
                  />
                  {krs.length > 1 && (
                    <button onClick={() => setKRs(k => k.filter((_, j) => j !== i))} className="text-red-400"><X size={13} /></button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-white/[0.06]">
          <button onClick={onClose} className="h-8 px-4 text-[13px] font-medium text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white">Cancel</button>
          <button onClick={() => onSave({ ...form, keyResults: krs.filter(k => k.title) })}
            disabled={!form.title || !form.cycleId}
            className="h-8 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            Create Goal
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GoalsPage() {
  const [view, setView] = useUrlTab<"my" | "team" | "company">("view", "my", ["my", "team", "company"] as const);
  const [showNew, setShowNew] = useState(false);
  const [activeCycleId, setActiveCycleId] = useState<string>("");

  const { data: cycles = [] } = useSWR("/api/hr/goals/cycles", fetcher);
  const activeCycle = activeCycleId ? cycles.find((c: any) => c.id === parseInt(activeCycleId)) : cycles[0];

  const { data: goals = [], isLoading } = useSWR(
    activeCycle ? `/api/hr/goals?view=${view}&cycleId=${activeCycle.id}` : null,
    fetcher
  );

  const statsCount = {
    total: goals.length,
    on_track: goals.filter((g: any) => g.status === "on_track").length,
    at_risk: goals.filter((g: any) => g.status === "at_risk").length,
    behind: goals.filter((g: any) => g.status === "behind").length,
    completed: goals.filter((g: any) => g.status === "completed").length,
  };

  const handleCreate = async (data: any) => {
    const res = await fetch("/api/hr/goals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!res.ok) { const d = await res.json(); return alert(d.error); }
    setShowNew(false);
    mutate((k: string) => typeof k === "string" && k.includes("/api/hr/goals"));
  };

  const handleUpdate = async (id: number, data: any) => {
    await fetch(`/api/hr/goals/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    mutate((k: string) => typeof k === "string" && k.includes("/api/hr/goals"));
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this goal?")) return;
    await fetch(`/api/hr/goals/${id}`, { method: "DELETE" });
    mutate((k: string) => typeof k === "string" && k.includes("/api/hr/goals"));
  };

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">

      {/* Top Module Tabs */}
      <div className="flex items-center bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-4">
        {TOP_TABS.map(t => (
          <Link key={t.key} href={t.href}
            className={`px-4 py-3 text-[11px] font-bold tracking-widest transition-colors border-b-2 whitespace-nowrap ${
              t.key === "performance"
                ? "border-[#008CFF] text-[#008CFF]"
                : "border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            }`}>{t.label}
          </Link>
        ))}
      </div>

      {/* Header bar */}
      <div className="bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#008CFF]/10 flex items-center justify-center">
              <Target size={18} strokeWidth={1.75} className="text-[#008CFF]" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-slate-800 dark:text-white">Goals & OKRs</h2>
              <p className="text-[11px] text-slate-500">Track objectives and key results</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Cycle selector */}
            <SelectField
              value={String(activeCycleId || activeCycle?.id || "")}
              onChange={(v) => setActiveCycleId(v)}
              options={cycles.map((c: any) => ({ value: String(c.id), label: c.name }))}
              className="h-8 w-[160px] px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-800 dark:text-white bg-white dark:bg-[#0a1526]"
            />
            <button onClick={() => setShowNew(true)}
              className="h-8 px-4 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[12px] font-semibold flex items-center gap-1.5 transition-colors">
              <Plus size={14} strokeWidth={2} /> Add Goal
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-6 mt-4">
          {[
            { label: "Total", value: statsCount.total, color: "text-slate-700 dark:text-white" },
            { label: "On Track", value: statsCount.on_track, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "At Risk",  value: statsCount.at_risk,  color: "text-amber-600 dark:text-amber-400"  },
            { label: "Behind",   value: statsCount.behind,   color: "text-red-500 dark:text-red-400"      },
            { label: "Completed",value: statsCount.completed,color: "text-[#008CFF]"                       },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2">
              <span className={`text-[20px] font-bold ${s.color}`}>{s.value}</span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Sub tabs */}
      <div className="bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6 flex gap-0">
        {(["my", "team", "company"] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-2.5 text-[12px] font-semibold border-b-2 transition-colors capitalize ${
              view === v ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white"
            }`}>
            {v === "my" ? "My Goals" : v === "team" ? "Team Goals" : "Company Goals"}
          </button>
        ))}
      </div>

      {/* Goals grid */}
      <div className="px-6 py-5">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3].map(i => (
              <div key={i} className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-5 h-32 animate-pulse" />
            ))}
          </div>
        ) : goals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-[#008CFF]/10 flex items-center justify-center mb-4">
              <Target size={28} strokeWidth={1.5} className="text-[#008CFF]" />
            </div>
            <p className="text-[14px] font-semibold text-slate-700 dark:text-white mb-1">No goals yet for this cycle</p>
            <p className="text-[12px] text-slate-500 mb-4">Set objectives and track key results to stay aligned</p>
            <button onClick={() => setShowNew(true)}
              className="h-9 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold transition-colors">
              + Create First Goal
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {goals.map((g: any) => (
              <GoalCard key={g.id} goal={g} onUpdate={handleUpdate} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      {showNew && <NewGoalModal cycles={cycles} onClose={() => setShowNew(false)} onSave={handleCreate} />}
    </div>
  );
}
