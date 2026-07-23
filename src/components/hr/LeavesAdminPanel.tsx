"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import { useSession } from "next-auth/react";
import { fetcher } from "@/lib/swr";
import { Search, Sparkles, Plus, Minus, X, CalendarPlus, AlertTriangle, Home, Clock } from "lucide-react";
import { DateField } from "@/components/ui/date-field";
import SelectField from "@/components/ui/SelectField";
import PopupPanel from "@/components/ui/PopupPanel";
import HandoffSection from "@/components/hr/HandoffSection";
import type { PickerUser } from "@/components/hr/EmployeePicker";

type LeaveTypeRow = { id: number; name: string; code: string; daysPerYear: number; applicable?: boolean };
type Bal          = { id: number | null; total: number; used: number; pending: number };
type EmpRow       = {
  id: number; name: string; email: string;
  profilePictureUrl: string | null;
  businessUnit: string | null;
  balances: Record<number, Bal>;
};

/**
 * Leave-balance admin grid. Every employee × leave type cell is a
 * click-to-edit chip showing remaining days. Zero balances render in a
 * quiet slate tone (not "alarming" red) — red is reserved for actually
 * overdrawn balances.
 */
export default function LeavesAdminPanel(_props: {
  leaveTypes?: any[];
  /** Locks the panel to a specific brand on mount (NB Media / YT Labs)
   *  — comes from the `?brand=` URL param on /dashboard/hr/admin. When
   *  null, the panel auto-detects from the viewer's businessUnit (or
   *  "all" for super-admins) as before. */
  initialBrand?: "NB Media" | "YT Labs" | "all" | null;
}) {
  const initialBrand = _props.initialBrand ?? null;
  const currentYear = new Date().getFullYear();
  const [year, setYear]   = useState<number>(currentYear);
  const [query, setQuery] = useState("");

  const url = `/api/hr/admin/leave-balances?year=${year}`;
  const { data, isLoading } = useSWR<{ year: number; leaveTypes: LeaveTypeRow[]; employees: EmpRow[] }>(url, fetcher);

  const leaveTypes = data?.leaveTypes ?? [];
  const employees  = data?.employees ?? [];

  // ── Company scope tabs ──────────────────────────────────────────────
  // Same pattern as ApprovalsPanel: auto-default to viewer's brand
  // (founders / super-admins land on "all"). Splits the balance grid
  // into NB Media vs YT Labs so each HR manager works on their brand.
  type CompanyTab = "NB Media" | "YT Labs" | "all";
  const { data: session } = useSession();
  const me = session?.user as any;
  const [companyTab, setCompanyTab] = useState<CompanyTab>(initialBrand ?? "all");
  const [companyTabTouched, setCompanyTabTouched] = useState<boolean>(initialBrand != null);
  const { data: viewerProfile } = useSWR<any>(
    me ? "/api/hr/profile" : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  // Sync to a changing URL param without remounting.
  useEffect(() => {
    if (initialBrand == null) return;
    setCompanyTab(initialBrand);
    setCompanyTabTouched(true);
  }, [initialBrand]);
  useEffect(() => {
    if (companyTabTouched) return;
    const isSuperAdmin = me?.orgLevel === "ceo" || me?.isDeveloper;
    if (isSuperAdmin) { setCompanyTab("all"); return; }
    const bu = viewerProfile?.employeeProfile?.businessUnit;
    if (bu === "YT Labs") setCompanyTab("YT Labs");
    else if (bu === "NB Media" || bu == null) setCompanyTab("NB Media");
  }, [viewerProfile, me, companyTabTouched]);

  const companyCounts = useMemo(() => {
    let nb = 0, yt = 0;
    employees.forEach((e) => {
      const bu = e.businessUnit || "NB Media";
      if (bu === "YT Labs") yt++;
      else nb++;
    });
    return { nb, yt, all: employees.length };
  }, [employees]);

  const filtered = useMemo(() => {
    let rows = employees;
    if (companyTab !== "all") {
      rows = rows.filter((e) => (e.businessUnit || "NB Media") === companyTab);
    }
    if (!query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter((e) =>
      (e.name || "").toLowerCase().includes(q) ||
      (e.email || "").toLowerCase().includes(q)
    );
  }, [employees, query, companyTab]);

  // ── Edit modal ────────────────────────────────────────────────
  const [editing, setEditing] = useState<{ emp: EmpRow; type: LeaveTypeRow; bal: Bal } | null>(null);
  // `unused` is derived (total − used) but tracked in form state so HR can
  // edit it directly. Editing total keeps used fixed and recomputes unused;
  // editing unused keeps total fixed and recomputes used. Saved usedDays
  // comes from form.used, which is always kept consistent with these rules.
  const [form, setForm] = useState({ total: "", used: "", unused: "", pending: "" });
  const [busy, setBusy] = useState(false);
  const totalInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    const t = editing.bal.total;
    const u = editing.bal.used;
    setForm({
      total:   String(t),
      used:    String(u),
      unused:  String(Math.max(0, t - u)),
      pending: String(editing.bal.pending),
    });
    requestAnimationFrame(() => totalInputRef.current?.select());
  }, [editing]);

  // Helpers that keep total/used/unused in sync when any one of them moves.
  // Total changed → used stays, unused = total − used.
  const setTotalKeepingUsed = (nextTotal: string) => {
    setForm((f) => {
      const t = Number(nextTotal || 0);
      const u = Number(f.used || 0);
      return { ...f, total: nextTotal, unused: String(Math.max(0, t - u)) };
    });
  };
  // Unused changed → total stays, used = total − unused.
  const setUnusedKeepingTotal = (nextUnused: string) => {
    setForm((f) => {
      const t = Number(f.total || 0);
      const un = Number(nextUnused || 0);
      return { ...f, unused: nextUnused, used: String(Math.max(0, t - un)) };
    });
  };

  const openEdit = (emp: EmpRow, type: LeaveTypeRow) =>
    setEditing({ emp, type, bal: emp.balances[type.id] });

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const res = await fetch("/api/hr/admin/leave-balances", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId:      editing.emp.id,
          leaveTypeId: editing.type.id,
          year,
          totalDays:   form.total   === "" ? undefined : Number(form.total),
          usedDays:    form.used    === "" ? undefined : Number(form.used),
          pendingDays: form.pending === "" ? undefined : Number(form.pending),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Save failed");
        return;
      }
      setEditing(null);
      mutate(url);
    } finally { setBusy(false); }
  };

  const adjustTotal = (delta: number) => {
    setForm((f) => {
      const next = Math.max(0, Number(f.total || 0) + delta);
      const u    = Number(f.used || 0);
      return { ...f, total: String(next), unused: String(Math.max(0, next - u)) };
    });
  };

  // ── Bulk action: seed every employee's TOTAL for one type to its policy. ──
  const [bulkBusy, setBulkBusy] = useState(false);
  const seedDefaults = async (typeId: number | "all") => {
    // Skip balance-only types (e.g. Carry Over Leave). HR enters those
    // manually per-employee and the value must NEVER be overwritten by
    // policy defaults — old employees rely on it for exit encashment.
    const pool = leaveTypes.filter((t) => t.applicable !== false);
    const targets = typeId === "all" ? pool : pool.filter((t) => t.id === typeId);
    if (targets.length === 0) {
      alert("This leave type is balance-only — policy defaults don't apply. Edit each employee's value manually.");
      return;
    }
    const summary = targets.map((t) => `• ${t.name} → ${t.daysPerYear} day(s)`).join("\n");
    if (!confirm(
      `Apply the policy entitlement to every active employee for ${year}?\n\n${summary}\n\nUsed / pending days are preserved; only TOTAL changes.`
    )) return;

    setBulkBusy(true);
    try {
      const ids = employees.map((e) => e.id);
      // Fire requests in batches of 8 so we don't drown the API.
      const BATCH = 8;
      for (const t of targets) {
        for (let i = 0; i < ids.length; i += BATCH) {
          await Promise.all(ids.slice(i, i + BATCH).map((userId) =>
            fetch("/api/hr/admin/leave-balances", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId, leaveTypeId: t.id, year, totalDays: t.daysPerYear }),
            }).catch(() => {})
          ));
        }
      }
      mutate(url);
    } finally { setBulkBusy(false); }
  };

  const yearOptions = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2];

  // ── Apply On Behalf modal ──────────────────────────────────────
  // HR admins can grant any active leave type — or a Work From Home —
  // for any active user. Both flows route through normal approval
  // (the target user's manager's L1 queue, then CEO/HR finalises).
  // When applying leave: an insufficient/missing balance auto-routes
  // to LWP if the toggle is on.
  type ApplyMode = "leave" | "wfh";
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyMode, setApplyMode] = useState<ApplyMode>("leave");
  const [applyForm, setApplyForm] = useState({
    userId: "" as number | "",
    leaveTypeId: "" as number | "",
    fromDate: new Date().toISOString().slice(0, 10),
    toDate:   new Date().toISOString().slice(0, 10),
    reason: "",
    useLwpFallback: true,
  });
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState("");
  // Handoff Details for the HR-on-behalf flow. POC supports an N/A
  // option (HR may not know who's covering); workStatus is required
  // but accepts "N/A" if HR doesn't have that context either.
  // unavailability only renders in WFH mode.
  const [handoffPoc,            setHandoffPoc]            = useState<PickerUser[]>([]);
  const [handoffPocNa,          setHandoffPocNa]          = useState(false);
  const [handoffWorkStatus,     setHandoffWorkStatus]     = useState("");
  const [handoffUnavailability, setHandoffUnavailability] = useState("");
  const resetHandoff = () => {
    setHandoffPoc([]); setHandoffPocNa(false);
    setHandoffWorkStatus(""); setHandoffUnavailability("");
  };
  // Day-kind toggle for the apply-on-behalf form (mirrors the regular
  // leave application form). full → standard range; first/second half
  // collapse to one date and tag the reason so attendance reports the
  // correct fraction.
  const [applyDayKind, setApplyDayKind] = useState<"full" | "first_half" | "second_half">("full");
  const isApplyHalf = applyDayKind !== "full";
  // Employee picker: typed search + outside-click close. Replaces the
  // native <select> which became unwieldy with 60+ active employees.
  const [empQuery, setEmpQuery] = useState("");
  const [empOpen,  setEmpOpen]  = useState(false);
  const empPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!empOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (empPickerRef.current && !empPickerRef.current.contains(e.target as Node)) setEmpOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [empOpen]);
  const filteredEmps = useMemo(() => {
    if (!empQuery.trim()) return employees.slice(0, 12);
    const q = empQuery.trim().toLowerCase();
    return employees
      .filter((e) => e.name?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q))
      .slice(0, 12);
  }, [employees, empQuery]);
  const selectedEmployee = typeof applyForm.userId === "number"
    ? employees.find((e) => e.id === applyForm.userId)
    : null;
  // Pickable leave types — only active + applicable. Reuses the data
  // already loaded for the matrix so no extra fetch is needed.
  const applicableTypes = useMemo(
    () => leaveTypes.filter((t) => t.applicable !== false),
    [leaveTypes],
  );
  // Live preview of the chosen user's available balance for the chosen type.
  const applyBalancePreview = useMemo(() => {
    if (typeof applyForm.userId !== "number" || typeof applyForm.leaveTypeId !== "number") return null;
    const emp = employees.find((e) => e.id === applyForm.userId);
    const bal = emp?.balances?.[applyForm.leaveTypeId];
    if (!bal) return { total: 0, used: 0, pending: 0, available: 0 };
    return { ...bal, available: Math.max(0, (bal.total ?? 0) - (bal.used ?? 0) - (bal.pending ?? 0)) };
  }, [applyForm.userId, applyForm.leaveTypeId, employees]);

  // Inline balance editor — HR can grant / adjust the chosen employee's
  // balance for the chosen leave type without leaving the Apply modal.
  // Useful for the common case where Sick Leave shows 0/0 and HR wants
  // to give a quick allotment so the leave goes through instead of
  // falling back to LWP. Closes back to the read-only preview on Save.
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceEdit, setBalanceEdit] = useState({ total: "", used: "", pending: "" });
  const [savingBalance, setSavingBalance] = useState(false);
  const [balanceError, setBalanceError] = useState("");

  // Whenever the picked (user, type) changes, exit edit mode so the
  // pre-fill on next edit reflects the new pair, not the previous one.
  useEffect(() => {
    setEditingBalance(false);
    setBalanceError("");
  }, [applyForm.userId, applyForm.leaveTypeId]);

  const openBalanceEdit = () => {
    const b = applyBalancePreview;
    setBalanceEdit({
      total:   String(b?.total   ?? 0),
      used:    String(b?.used    ?? 0),
      pending: String(b?.pending ?? 0),
    });
    setBalanceError("");
    setEditingBalance(true);
  };
  const saveBalance = async () => {
    if (typeof applyForm.userId !== "number" || typeof applyForm.leaveTypeId !== "number") return;
    const t = Number(balanceEdit.total),
          u = Number(balanceEdit.used),
          pen = Number(balanceEdit.pending);
    if (![t, u, pen].every(Number.isFinite) || t < 0 || u < 0 || pen < 0) {
      setBalanceError("All three values must be non-negative numbers.");
      return;
    }
    setSavingBalance(true);
    setBalanceError("");
    try {
      const fromDate = applyForm.fromDate || new Date().toISOString().slice(0, 10);
      const yr = parseInt(fromDate.slice(0, 4), 10);
      const res = await fetch("/api/hr/admin/leave-balances", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId:      applyForm.userId,
          leaveTypeId: applyForm.leaveTypeId,
          year:        yr,
          totalDays:   t,
          usedDays:    u,
          pendingDays: pen,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setBalanceError(json?.error || "Failed to save balance."); return; }
      // Refresh the matrix so the live preview picks up the new numbers.
      await mutate(url);
      setEditingBalance(false);
    } finally { setSavingBalance(false); }
  };

  const submitApply = async () => {
    setApplyError("");
    if (typeof applyForm.userId !== "number")     return setApplyError("Pick an employee.");
    if (!applyForm.fromDate || !applyForm.toDate) return setApplyError("Pick a date range.");
    if (!applyForm.reason.trim())                 return setApplyError("Reason is required.");
    if (applyMode === "leave" && typeof applyForm.leaveTypeId !== "number") {
      return setApplyError("Pick a leave type.");
    }
    // Handoff Details — POC is N/A-eligible; workStatus is always
    // required (HR can type "N/A" if they don't have context).
    // unavailability is WFH-only and required when shown.
    const pocId = handoffPocNa ? null : (handoffPoc[0]?.id ?? null);
    if (!handoffPocNa && !pocId)                              return setApplyError("POC in Absence is required (or mark as N/A).");
    if (!handoffWorkStatus.trim())                            return setApplyError("Work Status is required.");
    if (applyMode === "wfh" && !handoffUnavailability.trim()) return setApplyError("Time of Unavailability is required.");
    setApplyBusy(true);
    try {
      let res: Response;
      if (applyMode === "leave") {
        // Half-day requests tag the reason with [First Half] / [Second Half]
        // so the API's 0.5-day rule kicks in. Full-day passes the reason
        // verbatim. The toDate is always pinned to fromDate when half-day.
        const reasonText = applyForm.reason.trim();
        const reasonOut =
          applyDayKind === "first_half"  ? `[First Half] ${reasonText}`  :
          applyDayKind === "second_half" ? `[Second Half] ${reasonText}` :
                                            reasonText;
        const toDateOut = isApplyHalf ? applyForm.fromDate : applyForm.toDate;
        res = await fetch("/api/hr/leaves", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetUserId:    applyForm.userId,
            leaveTypeId:     applyForm.leaveTypeId,
            fromDate:        applyForm.fromDate,
            toDate:          toDateOut,
            reason:          reasonOut,
            useLwpFallback:  applyForm.useLwpFallback,
            pocUserId:       pocId,
            workStatus:      handoffWorkStatus.trim(),
          }),
        });
      } else {
        // WFH range: the API iterates working days between date and
        // toDate, creating one WFHRequest per day. Weekends are skipped
        // server-side; days that already have an active WFH are quietly
        // skipped too. Goes through normal approval (no forceGrant) —
        // routed to the target user's manager's L1 queue.
        //
        // Half-day WFH tags the reason with [First Half] / [Second Half]
        // (same convention as leave) and collapses the range to a
        // single date — half-day WFH only makes sense for one day.
        const wfhReasonText = applyForm.reason.trim();
        const wfhReasonOut =
          applyDayKind === "first_half"  ? `[First Half] ${wfhReasonText}`  :
          applyDayKind === "second_half" ? `[Second Half] ${wfhReasonText}` :
                                            wfhReasonText;
        const wfhToDateOut = isApplyHalf ? applyForm.fromDate : applyForm.toDate;
        res = await fetch("/api/hr/attendance/wfh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetUserId:   applyForm.userId,
            date:           applyForm.fromDate,
            toDate:         wfhToDateOut,
            reason:         wfhReasonOut,
            pocUserId:      pocId,
            workStatus:     handoffWorkStatus.trim(),
            unavailability: handoffUnavailability.trim(),
          }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setApplyError(data?.error || `Failed to apply ${applyMode === "wfh" ? "WFH" : "leave"}.`); return; }
      setApplyOpen(false);
      setApplyForm((f) => ({ ...f, reason: "" }));
      resetHandoff();
      mutate(url);
    } finally { setApplyBusy(false); }
  };

  return (
    <>
      {/* ── Header card ────────────────────────────────────────────
          Two-row layout: title + tiny meta strip on top; controls
          underneath. Wraps cleanly on narrow widths so the buttons
          never collide with the search box. */}
      <header className="mb-5 rounded-2xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-slate-800 dark:text-white">Leave Balances</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Click any cell to edit. Changes apply to{" "}
              <span className="font-semibold text-slate-700">{year}</span>.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {employees.length} {employees.length === 1 ? "employee" : "employees"}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#008CFF]" />
                {applicableTypes.length} active leave types
              </span>
            </div>
          </div>

          {/* Controls — primary actions on the right, search/year on the left
              within the control row so the eye lands on the action first. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search employee…"
                className="h-9 w-[200px] rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/20"
              />
              {query ? (
                <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                  <X size={12} />
                </button>
              ) : null}
            </div>
            <SelectField
              value={String(year)}
              onChange={(v) => setYear(Number(v))}
              options={yearOptions.map((y) => ({ value: String(y), label: String(y) }))}
              className="h-9 w-[110px] rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-800"
            />
            {/* Tonal divider so action buttons feel grouped */}
            <div className="hidden h-7 w-px bg-slate-200 sm:block" aria-hidden />
            <button
              onClick={() => { setApplyMode("leave"); setApplyOpen(true); }}
              disabled={employees.length === 0 || applicableTypes.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 text-[12.5px] font-semibold text-white shadow-sm shadow-emerald-500/20 transition hover:bg-emerald-600 disabled:opacity-60"
            >
              <CalendarPlus size={14} />
              Apply on behalf
            </button>
            <button
              onClick={() => seedDefaults("all")}
              disabled={bulkBusy || leaveTypes.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-[12.5px] font-semibold text-slate-700 transition hover:border-[#008CFF] hover:text-[#008CFF] disabled:opacity-60"
            >
              <Sparkles size={14} />
              {bulkBusy ? "Applying…" : "Apply policy defaults"}
            </button>
          </div>
        </div>
        {/* Company scope tabs — hidden when initialBrand is set
            (the HR Dashboard sidebar flyout already chose a brand). */}
        {initialBrand == null && (
          <div className="px-5 pb-4 border-t border-slate-100 pt-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 mb-2">Brand scope</div>
            <div className="flex items-center gap-1.5 flex-wrap">
            {([
              { key: "NB Media", count: companyCounts.nb  },
              { key: "YT Labs",  count: companyCounts.yt  },
              { key: "all",      count: companyCounts.all },
            ] as const).map(({ key, count }) => {
              const active = companyTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setCompanyTab(key as CompanyTab); setCompanyTabTouched(true); }}
                  className={`px-3.5 h-8 rounded-lg text-[12px] font-semibold transition-colors inline-flex items-center gap-2 ${
                    active
                      ? "bg-[#008CFF] text-white shadow-sm"
                      : "bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10"
                  }`}
                >
                  <span>{key === "all" ? "All" : key}</span>
                  <span className={`inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-bold !text-white ${
                    active ? "bg-white/20" : "bg-[#008CFF]"
                  }`} style={{ color: "#fff" }}>{count}</span>
                </button>
              );
            })}
            </div>
          </div>
        )}
      </header>

      {/* ── Matrix ─────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <table className="w-full min-w-[760px]">
          <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm">
            <tr className="border-b border-slate-100">
              <th className="sticky left-0 z-20 bg-slate-50/95 px-5 py-3 text-left text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500 min-w-[260px]">
                Employee
              </th>
              {leaveTypes.map((lt) => (
                <th key={lt.id} className="px-3 py-3 text-left align-bottom min-w-[120px]">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-700">{lt.name}</span>
                    {lt.applicable === false ? (
                      // Balance-only (e.g. Carry Over Leave) — value is HR-set
                      // per employee and stays exactly as entered. No policy
                      // reset button so a misclick can't wipe the carry-over
                      // balance an old employee will be paid out at exit.
                      <span
                        title="Balance-only — value stays as HR enters it; no policy default applies."
                        className="self-start rounded bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-semibold normal-case tracking-normal text-amber-700"
                      >
                        Balance only
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => seedDefaults(lt.id)}
                        title={`Reset every employee's ${lt.name} entitlement to ${lt.daysPerYear} day(s)`}
                        className="self-start rounded bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-semibold normal-case tracking-normal text-slate-600 transition hover:bg-[#e8f1fc] hover:text-[#0f4e93]"
                      >
                        Policy: {lt.daysPerYear}d ↻
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={leaveTypes.length + 1} className="px-5 py-12 text-center text-[12.5px] text-slate-400">Loading balances…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={leaveTypes.length + 1} className="px-5 py-12 text-center text-[12.5px] text-slate-400">
                {employees.length === 0 ? "No active employees." : `No employee matches "${query}".`}
              </td></tr>
            ) : filtered.map((emp, i) => (
              <tr
                key={emp.id}
                className={`border-b border-slate-50 transition-colors hover:bg-[#f8fbff] ${i % 2 === 0 ? "" : "bg-slate-50/30"}`}
              >
                <td className="sticky left-0 z-[1] bg-inherit px-5 py-3 min-w-[260px]">
                  <div className="flex items-center gap-2.5">
                    {emp.profilePictureUrl ? (
                      <img src={emp.profilePictureUrl} alt="" referrerPolicy="no-referrer" className="h-8 w-8 rounded-full object-cover ring-1 ring-slate-200" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e8f1fc] text-[11px] font-semibold text-[#0f4e93] ring-1 ring-[#cfdef5]">
                        {(emp.name || "?").trim().slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-slate-800">{emp.name}</p>
                      <p className="truncate text-[10.5px] text-slate-400">{emp.email}</p>
                    </div>
                  </div>
                </td>
                {leaveTypes.map((lt) => (
                  <td key={lt.id} className="px-3 py-3 align-middle">
                    <BalanceChip
                      bal={emp.balances[lt.id]}
                      onClick={() => openEdit(emp, lt)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Legend ─────────────────────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> Available
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> ≤ 1 day left
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" /> Overdrawn
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-slate-300" /> Not set
        </span>
        <span>· Click any cell to edit · Numbers shown are <strong>remaining / total</strong></span>
      </div>

      {/* ── Edit modal ─────────────────────────────────────────────── */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-2xl">
            <header className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-[15px] font-semibold text-slate-800">Edit leave balance</h3>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  {editing.emp.name} · <span className="font-medium text-slate-700">{editing.type.name}</span> · {year}
                </p>
              </div>
              <button onClick={() => setEditing(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X size={16} />
              </button>
            </header>

            <div className="space-y-4 px-5 py-4">
              {/* Total — primary control */}
              <div>
                <label className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500">Total entitlement</label>
                <div className="mt-1.5 flex items-center gap-2">
                  <button onClick={() => adjustTotal(-1)} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-100">
                    <Minus size={14} />
                  </button>
                  <input
                    ref={totalInputRef}
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.total}
                    onChange={(e) => setTotalKeepingUsed(e.target.value)}
                    className="h-9 flex-1 rounded-md border border-slate-200 bg-white px-3 text-center text-[16px] font-semibold tabular-nums text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/30"
                  />
                  <button onClick={() => adjustTotal( 1)} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-100">
                    <Plus size={14} />
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Policy default: <strong className="text-slate-600">{editing.type.daysPerYear} day(s)</strong>
                  {Number(form.total) !== editing.type.daysPerYear && form.total !== "" ? (
                    <button
                      onClick={() => setTotalKeepingUsed(String(editing!.type.daysPerYear))}
                      className="ml-2 text-[11px] font-semibold text-[#008CFF] hover:underline"
                    >
                      Use policy
                    </button>
                  ) : null}
                </p>
              </div>

              {/* Unused balance — read-only display. HR only edits the
                  entitlement above; "used" is auto-managed by the leaves
                  flow (created on approve, freed on reject). The number
                  shown here = currentTotal − usedDaysFromDB, recomputed
                  live so HR sees the impact of bumping the entitlement. */}
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor="unused-balance-input"
                    className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider text-amber-700"
                  >
                    <Clock size={11} strokeWidth={2.5} />
                    Unused balance
                  </label>
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      id="unused-balance-input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.unused}
                      onChange={(e) => setUnusedKeepingTotal(e.target.value)}
                      aria-label="Unused balance"
                      className="w-20 rounded-md border border-amber-200 bg-white px-2 py-1.5 text-center text-[18px] font-bold tabular-nums text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <span className="text-[12px] text-amber-700/70 tabular-nums">
                      / {(() => {
                        const t = Number(form.total || 0);
                        return t % 1 === 0 ? t.toFixed(0) : t.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
                      })()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Preview — what saves to the DB. Used stays as it was
                  loaded (auto-managed); only the entitlement changes. */}
              <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                <p className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wider text-slate-500">After save</p>
                <PreviewBreakdown
                  total={Number(form.total || 0)}
                  used={Number(form.used || 0)}
                />
              </div>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button onClick={() => setEditing(null)}
                className="h-9 rounded-md border border-slate-200 bg-white px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={busy}
                className="h-9 rounded-md bg-[#008CFF] px-4 text-[13px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-60">
                {busy ? "Saving…" : "Save changes"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* ── Apply On Behalf modal ────────────────────────────────── */}
      {applyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => !applyBusy && setApplyOpen(false)}>
          <div
            className="w-full max-w-xl rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200/60 max-h-[calc(100vh-48px)] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
              <div className="min-w-0">
                <h3 className="text-[15px] font-bold text-slate-800">
                  Apply {applyMode === "wfh" ? "WFH" : "Leave"} on behalf
                </h3>
              </div>
              <button onClick={() => !applyBusy && setApplyOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X size={16} />
              </button>
            </header>

            {/* Segmented Leave / WFH selector — clearer than two tabs at
                the top of the panel, since the rest of the form depends on
                this choice. */}
            <div className="px-6 pt-4">
              <div className="inline-flex w-full rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                <button
                  type="button"
                  onClick={() => setApplyMode("leave")}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold transition ${
                    applyMode === "leave"
                      ? "bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-200"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <CalendarPlus size={13} /> Leave
                </button>
                <button
                  type="button"
                  onClick={() => setApplyMode("wfh")}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold transition ${
                    applyMode === "wfh"
                      ? "bg-white text-[#0070d4] shadow-sm ring-1 ring-[#008CFF]/30"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <Home size={13} /> WFH
                </button>
              </div>
            </div>

            <div className="space-y-4 px-6 pb-5 pt-4">
              {applyError && (
                <p className="inline-flex w-full items-center gap-1.5 rounded-md bg-red-50 px-2.5 py-1.5 text-[12px] text-red-700 ring-1 ring-inset ring-red-200">
                  <AlertTriangle size={12} />
                  {applyError}
                </p>
              )}

              <div>
                <label className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Employee</label>
                <div ref={empPickerRef} className="relative mt-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={selectedEmployee && !empOpen
                      ? `${selectedEmployee.name} (${selectedEmployee.email})`
                      : empQuery}
                    onFocus={() => setEmpOpen(true)}
                    onChange={(e) => { setEmpQuery(e.target.value); setEmpOpen(true); }}
                    placeholder="Search by name or email…"
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/20"
                  />
                  <PopupPanel
                    open={empOpen}
                    triggerRef={empPickerRef}
                    onClose={() => setEmpOpen(false)}
                    maxHeight={288}
                    className="bg-white border border-slate-200 rounded-lg shadow-2xl overflow-y-auto"
                  >
                      {filteredEmps.length === 0 ? (
                        <p className="px-3 py-2.5 text-[12.5px] text-slate-500">
                          {empQuery ? "No matching employees." : "No active employees."}
                        </p>
                      ) : (
                        filteredEmps.map((e) => {
                          const active = applyForm.userId === e.id;
                          return (
                            <button
                              key={e.id}
                              type="button"
                              onClick={() => {
                                setApplyForm((f) => ({ ...f, userId: e.id }));
                                setEmpQuery("");
                                setEmpOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2 border-b border-slate-50 last:border-0 ${
                                active ? "bg-[#008CFF]/10" : "hover:bg-[#008CFF]/5"
                              }`}
                            >
                              <p className="text-[13px] font-semibold text-slate-800">{e.name}</p>
                              <p className="text-[11.5px] text-slate-500 truncate">{e.email}</p>
                            </button>
                          );
                        })
                      )}
                  </PopupPanel>
                </div>
              </div>

              {applyMode === "leave" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Leave type</label>
                  <SelectField
                    value={applyForm.leaveTypeId === "" ? "" : String(applyForm.leaveTypeId)}
                    onChange={(v) => setApplyForm((f) => ({ ...f, leaveTypeId: v ? Number(v) : "" }))}
                    placeholder="— Select type —"
                    options={applicableTypes.map((t) => ({ value: String(t.id), label: t.name }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 h-10 text-[13px] text-slate-800"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Live balance</label>
                    {applyBalancePreview !== null && !editingBalance && (
                      <button
                        type="button"
                        onClick={openBalanceEdit}
                        className="text-[10.5px] font-bold uppercase tracking-wider text-[#008CFF] hover:underline"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  {!editingBalance ? (
                    <div className="mt-1 h-[38px] flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-[12.5px] text-slate-600">
                      {applyBalancePreview === null ? "— —" : (
                        <>
                          <span className="font-semibold text-slate-800">{applyBalancePreview.available}</span>
                          <span className="ml-1 text-slate-500">available · {applyBalancePreview.total} total</span>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="mt-1 rounded-lg border border-[#008CFF]/30 bg-[#008CFF]/[0.04] p-2.5 space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">Total</label>
                          <input
                            type="number" min={0} step="0.5"
                            value={balanceEdit.total}
                            onChange={(e) => setBalanceEdit((f) => ({ ...f, total: e.target.value }))}
                            className="mt-0.5 w-full rounded border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                          />
                        </div>
                        <div>
                          <label className="block text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">Used</label>
                          <input
                            type="number" min={0} step="0.5"
                            value={balanceEdit.used}
                            onChange={(e) => setBalanceEdit((f) => ({ ...f, used: e.target.value }))}
                            className="mt-0.5 w-full rounded border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                          />
                        </div>
                        <div>
                          <label className="block text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">Pending</label>
                          <input
                            type="number" min={0} step="0.5"
                            value={balanceEdit.pending}
                            onChange={(e) => setBalanceEdit((f) => ({ ...f, pending: e.target.value }))}
                            className="mt-0.5 w-full rounded border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                          />
                        </div>
                      </div>
                      {balanceError && (
                        <p className="text-[11px] text-red-700 bg-red-50 px-2 py-1 rounded ring-1 ring-inset ring-red-200">{balanceError}</p>
                      )}
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => { setEditingBalance(false); setBalanceError(""); }}
                          disabled={savingBalance}
                          className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={saveBalance}
                          disabled={savingBalance}
                          className="rounded bg-[#008CFF] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-60"
                        >
                          {savingBalance ? "Saving…" : "Save balance"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              )}

              {/* Full / Half day pill — applies to both leave and WFH
                  grants. Picking a half day pins toDate to fromDate and
                  prepends the reason with the [First Half] / [Second
                  Half] marker. For leave the API uses the marker to
                  count as 0.5 days; for WFH the marker shows up on
                  approval + attendance display so HR knows which half. */}
              {(applyMode === "leave" || applyMode === "wfh") && (
                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Day type</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { k: "full",         label: "Full Day"    },
                      { k: "first_half",   label: "First Half"  },
                      { k: "second_half",  label: "Second Half" },
                    ].map((opt) => {
                      const active = applyDayKind === opt.k;
                      return (
                        <button
                          key={opt.k}
                          type="button"
                          onClick={() => {
                            const next = opt.k as typeof applyDayKind;
                            setApplyDayKind(next);
                            if (next !== "full") {
                              // Half-day collapses the range to a single date.
                              setApplyForm((f) => ({ ...f, toDate: f.fromDate }));
                            }
                          }}
                          className={`h-8 px-3.5 rounded-full border text-[11.5px] font-semibold transition-colors ${
                            active
                              ? "bg-[#008CFF] text-white border-[#008CFF] shadow-sm"
                              : "bg-white text-slate-600 border-slate-200 hover:border-[#008CFF]/40 hover:text-[#008CFF]"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Date range — both leave and WFH use From/To. HR-grant
                  WFH iterates working days in the range; weekends are
                  skipped server-side. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">From date</label>
                  <DateField
                    value={applyForm.fromDate}
                    onChange={(v) => setApplyForm((f) => ({
                      ...f,
                      fromDate: v,
                      // Half-day always pins toDate to fromDate.
                      toDate: isApplyHalf ? v : (!f.toDate || new Date(v) > new Date(f.toDate) ? v : f.toDate),
                    }))}
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">To date</label>
                  <DateField
                    value={isApplyHalf ? applyForm.fromDate : applyForm.toDate}
                    disabled={isApplyHalf}
                    onChange={(v) => setApplyForm((f) => ({ ...f, toDate: v }))}
                    className="mt-1 w-full"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                  Reason <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={applyForm.reason}
                  onChange={(e) => setApplyForm((f) => ({ ...f, reason: e.target.value }))}
                  rows={3}
                  placeholder={applyMode === "wfh"
                    ? "Why is HR granting this WFH?"
                    : "Why is HR applying this leave on behalf?"}
                  className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/20"
                />
              </div>

              {/* Handoff Details — POC + Work Status (+ Unavailability for
                  WFH). POC is N/A-eligible here because HR may not know
                  who's covering. The HandoffSection renders its own top
                  divider for visual separation. */}
              <HandoffSection
                poc={handoffPoc}
                onPocChange={setHandoffPoc}
                workStatus={handoffWorkStatus}
                onWorkStatusChange={setHandoffWorkStatus}
                unavailability={handoffUnavailability}
                onUnavailabilityChange={setHandoffUnavailability}
                showUnavailability={applyMode === "wfh"}
                allowNa
                naSelected={handoffPocNa}
                onNaChange={setHandoffPocNa}
              />

              {applyMode === "leave" && (
                <label className="flex items-start gap-2 rounded-lg bg-amber-50/60 px-3 py-2 ring-1 ring-inset ring-amber-200/60">
                  <input
                    type="checkbox"
                    checked={applyForm.useLwpFallback}
                    onChange={(e) => setApplyForm((f) => ({ ...f, useLwpFallback: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span className="text-[12px] text-amber-900">
                    Fall back to <strong>Leave Without Pay</strong> if balance is missing or insufficient.
                    When off, the request will be rejected with an insufficient-balance error.
                  </span>
                </label>
              )}
              {applyMode === "wfh" && (
                <p className="rounded-lg bg-sky-50 px-3 py-2 text-[12px] text-sky-800 ring-1 ring-inset ring-sky-200/60">
                  Monthly cap of <strong>2 WFH per employee</strong> is bypassed for HR-granted requests. One approved Work-From-Home is created per working day in the range — weekends are skipped and any day with an active WFH already on file stays untouched.
                </p>
              )}
            </div>

            <footer className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
              <button
                onClick={() => setApplyOpen(false)}
                disabled={applyBusy}
                className="h-9 rounded-md border border-slate-200 px-4 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitApply}
                disabled={applyBusy}
                className={`h-9 rounded-md px-4 text-[13px] font-semibold text-white shadow-sm disabled:opacity-60 ${
                  applyMode === "wfh"
                    ? "bg-[#008CFF] shadow-[#008CFF]/20 hover:bg-[#0070d4]"
                    : "bg-emerald-500 shadow-emerald-500/20 hover:bg-emerald-600"
                }`}
              >
                {applyBusy
                  ? "Applying…"
                  : applyMode === "wfh" ? "Grant WFH" : "Apply leave"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

// ── Cell chip — colour-graded by remaining balance ────────────────────
function BalanceChip({ bal, onClick }: { bal: Bal; onClick: () => void }) {
  const total     = bal.total;
  const used      = bal.used;
  const pending   = bal.pending;
  const remaining = total - used - pending;

  // Tone rules:
  //   total = 0          → slate (not configured)  — quiet, NOT alarming
  //   remaining < 0      → red   (overdrawn)
  //   remaining < 1      → amber (≤ 1 day left)
  //   otherwise          → emerald
  const tone =
    total <= 0
      ? "bg-slate-50 text-slate-500 ring-slate-200 hover:bg-slate-100"
      : remaining < 0
        ? "bg-red-50 text-red-700 ring-red-200 hover:bg-red-100"
        : remaining < 1
          ? "bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100"
          : "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100";

  const tooltip = total === 0
    ? "Not configured — click to set"
    : `Total ${total} · Used ${used} · Pending ${pending}`;

  // Display: if not set yet, just show a muted dash — don't shout zeros.
  const display = total === 0
    ? <span className="font-medium">—</span>
    : (
      <>
        <span className="text-[14px] font-semibold tabular-nums leading-none">{remaining}</span>
        <span className="ml-1 text-[10.5px] font-medium tabular-nums leading-none opacity-70">/ {total}</span>
      </>
    );

  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={`inline-flex min-w-[68px] items-baseline justify-center gap-0.5 rounded-md px-2.5 py-1.5 ring-1 ring-inset transition ${tone}`}
    >
      {display}
    </button>
  );
}

function PreviewBreakdown({ total, used }: { total: number; used: number }) {
  const unused = Math.max(0, total - used);
  const fmt = (n: number) => (n % 1 === 0 ? n.toFixed(0) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
  const unusedTone =
    total <= 0    ? "bg-slate-100 text-slate-600" :
    unused < 1    ? "bg-amber-100 text-amber-700"  :
                    "bg-emerald-100 text-emerald-700";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-[12px] tabular-nums">
        <span className="flex items-center gap-1.5 text-slate-700">
          <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
          Total entitlement
        </span>
        <span className="font-semibold text-slate-800">{fmt(total)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 text-[12px] tabular-nums">
        <span className="flex items-center gap-1.5 text-emerald-700">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          − Used (already taken)
        </span>
        <span className="font-semibold text-emerald-700">{fmt(used)}</span>
      </div>
      {/* Final unused balance — emphasized; shown as X / Y for clarity. */}
      <div className={`mt-1 flex items-center justify-between gap-2 rounded-md px-2 py-1.5 ${unusedTone}`}>
        <span className="text-[11.5px] font-bold uppercase tracking-wider opacity-80">
          = Unused (leave balance)
        </span>
        <span className="text-[14px] font-bold tabular-nums">
          {fmt(unused)} <span className="opacity-60 font-normal">/ {fmt(total)}</span>
        </span>
      </div>
    </div>
  );
}
