"use client";

// Right-side drawer for a single EmployeeExit. Hits
// GET /api/hr/exits/:id (full hydrated payload — exit + settlement +
// tasks + survey + notes) so the drawer renders in one round-trip.
//
// Five tabs:
//   1. Summary       — header card + status pipeline + clearance list
//                       + activity log (notes)
//   2. Finances      — payable / deduction summary, opens the Finalise
//                       Wizard (sibling component)
//   3. Survey        — exit-interview form (rate management, growth,
//                       environment, recommend yes/no, free text)
//   4. Tasks         — clearance checklist (assign owner, due date,
//                       mark done). Auto-creates default tasks the
//                       first time HR visits this tab.
//   5. Leave Settings — sub-set of the settlement (LOP, encashment) —
//                       read-only here; the figures are owned by the
//                       wizard. Linked so HR can jump.

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import {
  X, CheckCircle2, Circle, RefreshCw, FileText, Star, ClipboardList,
  Plus, Trash2, Save, AlertCircle, CalendarDays, ArrowRight, Pencil,
  ListChecks, MessageSquare, Paperclip, ExternalLink,
} from "lucide-react";
import { DateField } from "@/components/ui/date-field";
import ExitSurveyTab from "@/components/hr/ExitSurveyTab";

type ExitDetail = {
  exit: {
    id: number; userId: number; status: string; exitType: string;
    resignationDate: string; lastWorkingDay: string; noticePeriodDays: number;
    reason: string | null; notes: string | null;
    assetsReturned: boolean; documentsHandled: boolean;
    finalSettlementDone: boolean; exitInterviewDone: boolean;
    okToRehire: boolean; createdAt: string;
    userName: string; userEmail: string;
    designation: string | null; department: string | null;
    managerName: string | null;
  };
  settlement: {
    id: number; exitId: number;
    paymentMode: string; settlementMode: string;
    settlementDate: string | null; settlementNotes: string | null;
    actualNoticeDays: number; noticeServingDays: number;
    buyoutEligible: boolean; buyoutAmount: string | null;
    gratuityEligible: boolean; gratuityAmount: string | null;
    finalised: boolean; finalisedAt: string | null;
  } | null;
  settlementLines: Array<{
    id: number; settlementId: number;
    section: string; subsection: string; label: string;
    amount: string; payAction: string;
    days: string | null; comment: string | null;
  }>;
  tasks: Array<{
    id: number; exitId: number; category: string; title: string;
    description: string | null; assigneeId: number | null;
    assigneeName: string | null; assigneePicture: string | null;
    status: string; dueDate: string | null; completedAt: string | null;
  }>;
  survey: {
    id: number; exitId: number;
    reasonForLeaving: string | null;
    satisfactionRating: number | null;
    managementRating: number | null;
    workEnvironmentRating: number | null;
    growthRating: number | null;
    wouldRecommend: boolean | null;
    additionalFeedback: string | null;
    submittedAt: string | null;
  } | null;
  notes: Array<{
    id: number; exitId: number; authorId: number | null;
    authorName: string | null; authorPicture: string | null;
    body: string; createdAt: string;
  }>;
};

const TABS = [
  { k: "summary",  label: "Summary",        icon: FileText },
  { k: "finances", label: "Finances",       icon: ClipboardList },
  { k: "survey",   label: "Survey",         icon: Star },
  { k: "tasks",    label: "Tasks",          icon: CheckCircle2 },
  { k: "leave",    label: "Leave Settings", icon: CalendarDays },
  { k: "documents", label: "Documents",     icon: Paperclip },
] as const;
type TabKey = typeof TABS[number]["k"];

const fmtDate = (d: string | Date | null) =>
  !d ? "—" : new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const fmtDateTime = (d: string | Date | null) =>
  !d ? "—" : new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const inr = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
};

/* ── Documents tab ────────────────────────────────────────────────────────
   Lists every file uploaded for this employee (offer letter, exit letters,
   settlement docs, ID proofs, etc.) so HR can open them right from the exit
   drawer. Reuses the existing per-user documents API + file-serve endpoint. */
function DocumentsTab({ userId }: { userId: number }) {
  const { data: docs = [], isLoading } = useSWR<any[]>(`/api/hr/documents?userId=${userId}`, fetcher);
  const fileHref = (d: any) =>
    typeof d.fileUrl === "string" && /^https?:\/\//.test(d.fileUrl) ? d.fileUrl : `/api/hr/documents/${d.id}/file`;
  const catLabel = (c: string) =>
    (c || "other").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-slate-500">
        Files uploaded for this employee — offer letter, exit / relieving letters, settlement docs, ID proofs, etc.
      </p>
      {isLoading ? (
        <p className="text-[13px] text-slate-400">Loading documents…</p>
      ) : docs.length === 0 ? (
        <p className="text-[13px] text-slate-400">No documents uploaded for this employee yet.</p>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <a key={d.id} href={fileHref(d)} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 transition-colors hover:bg-slate-50">
              <div className="flex min-w-0 items-center gap-3">
                <Paperclip className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-slate-800">{d.fileName || "Document"}</p>
                  <p className="text-[11px] text-slate-400">
                    {catLabel(d.category)} · {fmtDate(d.createdAt)}{d.uploadedBy?.name ? ` · by ${d.uploadedBy.name}` : ""}
                  </p>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-sky-600">
                View <ExternalLink className="h-3.5 w-3.5" />
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ExitDetailDrawer({
  exitId, onClose, onChanged,
}: { exitId: number; onClose: () => void; onChanged: () => void }) {
  const key = `/api/hr/exits/${exitId}/full`;
  const { data, mutate: refetch, isLoading } = useSWR<ExitDetail>(
    `/api/hr/exits/${exitId}`,
    fetcher,
    { refreshInterval: 0 },
  );
  const [tab, setTab] = useState<TabKey>("summary");

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[920px] bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <header className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {isLoading || !data ? (
              <div className="h-5 w-40 bg-slate-100 rounded animate-pulse" />
            ) : (
              <>
                <h2 className="text-[15px] font-bold text-slate-800 truncate">{data.exit.userName}</h2>
                <p className="text-[11.5px] text-slate-500 truncate">
                  {data.exit.designation || "—"}{data.exit.department ? ` · ${data.exit.department}` : ""}
                  {data.exit.managerName ? ` · Reports to ${data.exit.managerName}` : ""}
                </p>
              </>
            )}
          </div>
          <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400">
            <X size={18} />
          </button>
        </header>

        {/* Tabs */}
        <nav className="px-5 border-b border-slate-200 flex gap-1 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.k;
            return (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={`px-3 py-2.5 text-[12.5px] font-semibold border-b-2 -mb-px inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  active ? "border-[#0f6ecd] text-[#0f6ecd]" : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                <Icon size={13} />
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-slate-50/40">
          {isLoading || !data ? (
            <div className="p-6 space-y-3">
              <div className="h-24 w-full bg-white rounded-xl animate-pulse" />
              <div className="h-40 w-full bg-white rounded-xl animate-pulse" />
            </div>
          ) : (
            <>
              {tab === "summary"  && <SummaryTab  data={data} onChanged={() => { refetch(); onChanged(); }} />}
              {tab === "finances" && <FinancesTab data={data} onRefresh={() => { refetch(); onChanged(); }} />}
              {tab === "survey"   && <SurveyTab   data={data} onChanged={() => { refetch(); onChanged(); }} />}
              {tab === "tasks"    && <TasksTab    data={data} onChanged={() => { refetch(); onChanged(); }} />}
              {tab === "leave"    && <LeaveTab    data={data} onJumpFinances={() => setTab("finances")} />}
              {tab === "documents" && <DocumentsTab userId={data.exit.userId} />}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ── Summary tab ──────────────────────────────────────────────────────── */

function SummaryTab({
  data, onChanged,
}: { data: ExitDetail; onChanged: () => void }) {
  const e = data.exit;

  const setStatus = async (next: string) => {
    await fetch(`/api/hr/exits/${e.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    onChanged();
  };
  const setClearance = async (key: string, value: boolean) => {
    await fetch(`/api/hr/exits/${e.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    onChanged();
  };

  // Summary-card editor modal. HR can correct any of the
  // exit-type / dates / notice / reason / rehire fields without
  // having to rebuild the whole offboarding flow.
  const [editingSummary, setEditingSummary] = useState(false);
  const [editForm, setEditForm] = useState<{
    exitType: string;
    resignationDate: string;
    lastWorkingDay: string;
    noticePeriodDays: string;
    reason: string;
    okToRehire: boolean;
  }>({
    exitType: e.exitType,
    resignationDate: (e.resignationDate || "").slice(0, 10),
    lastWorkingDay:  (e.lastWorkingDay  || "").slice(0, 10),
    noticePeriodDays: String(e.noticePeriodDays ?? 30),
    reason: e.reason ?? "",
    okToRehire: !!e.okToRehire,
  });
  const [savingSummary, setSavingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  // Add `days` calendar days to a YYYY-MM-DD string. Returns "" if
  // the input isn't a valid date. Used to keep last-working-day in
  // sync with resignationDate + noticePeriodDays — HR types one,
  // the other auto-recalcs.
  const addDays = (ymd: string, days: number): string => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
    if (!Number.isFinite(days)) return "";
    const d = new Date(`${ymd}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return "";
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  // When notice period changes, recompute LWD from the (possibly
  // updated) resignation date. Same when resignation date changes —
  // LWD slides to keep the notice constant.
  const onNoticeChange = (v: string) => {
    setEditForm((f) => {
      const n = Number(v);
      const lwd = Number.isInteger(n) && n >= 0 && f.resignationDate
        ? addDays(f.resignationDate, n)
        : f.lastWorkingDay;
      return { ...f, noticePeriodDays: v, lastWorkingDay: lwd };
    });
  };
  const onResignationChange = (v: string) => {
    setEditForm((f) => {
      const n = Number(f.noticePeriodDays);
      const lwd = Number.isInteger(n) && n >= 0 && v ? addDays(v, n) : f.lastWorkingDay;
      return { ...f, resignationDate: v, lastWorkingDay: lwd };
    });
  };

  const openSummaryEdit = () => {
    setEditForm({
      exitType: e.exitType,
      resignationDate: (e.resignationDate || "").slice(0, 10),
      lastWorkingDay:  (e.lastWorkingDay  || "").slice(0, 10),
      noticePeriodDays: String(e.noticePeriodDays ?? 30),
      reason: e.reason ?? "",
      okToRehire: !!e.okToRehire,
    });
    setSummaryError(null);
    setEditingSummary(true);
  };
  const saveSummary = async () => {
    setSavingSummary(true);
    setSummaryError(null);
    try {
      const n = Number(editForm.noticePeriodDays);
      if (!Number.isInteger(n) || n < 0 || n > 365) {
        setSummaryError("Notice period must be a whole number between 0 and 365.");
        return;
      }
      const res = await fetch(`/api/hr/exits/${e.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          exitType:         editForm.exitType,
          resignationDate:  editForm.resignationDate,
          lastWorkingDay:   editForm.lastWorkingDay,
          noticePeriodDays: n,
          reason:           editForm.reason,
          okToRehire:       editForm.okToRehire,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setSummaryError(j?.error || `Save failed (${res.status})`);
        return;
      }
      setEditingSummary(false);
      onChanged();
    } finally {
      setSavingSummary(false);
    }
  };

  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const postNote = async () => {
    const text = noteDraft.trim();
    if (!text) return;
    setSavingNote(true);
    try {
      await fetch(`/api/hr/exits/${e.id}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      setNoteDraft("");
      onChanged();
    } finally { setSavingNote(false); }
  };

  return (
    <div className="p-5 space-y-4 max-w-3xl">
      {/* Exit details */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0f6ecd]/10 text-[#0f6ecd]"><FileText size={15} /></span>
            <h3 className="text-[13px] font-semibold text-slate-800">Exit Details</h3>
          </div>
          <button
            type="button"
            onClick={openSummaryEdit}
            aria-label="Edit exit summary"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium text-slate-500 transition-colors hover:bg-[#0f6ecd]/[0.06] hover:text-[#0f6ecd]"
          >
            <Pencil size={12} /> Edit
          </button>
        </div>
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 p-5 sm:grid-cols-3">
          <Detail label="Exit Type">
            <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-semibold capitalize text-slate-700">{e.exitType.replace(/_/g, " ")}</span>
          </Detail>
          <Detail label="Resignation Date"><span className="text-[12.5px] font-semibold tabular-nums text-slate-800">{fmtDate(e.resignationDate)}</span></Detail>
          <Detail label="Last Working Day"><span className="text-[12.5px] font-semibold tabular-nums text-slate-800">{fmtDate(e.lastWorkingDay)}</span></Detail>
          <Detail label="Notice Period"><span className="text-[12.5px] font-semibold text-slate-800">{e.noticePeriodDays} days</span></Detail>
          <Detail label="Reason"><span className="text-[12.5px] text-slate-800">{e.reason || "—"}</span></Detail>
          <Detail label="Rehire">
            {e.okToRehire
              ? <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">Ok to rehire</span>
              : <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Not flagged</span>}
          </Detail>
        </div>
      </section>

      {/* Edit-summary modal — appears centered on top of the drawer */}
      {editingSummary && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-[60]"
            onClick={() => !savingSummary && setEditingSummary(false)}
          />
          <div className="fixed inset-0 z-[61] flex items-start justify-center pt-20 px-4 pointer-events-none">
            <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md pointer-events-auto">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-[14px] font-semibold text-slate-800">Edit exit summary</h3>
                <button
                  type="button"
                  onClick={() => !savingSummary && setEditingSummary(false)}
                  className="text-slate-400 hover:text-slate-700"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 space-y-3.5">
                <div>
                  <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Exit Type</label>
                  <select
                    value={editForm.exitType}
                    onChange={(ev) => setEditForm((f) => ({ ...f, exitType: ev.target.value }))}
                    className="mt-1 w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#008CFF]"
                  >
                    <option value="resignation">Resignation</option>
                    <option value="termination">Termination</option>
                    <option value="contract_end">Contract end</option>
                    <option value="retirement">Retirement</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Resignation Date</label>
                    <DateField
                      value={editForm.resignationDate}
                      onChange={onResignationChange}
                      className="mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Last Working Day</label>
                    <DateField
                      value={editForm.lastWorkingDay}
                      onChange={(v) => setEditForm((f) => ({ ...f, lastWorkingDay: v }))}
                      className="mt-1 w-full"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Notice Period (days)</label>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={editForm.noticePeriodDays}
                    onChange={(ev) => onNoticeChange(ev.target.value)}
                    className="mt-1 w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#008CFF]"
                  />
                  <p className="mt-1 text-[10.5px] text-slate-400">
                    Last Working Day auto-updates as Resignation Date + Notice.
                  </p>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Reason</label>
                  <input
                    type="text"
                    value={editForm.reason}
                    onChange={(ev) => setEditForm((f) => ({ ...f, reason: ev.target.value }))}
                    placeholder="e.g. Performance, Better opportunity"
                    className="mt-1 w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#008CFF]"
                  />
                </div>
                <label className="flex items-center gap-2 text-[13px] text-slate-700">
                  <input
                    type="checkbox"
                    checked={editForm.okToRehire}
                    onChange={(ev) => setEditForm((f) => ({ ...f, okToRehire: ev.target.checked }))}
                    className="w-4 h-4 rounded border-slate-300 text-[#008CFF] focus:ring-[#008CFF]"
                  />
                  Ok to rehire
                </label>
                {summaryError && (
                  <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[12px] text-rose-700">
                    {summaryError}
                  </div>
                )}
              </div>
              <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => !savingSummary && setEditingSummary(false)}
                  disabled={savingSummary}
                  className="h-8 px-4 text-[12.5px] text-slate-500 hover:text-slate-800 rounded-md disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveSummary}
                  disabled={savingSummary}
                  className="h-8 px-4 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-md text-[12.5px] font-semibold disabled:opacity-60 disabled:cursor-wait"
                >
                  {savingSummary ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Status pipeline — "Under Review" was retired (all new exits
          land in_progress). Legacy under_review / notice_period /
          cleared rows count as in_progress for the active highlight. */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2.5 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><ArrowRight size={15} /></span>
          <h3 className="text-[13px] font-semibold text-slate-800">Exit Stage</h3>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 gap-2.5">
            {(["in_progress", "exited"] as const).map(s => {
              const active = e.status === s
                || (s === "in_progress" && (e.status === "under_review" || e.status === "notice_period" || e.status === "cleared"))
                || (s === "exited" && e.status === "offboarded");
              return (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                    active ? "border-[#0f6ecd] bg-[#0f6ecd]/[0.06] ring-1 ring-[#0f6ecd]/20" : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <span className={`block text-[12.5px] font-semibold ${active ? "text-[#0f6ecd]" : "text-slate-700"}`}>
                    {s === "in_progress" ? "In Progress" : "Exited"}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    {s === "in_progress" ? "Clearance underway" : "Off the books · account off"}
                  </span>
                </button>
              );
            })}
          </div>
          {e.status === "exited" && (
            <p className="mt-3 flex items-start gap-1.5 text-[11.5px] text-amber-700">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              Marking as exited deactivates the user account. Move back to In Progress to reactivate.
            </p>
          )}
        </div>
      </section>

      {/* Clearance */}
      {(() => {
        const done = [e.assetsReturned, e.documentsHandled, e.finalSettlementDone, e.exitInterviewDone].filter(Boolean).length;
        return (
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><ListChecks size={15} /></span>
                <h3 className="text-[13px] font-semibold text-slate-800">Clearance Checklist</h3>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ${done === 4 ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200"}`}>
                {done}/4 done
              </span>
            </div>
            <div className="space-y-2 p-3">
              <ClearanceRow label="Assets returned"          checked={e.assetsReturned}      onChange={v => setClearance("assetsReturned", v)} />
              <ClearanceRow label="Documents handled"        checked={e.documentsHandled}    onChange={v => setClearance("documentsHandled", v)} />
              <ClearanceRow label="Final settlement done"    checked={e.finalSettlementDone} onChange={v => setClearance("finalSettlementDone", v)} />
              <ClearanceRow label="Exit interview completed" checked={e.exitInterviewDone}   onChange={v => setClearance("exitInterviewDone", v)} />
            </div>
          </section>
        );
      })()}

      {/* Activity log */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2.5 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><MessageSquare size={15} /></span>
          <h3 className="text-[13px] font-semibold text-slate-800">Activity Log</h3>
        </div>
        <div className="p-5">
        <div className="flex gap-2">
          <textarea
            rows={2}
            value={noteDraft}
            onChange={ev => setNoteDraft(ev.target.value)}
            placeholder="Add an internal note (visible only to HR)…"
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-[12.5px] focus:outline-none focus:border-[#0f6ecd] resize-none"
          />
          <button
            onClick={postNote}
            disabled={savingNote || !noteDraft.trim()}
            className="h-9 self-start px-4 rounded-lg bg-[#0f6ecd] hover:bg-[#0a5fb3] disabled:opacity-50 text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5"
          >
            <Save size={13} /> Post
          </button>
        </div>
        <ul className="mt-4 space-y-2.5">
          {data.notes.length === 0 ? (
            <li className="text-[12px] text-slate-400">No notes yet.</li>
          ) : data.notes.map(n => (
            <li key={n.id} className="border border-slate-100 rounded-lg p-3 bg-slate-50/50">
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-[11.5px] font-semibold text-slate-700">
                  {n.authorName || "System"}
                </p>
                <p className="text-[10.5px] text-slate-400 tabular-nums">{fmtDateTime(n.createdAt)}</p>
              </div>
              <p className="text-[12.5px] text-slate-700 whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
        </div>
      </section>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      {children}
    </div>
  );
}

function ClearanceRow({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
      checked ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 hover:bg-slate-50"
    }`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-[#0f6ecd] focus:ring-[#0f6ecd]"
      />
      <span className={`text-[13px] ${checked ? "font-medium text-slate-700" : "text-slate-600"}`}>{label}</span>
      {checked && <CheckCircle2 size={15} className="ml-auto text-emerald-500" />}
    </label>
  );
}

/* ── Finances tab ─────────────────────────────────────────────────────── */

function FinancesTab({
  data, onRefresh,
}: { data: ExitDetail; onRefresh: () => void }) {
  const s = data.settlement;
  const lines = data.settlementLines;
  const [busy, setBusy] = useState(false);

  // The F&F Letter IS the finalization: generating it marks the exit's
  // settlement as finalised (auto-creating a minimal settlement row) and
  // opens the Full & Final Settlement Letter template pre-filled for the
  // employee. No separate line-item wizard.
  const letterHref = `/dashboard/hr/admin/templates/fnf_settlement?employeeId=${data.exit.userId}`;
  async function generateAndFinalise() {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/exits/${data.exit.id}/settlement/finalise`, { method: "POST" });
      window.open(letterHref, "_blank", "noopener,noreferrer");
      if (res.ok || res.status === 409) onRefresh();
      else { const j = await res.json().catch(() => ({})); alert(j?.error || "Could not finalise the settlement"); }
    } catch {
      window.open(letterHref, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  }

  const totals = useMemo(() => {
    let pay = 0, recover = 0, hold = 0, carry = 0;
    for (const l of lines) {
      const v = Number(l.amount);
      if (l.payAction === "recover") recover += v;
      else if (l.payAction === "hold") hold += v;
      else if (l.payAction === "carryover") carry += v;
      else pay += v;
    }
    return { pay, recover, hold, carry, net: pay - recover };
  }, [lines]);

  return (
    <div className="p-5 space-y-4 max-w-3xl">
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-bold text-slate-800">Review &amp; Finalise Payables</h3>
          <div className="flex items-center gap-2">
            {s?.finalised && (
              <span className="inline-flex items-center gap-1 px-2.5 h-7 rounded-full ring-1 ring-inset ring-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] font-semibold">
                <CheckCircle2 size={12} /> Finalised {fmtDateTime(s.finalisedAt)}
              </span>
            )}
            <button
              onClick={generateAndFinalise}
              disabled={busy}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#0f6ecd] hover:bg-[#0a5fb3] text-white text-[12.5px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileText size={13} />
              {busy ? "Working…" : s?.finalised ? "Open F&F Letter" : "Generate F&F Letter"}
            </button>
          </div>
        </div>

        {!s?.finalised ? (
          <p className="text-[12.5px] text-slate-500">
            Generate the F&amp;F Letter to finalise this settlement — it marks the exit as settled and opens the letter for this employee.
          </p>
        ) : (
          <>
            <p className="text-[12.5px] text-slate-600">
              Settlement finalised. The amounts are carried by the F&amp;F Letter — click <strong>Open F&amp;F Letter</strong> to view or re-generate it.
            </p>
            {/* Legacy line-item settlements (created via the old wizard) still
                show their totals. New F&F-letter finalisations have no lines. */}
            {lines.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                <Stat label="To pay"      value={inr(totals.pay)}     tone="emerald" />
                <Stat label="To recover"  value={inr(totals.recover)} tone="rose"    />
                <Stat label="Net payable" value={inr(totals.net)}     tone="sky"     />
                <Stat label="Carry over"  value={inr(totals.carry)}   tone="slate"   />
              </div>
            )}

            {s.settlementDate && (
              <p className="mt-3 text-[12px] text-slate-600">
                Settlement date: <strong className="text-slate-800">{fmtDate(s.settlementDate)}</strong>
                {s.settlementNotes && <span className="block mt-1 text-slate-500 whitespace-pre-wrap">{s.settlementNotes}</span>}
              </p>
            )}
          </>
        )}
      </section>

      {/* Line items breakdown */}
      {lines.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="text-[13px] font-bold text-slate-800">Line items</h3>
          </div>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-slate-50 text-[10.5px] uppercase tracking-wide font-bold text-slate-500">
                <th className="text-left px-5 py-2.5">Section</th>
                <th className="text-left px-5 py-2.5">Item</th>
                <th className="text-right px-5 py-2.5">Days</th>
                <th className="text-right px-5 py-2.5">Amount</th>
                <th className="text-right px-5 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="px-5 py-2 text-slate-500 capitalize">{l.section}</td>
                  <td className="px-5 py-2 text-slate-800">{l.label}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-slate-600">{l.days ?? "—"}</td>
                  <td className="px-5 py-2 text-right tabular-nums font-semibold text-slate-800">{inr(l.amount)}</td>
                  <td className="px-5 py-2 text-right">
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10.5px] font-semibold uppercase ring-1 ring-inset ${
                      l.payAction === "recover" ? "bg-rose-50 text-rose-700 ring-rose-200"
                      : l.payAction === "hold" ? "bg-slate-100 text-slate-600 ring-slate-200"
                      : l.payAction === "carryover" ? "bg-amber-50 text-amber-700 ring-amber-200"
                      : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    }`}>
                      {l.payAction}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "emerald" | "rose" | "sky" | "slate" }) {
  const toneMap: Record<string, string> = {
    emerald: "bg-emerald-50 ring-emerald-200 text-emerald-700",
    rose:    "bg-rose-50 ring-rose-200 text-rose-700",
    sky:     "bg-sky-50 ring-sky-200 text-sky-800",
    slate:   "bg-slate-50 ring-slate-200 text-slate-700",
  };
  return (
    <div className={`rounded-lg ring-1 ring-inset px-3 py-2.5 ${toneMap[tone]}`}>
      <p className="text-[10.5px] uppercase font-bold opacity-80">{label}</p>
      <p className="text-[15px] font-bold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

/* ── Survey tab ───────────────────────────────────────────────────────── */

function SurveyTab({
  data, onChanged,
}: { data: ExitDetail; onChanged: () => void }) {
  const initial = data.survey;
  const [reasonForLeaving, setReasonForLeaving] = useState(initial?.reasonForLeaving ?? "");
  const [satisfactionRating, setSatisfactionRating] = useState<number | null>(initial?.satisfactionRating ?? null);
  const [managementRating, setManagementRating] = useState<number | null>(initial?.managementRating ?? null);
  const [workEnvironmentRating, setWorkEnvironmentRating] = useState<number | null>(initial?.workEnvironmentRating ?? null);
  const [growthRating, setGrowthRating] = useState<number | null>(initial?.growthRating ?? null);
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(initial?.wouldRecommend ?? null);
  const [additionalFeedback, setAdditionalFeedback] = useState(initial?.additionalFeedback ?? "");
  const [saving, setSaving] = useState(false);
  const submitted = !!initial?.submittedAt;

  const send = async (submit: boolean) => {
    setSaving(true);
    try {
      await fetch(`/api/hr/exits/${data.exit.id}/survey`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reasonForLeaving, satisfactionRating, managementRating,
          workEnvironmentRating, growthRating, wouldRecommend,
          additionalFeedback, submitted,
        }),
      });
      onChanged();
    } finally { setSaving(false); }
  };

  return (
    <div className="p-5 space-y-4 max-w-3xl">
      {/* The employee's own submitted Exit Survey (detailed questionnaire). */}
      <ExitSurveyTab userId={data.exit.userId} />

      {/* HR's exit-interview notes (separate from the employee's survey). */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0f6ecd]/10 text-[#0f6ecd]"><Pencil size={15} /></span>
            <div>
              <h3 className="text-[13px] font-semibold text-slate-800">Exit Interview</h3>
              <p className="text-[11.5px] text-slate-500">HR&apos;s private notes from the exit conversation.</p>
            </div>
          </div>
          {submitted && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
              <CheckCircle2 size={12} /> Submitted {fmtDateTime(initial!.submittedAt)}
            </span>
          )}
        </div>

        <div className="p-5 space-y-4">
        <Field label="Reason for leaving (the employee's own words)">
          <textarea
            rows={2}
            value={reasonForLeaving}
            onChange={e => setReasonForLeaving(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[12.5px] focus:outline-none focus:border-[#0f6ecd] resize-none"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <RatingField label="Overall satisfaction" value={satisfactionRating} onChange={setSatisfactionRating} />
          <RatingField label="Management"           value={managementRating}   onChange={setManagementRating} />
          <RatingField label="Work environment"     value={workEnvironmentRating} onChange={setWorkEnvironmentRating} />
          <RatingField label="Growth opportunities" value={growthRating}       onChange={setGrowthRating} />
        </div>

        <Field label="Would the employee recommend the company as a workplace?">
          <div className="flex gap-2">
            {([true, false] as const).map(opt => (
              <button
                key={String(opt)}
                onClick={() => setWouldRecommend(opt)}
                className={`h-9 px-4 rounded-lg text-[12px] font-semibold ring-1 ring-inset transition-colors ${
                  wouldRecommend === opt
                    ? opt ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"
                    : "bg-white text-slate-600 ring-slate-200 hover:ring-[#0f6ecd]"
                }`}
              >
                {opt ? "Yes" : "No"}
              </button>
            ))}
            {wouldRecommend !== null && (
              <button
                onClick={() => setWouldRecommend(null)}
                className="h-9 px-3 text-[11.5px] text-slate-500 hover:text-slate-700"
              >
                Clear
              </button>
            )}
          </div>
        </Field>

        <Field label="Additional feedback">
          <textarea
            rows={3}
            value={additionalFeedback}
            onChange={e => setAdditionalFeedback(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[12.5px] focus:outline-none focus:border-[#0f6ecd] resize-none"
          />
        </Field>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            onClick={() => send(false)}
            disabled={saving}
            className="h-9 px-4 rounded-lg border border-slate-200 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            onClick={() => send(true)}
            disabled={saving}
            className="h-9 px-4 rounded-lg bg-[#0f6ecd] hover:bg-[#0a5fb3] text-white text-[12.5px] font-semibold disabled:opacity-50"
          >
            {submitted ? "Update" : "Submit interview"}
          </button>
        </div>
        </div>
      </section>
    </div>
  );
}

function RatingField({
  label, value, onChange,
}: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            onClick={() => onChange(value === n ? null : n)}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-amber-50"
            title={`${n} / 5`}
          >
            <Star
              size={18}
              className={value !== null && n <= value ? "text-amber-400 fill-amber-400" : "text-slate-300"}
            />
          </button>
        ))}
        {value !== null && (
          <span className="ml-2 text-[11.5px] text-slate-500 tabular-nums">{value} / 5</span>
        )}
      </div>
    </Field>
  );
}

/* ── Tasks tab ────────────────────────────────────────────────────────── */

const DEFAULT_TASKS: Array<{ category: string; title: string }> = [
  { category: "finance", title: "Final settlement processed" },
  { category: "finance", title: "PF / Gratuity disbursed" },
  { category: "tasks",   title: "Knowledge transfer document delivered" },
  { category: "tasks",   title: "Open projects handed over" },
  { category: "it",      title: "Laptop returned" },
  { category: "it",      title: "Email + Slack + ClickUp access revoked" },
  { category: "admin",   title: "ID card collected" },
  { category: "admin",   title: "Experience letter issued" },
];

function TasksTab({
  data, onChanged,
}: { data: ExitDetail; onChanged: () => void }) {
  const tasks = data.tasks;
  const [seeding, setSeeding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCat, setNewCat] = useState("tasks");

  const seedDefaults = async () => {
    setSeeding(true);
    try {
      // Sequential so we don't slam the DB with 8 parallel inserts.
      for (const t of DEFAULT_TASKS) {
        await fetch(`/api/hr/exits/${data.exit.id}/tasks`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(t),
        });
      }
      onChanged();
    } finally { setSeeding(false); }
  };

  const addTask = async () => {
    const title = newTitle.trim();
    if (!title) return;
    await fetch(`/api/hr/exits/${data.exit.id}/tasks`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, category: newCat }),
    });
    setNewTitle("");
    onChanged();
  };

  const patchTask = async (id: number, body: any) => {
    await fetch(`/api/hr/exits/${data.exit.id}/tasks/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    onChanged();
  };

  const deleteTask = async (id: number) => {
    if (!window.confirm("Delete this task?")) return;
    await fetch(`/api/hr/exits/${data.exit.id}/tasks/${id}`, { method: "DELETE" });
    onChanged();
  };

  // Bucket by category so each panel renders independently.
  const groups = useMemo(() => {
    const g: Record<string, typeof tasks> = { finance: [], tasks: [], it: [], admin: [] };
    for (const t of tasks) (g[t.category] ?? (g[t.category] = [])).push(t);
    return g;
  }, [tasks]);

  return (
    <div className="p-5 space-y-4 max-w-3xl">
      {tasks.length === 0 && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 text-center">
          <p className="text-[13px] text-slate-600 mb-3">No tasks yet for this exit.</p>
          <button
            onClick={seedDefaults}
            disabled={seeding}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#0f6ecd] hover:bg-[#0a5fb3] text-white text-[12.5px] font-semibold disabled:opacity-50"
          >
            <RefreshCw size={13} className={seeding ? "animate-spin" : ""} />
            {seeding ? "Seeding…" : "Seed default tasks"}
          </button>
        </section>
      )}

      {(["finance", "tasks", "it", "admin"] as const).map(cat => {
        const items = groups[cat] ?? [];
        if (items.length === 0 && tasks.length > 0) return null;
        if (items.length === 0) return null;
        return (
          <section key={cat} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <header className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-[13px] font-bold text-slate-800 capitalize">{cat}</h3>
              <span className="text-[11px] text-slate-500">
                {items.filter(t => t.status === "done").length} / {items.length} done
              </span>
            </header>
            <ul className="divide-y divide-slate-100">
              {items.map(t => (
                <li key={t.id} className="px-5 py-3 flex items-center gap-3">
                  <button
                    onClick={() => patchTask(t.id, { status: t.status === "done" ? "pending" : "done" })}
                    title="Toggle done"
                    className="shrink-0"
                  >
                    {t.status === "done" ? (
                      <CheckCircle2 size={18} className="text-emerald-500" />
                    ) : (
                      <Circle size={18} className="text-slate-300 hover:text-slate-500" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[12.5px] font-semibold ${t.status === "done" ? "text-slate-400 line-through" : "text-slate-800"}`}>
                      {t.title}
                    </p>
                    <p className="text-[10.5px] text-slate-500">
                      {t.assigneeName ? `Assigned to ${t.assigneeName}` : "Unassigned"}
                      {t.dueDate ? ` · Due ${fmtDate(t.dueDate)}` : ""}
                      {t.completedAt ? ` · Done ${fmtDateTime(t.completedAt)}` : ""}
                    </p>
                  </div>
                  <DateField
                    value={t.dueDate ? t.dueDate.slice(0, 10) : ""}
                    onChange={(v) => patchTask(t.id, { dueDate: v || null })}
                    className="w-36"
                  />
                  <button
                    onClick={() => deleteTask(t.id)}
                    className="text-slate-300 hover:text-rose-500"
                    title="Delete task"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {/* Add task row */}
      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-[12.5px] font-bold text-slate-800 mb-2">Add task</h3>
        <div className="flex flex-wrap gap-2">
          <select
            value={newCat}
            onChange={e => setNewCat(e.target.value)}
            className="h-9 px-2 rounded-lg border border-slate-200 bg-white text-[12.5px]"
          >
            <option value="finance">Finance</option>
            <option value="tasks">Tasks</option>
            <option value="it">IT</option>
            <option value="admin">Admin</option>
          </select>
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") addTask(); }}
            placeholder="Task title"
            className="flex-1 h-9 px-3 rounded-lg border border-slate-200 bg-white text-[12.5px] focus:outline-none focus:border-[#0f6ecd]"
          />
          <button
            onClick={addTask}
            disabled={!newTitle.trim()}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#0f6ecd] hover:bg-[#0a5fb3] disabled:opacity-50 text-white text-[12.5px] font-semibold"
          >
            <Plus size={13} /> Add
          </button>
        </div>
      </section>
    </div>
  );
}

/* ── Leave Settings tab ───────────────────────────────────────────────── */

function LeaveTab({
  data, onJumpFinances,
}: { data: ExitDetail; onJumpFinances: () => void }) {
  const leaveLines = data.settlementLines.filter(l => l.section === "leave");
  const attendanceLines = data.settlementLines.filter(l => l.section === "attendance");

  return (
    <div className="p-5 space-y-4 max-w-3xl">
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-bold text-slate-800">Leave &amp; Attendance settings for F&amp;F</h3>
          <button
            onClick={onJumpFinances}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#0f6ecd] hover:underline"
          >
            Edit in Finances <ArrowRight size={12} />
          </button>
        </div>

        <p className="text-[12px] text-slate-500 mb-3">
          These figures flow into the Final Settlement statement. They are owned by the
          <strong className="text-slate-700"> Review &amp; Finalise Payables</strong> wizard — open it from the
          Finances tab to adjust.
        </p>

        {leaveLines.length === 0 && attendanceLines.length === 0 ? (
          <div className="text-center text-[12.5px] text-slate-400 py-6">
            No leave or attendance lines configured yet.
          </div>
        ) : (
          <div className="space-y-4">
            {leaveLines.length > 0 && (
              <LineGroup title="Leave" lines={leaveLines} />
            )}
            {attendanceLines.length > 0 && (
              <LineGroup title="Attendance" lines={attendanceLines} />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function LineGroup({ title, lines }: { title: string; lines: ExitDetail["settlementLines"] }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">{title}</p>
      <table className="w-full text-[12.5px] border border-slate-200 rounded-lg overflow-hidden">
        <tbody>
          {lines.map(l => (
            <tr key={l.id} className="border-t border-slate-100 first:border-0">
              <td className="px-3 py-2 text-slate-700">{l.label}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-500">{l.days ?? "—"}d</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">{inr(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Shared field shell ───────────────────────────────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
