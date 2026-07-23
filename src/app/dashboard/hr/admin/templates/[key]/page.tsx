"use client";

// Per-template editor. Pick employee → see auto-filled placeholders
// + custom field inputs → live preview → Generate PDF.
// Generate POSTs to /api/hr/letter-templates/[key]/generate with
// action=pdf which renders, saves to the employee's Documents, and
// streams the PDF for inline view.

import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import "react-quill-new/dist/quill.snow.css";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { isLeadershipOrHR } from "@/lib/access";
import { computeExitSettlement } from "@/lib/hr/exit-settlement-calc";
import { DateField } from "@/components/ui/date-field";
// NOTE: previously imported JOB_TITLES from @/lib/job-titles — a stale
// 28-entry hardcoded list that was missing 40+ designations HR had added
// via Admin → RBAC → Designations (CEO, COO, Manager, Lead, Channel
// Manager, etc.) and still showed 13 designations that no longer exist
// in the DB. Now reads the same /api/designations source Edit Profile
// uses, so the picker stays in sync without code changes.
import { Search, Save, FileText, RefreshCw } from "lucide-react";

// Reuse the same Quill build the JD editor uses so HR gets a
// consistent Word-doc-like authoring experience across all
// rich-text fields. Dynamic + ssr:false because Quill touches
// `document` on import.
const ReactQuill = dynamic(
  async () => (await import("react-quill-new")).default,
  { ssr: false, loading: () => <div className="px-4 py-3 text-[12.5px] text-slate-400">Loading editor…</div> },
);

const LETTER_QUILL_MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    [{ size: ["small", false, "large", "huge"] }],
    ["bold", "italic", "underline", "strike"],
    [{ color: [] }, { background: [] }],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ align: [] }],
    ["clean"],
  ],
};
const LETTER_QUILL_FORMATS = [
  "header", "size", "bold", "italic", "underline", "strike",
  "color", "background", "list", "bullet", "align",
];

type CustomFieldDef = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "textarea" | "checkbox";
  required?: boolean;
  placeholder?: string;
  /** Inline helper text rendered below the input. */
  help?: string;
  /** For checkbox fields only. Strings that represent the
   *  unchecked/checked state when serialised into customValues. */
  uncheckedValue?: string;
  checkedValue?: string;
};

type Template = {
  id: number;
  key: string;
  title: string;
  category: string;
  /** "NB Media" | "YT Labs" | null. Determines which letterhead +
   *  logo + watermark chrome the preview wraps the body in, and
   *  which set of employees the picker filters to. */
  businessUnit?: string | null;
  bodyHtml: string;
  customFields: CustomFieldDef[] | null;
};

type Employee = {
  id: number;
  name: string;
  email: string;
  profilePictureUrl?: string | null;
  isActive?: boolean;
  employeeProfile?: { designation?: string | null; department?: string | null } | null;
};

// Next.js 16 + Turbopack requires every useSearchParams() consumer
// to live under a Suspense boundary, otherwise the static-prerender
// pass aborts. We split the body into an Inner component and wrap
// it here so the rest of the tree prerenders cleanly.
export default function TemplateEditorPage({ params }: { params: Promise<{ key: string }> }) {
  return (
    <Suspense fallback={null}>
      <TemplateEditorPageInner params={params} />
    </Suspense>
  );
}

function TemplateEditorPageInner({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const { data: session } = useSession();
  const me = session?.user as any;
  // Brand context from the URL (set by the HR-Dashboard brand-
  // switcher). When absent, the API falls back to the viewer's
  // session brand. Forward it on every fetch so we always pull the
  // right brand variant of the template.
  const searchParams = useSearchParams();
  const brandSlug = searchParams?.get("brand") ?? null;
  const brandQs = brandSlug ? `?brand=${encodeURIComponent(brandSlug)}` : "";

  const { data: tpl, mutate: mutateTpl } = useSWR<Template>(
    `/api/hr/letter-templates/${key}${brandQs}`, fetcher,
  );

  // Active brand for this session — URL brand wins, else the template's,
  // else the viewer's. Drives both the employee-picker filter AND the
  // new-joiner brand (template variant + letterhead chrome).
  const activeBrand: "NB Media" | "YT Labs" =
    brandSlug === "yt-labs" ? "YT Labs"
    : brandSlug === "nb-media" ? "NB Media"
    : (((tpl?.businessUnit as any) || (me?.businessUnit as any) || "NB Media") as "NB Media" | "YT Labs");

  // "employee" = pick someone already in the system; "manual" = a new
  // joiner not in the DB yet (the letter is parked + auto-attached when
  // they're onboarded, matched by email).
  const [mode, setMode] = useState<"employee" | "manual">("employee");
  const [manualFields, setManualFields] = useState({
    name: "", email: "", designation: "", department: "",
    joiningDate: "", applicationDate: "", gender: "", employeeNumber: "",
  });

  const [employee, setEmployee] = useState<Employee | null>(null);
  // Deep-link support: ?employeeId=N pre-selects that employee (used by the
  // offboarding drawer's "Generate F&F Letter" button so HR lands here with
  // the person already picked and all fields auto-filled). Runs once.
  const preEmployeeId = searchParams?.get("employeeId") ?? null;
  useEffect(() => {
    if (!preEmployeeId) return;
    const idN = Number(preEmployeeId);
    if (!Number.isInteger(idN) || idN <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/hr/people/${idN}`);
        if (!res.ok) return;
        const j = await res.json();
        const u = j?.user ?? j;
        if (cancelled) return;
        setMode("employee");
        setEmployee({
          id: idN,
          name: u?.name ?? `User ${idN}`,
          email: u?.email ?? "",
          profilePictureUrl: u?.profilePictureUrl ?? null,
          isActive: u?.isActive,
          employeeProfile: (u?.profile ?? u?.employeeProfile) ?? null,
        });
      } catch { /* HR can still pick manually */ }
    })();
    return () => { cancelled = true; };
  }, [preEmployeeId]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  // Letter-issue date — drives every {{*.ShortDate}} placeholder. Empty
  // string means "today" (legacy behaviour). HR sets this when they
  // need to backdate a letter or post-date one. Stored as YYYY-MM-DD
  // to match the DateField component's value shape.
  const [letterDate, setLetterDate] = useState<string>("");
  // Salary type of the picked employee — "intern" or "regular".
  // Used by the Exit Statement template to hide the EnablePf
  // checkbox for interns (interns don't have PF). Set in the
  // auto-fill effect below.
  const [employeeSalaryType, setEmployeeSalaryType] = useState<string | null>(null);
  // Editable designation for the picked employee. Lets HR correct the job
  // title right here — it PUTs to the profile, and since the letter reads
  // designation from the profile server-side, the change flows straight
  // into the document. Saves a trip to the Edit Profile page.
  const [designationDraft, setDesignationDraft]       = useState("");
  const [savingDesignation, setSavingDesignation]     = useState(false);
  const [designationSaved, setDesignationSaved]       = useState(false);

  // Live designation list — same source as Edit Profile so HR sees the
  // full set (CEO, COO, Manager, Lead, every brand-scoped role) instead
  // of the stale 28-entry hardcoded list this page used previously.
  const { data: desigData } = useSWR<{ designations: { label: string }[] }>(
    "/api/designations",
    fetcher,
  );
  const designationOptions: string[] = useMemo(() => {
    const labels = (desigData?.designations ?? []).map((d) => d.label).filter(Boolean);
    return Array.from(new Set(labels)).sort((a, b) => a.localeCompare(b));
  }, [desigData]);

  // Auto-fill custom fields from the picked employee's profile +
  // salary structure so HR doesn't retype data we already have.
  // Triggers whenever the employee changes; only fills fields
  // that are CURRENTLY EMPTY so HR's manual edits aren't
  // clobbered.
  //
  // Mappings:
  //   BankAccount    ← profile.bankAccountNumber
  //   BankIFSC       ← profile.bankIfsc
  //   Bank           ← profile.bankName
  //   PANNumber      ← profile.panNumber
  //   SubDepartment  ← profile.department  (same as Department —
  //                    we don't have a dedicated subDepartment
  //                    column yet; HR can refine manually)
  //   AnnualPackage  ← salaryStructure.ctc  (Exit Statement +
  //                    Revised Offer Letter both consume this)
  //   EnablePf       ← salaryStructure.pfEligible (auto-checked,
  //                    forced off for interns)
  useEffect(() => {
    let cancelled = false;
    if (!employee?.id) {
      // Employee deselected (HR pressed the ✕) → clear everything the
      // auto-fill populated, so the form returns to a clean slate instead
      // of keeping the previous person's bank / PAN / package / F&F figures.
      // These are exactly the keys written by `fillMap` below — keep in sync.
      setEmployeeSalaryType(null);
      const AUTO_FILLED_KEYS = [
        "LeaveEncashmentDays", "AdvanceSalaryDays", "AdvanceSalaryAmount",
        "WorkingDays", "LossOfPayDays", "FnFAmount", "BankAccount", "BankIFSC",
        "Bank", "PANNumber", "AnnualPackage", "PaymentMode", "EnablePf",
        "ProfessionalTax", "SalaryType",
      ];
      setCustomValues((curr) => {
        const next = { ...curr };
        let changed = false;
        for (const k of AUTO_FILLED_KEYS) {
          if (k in next && next[k] !== "") { next[k] = ""; changed = true; }
        }
        return changed ? next : curr;
      });
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/hr/people/${employee.id}`);
        if (!res.ok) return;
        const j = await res.json();
        const u = j?.user ?? j;
        const p = u?.employeeProfile ?? j?.profile ?? j;
        const s = u?.salaryStructure ?? j?.salaryStructure ?? null;
        if (cancelled) return;
        const salaryType = s?.salaryType ?? null;
        setEmployeeSalaryType(salaryType);
        const isIntern = salaryType === "intern";
        // Carry Over Leave → auto-fills Leave Encashment Days on the Exit
        // Statement. Match the balance-only "Carry Over Leave" leave type by
        // name and take its remaining days (total − used − pending).
        const balances: any[] = Array.isArray((u as any)?.leaveBalances) ? (u as any).leaveBalances : [];
        const carry = balances.find((b) => /carry\s*over/i.test(String(b?.leaveType?.name ?? "")));
        const carryDays = carry
          ? Math.max(0, (Number(carry.totalDays) || 0) - (Number(carry.usedDays) || 0) - (Number(carry.pendingDays) || 0))
          : undefined;
        // Advance Salary already paid in payroll (adhoc) → Exit Statement
        // earnings + the days shown for reference.
        const adv = (u as any)?.advanceSalary ?? null;
        const advDays   = adv?.days   ? Number(adv.days)   : 0;
        const advAmount = adv?.amount ? Number(adv.amount) : 0;
        // Working Days + Loss of Pay for the Exit Statement — reuse the SAME
        // final-month proration the F&F wizard uses (worked days up to the
        // last working day, and LOP within that window). Only when the
        // employee has an active exit and the exit month isn't already paid.
        let workingDaysFill: string | undefined;
        let lopDaysFill: string | undefined;
        const activeExit = (u as any)?.activeExit;
        if (activeExit?.id) {
          try {
            const ps = await fetch(`/api/hr/exits/${activeExit.id}/settlement/pending-salary`);
            if (ps.ok) {
              const pj = await ps.json();
              // Fill worked-days / LOP even when the exit month is already paid
              // (exited employees) — pending-salary now returns the real days.
              if (Number(pj?.paidDays) > 0) workingDaysFill = String(pj.paidDays);
              if (pj?.breakdown?.lopInPeriod != null) lopDaysFill = String(pj.breakdown.lopInPeriod);
            }
          } catch { /* network blip — HR can still type manually */ }
        }
        // F&F amount = the Exit Statement's Net Payable, computed with the
        // SAME shared formula the letter renders (earnings incl. leave
        // encashment − PF/PT). This keeps the F&F letter's FnF Amount equal
        // to the Exit Statement's net for the same employee.
        let fnfAmountFill: string | undefined;
        {
          const net = computeExitSettlement({
            AnnualPackage:       s?.ctc != null ? String(s.ctc) : "",
            WorkingDays:         workingDaysFill ?? "",
            LeaveEncashmentDays: carryDays != null ? String(carryDays) : "",
            AdvanceSalaryAmount: advAmount > 0 ? String(advAmount) : "",
            EnablePf:            isIntern ? "false" : (s?.pfEligible ? "true" : "false"),
          }).net;
          if (net > 0) fnfAmountFill = net.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        if (cancelled) return;
        const fillMap: Record<string, string | null | undefined> = {
          // Auto-picked from the employee's Carry Over Leave balance.
          LeaveEncashmentDays: carryDays != null ? String(carryDays) : undefined,
          // Auto-picked from the employee's Advance Salary payroll entries.
          // Days always show a number (0 when the employee has none).
          AdvanceSalaryDays:   String(advDays),
          AdvanceSalaryAmount: advAmount > 0 ? String(advAmount) : undefined,
          // Auto-picked from the exit month's attendance (worked days / LOP).
          WorkingDays:   workingDaysFill,
          LossOfPayDays: lopDaysFill,
          // F&F letter amount = the Exit Statement's Net Payable (same formula).
          FnFAmount:     fnfAmountFill,
          BankAccount:   p?.bankAccountNumber,
          BankIFSC:      p?.bankIfsc,
          Bank:          p?.bankName,
          PANNumber:     p?.panNumber,
          AnnualPackage: s?.ctc != null ? String(s.ctc) : undefined,
          // Default payment mode — payroll is paid via bank transfer
          // for every employee on the platform today. HR can still
          // override manually if a one-off cash / cheque settlement
          // is needed; this just removes the typing for the 100%
          // common case.
          PaymentMode:   "Bank Transfer",
          // Interns NEVER get PF — force the checkbox off.
          // Regular employees inherit from salaryStructure.pfEligible.
          EnablePf:      isIntern ? "false" : (s?.pfEligible ? "true" : undefined),
          // Professional Tax deduction — auto-filled for regular employees:
          // the salary structure's monthly PT when set, else the standard
          // ₹200/month (most structures leave PT at 0). Interns have none.
          ProfessionalTax: isIntern ? undefined : String((Number(s?.professionalTax) || 0) > 0 ? Number(s.professionalTax) : 200),
          // Salary type drives the intern vs regular exit-statement layout.
          SalaryType:    salaryType ?? undefined,
        };
        setCustomValues((curr) => {
          // On EMPLOYEE CHANGE we always OVERWRITE the profile-
          // driven fields with the new employee's data. Previous
          // "fill-if-empty" logic was wrong — if HR picked
          // someone with IndusInd Bank, then switched to someone
          // at HDFC, the IndusInd account number stayed on screen
          // because the field "had a value" (the wrong person's).
          //
          // What HR types manually for THIS render (Settlement
          // Date, Working Days, manual amount overrides, etc.)
          // is NOT in the fillMap, so it stays untouched. Only
          // the profile-driven fields refresh.
          const next = { ...curr };
          let changed = false;
          for (const [k, v] of Object.entries(fillMap)) {
            // Intern → ALWAYS force EnablePf=false regardless of
            // saved state.
            if (k === "EnablePf" && isIntern) {
              if (curr[k] !== "false") { next[k] = "false"; changed = true; }
              continue;
            }
            const newVal = v == null || v === "" ? "" : String(v);
            if (curr[k] !== newVal) { next[k] = newVal; changed = true; }
          }
          return changed ? next : curr;
        });
      } catch { /* network blip — HR can still type manually */ }
    })();
    return () => { cancelled = true; };
  }, [employee?.id]);

  // Keep the editable designation in sync with whoever is picked.
  useEffect(() => {
    setDesignationDraft(employee?.employeeProfile?.designation ?? "");
    setDesignationSaved(false);
  }, [employee?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [preview, setPreview] = useState<{ html: string; missing: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editingBody, setEditingBody] = useState(false);
  const [draftBody, setDraftBody] = useState("");
  const [savingBody, setSavingBody] = useState(false);

  if (!isLeadershipOrHR(me)) {
    return (
      <div className="p-6">
        <p className="text-[13px] text-slate-500">You don't have access to this page.</p>
      </div>
    );
  }

  if (!tpl) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const cats = Array.isArray(tpl.customFields) ? tpl.customFields : [];

  // Ready to preview/generate? Employee mode needs a pick; manual mode
  // needs at least a name + email (email is the later match key).
  const ready = mode === "employee"
    ? !!employee
    : !!(manualFields.name.trim() && manualFields.email.trim());

  const buildBody = (action: "preview" | "pdf") => {
    const base = { customFields: customValues, action, letterDate: letterDate || null };
    return mode === "manual"
      ? { ...base, manual: { ...manualFields, brand: activeBrand } }
      : { ...base, employeeId: employee?.id };
  };

  const refreshPreview = async () => {
    if (!ready) { setPreview(null); return; }
    setPreviewing(true);
    try {
      const res = await fetch(`/api/hr/letter-templates/${tpl.key}/generate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(buildBody("preview")),
      });
      if (!res.ok) { alert("Preview failed"); return; }
      const j = await res.json();
      setPreview({ html: j.html, missing: j.missing ?? [] });
    } finally {
      setPreviewing(false);
    }
  };

  // Persist a designation edit to the picked employee's profile, then
  // mirror it locally so the preview / generated letter pick it up.
  const saveDesignation = async () => {
    if (!employee?.id) return;
    const next = designationDraft.trim();
    setSavingDesignation(true);
    try {
      const res = await fetch(`/api/hr/people/${employee.id}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ designation: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Couldn't update designation");
      }
      setEmployee((e) => e ? { ...e, employeeProfile: { ...(e.employeeProfile ?? {}), designation: next } } : e);
      setPreview(null);
      setDesignationSaved(true);
      // Auto-re-render the letter so HR sees the new title applied
      // without a second click. Previously we only cleared the
      // preview; the user had to manually click "Preview" again to
      // see the change, which looked like the save hadn't worked.
      // Fire-and-forget — refreshPreview owns its own busy/error UI.
      void refreshPreview();
    } catch (err: any) {
      alert(err?.message || "Couldn't update designation");
    } finally {
      setSavingDesignation(false);
    }
  };

  const generatePdf = async () => {
    if (!ready) {
      alert(mode === "manual" ? "Enter at least a name and email for the new joiner." : "Pick an employee first.");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch(`/api/hr/letter-templates/${tpl.key}/generate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(buildBody("pdf")),
      });
      if (!res.ok) {
        // Try to surface the server's error message; fall back to
        // raw text if the body isn't JSON.
        let msg = `Generate failed (${res.status})`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          try { msg = (await res.text()).slice(0, 200) || msg; } catch {}
        }
        alert(msg);
        return;
      }
      // Server may return either PDF bytes (the production path —
      // also auto-saved to the employee's Documents) OR HTML when
      // the LibreOffice converter is unavailable. Use the response
      // Content-Type to decide how to deliver to the user. Always
      // trigger a programmatic <a download> click — popup blockers
      // shoot down window.open() since it fires AFTER the network
      // round-trip, but anchored downloads from a user-gesture
      // chain are honoured.
      const ct = (res.headers.get("Content-Type") || "").toLowerCase();
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const isPdf = ct.includes("application/pdf");
      const ext = isPdf ? "pdf" : "html";
      const safeName = tpl.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "letter";
      const who = (mode === "manual" ? manualFields.name : employee?.name) || "recipient";
      const filename = `${safeName}-${who.replace(/[^A-Za-z0-9]+/g, "-")}.${ext}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener noreferrer";
      // For PDF, also open in a new tab so HR can preview without
      // a download — but the <a download> attribute still triggers
      // the Save dialog as a fallback if the new tab is blocked.
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Free the blob URL a beat later so the browser had time to
      // start the download.
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      if (mode === "manual" && isPdf) {
        alert(`Saved. This document is parked for ${manualFields.email} and will auto-attach to their Documents once they're added to the system.`);
      } else if (!isPdf) {
        alert(
          "LibreOffice isn't available on the server, so a print-ready HTML was downloaded instead. " +
          "Open the file and use the browser's Print → Save as PDF to convert it.",
        );
      }
    } catch (e: any) {
      alert(`Generate failed: ${e?.message ?? e}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="px-6 py-5">
      <div className="flex items-center gap-1.5 text-[11.5px] text-slate-500 mb-2">
        {/* Both breadcrumb links preserve the current `?brand=` so
            navigating back lands on the same brand's HR Dashboard +
            Templates page (not the viewer's session-default brand). */}
        <Link href={`/dashboard/hr/admin${brandQs}`} className="hover:text-slate-800 transition-colors">HR Dashboard</Link>
        <span>/</span>
        <Link href={`/dashboard/hr/admin/templates${brandQs}`} className="hover:text-slate-800 transition-colors">Templates</Link>
        <span>/</span>
        <span className="text-slate-700 font-medium">{tpl.title}</span>
      </div>

      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-[20px] font-semibold text-slate-800 tracking-tight">{tpl.title}</h1>
          <p className="mt-1 text-[12.5px] text-slate-500">
            Search for an employee, fill any custom inputs, then preview or generate the PDF.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setDraftBody(tpl.bodyHtml); setEditingBody(true); }}
          className="inline-flex items-center gap-1.5 h-9 px-3 border border-slate-200 hover:border-slate-300 rounded-lg text-[12.5px] font-medium text-slate-600 hover:text-slate-800 transition-colors"
        >
          <Save size={14} /> Edit template body
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-5">
        {/* ── Left: form ─────────────────────────────────────────── */}
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            {/* Recipient mode — existing employee vs new joiner */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button type="button" onClick={() => { setMode("employee"); setPreview(null); }}
                className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors ${mode === "employee" ? "bg-white text-[#008CFF] shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
                Existing employee
              </button>
              <button type="button" onClick={() => { setMode("manual"); setEmployee(null); setPreview(null); }}
                className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors ${mode === "manual" ? "bg-white text-[#008CFF] shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
                New joiner (not in system)
              </button>
            </div>

            {mode === "employee" ? (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Employee</label>
                  {/* brand drives the picker filter so HR never picks a
                      cross-brand employee for a brand-specific letter. */}
                  <EmployeePicker
                    value={employee}
                    onChange={(v) => { setEmployee(v); setPreview(null); }}
                    brand={activeBrand}
                  />
                </div>
                {/* Inline designation editor — change the job title here and
                    it saves straight to the profile (the letter uses it). */}
                {employee && (
                  <div>
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Designation / Job title</label>
                    <div className="mt-1 flex items-center gap-2">
                      <select
                        value={designationDraft}
                        onChange={(e) => { setDesignationDraft(e.target.value); setDesignationSaved(false); }}
                        className="flex-1 h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#008CFF]"
                      >
                        <option value="">— Select designation —</option>
                        {/* Keep the current title selectable even if it's not in
                            the canonical list, so we never silently change it. */}
                        {designationDraft && !designationOptions.includes(designationDraft) && (
                          <option value={designationDraft}>{designationDraft}</option>
                        )}
                        {designationOptions.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={saveDesignation}
                        disabled={savingDesignation || designationDraft.trim() === (employee.employeeProfile?.designation ?? "").trim()}
                        className="h-9 px-4 rounded-lg bg-[#008CFF] text-white text-[12px] font-semibold transition-colors hover:bg-[#0070cc] disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {savingDesignation ? "Saving…" : "Save"}
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {designationSaved
                        ? <span className="font-medium text-emerald-600">Saved — updated on the profile and this letter.</span>
                        : "Changes the employee's designation directly — no need to open Edit Profile."}
                    </p>
                  </div>
                )}
                {/* Letter date override — the {{*.ShortDate}} placeholder
                    defaults to today's date. HR sets this to backdate a
                    letter or post-date one. The "Reset to today" button
                    clears the override. */}
                <div>
                  <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Letter date</label>
                  <div className="mt-1 flex items-center gap-2">
                    <DateField
                      value={letterDate}
                      onChange={(v) => { setLetterDate(v); setPreview(null); }}
                      className="flex-1"
                    />
                    {letterDate && (
                      <button
                        type="button"
                        onClick={() => { setLetterDate(""); setPreview(null); }}
                        className="h-9 px-3 rounded-lg border border-slate-200 text-[12px] text-slate-600 hover:bg-slate-50"
                      >
                        Today
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Leave blank to use today's date. Pick a date to back/post-date the letter.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="rounded-md bg-blue-50/70 border border-blue-200 px-3 py-2 text-[11.5px] text-blue-900 leading-snug">
                  This person isn't in the system yet. The document is <strong>parked by email</strong> (brand: {activeBrand}) and auto-attaches to their Documents tab once they're onboarded.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ManualInput label="Full name" required value={manualFields.name} onChange={(v) => { setManualFields((s) => ({ ...s, name: v })); setPreview(null); }} placeholder="e.g. Priya Sharma" />
                  <ManualInput label="Email" required lowercase value={manualFields.email} onChange={(v) => { setManualFields((s) => ({ ...s, email: v })); setPreview(null); }} placeholder="priya@example.com" />
                  <ManualInput label="Designation / Job title" value={manualFields.designation} onChange={(v) => setManualFields((s) => ({ ...s, designation: v }))} placeholder="e.g. Content Writer" />
                  <ManualInput label="Department" value={manualFields.department} onChange={(v) => setManualFields((s) => ({ ...s, department: v }))} placeholder="e.g. Content" />
                  <div>
                    <label className="text-[11.5px] text-slate-600 mb-1 block">Joining date</label>
                    <DateField value={manualFields.joiningDate} onChange={(v) => setManualFields((s) => ({ ...s, joiningDate: v }))} className="w-full" />
                  </div>
                  <div>
                    <label className="text-[11.5px] text-slate-600 mb-1 block">
                      Application date <span className="text-slate-400">(blank = auto from job application)</span>
                    </label>
                    <DateField value={manualFields.applicationDate} onChange={(v) => { setManualFields((s) => ({ ...s, applicationDate: v })); setPreview(null); }} className="w-full" />
                  </div>
                  <div>
                    <label className="text-[11.5px] text-slate-600 mb-1 block">
                      Letter date <span className="text-slate-400">(blank = today)</span>
                    </label>
                    <DateField value={letterDate} onChange={(v) => { setLetterDate(v); setPreview(null); }} className="w-full" />
                  </div>
                  <div>
                    <label className="text-[11.5px] text-slate-600 mb-1 block">Gender</label>
                    <select value={manualFields.gender} onChange={(e) => setManualFields((s) => ({ ...s, gender: e.target.value }))}
                      className="w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#008CFF]">
                      <option value="">—</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <ManualInput label="HRM / Employee no. (optional)" value={manualFields.employeeNumber} onChange={(v) => setManualFields((s) => ({ ...s, employeeNumber: v }))} placeholder="auto-assigned on join if blank" />
                </div>
              </div>
            )}
          </section>

          {cats.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Custom fields</label>
              {cats.map((f) => {
                // Hide the EnablePf toggle for interns — interns
                // don't have PF deductions, so the choice is
                // meaningless for them. EnablePf is force-set to
                // "false" in customValues by the auto-fill effect,
                // so the resolver still computes correctly without
                // the user seeing the checkbox.
                if (f.key === "EnablePf" && employeeSalaryType === "intern") {
                  return (
                    <div key={f.key} className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-[11.5px] text-slate-500">
                      Provident Fund disabled — <span className="font-medium text-slate-700">{employee?.name || "this employee"}</span> is on an intern payroll.
                    </div>
                  );
                }
                if (f.type === "checkbox") {
                  const onVal  = f.checkedValue   ?? "true";
                  const offVal = f.uncheckedValue ?? "false";
                  const checked = (customValues[f.key] ?? offVal) === onVal;
                  return (
                    <label key={f.key} className="flex items-start gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setCustomValues((v) => ({ ...v, [f.key]: e.target.checked ? onVal : offVal }))}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#008CFF] focus:ring-[#008CFF]/40"
                      />
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-medium text-slate-800">
                          {f.label}
                          {f.required && <span className="text-rose-500"> *</span>}
                        </span>
                        {f.help && <span className="block text-[11px] text-slate-500 mt-0.5">{f.help}</span>}
                      </span>
                    </label>
                  );
                }
                return (
                  <div key={f.key}>
                    <label className="text-[11.5px] text-slate-600 mb-1 inline-flex items-center gap-1">
                      {f.label}
                      {f.required && <span className="text-rose-500">*</span>}
                    </label>
                    {f.type === "textarea" ? (
                      <textarea
                        value={customValues[f.key] ?? ""}
                        onChange={(e) => setCustomValues((v) => ({ ...v, [f.key]: e.target.value }))}
                        rows={3}
                        placeholder={f.placeholder}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#008CFF] resize-none"
                      />
                    ) : f.type === "date" ? (
                      // Custom DateField (consistent dd/mm/yyyy calendar
                      // across browsers) instead of the native
                      // <input type="date"> picker, which renders with
                      // the OS theme + an inconsistent month/year grid.
                      // DateField stores YYYY-MM-DD — same value shape as
                      // the native input, so it's a drop-in.
                      <DateField
                        value={customValues[f.key] ?? ""}
                        onChange={(v) => setCustomValues((s) => ({ ...s, [f.key]: v }))}
                        className="w-full"
                        placeholder={f.placeholder || "dd/mm/yyyy"}
                      />
                    ) : (
                      <input
                        type={f.type === "number" ? "number" : "text"}
                        // For number inputs: `min={0}` blocks the
                        // user from typing/spinning negative values,
                        // and the onWheel/onKeyDown handlers stop
                        // the browser's built-in scroll-wheel /
                        // arrow-key incrementing — common UX trap
                        // where scrolling the page accidentally
                        // changes a focused number field (0 → -1
                        // → -2 → -3, etc.).
                        {...(f.type === "number" ? {
                          min:        0,
                          step:       "any",
                          onWheel:    (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur(),
                          onKeyDown:  (e: React.KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
                          },
                        } : {})}
                        value={customValues[f.key] ?? ""}
                        onChange={(e) => setCustomValues((v) => ({ ...v, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                        className="w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#008CFF]"
                      />
                    )}
                    {f.help && <p className="text-[11px] text-slate-500 mt-1">{f.help}</p>}
                  </div>
                );
              })}
            </section>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshPreview}
              disabled={!ready || previewing}
              className="inline-flex items-center gap-1.5 h-9 px-4 border border-slate-200 hover:border-slate-300 rounded-lg text-[12.5px] font-semibold text-slate-700 hover:text-slate-900 disabled:opacity-50"
            >
              <RefreshCw size={13} className={previewing ? "animate-spin" : ""} />
              Preview
            </button>
            <button
              type="button"
              onClick={generatePdf}
              disabled={!ready || generating}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[12.5px] font-semibold disabled:opacity-60"
            >
              <FileText size={13} />
              {generating ? "Generating…" : "Generate PDF"}
            </button>
          </div>

          {preview?.missing && preview.missing.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              <strong>Heads up</strong> — these placeholders couldn't be resolved:
              <ul className="mt-1 list-disc pl-5">
                {preview.missing.map((m) => <li key={m}><code>{m}</code></li>)}
              </ul>
            </div>
          )}
        </div>

        {/* ── Right: preview pane ───────────────────────────────── */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden min-h-[500px]">
          <div className="px-5 py-2.5 border-b border-slate-100 text-[11px] uppercase tracking-wider font-semibold text-slate-500 flex items-center justify-between">
            <span>Preview</span>
            {ready && (
              <span className="text-slate-500 normal-case tracking-normal">for <span className="text-slate-700 font-semibold">{mode === "manual" ? (manualFields.name || "new joiner") : employee?.name}</span></span>
            )}
          </div>
          <div className="p-6">
            {!ready ? (
              <p className="text-[13px] text-slate-400 italic text-center py-12">{mode === "manual" ? "Enter the new joiner's name + email to preview." : "Pick an employee to see a preview."}</p>
            ) : !preview ? (
              <p className="text-[13px] text-slate-400 italic text-center py-12">Click "Preview" to render the letter.</p>
            ) : (
              // Sandboxed iframe — `sandbox=""` blocks scripts,
              // forms, same-origin access, top navigation, popups,
              // and plugins. Even if a malicious HR user manages to
              // sneak <script> past the server-side sanitiser, it
              // can't execute here. The server now returns a
              // FULL A4 preview HTML doc (letterhead + logo data
              // URL + watermark + CSS), so we feed it directly into
              // srcDoc as-is.
              <iframe
                title="Letter preview"
                sandbox=""
                referrerPolicy="no-referrer"
                className="w-full border border-slate-100 rounded-md"
                style={{ minHeight: "760px", background: "#f8fafc" }}
                srcDoc={preview.html}
              />
            )}
          </div>
        </div>
      </div>

      {/* Template body editor — Word-doc-style rich-text editor
          (Quill, Times New Roman, full formatting toolbar). HR
          types/edits the letter content visually; placeholders
          stay as plain text so `{{Section.Field}}` round-trips
          through Quill unchanged. */}
      {editingBody && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !savingBody && setEditingBody(false)} />
          <div className="fixed top-8 left-1/2 -translate-x-1/2 w-[min(960px,calc(100vw-32px))] max-h-[calc(100vh-64px)] bg-white rounded-xl shadow-2xl border border-slate-200 z-50 flex flex-col">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-slate-800">Edit template body</h3>
              <button onClick={() => !savingBody && setEditingBody(false)} className="text-slate-400 hover:text-slate-700" disabled={savingBody}>✕</button>
            </div>
            <div
              className="flex-1 overflow-y-auto"
              // Force Times New Roman + 12pt as the default authoring
              // font so the on-screen editor matches the rendered PDF.
              style={{
                fontFamily: '"Times New Roman", Times, serif',
                fontSize: "12pt",
                lineHeight: 1.5,
              }}
            >
              <ReactQuill
                theme="snow"
                value={draftBody}
                onChange={(html) => setDraftBody(html)}
                modules={LETTER_QUILL_MODULES}
                formats={LETTER_QUILL_FORMATS}
                placeholder="Type or paste the letter content. Use {{Section.Field}} placeholders to auto-fill employee data."
              />
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[11.5px] text-slate-500">
                Use <code className="px-1 py-0.5 bg-slate-100 rounded">{`{{Section.Field}}`}</code> placeholders — they auto-fill from the picked employee.
                Letters render in Times New Roman.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => !savingBody && setEditingBody(false)}
                  disabled={savingBody}
                  className="h-8 px-4 text-[12.5px] text-slate-500 hover:text-slate-800 rounded-md disabled:opacity-50"
                >Cancel</button>
                <button
                  onClick={async () => {
                    setSavingBody(true);
                    try {
                      // Forward the brand slug from the URL so the
                      // PATCH targets the right brand variant
                      // (otherwise we'd update both the NB Media
                      // AND YT Labs rows that share the same key).
                      const res = await fetch(`/api/hr/letter-templates/${tpl.key}${brandQs}`, {
                        method:  "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body:    JSON.stringify({ bodyHtml: draftBody }),
                      });
                      if (!res.ok) { alert("Save failed"); return; }
                      await mutateTpl();
                      setEditingBody(false);
                    } finally {
                      setSavingBody(false);
                    }
                  }}
                  disabled={savingBody}
                  className="h-8 px-4 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-md text-[12.5px] font-semibold disabled:opacity-60"
                >{savingBody ? "Saving…" : "Save"}</button>
              </div>
            </div>
          </div>
        </>
      )}
      {/* Quill-snow uses Helvetica by default — override to Times New
          Roman so the on-screen editor matches the rendered PDF. */}
      <style jsx global>{`
        .ql-editor {
          font-family: "Times New Roman", Times, serif !important;
          font-size: 12pt !important;
          line-height: 1.5 !important;
          min-height: 400px;
        }
      `}</style>
    </div>
  );
}

// Plain labelled text input for the new-joiner manual form.
function ManualInput({
  label, value, onChange, placeholder, required, lowercase,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; lowercase?: boolean }) {
  return (
    <div>
      <label className="text-[11.5px] text-slate-600 mb-1 inline-flex items-center gap-1">
        {label}{required && <span className="text-rose-500">*</span>}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(lowercase ? e.target.value.toLowerCase() : e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#008CFF]"
      />
    </div>
  );
}

// Debounced employee search picker. Hits /api/hr/employees and
// renders a small dropdown. Same shape used in AssetsPanel.
// `brand` (optional) restricts results to one businessUnit so HR
// generating an NB Media letter never accidentally picks a YT Labs
// employee (and vice versa).
function EmployeePicker({
  value, onChange, brand,
}: { value: Employee | null; onChange: (v: Employee | null) => void; brand?: string | null }) {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState("");
  const [debounced, setDebounced] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(t);
  }, [query]);

  // No isActive filter — letter templates (Exit Statement, Relieving,
  // Experience, etc.) often target EXITED / deactivated employees, so the
  // picker must surface them too. Inactive rows are flagged "Exited" below.
  const fetchUrl = open
    ? `/api/hr/employees?search=${encodeURIComponent(debounced)}${brand ? `&businessUnit=${encodeURIComponent(brand)}` : ""}`
    : null;
  const { data: results = [] as Employee[], isLoading } = useSWR<Employee[]>(
    fetchUrl,
    fetcher,
    { keepPreviousData: true },
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      {value ? (
        <div className="mt-1 flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg bg-white">
          {value.profilePictureUrl ? (
            <img src={value.profilePictureUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#008CFF] text-[10px] font-bold text-white">
              {value.name.charAt(0)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-slate-800 truncate">{value.name}</p>
            <p className="text-[11px] text-slate-500 truncate">{value.employeeProfile?.designation || value.email}</p>
          </div>
          {value.isActive === false && (
            <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 ring-1 ring-inset ring-slate-300">Exited</span>
          )}
          <button onClick={() => onChange(null)} className="text-slate-400 hover:text-rose-500 text-sm">✕</button>
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg bg-white">
          <Search size={14} className="text-slate-400" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Search employee by name or email…"
            className="flex-1 text-[13px] bg-transparent focus:outline-none"
          />
        </div>
      )}

      {open && !value && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
          {isLoading && <p className="px-3 py-3 text-[12px] text-slate-400">Loading…</p>}
          {!isLoading && results.length === 0 && (
            <p className="px-3 py-3 text-[12px] text-slate-400">
              {debounced ? `No matches for "${debounced}"` : "Type at least 2 characters…"}
            </p>
          )}
          {results.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => { onChange(u); setOpen(false); setQuery(""); }}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 transition-colors text-left"
            >
              {u.profilePictureUrl ? (
                <img src={u.profilePictureUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#008CFF] text-[10px] font-bold text-white">
                  {u.name.charAt(0)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-slate-800 truncate">{u.name}</p>
                <p className="text-[11px] text-slate-500 truncate">{u.employeeProfile?.designation || u.email}</p>
              </div>
              {u.isActive === false && (
                <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 ring-1 ring-inset ring-slate-300">Exited</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
