"use client";

// Salary Structure panel rendered on the user-profile page. Mirrors the
// onboarding wizard's "Compensation" step so HR admins can fill in or
// adjust a user's salary after onboarding (or for legacy users who were
// imported before the wizard existed).
//
// Visibility rules are enforced by the parent page: HR admin tier OR the
// profile owner can SEE this panel; only HR admin tier can SAVE.

import { useEffect, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { regularSplit } from "@/lib/hr/salary-split";
import {
  CheckCircle2, AlertCircle, IndianRupee, Save, Wallet, Info, Lock, Calendar,
  MoreVertical, Plus, X, Paperclip, TrendingUp,
} from "lucide-react";
import CustomSelect from "@/components/ui/CustomSelect";
import SelectField from "@/components/ui/SelectField";
import { DatePicker } from "@/components/ui/date-picker";
import { DateField } from "@/components/ui/date-field";

type Props = {
  userId: number;
  canEdit: boolean;
};

type ApiStructure = {
  id: number;
  userId: number;
  salaryType: string;
  payGroup: string | null;
  bonusIncluded: boolean;
  taxRegime: string | null;
  structureType: string | null;
  pfEligible: boolean;
  ctc: string;
  basic: string;
  hra: string;
  specialAllowance: string;
  pfEmployee: string;
  pfEmployer: string;
  esiEmployee: string;
  esiEmployer: string;
  tds: string;
  professionalTax: string;
  effectiveFrom: string;
};

type FormState = {
  salaryType: "Regular Employee" | "Intern";
  payGroup: string;
  annualSalary: string;       // regular: CTC; intern: 0 (we store stipend × 12 as basic)
  monthlyStipend: string;     // intern only
  bonusIncluded: boolean;
  pfEligible: boolean;
  structureType: string;      // "Range Based" | "Fixed"
  taxRegime: string;          // "New Regime (Section 115BAC)" | "Old Regime"
  effectiveFrom: string;      // YYYY-MM-DD
};

const EMPTY_FORM: FormState = {
  salaryType: "Regular Employee",
  payGroup: "NB Media",
  annualSalary: "",
  monthlyStipend: "",
  bonusIncluded: false,
  pfEligible: false,
  structureType: "Range Based",
  taxRegime: "New Regime (Section 115BAC)",
  effectiveFrom: new Date().toISOString().slice(0, 10),
};

// Map a saved API structure → form state (best-effort; same logic the
// onboarding wizard would use after re-loading a draft).
function apiToForm(s: ApiStructure | null): FormState {
  if (!s) return EMPTY_FORM;
  const isIntern = s.salaryType === "intern";
  return {
    salaryType: isIntern ? "Intern" : "Regular Employee",
    payGroup: s.payGroup || "NB Media",
    annualSalary: isIntern ? "" : String(parseFloat(s.ctc || "0") || ""),
    // For interns, the source-of-truth annual figure is `ctc`. Deriving
    // the form's monthly stipend off `ctc / 12` rather than off `basic`
    // means we don't care whether the underlying row is a legacy save
    // (basic stored as monthly) or a post-fix save (basic stored as
    // annual) — both have a correct `ctc` value, so both load right.
    monthlyStipend: isIntern ? String(Math.round((parseFloat(s.ctc || "0") || 0) / 12) || "") : "",
    bonusIncluded: !!s.bonusIncluded,
    pfEligible: !!s.pfEligible,
    structureType: s.structureType || "Range Based",
    taxRegime: s.taxRegime || "New Regime (Section 115BAC)",
    effectiveFrom: s.effectiveFrom ? s.effectiveFrom.slice(0, 10) : new Date().toISOString().slice(0, 10),
  };
}

// regularSplit + the fixed-amount constants now live in lib/hr/salary-split and
// are shared with the onboarding API (/api/users) so the two can't drift.

// Form state → POST body for /api/hr/payroll/salary-structure. Mirrors
// the field mapping the onboarding submit handler does.
function formToApi(f: FormState, userId: number) {
  if (f.salaryType === "Intern") {
    const stipend = parseFloat(f.monthlyStipend || "0") || 0;
    return {
      userId,
      salaryType:    "intern",
      payGroup:      null,
      bonusIncluded: false,
      taxRegime:     null,
      structureType: null,
      pfEligible:    false,
      // Both `ctc` and `basic` are stored as ANNUAL figures here —
      // matching how regular employees' rows are saved (basic = annual
      // amount, divided by 12 only at display time). Older intern rows
      // stored `basic` as the monthly amount and the breakup display
      // misrendered them as ₹2,916/month; storing × 12 is the canonical
      // fix and keeps the data model uniform across salary types.
      ctc:           stipend * 12,
      basic:         stipend * 12,
      hra:           0,
      specialAllowance: 0,
      pfEmployee: 0, pfEmployer: 0,
      esiEmployee: 0, esiEmployer: 0,
      tds: 0, professionalTax: 0,
      effectiveFrom: f.effectiveFrom,
    };
  }
  // Regular employee — per the company's CTC split formula.
  const annual = parseFloat(f.annualSalary || "0") || 0;
  const s = regularSplit(annual, !!f.pfEligible);
  return {
    userId,
    salaryType:    "regular",
    payGroup:      f.payGroup || null,
    bonusIncluded: !!f.bonusIncluded,
    taxRegime:     f.taxRegime || null,
    structureType: f.structureType || null,
    pfEligible:    !!f.pfEligible,
    ctc:           annual,
    basic:               s.basic,
    hra:                 s.hra,
    dearnessAllowance:   s.da,
    conveyanceAllowance: s.conv,
    medicalAllowance:    s.medical,
    specialAllowance:    s.special,
    pfEmployee:  s.pfEmp,
    pfEmployer:  s.pfEmpr,
    esiEmployee: 0, esiEmployer: 0,
    tds: 0, professionalTax: 0,
    effectiveFrom: f.effectiveFrom,
  };
}

const cls = {
  field: "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 disabled:bg-slate-50 disabled:text-slate-500",
  label: "block text-[11.5px] font-semibold text-slate-600 mb-1",
};

type SalaryHistoryRow = {
  id: number;
  action: string;
  oldCtc: string | null;
  newCtc: string | null;
  effectiveFrom: string | null;
  changedAt: string;
  actorName: string | null;
};

export default function SalaryStructurePanel({ userId, canEdit }: Props) {
  const apiUrl = `/api/hr/payroll/salary-structure?userId=${userId}`;
  const { data, isLoading } = useSWR<ApiStructure | null>(apiUrl, fetcher);
  // Salary revision timeline (old CTC → new CTC + effective date), from the
  // audit log. Mutated alongside apiUrl on every save/revision.
  const historyUrl = `/api/hr/payroll/salary-structure/history?userId=${userId}`;
  const { data: historyData } = useSWR<{ items: SalaryHistoryRow[] }>(historyUrl, fetcher);
  const history = historyData?.items ?? [];
  // Bonuses for the same user — merged into the history timeline so HR sees
  // salary revisions AND bonuses in one place. Re-fetched when a bonus is added.
  const bonusUrl = `/api/hr/payroll/bonus?userId=${userId}`;
  const { data: bonusData } = useSWR<{ items: any[] }>(bonusUrl, fetcher);
  const bonuses = bonusData?.items ?? [];
  const timeline = [
    ...history.map((h) => ({ key: `s${h.id}`, kind: "salary" as const, date: h.effectiveFrom || h.changedAt, h, b: null as any })),
    ...bonuses.map((b) => ({ key: `b${b.id}`, kind: "bonus" as const, date: b.effectiveDate, h: null as any, b })),
  ].sort((a, z) => new Date(z.date).getTime() - new Date(a.date).getTime());
  const [showHistory, setShowHistory] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // 3-dots menu + Add Bonus modal — admin-only.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [showBonusModal, setShowBonusModal] = useState(false);
  // Salary Revision modal — a focused "new salary, effective from <date>" flow.
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [revSalary, setRevSalary] = useState("");
  const [revDate, setRevDate] = useState("");
  const [revBusy, setRevBusy] = useState(false);
  const [revErr, setRevErr] = useState("");
  // Close the dots menu on outside click / Escape so it behaves like the
  // rest of the dashboard's overflow menus.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  // Sync form once the data arrives. We don't re-sync on every data
  // change to avoid clobbering local edits — only when the underlying
  // record id changes (re-fetched from server).
  useEffect(() => {
    setForm(apiToForm(data ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSavedAt(null);
    if (form.salaryType === "Intern" && !form.monthlyStipend) {
      setError("Enter the monthly stipend.");
      return;
    }
    if (form.salaryType === "Regular Employee" && !form.annualSalary) {
      setError("Enter the annual salary.");
      return;
    }
    // (No minimum-CTC gate: a low CTC is allowed — Special Allowance just
    // floors at 0 in regularSplit instead of going negative.)
    if (!form.effectiveFrom) {
      setError("Pick an effective-from date.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/hr/payroll/salary-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToApi(form, userId)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Save failed");
      setSavedAt(Date.now());
      mutate(apiUrl); mutate(historyUrl);
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // Salary Revision — set a new salary effective from a chosen date. Reuses the
  // same POST endpoint as a full edit, so the change is audited and shows up
  // under Payroll → Salary Revisions. The single SalaryStructure row is updated
  // in place to the new CTC + effectiveFrom (the AuditLog before/after is the
  // revision record — there is no separate history table).
  const submitRevision = async () => {
    setRevErr("");
    const amt = parseFloat(revSalary || "0") || 0;
    if (amt <= 0) { setRevErr(form.salaryType === "Intern" ? "Enter the new monthly stipend." : "Enter the new annual salary (CTC)."); return; }
    if (!revDate) { setRevErr("Pick the date the new salary takes effect."); return; }
    setRevBusy(true);
    try {
      const revised: FormState = form.salaryType === "Intern"
        ? { ...form, monthlyStipend: revSalary, effectiveFrom: revDate }
        : { ...form, annualSalary: revSalary, effectiveFrom: revDate };
      const res = await fetch("/api/hr/payroll/salary-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToApi(revised, userId)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Revision failed");
      setForm(revised);          // reflect the revised figures in the panel
      setSavedAt(Date.now());
      mutate(apiUrl); mutate(historyUrl);
      setShowRevisionModal(false);
    } catch (e: any) {
      setRevErr(e?.message || "Revision failed");
    } finally {
      setRevBusy(false);
    }
  };

  if (isLoading) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
      </section>
    );
  }

  const isIntern = form.salaryType === "Intern";

  // Pastel tint that drives the header accent — emerald for intern,
  // brand blue for regular. Keeps the card on-brand without dominating.
  const tint = isIntern ? "#059669" : "#3b82f6";
  const effectiveFromLabel = data && form.effectiveFrom
    ? new Date(form.effectiveFrom).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      {/* Top accent strip — fades to transparent so it reads as a refined
          tag rather than a hard line. */}
      <span
        aria-hidden
        className="block h-[3px] w-full"
        style={{ background: `linear-gradient(90deg, ${tint}, ${tint}80 60%, transparent)` }}
      />

      {/* ── Header ── */}
      <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1"
            style={{ background: `${tint}14`, color: tint, boxShadow: `inset 0 0 0 1px ${tint}33` }}
          >
            <Wallet size={18} />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">Salary structure</h3>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {effectiveFromLabel
                ? <>Effective from <span className="font-medium text-slate-700">{effectiveFromLabel}</span></>
                : "No structure assigned yet."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {!canEdit && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-600">
              <Lock size={10} /> Read-only
            </span>
          )}
          {data && (
            <span
              className="inline-flex h-6 items-center rounded-full px-2.5 text-[10.5px] font-bold uppercase tracking-wider ring-1"
              style={{ background: `${tint}14`, color: tint, boxShadow: `inset 0 0 0 1px ${tint}33` }}
            >
              {isIntern ? "Intern" : "Regular"}
            </span>
          )}
          {/* 3-dots menu — admin-only "+ Add Bonus" entry. Hidden when
              the viewer can't edit (no point dangling an action they
              can't run). */}
          {canEdit && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Salary actions"
                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                <MoreVertical size={15} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white shadow-lg py-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setRevErr("");
                      setRevSalary(form.salaryType === "Intern" ? form.monthlyStipend : form.annualSalary);
                      setRevDate(new Date().toISOString().slice(0, 10));
                      setShowRevisionModal(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
                  >
                    <TrendingUp size={13} className="text-emerald-600" />
                    Salary Revision
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); setShowBonusModal(true); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
                  >
                    <Plus size={13} className="text-[#3b82f6]" />
                    Add Bonus
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={onSave} className="space-y-5 px-6 py-5">
        {/* ── Top row: Salary Type + Effective From ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={cls.label}>Salary Type</label>
            <SelectField
              value={form.salaryType}
              onChange={(v) => set("salaryType", v as FormState["salaryType"])}
              disabled={!canEdit}
              options={["Regular Employee", "Intern"]}
              className={cls.field}
            />
          </div>
          <div>
            <label className={cls.label}>Effective From</label>
            <DateField
              value={form.effectiveFrom}
              onChange={(v) => set("effectiveFrom", v)}
              disabled={!canEdit}
              className="w-full"
            />
          </div>
        </div>

        {isIntern ? (
          <>
            {/* ── Compensation section header ── */}
            <div className="border-t border-slate-100 pt-4">
              <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Compensation</p>
              <label className={cls.label}>Monthly Stipend (INR / month)</label>
              <div className="relative">
                <IndianRupee className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="number"
                  value={form.monthlyStipend}
                  onChange={(e) => set("monthlyStipend", e.target.value)}
                  disabled={!canEdit}
                  placeholder="Enter monthly stipend"
                  className={`${cls.field} pl-8`}
                />
              </div>
              {form.monthlyStipend && (
                <p className="mt-1 text-[11px] text-slate-500">
                  Annualised: <span className="font-mono font-semibold text-slate-700">
                    ₹{(Number(form.monthlyStipend || 0) * 12).toLocaleString("en-IN")}
                  </span>
                </p>
              )}
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
              <Info size={14} className="mt-0.5 shrink-0 text-emerald-600" />
              <p className="text-[11.5px] leading-relaxed text-emerald-700">
                Interns are paid a flat monthly stipend — no PF, ESI, bonuses, or tax-regime selection.
              </p>
            </div>
          </>
        ) : (
          <>
            {/* ── Compensation section ── */}
            <div className="border-t border-slate-100 pt-4">
              <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Compensation</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={cls.label}>Pay Group</label>
                  <CustomSelect
                    listKey="payGroup"
                    defaults={["NB Media", "Contractor"]}
                    value={form.payGroup}
                    onChange={(v) => set("payGroup", v)}
                    disabled={!canEdit}
                    readOnlyOptions={!canEdit}
                  />
                </div>
                <div>
                  <label className={cls.label}>Annual Salary (INR)</label>
                  <div className="relative">
                    <IndianRupee className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="number"
                      value={form.annualSalary}
                      onChange={(e) => set("annualSalary", e.target.value)}
                      disabled={!canEdit}
                      placeholder="Enter annual salary"
                      className={`${cls.field} pl-8`}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Bonus + Payroll Settings, side-by-side on wider screens ── */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-3.5 py-3">
                <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Bonus</p>
                <label className="inline-flex items-start gap-2 text-[12.5px] leading-snug text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.bonusIncluded}
                    onChange={(e) => set("bonusIncluded", e.target.checked)}
                    disabled={!canEdit}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#3b82f6] focus:ring-[#3b82f6]/30"
                  />
                  <span>
                    Bonus included in annual salary of{" "}
                    <span className="font-mono font-semibold text-slate-800">
                      ₹{Number(form.annualSalary || 0).toLocaleString("en-IN")}
                    </span>
                  </span>
                </label>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-3.5 py-3">
                <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Payroll settings</p>
                <label className="inline-flex items-center gap-2 text-[12.5px] text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.pfEligible}
                    onChange={(e) => set("pfEligible", e.target.checked)}
                    disabled={!canEdit}
                    className="h-4 w-4 rounded border-slate-300 text-[#3b82f6] focus:ring-[#3b82f6]/30"
                  />
                  Provident fund (PF) eligible
                </label>
                <div className="mt-2 flex items-start gap-1.5 rounded-md bg-sky-50 px-2 py-1.5">
                  <Info size={11} className="mt-0.5 shrink-0 text-sky-600" />
                  <p className="text-[10.5px] leading-snug text-sky-700">
                    ESI is not applicable for the selected Pay Group.
                  </p>
                </div>
              </div>
            </div>

            {/* ── Structure + tax regime ── */}
            <div className="border-t border-slate-100 pt-4">
              <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Tax & Structure</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={cls.label}>Salary Structure Type</label>
                  <CustomSelect
                    listKey="salaryStructure"
                    defaults={["Range Based", "Fixed"]}
                    value={form.structureType}
                    onChange={(v) => set("structureType", v)}
                    disabled={!canEdit}
                    readOnlyOptions={!canEdit}
                  />
                </div>
                <div>
                  <label className={cls.label}>Tax Regime</label>
                  <CustomSelect
                    listKey="taxRegime"
                    defaults={["New Regime (Section 115BAC)", "Old Regime"]}
                    value={form.taxRegime}
                    onChange={(v) => set("taxRegime", v)}
                    disabled={!canEdit}
                    readOnlyOptions={!canEdit}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {savedAt && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-700">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <span>Salary structure saved.</span>
          </div>
        )}

        {canEdit && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[#2563eb] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save size={14} />
              {saving ? "Saving…" : data ? "Update salary structure" : "Save salary structure"}
            </button>
          </div>
        )}
      </form>

      {/* ── Salary history + bonus timeline (revisions and bonuses, newest first) ── */}
      {timeline.length > 0 && (
        <div className="border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-700">
              <TrendingUp size={14} className="text-emerald-600" />
              Salary history
              <span className="font-normal text-slate-400">({timeline.length})</span>
            </span>
            <svg className={`h-4 w-4 text-slate-400 transition-transform ${showHistory ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>
          {showHistory && (
            <ol className="mt-3 space-y-2.5 border-l-2 border-slate-100 pl-4">
              {timeline.map((t) => {
                const fmtMoney = (v: string | null) => v == null ? "—" : `₹${Number(v).toLocaleString("en-IN")}`;
                const fmtDate  = (d: string | null) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
                if (t.kind === "bonus") {
                  const b = t.b;
                  return (
                    <li key={t.key} className="relative">
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white" />
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-[12.5px] font-semibold text-slate-800">
                          Bonus{b.bonusType ? ` · ${b.bonusType}` : ""} · <span className="text-amber-700">{fmtMoney(String(b.amount))}</span>
                        </span>
                        <span className="text-[11px] text-slate-500">effective {fmtDate(b.effectiveDate)}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{b.paymentStatus === "paid_past" ? "paid" : "due"}</span>
                      </div>
                      {b.reason ? <p className="text-[10.5px] text-slate-400">{b.reason}</p> : null}
                    </li>
                  );
                }
                const h = t.h;
                const isInitial = h.oldCtc == null;
                return (
                  <li key={t.key} className="relative">
                    <span className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ring-2 ring-white ${isInitial ? "bg-slate-400" : "bg-emerald-500"}`} />
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      {isInitial ? (
                        <span className="text-[12.5px] font-semibold text-slate-800">Initial · {fmtMoney(h.newCtc)}</span>
                      ) : (
                        <span className="text-[12.5px] font-semibold text-slate-800">
                          <span className="text-slate-400 line-through">{fmtMoney(h.oldCtc)}</span>
                          {" → "}
                          <span className="text-emerald-700">{fmtMoney(h.newCtc)}</span>
                        </span>
                      )}
                      <span className="text-[11px] text-slate-500">effective {fmtDate(h.effectiveFrom)}</span>
                    </div>
                    <p className="text-[10.5px] text-slate-400">
                      {h.actorName ? `by ${h.actorName} · ` : ""}changed {fmtDate(h.changedAt)}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}

      {showBonusModal && (
        <AddBonusModal
          userId={userId}
          onSaved={() => { mutate(bonusUrl); setShowHistory(true); }}
          onClose={() => setShowBonusModal(false)}
        />
      )}

      {showRevisionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !revBusy && setShowRevisionModal(false)}>
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <TrendingUp size={16} className="text-emerald-600" />
                <h3 className="text-[14px] font-bold text-slate-800">Salary Revision</h3>
              </div>
              <button type="button" onClick={() => setShowRevisionModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <p className="text-[12px] text-slate-500">
                Set the revised {form.salaryType === "Intern" ? "stipend" : "salary"} and the date it takes effect. It&apos;s recorded as a revision (Payroll → Salary Revisions).
              </p>
              <div>
                <label className={cls.label}>{form.salaryType === "Intern" ? "New Monthly Stipend (INR)" : "New Annual Salary / CTC (INR)"}</label>
                <div className="relative">
                  <IndianRupee size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="number"
                    value={revSalary}
                    onChange={(e) => setRevSalary(e.target.value)}
                    className={`${cls.field} pl-8`}
                    placeholder="e.g. 360000"
                  />
                </div>
              </div>
              <div>
                <label className={cls.label}>Revised From</label>
                <DateField value={revDate} onChange={setRevDate} className="w-full" />
                <p className="mt-1 text-[11px] text-slate-400">The new salary applies to payroll from this date onward.</p>
              </div>
              {revErr && <p className="text-[12px] text-rose-600">{revErr}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button type="button" onClick={() => setShowRevisionModal(false)} disabled={revBusy} className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
              <button type="button" onClick={submitRevision} disabled={revBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#2f6fe0] disabled:opacity-60">
                <Save size={14} /> {revBusy ? "Applying…" : "Apply Revision"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Add Bonus modal ────────────────────────────────────────────────
// Keka-style dialog: bonus type (with custom values), amount with INR
// prefix, payment status (Due in future / Paid in past), payout date,
// optional note. Saves to /api/hr/payroll/bonus.
function AddBonusModal({ userId, onClose, onSaved }: { userId: number; onClose: () => void; onSaved?: () => void }) {
  const [bonusType, setBonusType]         = useState("");
  const [amount, setAmount]               = useState("");
  const [paymentStatus, setPaymentStatus] = useState<"due_future" | "paid_past">("due_future");
  const [date, setDate]                   = useState("");
  const [note, setNote]                   = useState("");
  const [attachment, setAttachment]       = useState<File | null>(null);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState("");

  const dateLabel = paymentStatus === "due_future" ? "Payout due on" : "Paid on";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const amt = Number(amount);
    if (!bonusType.trim())                   { setError("Pick or create a bonus type.");        return; }
    if (!Number.isFinite(amt) || amt <= 0)   { setError("Enter a positive amount.");            return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))   { setError(`Pick the ${dateLabel.toLowerCase()} date.`); return; }
    // Match the server's 10 MB ceiling so we fail fast without burning
    // an upload round-trip on a too-big file.
    if (attachment && attachment.size > 10 * 1024 * 1024) {
      setError("Attachment must be 10 MB or smaller.");
      return;
    }
    setSaving(true);
    try {
      // Multipart when a file is attached so the bytes can ride along
      // with the rest of the fields; JSON otherwise (cheaper to parse,
      // and still what every legacy caller of this endpoint sends).
      let res: Response;
      if (attachment) {
        const fd = new FormData();
        fd.append("userId", String(userId));
        fd.append("amount", String(amt));
        if (note.trim()) fd.append("reason", note.trim());
        fd.append("effectiveDate", date);
        fd.append("bonusType", bonusType.trim());
        fd.append("paymentStatus", paymentStatus);
        fd.append("attachment", attachment);
        res = await fetch("/api/hr/payroll/bonus", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/hr/payroll/bonus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            amount: amt,
            reason: note.trim() || null,
            effectiveDate: date,
            bonusType: bonusType.trim(),
            paymentStatus,
          }),
        });
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Save failed");
      onSaved?.();   // refresh the bonus list + auto-open Salary history
      onClose();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-[15px] font-bold text-slate-800">Add Bonus</h3>
          <button type="button" onClick={onClose} aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={14} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-5 px-6 py-5">
          {/* ── Bonus Type ── */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Bonus Type</label>
            {/* Reuses the global CustomSelect: defaults are common bonus
                categories; HR can "+ Add custom value" for one-offs. */}
            <CustomSelect
              listKey="bonusType"
              defaults={[
                "Performance Incentive",
                "Retention Bonus",
                "Referral Bonus",
                "Diwali Bonus",
                "Advance Salary",
                "Bonus Pay",
                "Arrear",
                "Travel Reimbursement",
                "Reimbursed PF",
                "Business Expense Reimbursement",
                "Joining Bonus",
                "Project Delivery Bonus",
                "Spot Award",
              ]}
              value={bonusType}
              onChange={setBonusType}
              placeholder="Select or create bonus"
            />
          </div>

          {/* ── Amount ── */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Bonus amount</label>
            <div className="flex">
              <span className="inline-flex h-9 items-center rounded-l-lg border border-r-0 border-slate-200 bg-slate-50 px-3 text-[12px] font-semibold text-slate-500">
                INR
              </span>
              <input
                type="number" min="1" step="any"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount"
                className="h-9 flex-1 rounded-r-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15"
              />
            </div>
          </div>

          {/* ── Payment status ── */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-2">Payment status</label>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <label className="inline-flex items-center gap-2 text-[12.5px] text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="bonus-payment-status"
                  checked={paymentStatus === "due_future"}
                  onChange={() => setPaymentStatus("due_future")}
                  className="h-4 w-4 text-[#3b82f6] border-slate-300 focus:ring-[#3b82f6]/30"
                />
                Due in future
              </label>
              <label className="inline-flex items-center gap-2 text-[12.5px] text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="bonus-payment-status"
                  checked={paymentStatus === "paid_past"}
                  onChange={() => setPaymentStatus("paid_past")}
                  className="h-4 w-4 text-[#3b82f6] border-slate-300 focus:ring-[#3b82f6]/30"
                />
                Paid in past <span className="text-slate-400">(outside payroll)</span>
              </label>
            </div>
          </div>

          {/* ── Date — label changes with the payment status. Uses the
              shared DatePicker (Day/Month/Year dropdowns) so the styling
              matches the rest of the app instead of falling back to the
              browser's native picker. */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">{dateLabel}</label>
            <div className="max-w-md">
              <DatePicker
                value={date}
                onChange={setDate}
                // Bonuses can be backdated (paid_past) or scheduled
                // ahead (due_future) — give the year dropdown a
                // generous range covering past structures + a few
                // years of forward planning.
                yearStart={new Date().getFullYear() - 5}
                futureYears={5}
              />
            </div>
          </div>

          {/* ── Note ── */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Note</label>
            <textarea
              rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 resize-none"
            />
          </div>

          {/* ── Attachment (optional) ── PDF / Word / image, ≤ 10 MB.
              Stored as BYTEA on EmployeeBonus so the file survives
              Docker redeploys (same model as ViolationActionFile). */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
              Attachment <span className="font-normal text-slate-400">(optional)</span>
            </label>
            {attachment ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2 text-[12.5px] text-slate-700">
                  <Paperclip size={13} className="shrink-0 text-slate-500" />
                  <span className="truncate">{attachment.name}</span>
                  <span className="shrink-0 text-slate-400">
                    ({(attachment.size / 1024).toFixed(0)} KB)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                  aria-label="Remove attachment"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/40 px-3 py-3 text-[12.5px] text-slate-600 hover:border-[#3b82f6] hover:bg-[#3b82f6]/5">
                <Paperclip size={13} className="text-slate-500" />
                <span>Choose file</span>
                <span className="text-slate-400">— PDF, Word, or image (≤ 10 MB)</span>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.rtf,.odt,.txt,.md,.png,.jpg,.jpeg,.webp"
                  onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </form>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3.5">
          <button type="button" onClick={onClose}
            className="h-9 px-4 rounded-lg border border-slate-200 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={submit as any} disabled={saving}
            className="h-9 px-5 rounded-lg bg-[#3b82f6] text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[#2563eb] disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
