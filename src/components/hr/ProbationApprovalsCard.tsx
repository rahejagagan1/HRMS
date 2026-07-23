"use client";

// HR-facing probation surface.
//  • Home dashboard (standalone=false): a compact card of PENDING recommendations
//    (Approve / Send back). Hidden when nothing is pending.
//  • Admin "Probation Reviews" tab (standalone=true): Pending + History tabs.
//    History lists decided reviews and lets HR REVERT a confirmed/ended
//    employee back to probation (un-confirm / reactivate + a new end date).

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { DateField } from "@/components/ui/date-field";
import { CalendarClock, UserCheck, UserX, Check, X, RotateCcw } from "lucide-react";

type HrReview = {
  id: number;
  employeeUserId: number;
  employeeName: string;
  profilePictureUrl: string | null;
  employeeId: string | null;
  designation: string | null;
  managerName: string | null;
  recommendation: "extend" | "confirm" | "end";
  extendMonths: number | null;
  proposedEndDate: string | null;
  probationEndDate: string | null;
  daysRemaining: number | null;
  feedback: string;
};
type HrHistory = HrReview & { status: "approved" | "rejected"; decidedAt: string | null; deciderName: string | null; isConfirmed: boolean; employeeActive: boolean; hrNote: string | null };
type OnProb = {
  userId: number;
  name: string;
  designation: string | null;
  businessUnit: string;
  managerName: string | null;
  joiningDate: string | null;
  probationEndDate: string | null;
  daysRemaining: number | null;
  lastReviewStatus: "pending" | "approved" | "rejected" | null;
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

function recLabel(r: { recommendation: string; extendMonths: number | null; proposedEndDate: string | null }) {
  if (r.recommendation === "extend") return `Extend ${r.proposedEndDate ? `→ ${fmtDate(r.proposedEndDate)}` : r.extendMonths ? `+${r.extendMonths} mo` : ""}`.trim();
  if (r.recommendation === "confirm") return "Hire full-time";
  return "End employment";
}
function recBadge(r: HrReview) {
  if (r.recommendation === "extend") return { cls: "bg-blue-50 text-blue-700 ring-blue-200", Icon: CalendarClock };
  if (r.recommendation === "confirm") return { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", Icon: UserCheck };
  return { cls: "bg-rose-50 text-rose-700 ring-rose-200", Icon: UserX };
}

const AV_PALETTE = ["#6366f1", "#0891b2", "#059669", "#d97706", "#db2777", "#7c3aed", "#2563eb"];
const initials = (n: string) => (n || "?").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const avatarColor = (n: string) => AV_PALETTE[(n.charCodeAt(0) || 0) % AV_PALETTE.length];
// Approve button colour tracks the recommendation so approving a termination
// reads as weighty (rose), a confirm/pass as positive (emerald), extend as blue.
function approveBtnCls(rec: string) {
  if (rec === "extend") return "bg-[#008CFF] hover:bg-[#0070cc]";
  if (rec === "confirm" || rec === "pass") return "bg-emerald-600 hover:bg-emerald-700";
  return "bg-rose-600 hover:bg-rose-700";
}

// Profile photo if available, else white initials on a name-hashed colour.
// Inline color:#fff — the `text-white` class gets overridden by global CSS.
function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return <img src={url} alt={name} referrerPolicy="no-referrer" onError={() => setBroken(true)} style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover" />;
  }
  // `text-white bg-[#…]` together trigger the global white-restore rule
  // (color:#fff !important); the inline background overrides the sentinel
  // bg-class with the real per-name palette colour.
  return (
    <span style={{ width: size, height: size, background: avatarColor(name) }} className="flex shrink-0 items-center justify-center rounded-full bg-[#2563eb] text-[12px] font-bold text-white">
      {initials(name)}
    </span>
  );
}

export default function ProbationApprovalsCard({ standalone = false, brand = null }: { standalone?: boolean; brand?: string | null }) {
  // Brand scope for the per-brand HR sub-dashboards (NB Media / YT Labs).
  const brandQs = brand === "NB Media" || brand === "YT Labs" ? `&brand=${encodeURIComponent(brand)}` : "";
  const [tab, setTab] = useState<"onprob" | "pending" | "history">("onprob");
  const { data, mutate } = useSWR<{ reviews: HrReview[] }>(`/api/hr/probation-reviews?scope=hr${brandQs}`, fetcher, { refreshInterval: 60_000 });
  const reviews = data?.reviews ?? [];
  const { data: histData, mutate: mutateHist } = useSWR<{ reviews: HrHistory[] }>(standalone && tab === "history" ? `/api/hr/probation-reviews?scope=hr-history${brandQs}` : null, fetcher);
  const history = histData?.reviews ?? [];
  const { data: onProbData } = useSWR<{ employees: OnProb[] }>(standalone && tab === "onprob" ? `/api/hr/probation-reviews?scope=on-probation${brandQs}` : null, fetcher);
  const onProb = onProbData?.employees ?? [];
  const [busy, setBusy] = useState<number | null>(null);
  const [revertFor, setRevertFor] = useState<number | null>(null);
  const [revertDate, setRevertDate] = useState("");

  // Home dashboard: hide entirely when nothing pending.
  if (!standalone && reviews.length === 0) return null;

  const decide = async (r: HrReview, decision: "approve" | "reject") => {
    let hrNote: string | null = null;
    if (decision === "reject") hrNote = (prompt(`Send ${r.employeeName}'s review back to ${r.managerName || "the manager"} — optional note:`) ?? "").trim() || null;
    if (decision === "approve" && r.recommendation === "end" && !confirm(`Approve ENDING ${r.employeeName}'s employment? This deactivates their account.`)) return;
    setBusy(r.id);
    try {
      const res = await fetch(`/api/hr/probation-reviews/${r.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, hrNote }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || "Failed"); }
      mutate();
    } catch (e: any) { alert(e?.message || "Failed"); } finally { setBusy(null); }
  };

  const openRevert = (empId: number) => {
    const d = new Date(); d.setMonth(d.getMonth() + 3);
    setRevertFor(empId); setRevertDate(d.toISOString().slice(0, 10));
  };
  const doRevert = async (empId: number) => {
    if (!revertDate) { alert("Pick a new probation end date."); return; }
    setBusy(empId);
    try {
      const res = await fetch("/api/hr/probation-reviews/revert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeUserId: empId, newEndDate: revertDate }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || "Failed"); }
      setRevertFor(null); mutate(); mutateHist?.();
    } catch (e: any) { alert(e?.message || "Failed"); } finally { setBusy(null); }
  };

  const pendingList = reviews.length === 0 ? (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-4 py-10 text-center">
      <Check className="mx-auto mb-2 h-7 w-7 text-emerald-400" />
      <p className="text-[13px] font-medium text-slate-700">All caught up</p>
      <p className="mt-0.5 text-[12px] text-slate-500">Nothing awaiting your approval.</p>
    </div>
  ) : (
    <div className="space-y-3">
      {reviews.map((r) => {
        const b = recBadge(r);
        return (
          <div key={r.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <Avatar name={r.employeeName} url={r.profilePictureUrl} size={36} />
                  <div className="min-w-0">
                    <Link href={`/dashboard/hr/people/${r.employeeUserId}`} className="block truncate text-[13px] font-semibold text-slate-900 hover:text-[#008CFF] hover:underline">{r.employeeName}</Link>
                    <p className="truncate text-[11.5px] text-slate-500">{r.designation || "—"} · mgr {r.managerName || "—"}</p>
                    <p className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-slate-400"><CalendarClock size={11} /> Probation ends {fmtDate(r.probationEndDate)}</p>
                  </div>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold ring-1 ${b.cls}`}><b.Icon size={11} /> {recLabel(r)}</span>
              </div>
              <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
                <p className="text-[12px] italic leading-relaxed text-slate-600">“{r.feedback}”</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-4 py-2.5">
              <button type="button" disabled={busy === r.id} onClick={() => decide(r, "reject")} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3.5 text-[12px] font-semibold text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 disabled:opacity-50"><X size={13} /> Send back</button>
              <button type="button" disabled={busy === r.id} onClick={() => decide(r, "approve")} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-4 text-[12px] font-semibold text-white shadow-sm transition-colors disabled:opacity-50 ${approveBtnCls(r.recommendation)}`}><Check size={13} /> Approve</button>
            </div>
          </div>
        );
      })}
    </div>
  );

  const historyList = history.length === 0 ? (
    <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-[12.5px] text-slate-500 ring-1 ring-slate-100">No decided reviews yet.</p>
  ) : (
    <div className="space-y-2.5">
      {history.map((h) => {
        const canRevert = h.isConfirmed || h.employeeActive === false; // confirmed → un-confirm; ended → reactivate
        return (
          <div key={h.id} className="rounded-lg border border-slate-100 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/dashboard/hr/people/${h.employeeUserId}`} className="block truncate text-[12.5px] font-semibold text-slate-800 hover:text-[#008CFF] hover:underline">{h.employeeName}</Link>
                <p className="truncate text-[11px] text-slate-500">{h.designation || "—"} · mgr {h.managerName || "—"}</p>
              </div>
              <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${h.status === "approved" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"}`}>{h.status === "approved" ? "Approved" : "Sent back"}</span>
            </div>
            <p className="mt-1.5 text-[12px] text-slate-600">{recLabel(h)}{h.decidedAt ? <span className="text-slate-400"> · {fmtDate(h.decidedAt)}{h.deciderName ? ` by ${h.deciderName}` : ""}</span> : null}</p>
            <p className="mt-1 text-[12px] italic text-slate-500">“{h.feedback}”</p>
            {canRevert && (
              revertFor === h.employeeUserId ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ring-slate-100">
                  <span className="text-[11px] font-semibold text-slate-600">New probation end:</span>
                  <div className="w-[150px]"><DateField value={revertDate} onChange={setRevertDate} /></div>
                  <button type="button" disabled={busy === h.employeeUserId} onClick={() => doRevert(h.employeeUserId)} className="inline-flex h-7 items-center gap-1 rounded-md bg-[#008CFF] px-3 text-[11.5px] font-semibold text-white hover:bg-[#0070cc] disabled:opacity-50"><RotateCcw size={12} /> Confirm revert</button>
                  <button type="button" onClick={() => setRevertFor(null)} className="h-7 px-2 text-[11.5px] font-medium text-slate-500 hover:text-slate-800">Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => openRevert(h.employeeUserId)} className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#008CFF] hover:underline">
                  <RotateCcw size={12} /> Revert to probation
                </button>
              )
            )}
          </div>
        );
      })}
    </div>
  );

  const daysPill = (d: number | null) => {
    if (d == null) return "bg-slate-100 text-slate-600 ring-slate-200";
    if (d <= 7) return "bg-rose-50 text-rose-700 ring-rose-200";
    if (d <= 21) return "bg-amber-50 text-amber-700 ring-amber-200";
    return "bg-slate-100 text-slate-600 ring-slate-200";
  };
  const onProbList = onProb.length === 0 ? (
    <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-[12.5px] text-slate-500 ring-1 ring-slate-100">No one is on probation right now.</p>
  ) : (
    <div className="space-y-2">
      {onProb.map((e) => (
        <div key={e.userId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Link href={`/dashboard/hr/people/${e.userId}`} className="truncate text-[12.5px] font-semibold text-slate-800 hover:text-[#008CFF] hover:underline">{e.name}</Link>
              <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-slate-500">{e.businessUnit}</span>
              {e.lastReviewStatus === "pending" && <span className="shrink-0 rounded-full bg-[#008CFF]/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-[#008CFF]">review pending</span>}
            </div>
            <p className="truncate text-[11px] text-slate-500">{e.designation || "—"} · mgr {e.managerName || "—"}</p>
          </div>
          <div className="shrink-0 text-right">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ${daysPill(e.daysRemaining)}`}>
              {e.daysRemaining != null && e.daysRemaining >= 0 ? `${e.daysRemaining} day${e.daysRemaining === 1 ? "" : "s"} left` : "ended"}
            </span>
            <p className="mt-0.5 text-[10.5px] text-slate-400">ends {fmtDate(e.probationEndDate)}</p>
          </div>
        </div>
      ))}
    </div>
  );

  // Admin tab — On Probation / Pending / History tabs.
  if (standalone) {
    return (
      <div>
        <div className="mb-3 inline-flex rounded-lg bg-slate-100 p-0.5 text-[12px] font-medium">
          <button type="button" onClick={() => setTab("onprob")} className={`rounded-md px-3.5 py-1.5 transition-colors ${tab === "onprob" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>On Probation{onProb.length ? ` (${onProb.length})` : ""}</button>
          <button type="button" onClick={() => setTab("pending")} className={`rounded-md px-3.5 py-1.5 transition-colors ${tab === "pending" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>Pending{reviews.length ? ` (${reviews.length})` : ""}</button>
          <button type="button" onClick={() => setTab("history")} className={`rounded-md px-3.5 py-1.5 transition-colors ${tab === "history" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>History</button>
        </div>
        {tab === "onprob" ? onProbList : tab === "pending" ? pendingList : historyList}
      </div>
    );
  }

  // Home dashboard card — pending only.
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-slate-900">Probation Approvals</p>
        <span className="min-w-[20px] rounded-full bg-[#008CFF] px-1.5 py-0.5 text-center text-[10px] font-bold text-white tabular-nums">{reviews.length}</span>
      </div>
      {pendingList}
    </div>
  );
}
