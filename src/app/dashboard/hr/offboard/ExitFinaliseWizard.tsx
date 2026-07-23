"use client";

// Review & Finalise Payables — Keka-parity wizard.
//
//   Step 1 · PAYABLE COMPONENTS — six expandable accordion sections,
//             each with an inline Save button that flips to a green
//             "Saved Successfully" tick after persistence. The "Other
//             changes" section carries the rich settlement controls:
//             notice-period buyout (Actual / Serving / Short by + Yes/No),
//             gratuity toggle, one-time payments, settlement amounts,
//             loans, contribution overrides (ESI / LWF), tax overrides
//             (PT / Income Tax).
//   Step 2 · FINALISE — header strap "Settlement amount is paid at once",
//             Payable + Deductions summary cards, Net Payable table,
//             info banner, Download F&F Statement, settlement-amount
//             dropdown (Pay / Hold / Already Paid), Settlement Date,
//             Settlement notes.
//
// Everything still persists through PUT /api/hr/exits/:id/settlement
// — per-section Save calls the same endpoint with the current
// in-memory state. The Finalise button hits POST /finalise to lock the
// settlement.

import { useEffect, useMemo, useState } from "react";
import {
  X, ChevronDown, ChevronRight, Check, CheckCircle2, Plus, Trash2,
  Download, Loader2, AlertCircle,
} from "lucide-react";
import { DateField } from "@/components/ui/date-field";

/* ── Types from drawer ────────────────────────────────────────────────── */

type ExitHeader = {
  id: number; userId: number; userName: string; lastWorkingDay: string;
  noticePeriodDays: number;
  designation?: string | null;
  department?: string | null;
  status?: string;
};

type SettlementHeader = {
  id: number; exitId: number;
  paymentMode: string; settlementMode: string;
  settlementDate: string | null; settlementNotes: string | null;
  actualNoticeDays: number; noticeServingDays: number;
  buyoutEligible: boolean; buyoutAmount: string | null;
  gratuityEligible: boolean; gratuityAmount: string | null;
  finalised: boolean; finalisedAt: string | null;
} | null;

type Line = {
  id?: number;
  section: string;
  subsection: string;
  label: string;
  amount: number;
  payAction: "pay" | "recover" | "carryover" | "hold";
  days: number | null;
  comment: string | null;
};

const SECTIONS: Array<{ key: string; label: string }> = [
  { key: "leave",          label: "Leave changes" },
  { key: "attendance",     label: "Attendance changes" },
  { key: "salary",         label: "Salary changes" },
  { key: "reimbursements", label: "Reimbursements & expenses changes" },
  { key: "advances",       label: "Advance requests" },
  { key: "others",         label: "Other changes" },
];

const inr0 = (n: number) =>
  n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inrPlain = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (d: string | Date | null | undefined) =>
  !d ? "—" : new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/* ── Component ────────────────────────────────────────────────────────── */

export default function ExitFinaliseWizard({
  exit, settlement, lines, onClose, onSaved,
}: {
  exit: ExitHeader;
  settlement: SettlementHeader;
  lines: Array<{
    id: number; section: string; subsection: string; label: string;
    amount: string | number; payAction: string;
    days: string | number | null; comment: string | null;
  }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);

  // ── Per-section open/saved state ────────────────────────────────
  const [open, setOpen] = useState<Record<string, boolean>>({ others: true });
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // ── Settlement state ────────────────────────────────────────────
  const [paymentMode, setPaymentMode] = useState(settlement?.paymentMode ?? "pay");
  const [settlementMode] = useState(settlement?.settlementMode ?? "at_once");
  const [settlementDate, setSettlementDate] = useState(settlement?.settlementDate?.slice(0, 10) ?? "");
  const [settlementNotes, setSettlementNotes] = useState(settlement?.settlementNotes ?? "");

  // Notice period (Other changes panel)
  const [actualNoticeDays, setActualNoticeDays] = useState<number>(settlement?.actualNoticeDays ?? exit.noticePeriodDays);
  const [noticeServingDays, setNoticeServingDays] = useState<number>(settlement?.noticeServingDays ?? 0);
  const shortBy = Math.max(0, actualNoticeDays - noticeServingDays);

  const [buyoutEligible, setBuyoutEligible] = useState<boolean>(settlement?.buyoutEligible ?? false);
  const [buyoutAmount, setBuyoutAmount]     = useState<number>(Number(settlement?.buyoutAmount ?? 0));
  const [gratuityEligible, setGratuityEligible] = useState<boolean>(settlement?.gratuityEligible ?? false);
  const [gratuityAmount, setGratuityAmount] = useState<number>(Number(settlement?.gratuityAmount ?? 0));

  // Line items, materialised so each panel edits the same source of truth.
  const [items, setItems] = useState<Line[]>(
    lines.map(l => ({
      id: l.id,
      section: l.section,
      subsection: l.subsection,
      label: l.label,
      amount: Number(l.amount ?? 0),
      payAction: (l.payAction as Line["payAction"]) ?? "pay",
      days: l.days == null ? null : Number(l.days),
      comment: l.comment,
    })),
  );

  // ── UX: lock background scroll while modal is open ─────────────
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // ── Auto-fill pending salary (days worked up to the last working day, net) ──
  // into the Salary section — but only when HR hasn't already recorded a salary
  // line, so we never clobber a manual edit. The amount comes from the same
  // payslip-style proration (see /settlement/pending-salary). Editable + still
  // needs a Save like any other line.
  useEffect(() => {
    if (items.some(l => l.section === "salary")) return;
    let cancelled = false;
    fetch(`/api/hr/exits/${exit.id}/settlement/pending-salary`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d || d.alreadyPaid || !(Number(d.amount) > 0)) return;
        setItems(prev => prev.some(l => l.section === "salary") ? prev : [
          ...prev,
          {
            section: "salary", subsection: "salary_arrear",
            label: d.label || "Pending salary (days worked)",
            amount: Number(d.amount), payAction: "pay",
            days: d.paidDays ?? null,
            comment: "Auto-calculated for days worked up to the last working day (net). Edit if needed.",
          },
        ]);
        setOpen(o => ({ ...o, salary: true }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // run once on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived totals (for Step 2) ────────────────────────────────
  const totals = useMemo(() => {
    let pay = 0, recover = 0, hold = 0, carry = 0;
    for (const l of items) {
      const v = Number(l.amount) || 0;
      if (l.payAction === "recover") recover += v;
      else if (l.payAction === "hold") hold += v;
      else if (l.payAction === "carryover") carry += v;
      else pay += v;
    }
    // Buyout / gratuity are headers not lines — include them in the net.
    if (buyoutEligible)   pay += buyoutAmount;
    if (gratuityEligible) pay += gratuityAmount;
    return { pay, recover, hold, carry, net: pay - recover };
  }, [items, buyoutEligible, buyoutAmount, gratuityEligible, gratuityAmount]);

  // ── Persistence helpers ────────────────────────────────────────
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  const buildBody = () => ({
    paymentMode, settlementMode,
    settlementDate: settlementDate || null,
    settlementNotes: settlementNotes || null,
    actualNoticeDays, noticeServingDays,
    buyoutEligible, buyoutAmount: buyoutEligible ? buyoutAmount : null,
    gratuityEligible, gratuityAmount: gratuityEligible ? gratuityAmount : null,
    lines: items.map(l => ({
      section: l.section, subsection: l.subsection, label: l.label,
      amount: Number(l.amount) || 0,
      payAction: l.payAction, days: l.days, comment: l.comment,
    })).filter(l => l.label.trim().length > 0),
  });

  const persist = async (): Promise<boolean> => {
    setError("");
    try {
      const res = await fetch(`/api/hr/exits/${exit.id}/settlement`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || "Save failed"); return false; }
      onSaved();
      return true;
    } catch (e: any) {
      setError(e?.message || "Save failed");
      return false;
    }
  };

  // Per-section save: persists the whole settlement (we don't have a
  // per-section endpoint — the body is small enough that this is fine),
  // then flips the section's row to the "Saved Successfully" state.
  const saveSection = async (key: string) => {
    setSavingKey(key);
    const ok = await persist();
    setSavingKey(null);
    if (ok) setSavedAt(prev => ({ ...prev, [key]: Date.now() }));
  };

  // ── Footer actions ─────────────────────────────────────────────
  const finalise = async () => {
    if (!settlementDate) { setError("Settlement date is required to finalise."); return; }
    const ok = await persist();
    if (!ok) return;
    setSavingKey("__final");
    try {
      const res = await fetch(`/api/hr/exits/${exit.id}/settlement/finalise`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || "Finalise failed"); return; }
      onSaved();
      onClose();
    } finally { setSavingKey(null); }
  };

  // Generate the branded "Full & Final Settlement Letter" (fnf_settlement
  // template) as a PDF — the same letter Admin → Templates produces, with
  // the employee's brand chrome (NB Media → YT Money Productions letterhead
  // + Nikit Bassi; YT Labs → BILLION FILMS + Kunal Lall) resolved
  // server-side. The net payable is passed as the FnF amount; resignation /
  // last-working-day are pulled from the employee record by the renderer.
  const downloadStatement = async () => {
    setDownloading(true); setError("");
    try {
      const fnfAmount = Number(totals.net || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const res = await fetch(`/api/hr/letter-templates/fnf_settlement/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: exit.userId,
          action: "pdf",
          customFields: { FnFAmount: fnfAmount },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Could not generate the F&F letter");
      }
      const ct = res.headers.get("content-type") || "";
      const isPdf = ct.includes("pdf");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `FF-Settlement-${exit.userName.replace(/\s+/g, "_")}.${isPdf ? "pdf" : "html"}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      setError(e?.message || "Could not generate the F&F letter");
    } finally {
      setDownloading(false);
    }
  };

  /* ── Render ──────────────────────────────────────────────────── */

  const isFinalised = !!settlement?.finalised;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch justify-center">
      <div className="bg-slate-50 w-full h-full flex flex-col">
        {/* ── Top bar ───────────────────────────────────────────── */}
        <header className="bg-white border-b border-slate-200 px-6 pt-4 pb-3 flex items-start justify-between gap-6">
          <div>
            <h1 className="text-[16px] font-bold text-slate-800">Review and finalise payables</h1>
            <p className="text-[11.5px] text-slate-500 mt-0.5">
              {step === 1 ? "Configure each payable component, then continue to finalise." : "Confirm settlement and lock the F&F statement."}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <StepIndicator step={step} onJump={(n) => setStep(n)} />
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="h-9 px-4 rounded-md text-[12.5px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              {step === 1 ? (
                <button
                  onClick={async () => { const ok = await persist(); if (ok) setStep(2); }}
                  disabled={savingKey !== null || isFinalised}
                  className="h-9 px-4 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5"
                >
                  Save & Next <ChevronRight size={14} />
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setStep(1)}
                    className="h-9 px-4 rounded-md border border-slate-200 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Back
                  </button>
                  <button
                    onClick={finalise}
                    disabled={savingKey !== null || isFinalised}
                    className="h-9 px-5 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5"
                  >
                    {savingKey === "__final" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    {isFinalised ? "Finalised" : "Finalise"}
                  </button>
                </>
              )}
            </div>
          </div>
        </header>

        {/* ── Employee info row ─────────────────────────────────── */}
        <EmployeeInfoBar exit={exit} />

        {/* ── Body ──────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="max-w-5xl mx-auto mb-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-[12px]">
              <AlertCircle size={13} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {step === 1 ? (
            <Step1
              open={open} setOpen={setOpen}
              savedAt={savedAt} savingKey={savingKey}
              onSave={saveSection}
              actualNoticeDays={actualNoticeDays} setActualNoticeDays={setActualNoticeDays}
              noticeServingDays={noticeServingDays} setNoticeServingDays={setNoticeServingDays}
              shortBy={shortBy}
              buyoutEligible={buyoutEligible} setBuyoutEligible={setBuyoutEligible}
              buyoutAmount={buyoutAmount} setBuyoutAmount={setBuyoutAmount}
              gratuityEligible={gratuityEligible} setGratuityEligible={setGratuityEligible}
              gratuityAmount={gratuityAmount} setGratuityAmount={setGratuityAmount}
              items={items} setItems={setItems}
              isFinalised={isFinalised}
            />
          ) : (
            <Step2
              totals={totals}
              exit={exit}
              paymentMode={paymentMode} setPaymentMode={setPaymentMode}
              settlementDate={settlementDate} setSettlementDate={setSettlementDate}
              settlementNotes={settlementNotes} setSettlementNotes={setSettlementNotes}
              onDownload={downloadStatement}
              downloading={downloading}
              isFinalised={isFinalised}
            />
          )}
        </div>
      </div>

      {/* Close button hovers in the top-right corner */}
      <button
        onClick={onClose}
        className="fixed top-3 right-3 h-9 w-9 rounded-md bg-white border border-slate-200 hover:bg-slate-100 inline-flex items-center justify-center text-slate-500 shadow-sm"
        title="Close"
      >
        <X size={16} />
      </button>
    </div>
  );
}

/* ── Step indicator ───────────────────────────────────────────────────── */

function StepIndicator({ step, onJump }: { step: 1 | 2; onJump: (n: 1 | 2) => void }) {
  return (
    <div className="inline-flex items-center gap-2">
      <Pill n={1} label="PAYABLE COMPONENTS" active={step === 1} done={step === 2} onClick={() => onJump(1)} />
      <span className="w-8 h-px bg-slate-300" />
      <Pill n={2} label="FINALISE"           active={step === 2} done={false}      onClick={() => step === 2 || onJump(2)} />
    </div>
  );
}

function Pill({ n, label, active, done, onClick }: {
  n: number; label: string; active: boolean; done: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2"
    >
      <span
        className={`h-6 w-6 rounded-full inline-flex items-center justify-center text-[11px] font-bold ring-1 ring-inset ${
          active ? "bg-indigo-600 text-white ring-indigo-600"
            : done ? "bg-emerald-500 text-white ring-emerald-500"
            : "bg-white text-slate-500 ring-slate-300"
        }`}
      >
        {done ? <Check size={12} /> : n}
      </span>
      <span className={`text-[10.5px] font-bold tracking-[0.08em] ${
        active ? "text-indigo-700" : done ? "text-emerald-700" : "text-slate-500"
      }`}>
        {label}
      </span>
    </button>
  );
}

/* ── Employee info bar ────────────────────────────────────────────────── */

function EmployeeInfoBar({ exit }: { exit: ExitHeader }) {
  const isExited = exit.status === "exited" || exit.status === "offboarded";
  const initials = (exit.userName || "?")
    .split(/\s+/).slice(0, 2).map(s => s[0] ?? "").join("").toUpperCase();

  // Fields the current backend doesn't yet plumb through — show "—" until
  // we extend GET /api/hr/exits/:id with these.
  const workerType    = "—";
  const location      = "—";
  const dateOfJoining = null;
  const probationEnd  = null;

  return (
    <div className="bg-white border-b border-slate-200 px-6 py-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-10 w-10 rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100 inline-flex items-center justify-center text-[12px] font-bold">
          {initials || "·"}
        </div>
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-bold text-slate-800">{exit.userName}</h2>
          {isExited && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ring-rose-200 bg-rose-50 text-rose-700">
              Exited
            </span>
          )}
        </div>
        {exit.designation && (
          <span className="text-[12px] text-slate-500">· {exit.designation}</span>
        )}
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-6 gap-x-6 gap-y-2 text-[11.5px]">
        <Meta label="Worker type"           value={workerType} />
        <Meta label="Department"            value={exit.department ?? "—"} />
        <Meta label="Location"              value={location} />
        <Meta label="Date of Joining"       value={fmtDate(dateOfJoining)} />
        <Meta label="Probation End Date"    value={fmtDate(probationEnd)} />
        <Meta label="Tentative Last Day"    value={fmtDate(exit.lastWorkingDay)} />
      </dl>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase font-bold tracking-[0.06em] text-slate-400 mb-0.5">{label}</dt>
      <dd className="text-[12px] text-slate-800 font-semibold truncate">{value}</dd>
    </div>
  );
}

/* ── Step 1: accordion list ───────────────────────────────────────────── */

function Step1({
  open, setOpen, savedAt, savingKey, onSave,
  actualNoticeDays, setActualNoticeDays,
  noticeServingDays, setNoticeServingDays,
  shortBy,
  buyoutEligible, setBuyoutEligible,
  buyoutAmount, setBuyoutAmount,
  gratuityEligible, setGratuityEligible,
  gratuityAmount, setGratuityAmount,
  items, setItems,
  isFinalised,
}: {
  open: Record<string, boolean>;
  setOpen: (u: (p: Record<string, boolean>) => Record<string, boolean>) => void;
  savedAt: Record<string, number>;
  savingKey: string | null;
  onSave: (key: string) => void;
  actualNoticeDays: number; setActualNoticeDays: (n: number) => void;
  noticeServingDays: number; setNoticeServingDays: (n: number) => void;
  shortBy: number;
  buyoutEligible: boolean; setBuyoutEligible: (v: boolean) => void;
  buyoutAmount: number; setBuyoutAmount: (n: number) => void;
  gratuityEligible: boolean; setGratuityEligible: (v: boolean) => void;
  gratuityAmount: number; setGratuityAmount: (n: number) => void;
  items: Line[]; setItems: (u: (p: Line[]) => Line[]) => void;
  isFinalised: boolean;
}) {
  return (
    <div className="max-w-5xl mx-auto space-y-3">
      {SECTIONS.map(s => (
        <Accordion
          key={s.key}
          k={s.key}
          label={s.label}
          isOpen={!!open[s.key]}
          toggle={() => setOpen(p => ({ ...p, [s.key]: !p[s.key] }))}
          saving={savingKey === s.key}
          savedAt={savedAt[s.key]}
          onSave={() => onSave(s.key)}
          disabled={isFinalised}
        >
          {s.key === "others" ? (
            <OtherChangesPanel
              actualNoticeDays={actualNoticeDays} setActualNoticeDays={setActualNoticeDays}
              noticeServingDays={noticeServingDays} setNoticeServingDays={setNoticeServingDays}
              shortBy={shortBy}
              buyoutEligible={buyoutEligible} setBuyoutEligible={setBuyoutEligible}
              buyoutAmount={buyoutAmount} setBuyoutAmount={setBuyoutAmount}
              gratuityEligible={gratuityEligible} setGratuityEligible={setGratuityEligible}
              gratuityAmount={gratuityAmount} setGratuityAmount={setGratuityAmount}
              items={items} setItems={setItems}
              disabled={isFinalised}
            />
          ) : (
            <LineEditor
              section={s.key}
              items={items}
              setItems={setItems}
              disabled={isFinalised}
            />
          )}
        </Accordion>
      ))}
    </div>
  );
}

/* ── Accordion shell with per-section Save ────────────────────────────── */

function Accordion({
  k, label, isOpen, toggle, saving, savedAt, onSave, disabled, children,
}: {
  k: string;
  label: string;
  isOpen: boolean;
  toggle: () => void;
  saving: boolean;
  savedAt: number | undefined;
  onSave: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const justSaved = !!savedAt;
  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <header className="px-5 py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/60" onClick={toggle}>
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>
            <ChevronRight size={14} className="text-slate-400" />
          </span>
          <h3 className="text-[13px] font-bold text-slate-800">{label}</h3>
          {justSaved && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-emerald-700">
              <CheckCircle2 size={11} className="text-emerald-500" />
              Saved Successfully
            </span>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onSave(); }}
          disabled={saving || disabled}
          className={`h-7 px-3 rounded-md text-[11px] font-semibold inline-flex items-center gap-1 transition-colors ${
            justSaved
              ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
              : "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 ring-1 ring-inset ring-indigo-200 disabled:opacity-50"
          }`}
        >
          {saving ? (
            <><Loader2 size={11} className="animate-spin" /> Saving</>
          ) : justSaved ? (
            <><Check size={11} /> Saved</>
          ) : (
            <>Save</>
          )}
        </button>
      </header>
      {isOpen && (
        <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/30">
          {children}
        </div>
      )}
    </section>
  );
}

/* ── Generic line editor for the simpler sections ─────────────────────── */

function LineEditor({
  section, items, setItems, disabled,
}: {
  section: string;
  items: Line[];
  setItems: (u: (p: Line[]) => Line[]) => void;
  disabled?: boolean;
}) {
  const slice = items
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) => l.section === section);

  const addRow = () =>
    setItems(prev => [...prev, {
      section, subsection: section, label: "",
      amount: 0, payAction: "pay", days: null, comment: null,
    }]);
  const update = (idx: number, patch: Partial<Line>) =>
    setItems(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  const remove = (idx: number) =>
    setItems(prev => prev.filter((_, i) => i !== idx));

  return (
    <div className="space-y-3">
      {slice.length === 0 ? (
        <p className="text-[12px] text-slate-500 italic">No changes recorded for this section.</p>
      ) : (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide font-bold text-slate-500 border-b border-slate-200">
              <th className="text-left pb-2">Description</th>
              <th className="text-right pb-2 w-20">Days</th>
              <th className="text-right pb-2 w-28">Amount</th>
              <th className="text-left  pb-2 w-32">Action</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {slice.map(({ l, idx }) => (
              <tr key={idx} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-2">
                  <input
                    value={l.label}
                    onChange={e => update(idx, { label: e.target.value })}
                    placeholder="e.g. Leave encashment"
                    className="w-full h-8 px-2 rounded border border-slate-200 bg-white focus:outline-none focus:border-indigo-500 text-[12.5px]"
                    disabled={disabled}
                  />
                </td>
                <td className="py-2 px-1">
                  <input
                    type="number" step="0.5"
                    value={l.days ?? ""}
                    onChange={e => update(idx, { days: e.target.value === "" ? null : Number(e.target.value) })}
                    className="w-full h-8 px-2 text-right tabular-nums rounded border border-slate-200 bg-white focus:outline-none focus:border-indigo-500 text-[12.5px]"
                    disabled={disabled}
                  />
                </td>
                <td className="py-2 px-1">
                  <input
                    type="number" step="1"
                    value={l.amount}
                    onChange={e => update(idx, { amount: Number(e.target.value) })}
                    className="w-full h-8 px-2 text-right tabular-nums rounded border border-slate-200 bg-white focus:outline-none focus:border-indigo-500 text-[12.5px] font-semibold"
                    disabled={disabled}
                  />
                </td>
                <td className="py-2 pl-1">
                  <select
                    value={l.payAction}
                    onChange={e => update(idx, { payAction: e.target.value as Line["payAction"] })}
                    className="w-full h-8 px-2 rounded border border-slate-200 bg-white focus:outline-none focus:border-indigo-500 text-[12.5px]"
                    disabled={disabled}
                  >
                    <option value="pay">Pay</option>
                    <option value="recover">Recover</option>
                    <option value="hold">Hold</option>
                    <option value="carryover">Carry over</option>
                  </select>
                </td>
                <td className="py-2 pl-1 text-right">
                  <button
                    onClick={() => remove(idx)}
                    disabled={disabled}
                    className="text-slate-300 hover:text-rose-500 disabled:opacity-30"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button
        onClick={addRow}
        disabled={disabled}
        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11.5px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
      >
        <Plus size={12} /> Add
      </button>
    </div>
  );
}

/* ── Other changes — the rich panel ───────────────────────────────────── */

function OtherChangesPanel({
  actualNoticeDays, setActualNoticeDays,
  noticeServingDays, setNoticeServingDays,
  shortBy,
  buyoutEligible, setBuyoutEligible,
  buyoutAmount, setBuyoutAmount,
  gratuityEligible, setGratuityEligible,
  gratuityAmount, setGratuityAmount,
  items, setItems,
  disabled,
}: {
  actualNoticeDays: number; setActualNoticeDays: (n: number) => void;
  noticeServingDays: number; setNoticeServingDays: (n: number) => void;
  shortBy: number;
  buyoutEligible: boolean; setBuyoutEligible: (v: boolean) => void;
  buyoutAmount: number; setBuyoutAmount: (n: number) => void;
  gratuityEligible: boolean; setGratuityEligible: (v: boolean) => void;
  gratuityAmount: number; setGratuityAmount: (n: number) => void;
  items: Line[]; setItems: (u: (p: Line[]) => Line[]) => void;
  disabled?: boolean;
}) {
  // Contribution + tax overrides are display-only for now (no backend
  // column yet). Local state lets HR see the table behaviour matches the
  // Keka layout; a follow-up migration will persist the figures.
  const [esiProjected, setEsiProjected]   = useState<number>(0);
  const [esiOverridden, setEsiOverridden] = useState<number>(0);
  const [lwfProjected, setLwfProjected]   = useState<number>(0);
  const [lwfOverridden, setLwfOverridden] = useState<number>(0);
  const [ptProjected, setPtProjected]     = useState<number>(0);
  const [ptOverridden, setPtOverridden]   = useState<number>(0);
  const [itProjected, setItProjected]     = useState<number>(0);
  const [itOverridden, setItOverridden]   = useState<number>(0);

  return (
    <div className="space-y-6">
      {/* ── Notice period buyout ────────────────────────────────── */}
      <SubBlock title="Notice period buyout">
        <div className="grid grid-cols-3 gap-3 mb-3">
          <Stat label="Actual"   value={actualNoticeDays}   onChange={setActualNoticeDays}   suffix="days" disabled={disabled} />
          <Stat label="Serving"  value={noticeServingDays}  onChange={setNoticeServingDays}  suffix="day"  disabled={disabled} />
          <Stat label="Short by" value={shortBy}            readOnly                            suffix="days" tone="amber" />
        </div>
        <p className="text-[12px] text-slate-700 mb-2">
          Do you want employee to buyout the remaining notice period days?
        </p>
        <div className="flex items-center gap-4">
          <Radio checked={buyoutEligible}  onChange={() => setBuyoutEligible(true)}  label="Yes" disabled={disabled} />
          <Radio checked={!buyoutEligible} onChange={() => setBuyoutEligible(false)} label="No"  disabled={disabled} />
          {buyoutEligible && (
            <label className="inline-flex items-center gap-2 ml-4 text-[12px] text-slate-700">
              Amount
              <input
                type="number"
                value={buyoutAmount}
                onChange={e => setBuyoutAmount(Number(e.target.value))}
                className="h-8 w-32 px-2 text-right tabular-nums rounded border border-slate-200 bg-white focus:outline-none focus:border-indigo-500 text-[12px]"
                disabled={disabled}
              />
            </label>
          )}
        </div>
      </SubBlock>

      {/* ── Gratuity ─────────────────────────────────────────── */}
      <SubBlock title="Gratuity">
        <label className="inline-flex items-center gap-2 cursor-pointer text-[12.5px] text-slate-700">
          <input
            type="checkbox"
            checked={gratuityEligible}
            onChange={e => setGratuityEligible(e.target.checked)}
            disabled={disabled}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Employee is eligible for gratuity payment
        </label>
        {gratuityEligible && (
          <div className="mt-2 inline-flex items-center gap-2 text-[12px] text-slate-700">
            Amount
            <input
              type="number"
              value={gratuityAmount}
              onChange={e => setGratuityAmount(Number(e.target.value))}
              className="h-8 w-32 px-2 text-right tabular-nums rounded border border-slate-200 bg-white focus:outline-none focus:border-indigo-500 text-[12px]"
              disabled={disabled}
            />
          </div>
        )}
      </SubBlock>

      {/* ── One-time payments & Reimbursements ─────────────── */}
      <SubBlock title="One-time payments & Reimbursements">
        <SectionLines section="others-onetime" items={items} setItems={setItems} disabled={disabled} emptyText="There are no one time payments" />
      </SubBlock>

      {/* ── Any other settlement amount ─────────────────────── */}
      <SubBlock title="Any other settlement amount">
        <SectionLines section="others-misc" items={items} setItems={setItems} disabled={disabled} emptyText="There are no other settlement amounts" />
      </SubBlock>

      {/* ── Loans ────────────────────────────────────────────── */}
      <SubBlock title="Loans">
        <p className="text-[12px] text-slate-500 italic">There are no active loans for this employee.</p>
      </SubBlock>

      {/* ── Contribution overrides ──────────────────────────── */}
      <SubBlock title="Contribution overrides">
        <OverrideTable
          rows={[
            { label: "ESI", projected: esiProjected, setProjected: setEsiProjected, overridden: esiOverridden, setOverridden: setEsiOverridden },
            { label: "LWF", projected: lwfProjected, setProjected: setLwfProjected, overridden: lwfOverridden, setOverridden: setLwfOverridden },
          ]}
          disabled={disabled}
        />
      </SubBlock>

      {/* ── Tax overrides ───────────────────────────────────── */}
      <SubBlock title="Tax overrides">
        <OverrideTable
          rows={[
            { label: "PT",         projected: ptProjected, setProjected: setPtProjected, overridden: ptOverridden, setOverridden: setPtOverridden },
            { label: "Income Tax", projected: itProjected, setProjected: setItProjected, overridden: itOverridden, setOverridden: setItOverridden },
          ]}
          disabled={disabled}
        />
      </SubBlock>
    </div>
  );
}

function SubBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[12px] font-bold text-slate-700 mb-2">{title}</h4>
      <div className="bg-white rounded-md border border-slate-200 p-4">{children}</div>
    </div>
  );
}

function Stat({
  label, value, onChange, readOnly, suffix, tone, disabled,
}: {
  label: string; value: number;
  onChange?: (n: number) => void;
  readOnly?: boolean; suffix?: string;
  tone?: "amber"; disabled?: boolean;
}) {
  return (
    <div className={`rounded-md border p-2.5 ${
      tone === "amber" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"
    }`}>
      <p className="text-[10px] uppercase font-bold tracking-[0.06em] text-slate-500">{label}</p>
      {readOnly ? (
        <p className="text-[14px] font-bold text-slate-800 tabular-nums mt-1">
          {value} <span className="text-[10px] font-medium text-slate-500">{suffix}</span>
        </p>
      ) : (
        <div className="flex items-baseline gap-1 mt-1">
          <input
            type="number"
            value={value}
            onChange={e => onChange?.(Number(e.target.value))}
            disabled={disabled}
            className="w-full text-[14px] font-bold text-slate-800 tabular-nums bg-transparent focus:outline-none border-b border-transparent focus:border-indigo-500 disabled:opacity-50"
          />
          {suffix && <span className="text-[10px] font-medium text-slate-500">{suffix}</span>}
        </div>
      )}
    </div>
  );
}

function Radio({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: () => void; label: string; disabled?: boolean;
}) {
  return (
    <label className={`inline-flex items-center gap-2 cursor-pointer text-[12.5px] text-slate-700 ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
      <span className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${checked ? "border-indigo-600" : "border-slate-300"}`}>
        {checked && <span className="h-2 w-2 rounded-full bg-indigo-600" />}
      </span>
      <input type="radio" checked={checked} onChange={onChange} disabled={disabled} className="sr-only" />
      {label}
    </label>
  );
}

function SectionLines({
  section, items, setItems, disabled, emptyText,
}: {
  section: string;
  items: Line[];
  setItems: (u: (p: Line[]) => Line[]) => void;
  disabled?: boolean;
  emptyText: string;
}) {
  const slice = items
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) => l.subsection === section);

  const add = () =>
    setItems(prev => [...prev, {
      section: "others", subsection: section, label: "",
      amount: 0, payAction: "pay", days: null, comment: null,
    }]);
  const update = (idx: number, patch: Partial<Line>) =>
    setItems(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  const remove = (idx: number) =>
    setItems(prev => prev.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2">
      {slice.length === 0 ? (
        <p className="text-[12px] text-slate-500 italic">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {slice.map(({ l, idx }) => (
            <li key={idx} className="grid grid-cols-[1fr_140px_100px_30px] gap-2 items-center">
              <input
                value={l.label}
                onChange={e => update(idx, { label: e.target.value })}
                placeholder="Description"
                className="h-8 px-2 rounded border border-slate-200 bg-white focus:outline-none focus:border-indigo-500 text-[12.5px]"
                disabled={disabled}
              />
              <input
                type="number"
                value={l.amount}
                onChange={e => update(idx, { amount: Number(e.target.value) })}
                className="h-8 px-2 text-right tabular-nums rounded border border-slate-200 bg-white focus:outline-none focus:border-indigo-500 text-[12.5px] font-semibold"
                disabled={disabled}
              />
              <select
                value={l.payAction}
                onChange={e => update(idx, { payAction: e.target.value as Line["payAction"] })}
                className="h-8 px-2 rounded border border-slate-200 bg-white focus:outline-none focus:border-indigo-500 text-[12px]"
                disabled={disabled}
              >
                <option value="pay">Pay</option>
                <option value="recover">Recover</option>
                <option value="hold">Hold</option>
              </select>
              <button onClick={() => remove(idx)} disabled={disabled} className="text-slate-300 hover:text-rose-500 disabled:opacity-30">
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={add}
        disabled={disabled}
        className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-indigo-700 hover:underline disabled:opacity-50"
      >
        <Plus size={12} /> Add
      </button>
    </div>
  );
}

function OverrideTable({
  rows, disabled,
}: {
  rows: Array<{
    label: string;
    projected: number; setProjected: (n: number) => void;
    overridden: number; setOverridden: (n: number) => void;
  }>;
  disabled?: boolean;
}) {
  return (
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="text-[10px] uppercase tracking-wide font-bold text-slate-500 border-b border-slate-200">
          <th className="text-left pb-2">Component</th>
          <th className="text-right pb-2 w-32">Projected (₹)</th>
          <th className="text-right pb-2 w-32">Overridden (₹)</th>
          <th className="text-right pb-2 w-28">Final (₹)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const final = r.overridden || r.projected;
          return (
            <tr key={r.label} className="border-b border-slate-100 last:border-0">
              <td className="py-2 text-slate-800 font-semibold">{r.label}</td>
              <td className="py-2 pr-2">
                <input
                  type="number"
                  value={r.projected}
                  onChange={e => r.setProjected(Number(e.target.value))}
                  disabled={disabled}
                  className="w-full h-8 px-2 text-right tabular-nums rounded border border-slate-200 bg-white focus:outline-none focus:border-indigo-500"
                />
              </td>
              <td className="py-2 pr-2">
                <input
                  type="number"
                  value={r.overridden}
                  onChange={e => r.setOverridden(Number(e.target.value))}
                  disabled={disabled}
                  className="w-full h-8 px-2 text-right tabular-nums rounded border border-slate-200 bg-white focus:outline-none focus:border-indigo-500"
                />
              </td>
              <td className="py-2 text-right tabular-nums font-semibold text-slate-800">
                {inrPlain(final)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ── Step 2: Finalise ─────────────────────────────────────────────────── */

function Step2({
  totals, exit,
  paymentMode, setPaymentMode,
  settlementDate, setSettlementDate,
  settlementNotes, setSettlementNotes,
  onDownload, downloading,
  isFinalised,
}: {
  totals: { pay: number; recover: number; hold: number; carry: number; net: number };
  exit: ExitHeader;
  paymentMode: string; setPaymentMode: (v: string) => void;
  settlementDate: string; setSettlementDate: (v: string) => void;
  settlementNotes: string; setSettlementNotes: (v: string) => void;
  onDownload: () => void; downloading: boolean;
  isFinalised: boolean;
}) {
  const lwdMonth = new Date(exit.lastWorkingDay).toLocaleString("en-IN", { month: "short", year: "numeric" });
  const monthLabel = `Salary - ${lwdMonth}`;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Strap-line header */}
      <div className="text-[14px] font-bold text-slate-800">
        Settlement amount is paid at once
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SummaryCard
          tone="emerald"
          title="Payable summary"
          highlight={{ label: "Total Payable", value: totals.pay }}
          rows={[
            [monthLabel, totals.pay],
            ["Other Month's Salary", 0],
          ]}
        />
        <SummaryCard
          tone="rose"
          title="Deductions summary"
          highlight={{ label: "Total Deductions", value: totals.recover }}
          rows={[
            ["Income Tax", 0],
            ["Other Deductions", totals.recover],
          ]}
        />
      </div>

      {/* Net payable table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-slate-50 text-[10.5px] uppercase tracking-wide font-bold text-slate-500">
              <th className="text-left  px-4 py-2.5">Month</th>
              <th className="text-right px-4 py-2.5">Payable Amount</th>
              <th className="text-right px-4 py-2.5">Amount Recovered</th>
              <th className="text-right px-4 py-2.5">Final Payable</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100">
              <td className="px-4 py-2.5 text-slate-800">{monthLabel}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{inrPlain(totals.pay)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{inrPlain(totals.recover)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-800">{inrPlain(totals.net)}</td>
            </tr>
            <tr className="border-t border-slate-200 bg-slate-50/60 font-bold">
              <td className="px-4 py-2.5 text-slate-800">Total</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{inrPlain(totals.pay)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{inrPlain(totals.recover)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{inrPlain(totals.net)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Info banner */}
      <div className="rounded-md bg-sky-50 ring-1 ring-inset ring-sky-200 px-4 py-2.5 text-[12.5px] text-sky-800 flex items-start gap-2">
        <span className="mt-0.5">ℹ</span>
        <span>
          Total of <strong className="text-sky-900">{inr0(totals.net)}</strong> will be considered in payroll and will be paid out to the employee.
        </span>
      </div>

      {/* Action area */}
      <div className="flex justify-center">
        <button
          onClick={onDownload}
          disabled={downloading}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-md bg-white border border-slate-300 hover:bg-slate-50 text-[12.5px] font-semibold text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {downloading ? "Generating…" : "Download F&F Statement"}
        </button>
      </div>

      {/* Settlement controls */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div>
          <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
            What do you want to do with the settlement amount of <strong>{inr0(totals.net)}</strong>?
          </label>
          <select
            value={paymentMode}
            onChange={e => setPaymentMode(e.target.value)}
            disabled={isFinalised}
            className="h-10 w-full rounded-md border border-slate-200 bg-white text-[13px] text-slate-800 focus:outline-none focus:border-indigo-500 disabled:bg-slate-50"
          >
            <option value="pay">Pay</option>
            <option value="hold">Hold</option>
            <option value="already_paid">Already Paid</option>
          </select>
        </div>

        <div>
          <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Settlement Date</label>
          <DateField value={settlementDate} onChange={setSettlementDate} disabled={isFinalised} />
        </div>

        <div>
          <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Settlement notes</label>
          <textarea
            rows={3}
            value={settlementNotes}
            onChange={e => setSettlementNotes(e.target.value)}
            disabled={isFinalised}
            placeholder="Add any notes for the audit log…"
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-[13px] text-slate-800 focus:outline-none focus:border-indigo-500 resize-none disabled:bg-slate-50"
          />
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  tone, title, highlight, rows,
}: {
  tone: "emerald" | "rose";
  title: string;
  highlight: { label: string; value: number };
  rows: Array<[string, number]>;
}) {
  const toneRing = tone === "emerald"
    ? "ring-emerald-200 bg-emerald-50/40"
    : "ring-rose-200 bg-rose-50/40";
  const toneNum = tone === "emerald" ? "text-emerald-700" : "text-rose-700";

  return (
    <section className={`rounded-lg ring-1 ring-inset ${toneRing} p-5`}>
      <p className="text-[11px] uppercase tracking-wide font-bold text-slate-500">{title}</p>
      <p className="mt-1 text-[10.5px] text-slate-500">{highlight.label}</p>
      <p className={`text-[22px] font-bold tabular-nums ${toneNum}`}>{inr0(highlight.value)}</p>
      <dl className="mt-3 space-y-1.5 text-[12px]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between">
            <dt className="text-slate-600">{label}</dt>
            <dd className="text-slate-800 font-semibold tabular-nums">{inr0(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
