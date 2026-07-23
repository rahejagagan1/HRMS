"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ClipboardList, Play, Save, ExternalLink, RefreshCw } from "lucide-react";
import {
  FIELD_CATALOG,
  PHASE_ORDER,
  PHASE_LABELS,
  type FieldPhase,
  type StatusPlan,
} from "@/lib/missing-fields/catalog";
import { canUseMissingFields } from "@/lib/missing-fields/access";

type Capsule = {
  id: number;
  name: string;
  caseCount: number;
  statuses: Array<{ status: string; count: number }>;
  plan: StatusPlan; // status -> required field keys
};
type RunResult = {
  caseId: number; name: string; clickupUrl: string | null; status: string;
  capsule: { id: number; name: string }; assignee: string | null;
  missing: Array<{ key: string; label: string; phase?: string }>;
};
type RunData = {
  results: RunResult[];
  summary: { scanned: number; flagged: number; noRule: number; excludedTerminal?: number };
  note?: string;
  runId?: number | null;
  runAt?: string | null;
};
type HistoryRun = { id: number; runAt: string; runByName: string | null; scanned: number; flagged: number };

const FIELDS_BY_PHASE: Record<FieldPhase, typeof FIELD_CATALOG> = PHASE_ORDER.reduce((acc, p) => {
  acc[p] = FIELD_CATALOG.filter((f) => f.phase === p);
  return acc;
}, {} as Record<FieldPhase, typeof FIELD_CATALOG>);

// plan (status -> string[]) <-> editable draft (status -> Set<string>)
const planToDraft = (plan: StatusPlan): Record<string, Set<string>> =>
  Object.fromEntries(Object.entries(plan).map(([s, ks]) => [s, new Set(ks)]));
const draftToPlan = (draft: Record<string, Set<string>>): StatusPlan => {
  const out: StatusPlan = {};
  for (const [s, set] of Object.entries(draft)) if (set.size) out[s] = [...set].sort();
  return out;
};
const canonical = (plan: StatusPlan) =>
  JSON.stringify(Object.fromEntries(Object.entries(plan).map(([s, ks]) => [s, [...ks].sort()]).sort((a, b) => a[0] < b[0] ? -1 : 1)));

export default function MissingFieldsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const canUse = canUseMissingFields(session?.user as any);

  useEffect(() => {
    if (status === "loading") return;
    if (!canUse) router.replace("/dashboard");
  }, [status, canUse, router]);

  const [tab, setTab] = useState<"plans" | "run">("plans");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [capsules, setCapsules] = useState<Capsule[]>([]);
  const [selectedCapsuleId, setSelectedCapsuleId] = useState<number | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);

  // ── load config ──
  useEffect(() => {
    if (!canUse) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/missing-fields/config")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => {
        if (cancelled) return;
        setCapsules(d.capsules || []);
        setSelectedCapsuleId((d.capsules?.[0]?.id as number) ?? null);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setLoadError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [canUse]);

  const selectedCapsule = capsules.find((c) => c.id === selectedCapsuleId) || null;

  // ── Plans state (draft = the selected capsule's status->fields, editable) ──
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [savingPlan, setSavingPlan] = useState(false);
  const skipAutoSave = useRef(true); // don't auto-save when the draft is (re)loaded

  useEffect(() => {
    skipAutoSave.current = true;
    setDraft(planToDraft(selectedCapsule?.plan ?? {}));
    setSelectedStatus(selectedCapsule?.statuses[0]?.status ?? null);
  }, [selectedCapsuleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const planDirty = useMemo(
    () => selectedCapsule ? canonical(draftToPlan(draft)) !== canonical(selectedCapsule.plan) : false,
    [draft, selectedCapsule],
  );

  // Statuses in ClickUp flow order. Requirements cascade FORWARD: a field
  // required at one status is auto-required at every later status. The earlier
  // status "owns" it; later statuses show it as inherited + locked.
  const flow = useMemo(() => selectedCapsule?.statuses.map((s) => s.status) ?? [], [selectedCapsule]);
  const statusSet = (s: string) => draft[s] ?? new Set<string>();
  // Fields required at a status BEFORE the selected one (inherited → locked here).
  const inheritedSet = useMemo(() => {
    const out = new Set<string>();
    const i = selectedStatus ? flow.indexOf(selectedStatus) : -1;
    for (let j = 0; j < i; j++) for (const k of draft[flow[j]] ?? []) out.add(k);
    return out;
  }, [draft, flow, selectedStatus]);

  // Toggling a field applies it to this status AND every later status in the flow.
  const toggleField = (s: string, key: string) =>
    setDraft((prev) => {
      const i = flow.indexOf(s);
      const targets = i >= 0 ? flow.slice(i) : [s];
      const turningOn = !(prev[s]?.has(key));
      const n = { ...prev };
      for (const t of targets) {
        const set = new Set(n[t] ?? []);
        turningOn ? set.add(key) : set.delete(key);
        n[t] = set;
      }
      return n;
    });
  const togglePhase = (s: string, p: FieldPhase, on: boolean) =>
    setDraft((prev) => {
      const i = flow.indexOf(s);
      const targets = i >= 0 ? flow.slice(i) : [s];
      const inh = new Set<string>();
      for (let j = 0; j < i; j++) for (const k of prev[flow[j]] ?? []) inh.add(k);
      const n = { ...prev };
      for (const f of FIELDS_BY_PHASE[p]) {
        if (inh.has(f.key)) continue; // inherited from an earlier status — locked here
        for (const t of targets) {
          const set = new Set(n[t] ?? []);
          on ? set.add(f.key) : set.delete(f.key);
          n[t] = set;
        }
      }
      return n;
    });

  async function savePlan() {
    if (!selectedCapsuleId) return;
    setSavingPlan(true);
    try {
      // Only persist active (non-terminal) statuses — flow excludes done/closed.
      const flowSet = new Set(flow);
      const plan = Object.fromEntries(Object.entries(draftToPlan(draft)).filter(([s]) => flowSet.has(s)));
      const res = await fetch("/api/missing-fields/plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productionListId: selectedCapsuleId, plan }),
      });
      if (!res.ok) throw new Error();
      setCapsules((prev) => prev.map((c) => (c.id === selectedCapsuleId ? { ...c, plan } : c)));
    } catch { alert("Couldn't save the plan. Try again."); }
    finally { setSavingPlan(false); }
  }

  // Copy another capsule's plan into the current one (only statuses that exist
  // in this capsule's flow are copied; the rest are skipped). Auto-save persists it.
  function copyFrom(sourceId: number) {
    const src = capsules.find((c) => c.id === sourceId);
    if (!src || !selectedCapsule) return;
    if (!confirm(`Copy ${src.name}'s plan into ${selectedCapsule.name}? This replaces ${selectedCapsule.name}'s current plan.`)) return;
    // Walk THIS capsule's flow in order, carrying requirements forward. A status
    // the source doesn't have (different name) still inherits the running set, so
    // the copy never leaves a gap even when two capsules' status names differ.
    const running = new Set<string>();
    const next: Record<string, Set<string>> = {};
    for (const st of flow) {
      const fields = src.plan[st];
      if (Array.isArray(fields)) for (const k of fields) running.add(k);
      if (running.size) next[st] = new Set(running);
    }
    setDraft(next);
  }

  // Auto-save: persist the plan shortly after any change — no manual save needed.
  useEffect(() => {
    if (skipAutoSave.current) { skipAutoSave.current = false; return; }
    if (selectedCapsuleId == null) return;
    const t = setTimeout(() => { savePlan(); }, 800);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Run state + history ──
  const [running, setRunning] = useState(false);
  const [runData, setRunData] = useState<RunData | null>(null);
  const [runFilter, setRunFilter] = useState<number | "all">("all");
  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  async function loadHistory() {
    try {
      const res = await fetch("/api/missing-fields/runs");
      if (res.ok) setHistory(((await res.json()).runs as HistoryRun[]) || []);
    } catch { /* ignore */ }
  }
  // Load history when the Run tab is open.
  useEffect(() => { if (canUse && tab === "run") loadHistory(); }, [canUse, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runCheck() {
    setRunning(true);
    try {
      const res = await fetch("/api/missing-fields/run");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRunData(data);
      setSelectedRunId(data.runId ?? null);
      setRunFilter("all");
      loadHistory();
    } catch { alert("Run failed. Try again."); }
    finally { setRunning(false); }
  }

  // Load a past run's stored results into the table.
  async function viewRun(id: number) {
    try {
      const res = await fetch(`/api/missing-fields/runs?id=${id}`);
      if (!res.ok) throw new Error();
      const { run } = await res.json();
      if (run) {
        setRunData({ results: run.results || [], summary: run.summary || { scanned: 0, flagged: 0, noRule: 0 }, runAt: run.runAt });
        setSelectedRunId(id);
        setRunFilter("all");
      }
    } catch { alert("Couldn't load that run."); }
  }

  const fmtRunAt = (iso: string) => {
    try { return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }); }
    catch { return iso; }
  };

  const filteredResults = useMemo(() => {
    if (!runData) return [];
    return runFilter === "all" ? runData.results : runData.results.filter((r) => r.capsule.id === runFilter);
  }, [runData, runFilter]);

  if (status === "loading" || !canUse) return null;

  const configuredStatuses = (c: Capsule) => Object.keys(c.plan).length;

  return (
    <div className="min-h-screen bg-[#f4f7fb]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
          {/* Header */}
          <header className="flex items-center justify-between gap-4 border-b border-slate-100 bg-gradient-to-b from-[#fbfdff] to-white px-6 py-5">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e8f1fc] text-[#0f4e93] ring-1 ring-inset ring-[#cfdef5]">
                <ClipboardList className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-[18px] font-semibold leading-tight text-slate-800">Missing Fields</h1>
                <p className="mt-0.5 text-[12.5px] text-slate-500">
                  Per capsule, set which fields must be filled at each status — then flag cases that are missing them.
                </p>
              </div>
            </div>
            <span className="hidden md:inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200">
              Developers only
            </span>
          </header>

          {/* Tabs */}
          <div className="flex items-center gap-1 border-b border-slate-100 px-4">
            {([["plans", "Plans"], ["run", "Run check"]] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`relative px-4 py-3 text-[12.5px] font-semibold tracking-wide whitespace-nowrap transition-colors border-b-2 ${
                  tab === key ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="py-20 text-center"><div className="inline-block w-7 h-7 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" /></div>
          ) : loadError ? (
            <p className="py-20 text-center text-[13px] text-rose-500">Couldn't load — are you signed in as a developer?</p>
          ) : capsules.length === 0 ? (
            <p className="py-20 text-center text-[13px] text-slate-400">No capsules configured.</p>
          ) : (
            <div className="p-5 sm:p-6">
              {/* ════ PLANS ════ */}
              {tab === "plans" && (
                <div>
                  {/* Capsule pills */}
                  <div className="flex flex-wrap items-center gap-2 mb-5">
                    {capsules.map((c) => {
                      const active = c.id === selectedCapsuleId;
                      const n = configuredStatuses(c);
                      return (
                        <button
                          key={c.id}
                          onClick={() => setSelectedCapsuleId(c.id)}
                          className={`inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border text-[12.5px] font-semibold transition-colors ${
                            active ? "border-[#008CFF] bg-[#008CFF]/[0.06] text-[#0f4e93]" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {c.name}
                          <span className={`inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-full text-[10.5px] font-bold ${n ? "bg-[#008CFF] text-white" : "bg-slate-200 text-slate-500"}`}>
                            {n}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="text-[13px] text-slate-700">
                      Plan for <span className="font-semibold">{selectedCapsule?.name}</span>
                      <span className="text-slate-400 text-[12px]"> · {Object.values(draft).filter((s) => s.size).length} status{Object.values(draft).filter((s) => s.size).length === 1 ? "" : "es"} configured · {selectedCapsule?.caseCount ?? 0} cases</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {capsules.length > 1 && (
                        <select
                          value=""
                          onChange={(e) => { const id = Number(e.target.value); if (id) copyFrom(id); e.currentTarget.value = ""; }}
                          className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] text-slate-600 focus:outline-none focus:border-[#008CFF]/50"
                          title="Copy another capsule's plan into this one"
                        >
                          <option value="">Copy from…</option>
                          {capsules.filter((c) => c.id !== selectedCapsuleId).map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      )}
                      <span className="inline-flex items-center gap-1.5 h-9 px-1 text-[12px] font-medium text-slate-500">
                        {(savingPlan || planDirty)
                          ? <><RefreshCw className="h-3.5 w-3.5 animate-spin text-[#008CFF]" /> Saving…</>
                          : <><Save className="h-3.5 w-3.5 text-emerald-500" /> Saved automatically</>}
                      </span>
                    </div>
                  </div>

                  {/* status list (left) + fields for selected status (right) */}
                  <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                      <div className="bg-slate-50 px-3 py-2 border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-500">Flow / status</div>
                      <div className="max-h-[56vh] overflow-auto p-1.5">
                        {(selectedCapsule?.statuses ?? []).length === 0 ? (
                          <p className="px-2 py-3 text-[12px] text-slate-400">No cases in this capsule.</p>
                        ) : selectedCapsule!.statuses.map((s) => {
                          const sel = s.status === selectedStatus;
                          const reqN = statusSet(s.status).size;
                          return (
                            <button
                              key={s.status}
                              onClick={() => setSelectedStatus(s.status)}
                              className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${sel ? "bg-[#008CFF]/[0.08] text-[#0f4e93]" : "hover:bg-slate-50 text-slate-700"}`}
                            >
                              <span className="min-w-0">
                                <span className="block text-[12.5px] font-medium truncate" title={s.status}>{s.status}</span>
                                <span className="block text-[10.5px] text-slate-400">{s.count} case{s.count === 1 ? "" : "s"}</span>
                              </span>
                              <span className={`inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-full text-[10px] font-bold shrink-0 ${reqN ? "bg-[#008CFF] text-white" : "bg-slate-200 text-slate-400"}`}>{reqN}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      {selectedStatus == null ? (
                        <p className="py-12 text-center text-[13px] text-slate-400">Pick a status on the left to set its required fields.</p>
                      ) : (
                        <>
                          <p className="mb-3 text-[12.5px] text-slate-600">
                            When a case is <span className="font-semibold text-slate-800">{selectedStatus}</span>, these fields must be filled:
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                            {PHASE_ORDER.map((p) => {
                              const fields = FIELDS_BY_PHASE[p];
                              const set = statusSet(selectedStatus);
                              const allOn = fields.every((f) => set.has(f.key));
                              return (
                                <div key={p} className="rounded-xl border border-slate-200 overflow-hidden">
                                  <div className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2 border-b border-slate-100">
                                    <span className="text-[11.5px] font-bold uppercase tracking-wider text-slate-500">{PHASE_LABELS[p]}</span>
                                    <button onClick={() => togglePhase(selectedStatus, p, !allOn)} className="text-[11px] font-semibold text-[#008CFF] hover:underline">{allOn ? "Clear" : "All"}</button>
                                  </div>
                                  <div className="p-2">
                                    {fields.map((f) => {
                                      const inh = inheritedSet.has(f.key);
                                      return (
                                      <label key={f.key} title={inh ? "Required from an earlier status — change it there" : undefined}
                                        className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${inh ? "opacity-80" : "hover:bg-slate-50 cursor-pointer"}`}>
                                        <input type="checkbox" checked={set.has(f.key)} disabled={inh} onChange={() => toggleField(selectedStatus, f.key)} className="w-3.5 h-3.5 rounded border-slate-300 accent-[#008CFF] shrink-0 disabled:cursor-not-allowed" />
                                        <span className="w-7 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-slate-400">{f.code}</span>
                                        <span className={`text-[12.5px] truncate ${inh ? "text-slate-400" : "text-slate-700"}`}>{f.label}</span>
                                        {inh ? <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-300" title="inherited from an earlier status">↑ inh</span>
                                          : f.computed ? <span className="ml-auto shrink-0 text-[9.5px] font-bold uppercase tracking-wide text-slate-400 bg-slate-100 rounded px-1 py-0.5">auto</span> : null}
                                      </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="mt-3 text-[11.5px] text-slate-400">
                    Requirements cascade forward: a field you tick here is auto-required at every later status (shown <span className="font-semibold">↑ inh</span> + locked there — change it at the status it starts). A status with nothing required is skipped at run time, so rejected / published / off-flow cases drop out automatically.
                  </p>
                </div>
              )}

              {/* ════ RUN ════ */}
              {tab === "run" && (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="text-[12.5px] text-slate-500">
                      Scans the {capsules.length} capsule{capsules.length === 1 ? "" : "s"} and flags cases missing the fields their status requires.
                    </div>
                    <button
                      onClick={runCheck}
                      disabled={running}
                      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#008CFF] text-white text-[12.5px] font-semibold hover:bg-[#0079db] disabled:opacity-50"
                    >
                      {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {running ? "Running..." : runData ? "Re-run" : "Run check"}
                    </button>
                  </div>

                  {history.length > 0 && (
                    <div className="mb-4 rounded-xl border border-slate-200 overflow-hidden">
                      <div className="bg-slate-50 px-3 py-2 border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-500">Run history</div>
                      <div className="max-h-[210px] overflow-auto divide-y divide-slate-100">
                        {history.map((h) => (
                          <button
                            key={h.id}
                            onClick={() => viewRun(h.id)}
                            className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${selectedRunId === h.id ? "bg-[#008CFF]/[0.06]" : "hover:bg-slate-50"}`}
                          >
                            <span className="flex items-baseline gap-2 min-w-0">
                              <span className="text-[12.5px] text-slate-700 font-medium whitespace-nowrap">{fmtRunAt(h.runAt)}</span>
                              {h.runByName ? <span className="text-[11px] text-slate-400 truncate">by {h.runByName}</span> : null}
                            </span>
                            <span className="flex items-center gap-2 shrink-0 text-[11.5px]">
                              <span className="font-semibold text-rose-600">{h.flagged} flagged</span>
                              <span className="text-slate-400">/ {h.scanned} scanned</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {runData && (
                    <>
                      {runData.runAt && <p className="mb-2 text-[12px] text-slate-500">Showing run from <span className="font-semibold text-slate-700">{fmtRunAt(runData.runAt)}</span></p>}
                      <div className="flex flex-wrap gap-2 mb-4 text-[12px]">
                        <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-slate-600"><b className="text-slate-800">{runData.summary.scanned}</b> scanned</span>
                        <span className="rounded-lg bg-rose-50 px-3 py-1.5 text-rose-700"><b>{runData.summary.flagged}</b> flagged</span>
                        {runData.summary.noRule > 0 && <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-slate-500"><b>{runData.summary.noRule}</b> skipped (status has no rule)</span>}
                        {!!runData.summary.excludedTerminal && <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-slate-500"><b>{runData.summary.excludedTerminal}</b> excluded (published / rejected / done)</span>}
                      </div>
                      {runData.note && <p className="mb-4 text-[12.5px] text-amber-600">{runData.note}</p>}

                      {runData.results.length > 0 && (
                        <div className="mb-3">
                          <select
                            value={runFilter === "all" ? "all" : String(runFilter)}
                            onChange={(e) => setRunFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
                            className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] text-slate-700 focus:outline-none focus:border-[#008CFF]/50"
                          >
                            <option value="all">All capsules ({runData.results.length})</option>
                            {[...new Map(runData.results.map((r) => [r.capsule.id, r.capsule.name])).entries()].map(([id, name]) => (
                              <option key={id} value={id}>{name} ({runData.results.filter((r) => r.capsule.id === id).length})</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {runData.results.length === 0 ? (
                        <p className="py-12 text-center text-[13px] text-slate-400">
                          {runData.summary.scanned === 0 ? "Nothing to scan." : "No missing fields for any case whose status has a rule."}
                        </p>
                      ) : (
                        <div className="overflow-auto rounded-xl border border-slate-200 max-h-[60vh]">
                          <table className="w-full min-w-[760px]">
                            <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-sm">
                              <tr className="border-b border-slate-200">
                                {["CASE", "CAPSULE", "STATUS", "ASSIGNEE", "MISSING FIELDS"].map((h) => (
                                  <th key={h} className="px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {filteredResults.map((r) => (
                                <tr key={r.caseId} className="border-b border-slate-100 hover:bg-slate-50/60">
                                  <td className="px-3 py-2 max-w-[280px]">
                                    {r.clickupUrl ? (
                                      <a href={r.clickupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-800 hover:text-[#008CFF] max-w-full">
                                        <span className="truncate">{r.name}</span><ExternalLink className="h-3 w-3 shrink-0 text-slate-400" />
                                      </a>
                                    ) : <span className="text-[13px] text-slate-800 truncate block">{r.name}</span>}
                                  </td>
                                  <td className="px-3 py-2 text-[12px] text-slate-600 whitespace-nowrap">{r.capsule.name}</td>
                                  <td className="px-3 py-2 text-[12px] text-slate-600 whitespace-nowrap">{r.status}</td>
                                  <td className="px-3 py-2 text-[12px] text-slate-600 whitespace-nowrap">{r.assignee || "—"}</td>
                                  <td className="px-3 py-2">
                                    <span className="flex flex-wrap gap-1">
                                      {r.missing.map((m) => (
                                        <span key={m.key} className="inline-flex items-center rounded-md bg-rose-50 text-rose-700 text-[11px] font-medium px-1.5 py-0.5 ring-1 ring-inset ring-rose-100">{m.label}</span>
                                      ))}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
