"use client";

// My Team → Probation Reviews. A reporting manager sees their reports whose
// probation is ending, leaves required feedback, picks one recommendation —
// Extend / Confirm full-time / End employment — and submits it to HR.

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { DateField } from "@/components/ui/date-field";
import { Clock, CheckCircle2, XCircle, UserCheck, CalendarClock, UserX, ArrowRight } from "lucide-react";

type Recommendation = "extend" | "confirm" | "end";
type Review = {
  id: number;
  recommendation: Recommendation;
  status: "pending" | "approved" | "rejected";
  extendMonths: number | null;
  proposedEndDate: string | null;
  feedback: string;
  hrNote: string | null;
};
type Row = {
  userId: number;
  name: string;
  employeeId: string | null;
  designation: string | null;
  probationEndDate: string | null;
  daysRemaining: number | null;
  review: Review | null;
};
type FormState = { feedback: string; months: number; customDate: string; rec: Recommendation | null };

const MONTHS = [1, 3, 6];
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
const initials = (name: string) => (name || "?").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const AV_PALETTE = ["#6366f1", "#0891b2", "#059669", "#d97706", "#db2777", "#7c3aed", "#2563eb"];

const REC_OPTS: { key: Recommendation; title: string; sub: string; Icon: typeof CalendarClock; color: string; selBg: string; selRing: string; btn: string }[] = [
  { key: "extend",  title: "Extend probation",   sub: "Give more time",   Icon: CalendarClock, color: "#008CFF", selBg: "bg-[#008CFF]/[0.06]", selRing: "ring-[#008CFF]", btn: "bg-[#008CFF] hover:bg-[#0070cc]" },
  { key: "confirm", title: "Hire full-time",     sub: "Confirm the hire", Icon: UserCheck,     color: "#059669", selBg: "bg-emerald-50",       selRing: "ring-emerald-500", btn: "bg-emerald-600 hover:bg-emerald-700" },
  { key: "end",     title: "End employment",     sub: "Part ways",        Icon: UserX,         color: "#e11d48", selBg: "bg-rose-50",          selRing: "ring-rose-400",   btn: "bg-rose-600 hover:bg-rose-700" },
];

export default function ProbationReviewsPage({ embedded = false }: { embedded?: boolean }) {
  const { data, mutate, isLoading } = useSWR<{ employees: Row[] }>("/api/hr/probation-reviews?scope=manager", fetcher, { refreshInterval: 60_000 });
  const employees = data?.employees ?? [];
  const [forms, setForms] = useState<Record<number, FormState>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const { data: histData } = useSWR<{ reviews: any[] }>(tab === "history" ? "/api/hr/probation-reviews?scope=manager-history" : null, fetcher);
  const history = histData?.reviews ?? [];

  const getForm = (id: number): FormState => forms[id] ?? { feedback: "", months: 3, customDate: "", rec: null };
  const setForm = (id: number, patch: Partial<FormState>) => setForms((s) => ({ ...s, [id]: { ...getForm(id), ...patch } }));

  const submit = async (row: Row) => {
    const f = getForm(row.userId);
    if (!f.feedback.trim() || !f.rec) return;
    if (f.rec === "end" && !confirm(`Recommend ending ${row.name}'s employment? HR will review and apply it.`)) return;

    const payload: any = { employeeUserId: row.userId, recommendation: f.rec, feedback: f.feedback.trim() };
    if (f.rec === "extend") {
      if (f.customDate) payload.proposedEndDate = f.customDate;
      else payload.extendMonths = f.months;
    }
    setBusy(row.userId);
    try {
      const res = await fetch("/api/hr/probation-reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || "Failed to submit"); }
      setForms((s) => { const n = { ...s }; delete n[row.userId]; return n; });
      mutate();
    } catch (e: any) {
      alert(e?.message || "Failed to submit");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={embedded ? "" : "p-6 max-w-3xl mx-auto"}>
      {!embedded && (
        <div className="mb-5">
          <h1 className="text-[18px] font-semibold text-slate-900">Probation Reviews</h1>
          <p className="text-[12.5px] text-slate-500 mt-0.5">Team members whose probation is ending. Add feedback, pick a recommendation, and submit it to HR for approval.</p>
        </div>
      )}

      <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-0.5 text-[12.5px] font-medium">
        <button type="button" onClick={() => setTab("pending")} className={`rounded-md px-3.5 py-1.5 transition-colors ${tab === "pending" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>Needs review</button>
        <button type="button" onClick={() => setTab("history")} className={`rounded-md px-3.5 py-1.5 transition-colors ${tab === "history" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>History</button>
      </div>

      {tab === "history" ? (
        history.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-[13px] text-slate-500">No past probation reviews yet.</div>
        ) : (
          <div className="space-y-3">
            {history.map((h: any) => (
              <div key={h.id} className="rounded-xl border border-slate-200 bg-white px-5 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/dashboard/hr/people/${h.employeeUserId}`} className="block truncate text-[13.5px] font-semibold text-slate-800 hover:text-[#008CFF] hover:underline">{h.employeeName}</Link>
                    <p className="text-[11.5px] text-slate-500">{h.designation || "—"}{h.employeeId ? ` · ${h.employeeId}` : ""}</p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ${h.status === "approved" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"}`}>
                    {h.status === "approved" ? "Approved" : "Sent back"}
                  </span>
                </div>
                <p className="mt-2 text-[12px] text-slate-600">
                  You recommended{" "}
                  <strong className="text-slate-700">
                    {h.recommendation === "extend" ? `extend${h.extendMonths ? ` ${h.extendMonths} mo` : ""}${h.proposedEndDate ? ` to ${fmtDate(h.proposedEndDate)}` : ""}` : h.recommendation === "confirm" ? "hire full-time" : "end employment"}
                  </strong>
                  {h.decidedAt ? <span className="text-slate-400"> · {fmtDate(h.decidedAt)}</span> : null}
                </p>
                <p className="mt-1.5 text-[12px] italic text-slate-500">“{h.feedback}”</p>
                {h.hrNote ? <p className="mt-1 text-[11.5px] text-slate-500">HR note: {h.hrNote}</p> : null}
              </div>
            ))}
          </div>
        )
      ) : isLoading ? (
        <p className="text-[13px] text-slate-400">Loading…</p>
      ) : employees.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
          <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-400" />
          <p className="mt-3 text-[13.5px] font-medium text-slate-700">All caught up</p>
          <p className="mt-0.5 text-[12.5px] text-slate-500">No probation reviews need your attention right now.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {employees.map((row) => {
            const f = getForm(row.userId);
            const r = row.review;
            const showForm = !r || r.status !== "pending";
            const overdue = (row.daysRemaining ?? 0) < 0;
            const soon = !overdue && (row.daysRemaining ?? 99) <= 7;
            const pillCls = overdue ? "bg-rose-50 text-rose-700 ring-rose-200" : soon ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-slate-100 text-slate-600 ring-slate-200";
            const canSubmit = !!f.feedback.trim() && !!f.rec;
            const submitBtn = f.rec ? REC_OPTS.find((o) => o.key === f.rec)!.btn : "bg-slate-300";
            return (
              <div key={row.userId} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                {/* Header */}
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/40 px-5 py-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: AV_PALETTE[(row.name.charCodeAt(0) || 0) % AV_PALETTE.length] }}>
                      {initials(row.name)}
                    </span>
                    <div className="min-w-0">
                      <Link href={`/dashboard/hr/people/${row.userId}`} className="block truncate text-[14.5px] font-semibold text-slate-900 hover:text-[#008CFF] hover:underline">{row.name}</Link>
                      <p className="truncate text-[12px] text-slate-500">{row.designation || "—"}{row.employeeId ? ` · ${row.employeeId}` : ""}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Probation ends</p>
                    <p className="text-[13px] font-semibold text-slate-800">{fmtDate(row.probationEndDate)}</p>
                    <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ${pillCls}`}>
                      {overdue ? `${Math.abs(row.daysRemaining ?? 0)} days overdue` : row.daysRemaining === 0 ? "Ends today" : `${row.daysRemaining} days left`}
                    </span>
                  </div>
                </div>

                {/* Pending — already sent to HR */}
                {!showForm && r ? (
                  <div className="px-5 py-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200"><Clock size={12} /> Awaiting HR approval</span>
                      <span className="text-[12px] text-slate-500">
                        You recommended{" "}
                        <strong className="text-slate-700">
                          {r.recommendation === "extend" ? `extend${r.extendMonths ? ` ${r.extendMonths} mo` : ""}${r.proposedEndDate ? ` to ${fmtDate(r.proposedEndDate)}` : ""}` : r.recommendation === "confirm" ? "hire full-time" : "end employment"}
                        </strong>
                      </span>
                    </div>
                    <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] italic text-slate-600 ring-1 ring-slate-100">“{r.feedback}”</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-5 px-5 py-5">
                      {r?.status === "rejected" && (
                        <div className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700 ring-1 ring-rose-200">
                          <XCircle size={14} className="mt-0.5 shrink-0" />
                          <span>HR sent your last recommendation back{r.hrNote ? `: ${r.hrNote}` : "."} Please revise and resubmit.</span>
                        </div>
                      )}

                      {/* Feedback */}
                      <div>
                        <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Feedback <span className="text-rose-500">*</span></label>
                        <textarea
                          value={f.feedback}
                          onChange={(e) => setForm(row.userId, { feedback: e.target.value })}
                          rows={3}
                          placeholder="How did they perform during probation? This goes to HR with your recommendation."
                          className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-[13px] text-slate-800 placeholder-slate-400 transition-colors focus:border-[#008CFF] focus:outline-none focus:ring-2 focus:ring-[#008CFF]/15"
                        />
                      </div>

                      {/* Recommendation tiles */}
                      <div>
                        <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Recommendation <span className="text-rose-500">*</span></label>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          {REC_OPTS.map((o) => {
                            const sel = f.rec === o.key;
                            return (
                              <button
                                key={o.key}
                                type="button"
                                onClick={() => setForm(row.userId, { rec: o.key })}
                                className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all ring-inset ${sel ? `${o.selBg} ring-2 ${o.selRing}` : "ring-1 ring-slate-200 hover:ring-slate-300"}`}
                              >
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${o.color}14`, color: o.color }}>
                                  <o.Icon size={16} />
                                </span>
                                <span className="min-w-0">
                                  <span className="block text-[12.5px] font-semibold text-slate-800">{o.title}</span>
                                  <span className="block text-[11px] text-slate-500">{o.sub}</span>
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Extend-by — only when Extend is chosen */}
                        {f.rec === "extend" && (
                          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-100">
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Extend by</p>
                            <div className="flex flex-wrap items-center gap-2">
                              {MONTHS.map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => setForm(row.userId, { months: m, customDate: "" })}
                                  className={`h-8 rounded-lg px-3 text-[12px] font-semibold transition-colors ${!f.customDate && f.months === m ? "bg-[#008CFF] text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"}`}
                                >
                                  +{m} {m === 1 ? "month" : "months"}
                                </button>
                              ))}
                              <span className="text-[11px] text-slate-400">or</span>
                              <div className="w-[150px]"><DateField value={f.customDate} onChange={(v) => setForm(row.userId, { customDate: v })} /></div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
                      <span className="text-[11.5px] text-slate-400">Goes to HR for approval</span>
                      <button
                        type="button"
                        disabled={!canSubmit || busy === row.userId}
                        onClick={() => submit(row)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-[12.5px] font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300 ${canSubmit ? submitBtn : "bg-slate-300"}`}
                      >
                        {busy === row.userId ? "Submitting…" : <>Submit to HR <ArrowRight size={14} /></>}
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
