"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import useSWR, { mutate as globalMutate } from "swr";
import { showToast } from "@/components/ui/Toast";
import { fetcher } from "@/lib/swr";
import { X, Info, Search, Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { DatePicker } from "@/components/ui/date-picker";
import EmployeePicker, { type PickerUser } from "@/components/hr/EmployeePicker";
import HandoffSection from "@/components/hr/HandoffSection";
import { leaveMinDate } from "@/lib/hr/leave-date-rules";
import { isWorkingDay, type ShiftWorkRule } from "@/lib/hr/shift-working-days";

// ── Shared types ─────────────────────────────────────────────────────────────
export type LeaveRequestKind = "wfh" | "on_duty" | "half_day" | "leave" | "regularize";

export type LeaveRequestFormProps = {
  kind: LeaveRequestKind;
  title: string;
  policyText?: string;
  /** For "leave": list of LeaveType rows {id,name}. Shown as a select. */
  leaveTypes?: { id: number; name: string }[];
  /** Prefill the date field (YYYY-MM-DD). */
  prefillDate?: string;
  onClose: () => void;
  /** Called after successful POST so the caller can refresh their SWR keys. */
  onSaved?: () => void;
};

// ── Leave type picker — shows per-type balance next to each option ────────
function LeaveTypePicker({
  leaveTypes,
  value,
  onChange,
}: {
  leaveTypes: { id: number; name: string }[];
  value: number | "";
  onChange: (v: number | "") => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: balances = [] } = useSWR<any[]>("/api/hr/leaves/balance", fetcher);
  const balanceByTypeId = useMemo(() => {
    const map = new Map<number, number>();
    for (const b of Array.isArray(balances) ? balances : []) {
      // Remaining balance shown when applying = total − used − pending.
      // Pending must be subtracted so this matches what the apply API
      // enforces (POST /api/hr/leaves uses total-used-pending); otherwise the
      // form showed more "available" than could actually be applied for.
      const available = parseFloat(b.totalDays ?? "0") - parseFloat(b.usedDays ?? "0") - parseFloat(b.pendingDays ?? "0");
      if (b.leaveTypeId) map.set(b.leaveTypeId, available);
    }
    return map;
  }, [balances]);

  useEffect(() => {
    if (!open) return;
    const recompute = () => { if (btnRef.current) setRect(btnRef.current.getBoundingClientRect()); };
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t))   return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = leaveTypes.find((t) => t.id === value) || null;

  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
        Select type of leave you want to apply
      </label>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`mt-1.5 w-full h-11 px-3 rounded-lg border text-left flex items-center justify-between transition-colors
          bg-white dark:bg-[#0a1526] border-slate-200 dark:border-white/[0.08]
          text-[13px] text-slate-800 dark:text-white
          ${open ? "border-[#008CFF] dark:border-[#4a9cff] ring-1 ring-[#008CFF]/20" : "hover:border-[#008CFF]/40"}
        `}
      >
        <span className={selected ? "" : "text-slate-400"}>{selected?.name ?? "Select Leave"}</span>
        <ChevronDown size={16} strokeWidth={2} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && rect && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top:   rect.bottom + 6,
            left:  rect.left,
            width: rect.width,
            zIndex: 10000,
            maxHeight: 320,
          }}
          className="rounded-lg border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#0a1526] shadow-2xl overflow-y-auto"
        >
          {leaveTypes.map((t) => {
            const bal = balanceByTypeId.get(t.id);
            const isSelected = value === t.id;
            const available = bal != null && bal > 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { onChange(t.id); setOpen(false); }}
                className={`w-full flex items-center justify-between px-4 py-3 text-left border-b border-slate-100 dark:border-white/[0.04] last:border-b-0 transition-colors
                  ${isSelected ? "bg-[#008CFF]/[0.08] dark:bg-[#4a9cff]/[0.1]" : "hover:bg-slate-50 dark:hover:bg-white/[0.03]"}
                `}
              >
                <span className={`text-[13px] font-medium ${isSelected ? "text-[#008CFF] dark:text-[#4a9cff]" : "text-slate-800 dark:text-white"}`}>
                  {t.name}
                </span>
                <span className={`text-[11.5px] ${available ? "text-slate-600 dark:text-slate-300 font-medium" : "text-slate-400 dark:text-slate-500"}`}>
                  {bal == null
                    ? "Not Available"
                    : bal > 0
                      ? `${bal % 1 === 0 ? bal.toFixed(0) : bal.toFixed(1)} day${bal === 1 ? "" : "s"} available`
                      : "Not Available"}
                </span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}


// ── Main form ────────────────────────────────────────────────────────────────
export default function LeaveRequestForm({
  kind, title, policyText, leaveTypes, prefillDate, onClose, onSaved,
}: LeaveRequestFormProps) {
  // IST-anchored so evening users don't see yesterday as the default.
  const today = prefillDate || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const { data: session } = useSession();
  const me = session?.user as any;
  // The caller's own shift rule + anchor, so the day-count preview below
  // matches the server's countWorkingDays() (alternate-Saturday aware).
  // Undefined while loading / null when no shift → Mon–Fri fallback.
  const { data: myShift } = useSWR<{ shift: ShiftWorkRule; effectiveFrom: string | null }>(
    "/api/hr/me/shift", fetcher,
  );
  // Restricted-admin tier (CEO / hr_manager / dev) can back-date; everyone
  // else gets clamped to today + future via the date picker's minDate prop.
  const minDate = leaveMinDate(me);

  const [fromDate, setFromDate] = useState(today);
  const [toDate,   setToDate]   = useState(today);
  // Start with no leave type chosen — the picker shows the "Select Leave"
  // placeholder so the user makes a deliberate choice rather than accidentally
  // submitting against the first type in the list.
  const [leaveTypeId, setLeaveTypeId] = useState<number | "">("");
  const [note, setNote]         = useState("");
  const [notify, setNotify]     = useState<{ id: number; name: string; email?: string; profilePictureUrl?: string | null }[]>([]);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState("");
  const [isHalfDayShift, setIsHalfDayShift] = useState(false);
  // First-half / second-half follow-up when a WFH is marked as
  // half-day. Mirrors the leave form's first_half / second_half toggle
  // so HR can see which half of the day the employee is working from
  // home. Default to "first" so the form has a valid selection the
  // moment the half-day checkbox is ticked.
  const [halfKind, setHalfKind] = useState<"first" | "second">("first");
  // Full vs half day, with which half — only meaningful on the leave form. The
  // half-day form (`kind=half_day`) keeps its own legacy flow and ignores this.
  const [dayKind, setDayKind] = useState<"full" | "first_half" | "second_half">("full");
  const isHalfLeave = kind === "leave" && dayKind !== "full";

  // Handoff fields — apply to every kind EXCEPT regularize. Work Status
  // is required for those forms; WFH additionally requires Time of
  // Unavailability. POC has an opt-in N/A toggle: users / HR can mark
  // it N/A when there's no specific cover assigned. When N/A is ticked,
  // pocUserId submits as null.
  const handoffApplies = kind !== "regularize";
  const [poc, setPoc] = useState<PickerUser[]>([]);
  const [pocNa, setPocNa] = useState(false);
  const [workStatus, setWorkStatus] = useState("");
  const [unavailability, setUnavailability] = useState("");

  // Working-day preview: walk from→to and count the user's working days.
  // Shift-aware via the shared `isWorkingDay`, so it matches the server's
  // `countWorkingDays()` — an NB alternate-Saturday employee sees a worked
  // Saturday count as 1, a 5-day (YT) employee still sees Saturdays as 0,
  // and users with no shift fall back to Mon–Fri. Holidays are still only
  // subtracted server-side (the source of truth for the actual deduction),
  // so the preview can differ by any holidays in the range — same as before.
  const days = useMemo(() => {
    if (!fromDate || !toDate) return 0;
    if (isHalfLeave) return 0.5;
    const a = new Date(`${fromDate}T00:00:00Z`);
    const b = new Date(`${toDate}T00:00:00Z`);
    if (isNaN(a.getTime()) || isNaN(b.getTime()) || a > b) return 0;
    const shift = (myShift?.shift ?? null) as ShiftWorkRule;
    const anchor = myShift?.effectiveFrom ? new Date(myShift.effectiveFrom) : null;
    let count = 0;
    const cur = new Date(a.getTime());
    while (cur.getTime() <= b.getTime()) {
      if (isWorkingDay(cur, shift, anchor)) count++;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return count;
  }, [fromDate, toDate, isHalfLeave, myShift]);

  const submit = async () => {
    setErr("");
    if (!fromDate || !toDate) return setErr("Please select From and To dates");
    if (new Date(fromDate) > new Date(toDate)) return setErr("From date must be on/before To date");
    if (!note.trim()) return setErr("Reason is required.");
    if (kind === "leave" && !leaveTypeId) return setErr("Please choose a leave type");
    // Handoff validation — required for Leave / WFH / On Duty / Half Day.
    // POC can be N/A (pocNa toggle) — when ticked it satisfies the rule
    // and the payload sends pocUserId=null.
    if (handoffApplies && !pocNa && poc.length === 0)   return setErr("POC in Absence is required (or mark as N/A).");
    if (handoffApplies && !workStatus.trim())           return setErr("Work Status is required.");
    if (kind === "wfh" && !unavailability.trim()) return setErr("Time of Unavailability is required (type 'Available all day' if not applicable).");

    setSaving(true);
    const notifyUserIds = notify.map((u) => u.id);
    // Common handoff payload — added to every payload that needs it
    // below. Lets the server attribute the POC + work status without
    // changing the per-kind URL routing.
    const handoff = handoffApplies ? {
      pocUserId:  pocNa ? null : (poc[0]?.id ?? null),
      workStatus: workStatus.trim(),
    } : {};

    let url = "";
    let payload: Record<string, unknown> = {};
    let refreshKeys: string[] = [];

    if (kind === "wfh") {
      url = "/api/hr/attendance/wfh";
      // Half-day WFH is encoded as a reason prefix so we don't need a
      // schema migration. Approval + attendance display detect the
      // marker. We tag the specific half ([First Half] / [Second Half])
      // so HR knows WHICH half the employee is working from home — the
      // bare "[Half Day]" tag stays as a fallback for older clients.
      const reason = isHalfDayShift
        ? (halfKind === "first"  ? `[First Half] ${note}`  :
           halfKind === "second" ? `[Second Half] ${note}` :
                                      `[Half Day] ${note}`)
        : note;
      payload = { date: fromDate, reason, notifyUserIds, ...handoff, unavailability: unavailability.trim() };
      refreshKeys = ["/api/hr/attendance/wfh"];
    } else if (kind === "on_duty") {
      url = "/api/hr/attendance/on-duty";
      // Half-day OD encodes the half via the purpose prefix — same
      // convention as WFH / leaves. Approval / attendance display
      // detect "[First Half]" / "[Second Half]".
      const purpose = isHalfDayShift
        ? (halfKind === "first"  ? `[First Half] ${note}`  :
           halfKind === "second" ? `[Second Half] ${note}` :
                                   `[Half Day] ${note}`)
        : note;
      payload = { date: fromDate, purpose, notifyUserIds, ...handoff };
      refreshKeys = ["/api/hr/attendance/on-duty"];
    } else if (kind === "regularize") {
      // No handoff for regularize — it's the "I missed a clock-in" flow,
      // not a request for time off, so POC + Work Status don't apply.
      url = "/api/hr/attendance/regularize";
      payload = { date: fromDate, reason: note, notifyUserIds };
      refreshKeys = ["/api/hr/attendance/regularize"];
    } else if (kind === "half_day") {
      // Half-day = one-day leave of a half-day leave type if configured, else
      // fall back to a regularization so a request still reaches approvers.
      // Tag the specific half so HR knows whether it's the morning or
      // afternoon. Approval + attendance display detect "[First Half]"
      // / "[Second Half]" markers the same way they do for leave rows.
      const halfReason =
        halfKind === "first"  ? `[First Half] ${note}` :
        halfKind === "second" ? `[Second Half] ${note}` :
                                 `[Half Day] ${note}`;
      if (leaveTypeId) {
        url = "/api/hr/leaves";
        payload = { leaveTypeId, fromDate, toDate: fromDate, reason: halfReason, notifyUserIds, ...handoff };
        refreshKeys = ["/api/hr/leaves", "/api/hr/leaves/balance"];
      } else {
        url = "/api/hr/attendance/regularize";
        payload = { date: fromDate, reason: halfReason, notifyUserIds };
        refreshKeys = ["/api/hr/attendance/regularize"];
      }
    } else if (kind === "leave") {
      url = "/api/hr/leaves";
      // Half-day leave: force a single-date range and tag the reason so the
      // home-page board badge + downstream consumers can detect which half.
      // Markers must match the regexes in /api/hr/attendance/board/route.ts.
      const reason =
        dayKind === "first_half"  ? `[First Half] ${note}`  :
        dayKind === "second_half" ? `[Second Half] ${note}` :
                                    note;
      const halfDayTo = isHalfLeave ? fromDate : toDate;
      payload = { leaveTypeId, fromDate, toDate: halfDayTo, reason, notifyUserIds, ...handoff };
      refreshKeys = ["/api/hr/leaves", "/api/hr/leaves/balance"];
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErr((data as any).error || "Failed to submit"); setSaving(false); return; }

    for (const k of refreshKeys) {
      globalMutate((key: any) => typeof key === "string" && key.startsWith(k));
    }
    globalMutate((k: any) => typeof k === "string" && k.startsWith("/api/hr/notifications"));
    // Confirmation toast so the user KNOWS it went through (the form closes
    // immediately; the toast lives at the app root and outlives it).
    const TOAST_LABEL: Record<string, string> = {
      wfh: "Work From Home", leave: "Leave", on_duty: "On-Duty",
      half_day: "Half-day", regularize: "Regularization",
    };
    showToast(`${TOAST_LABEL[kind] ?? "Request"} request submitted`, "success");
    onSaved?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md max-h-[90vh] flex flex-col rounded-2xl border bg-white dark:bg-[#0a1526] border-slate-200 dark:border-white/[0.08] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-white/[0.06]">
          <h3 className="text-[14px] font-semibold text-slate-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-800 dark:hover:text-white" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {err && <p className="text-[12px] text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{err}</p>}

          {/* WFH balance badge — shows the employee how many of their
              monthly quota is used before they submit. Only renders
              for WFH requests (other kinds don't have this quota). */}
          {kind === "wfh" && <WfhBalanceBadge />}

          {/* Date range card — FROM and TO sit on the same row so the
              two date pickers line up, with the "1 day" badge anchored
              to the top-right of the card (not crammed beside FROM). */}
          <div className="rounded-lg border border-slate-200 dark:border-white/[0.08] p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10.5px] uppercase tracking-widest font-semibold text-slate-500 dark:text-slate-400">Date range</p>
              <span className="px-2 py-0.5 rounded-md bg-[#008CFF]/10 text-[#008CFF] dark:bg-[#4a9cff]/15 dark:text-[#4a9cff] text-[11px] font-semibold tabular-nums">
                {days} day{days === 1 ? "" : "s"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10.5px] uppercase tracking-widest font-semibold text-slate-500 dark:text-slate-400 mb-1.5">From</p>
                <DatePicker
                  value={fromDate}
                  onChange={(v) => {
                    setFromDate(v);
                    if (isHalfLeave) setToDate(v);
                    else if (v && (!toDate || new Date(v) > new Date(toDate))) setToDate(v);
                  }}
                  futureYears={2}
                  minDate={minDate}
                  className="w-full"
                />
              </div>
              <div>
                <p className="text-[10.5px] uppercase tracking-widest font-semibold text-slate-500 dark:text-slate-400 mb-1.5">To</p>
                {isHalfLeave ? (
                  <p className="text-[12.5px] text-slate-500 italic h-9 flex items-center">
                    Same as From (half-day).
                  </p>
                ) : (
                  <DatePicker
                    value={toDate}
                    onChange={setToDate}
                    futureYears={2}
                    minDate={fromDate || minDate}
                    className="w-full"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Full vs Half day toggle — leave form only. Half day collapses the
              date range to a single date and saves with a [First Half] /
              [Second Half] reason marker. The First / Second sub-toggle nests
              under the Half Day column so it's visually scoped to that choice. */}
          {kind === "leave" && (
            <div className="grid grid-cols-2 gap-2 items-start">
              {/* Left column — Full Day */}
              <button
                type="button"
                onClick={() => setDayKind("full")}
                className={`h-9 rounded-lg border text-[12.5px] font-semibold transition-colors ${
                  dayKind === "full"
                    ? "border-[#008CFF] bg-[#008CFF]/10 text-[#008CFF] dark:border-[#4a9cff] dark:bg-[#4a9cff]/15 dark:text-[#4a9cff]"
                    : "border-slate-200 dark:border-white/[0.08] text-slate-600 dark:text-slate-300 hover:border-[#008CFF]/40"
                }`}
              >
                Full Day
              </button>

              {/* Right column — Half Day, with First / Second sub-toggle stacked
                  directly underneath it so the two are visually grouped. */}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    // Collapse the range to a single date when switching to half-day —
                    // the API + leave-balance math both assume one calendar day.
                    setToDate(fromDate);
                    setDayKind((d) => (d === "full" ? "first_half" : d));
                  }}
                  className={`h-9 w-full rounded-lg border text-[12.5px] font-semibold transition-colors ${
                    isHalfLeave
                      ? "border-[#008CFF] bg-[#008CFF]/10 text-[#008CFF] dark:border-[#4a9cff] dark:bg-[#4a9cff]/15 dark:text-[#4a9cff]"
                      : "border-slate-200 dark:border-white/[0.08] text-slate-600 dark:text-slate-300 hover:border-[#008CFF]/40"
                  }`}
                >
                  Half Day
                </button>

                {isHalfLeave && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setDayKind("first_half")}
                      className={`h-8 rounded-md border text-[11.5px] font-medium transition-colors ${
                        dayKind === "first_half"
                          ? "border-[#008CFF] bg-[#008CFF]/[0.06] text-[#008CFF] dark:border-[#4a9cff] dark:text-[#4a9cff]"
                          : "border-slate-200 dark:border-white/[0.08] text-slate-500 dark:text-slate-400 hover:border-[#008CFF]/40"
                      }`}
                    >
                      First Half
                    </button>
                    <button
                      type="button"
                      onClick={() => setDayKind("second_half")}
                      className={`h-8 rounded-md border text-[11.5px] font-medium transition-colors ${
                        dayKind === "second_half"
                          ? "border-[#008CFF] bg-[#008CFF]/[0.06] text-[#008CFF] dark:border-[#4a9cff] dark:text-[#4a9cff]"
                          : "border-slate-200 dark:border-white/[0.08] text-slate-500 dark:text-slate-400 hover:border-[#008CFF]/40"
                      }`}
                    >
                      Second Half
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Policy */}
          {policyText && (
            <div className="rounded-lg border border-[#008CFF]/30 bg-[#008CFF]/[0.06] px-3 py-2.5 flex items-start gap-2">
              <Info size={14} strokeWidth={2} className="text-[#008CFF] mt-0.5 shrink-0" />
              <p className="text-[11.5px] leading-snug text-[#008CFF] dark:text-[#4a9cff]">{policyText}</p>
            </div>
          )}

          {/* Leave type — only for `kind=leave` + optional for half_day. Rich picker shows per-type balance. */}
          {(kind === "leave" || (kind === "half_day" && leaveTypes && leaveTypes.length > 0)) && leaveTypes && leaveTypes.length > 0 && (
            <LeaveTypePicker
              leaveTypes={leaveTypes}
              value={leaveTypeId}
              onChange={setLeaveTypeId}
            />
          )}

          {/* Half-day toggle — applies to WFH and OD requests. Tags
              the reason / purpose so approval + attendance render it
              as a half-day. When the checkbox is on, HR also needs to
              pick which half (mirrors the leave form's first_half /
              second_half toggle). */}
          {(kind === "wfh" || kind === "on_duty") && (
            <div className="space-y-2.5">
              <label className="flex items-center gap-2 text-[12.5px] text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isHalfDayShift}
                  onChange={(e) => setIsHalfDayShift(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-[#008CFF]"
                />
                {kind === "wfh"
                  ? "This is a half-day WFH (morning / afternoon only)"
                  : "This is a half-day OD (morning / afternoon only)"}
              </label>
              {isHalfDayShift && (
                <div className="grid grid-cols-2 gap-1.5 pl-6">
                  <button
                    type="button"
                    onClick={() => setHalfKind("first")}
                    className={`h-8 rounded-md border text-[11.5px] font-medium transition-colors ${
                      halfKind === "first"
                        ? "border-[#008CFF] bg-[#008CFF]/[0.08] text-[#008CFF] dark:border-[#4a9cff] dark:text-[#4a9cff]"
                        : "border-slate-200 dark:border-white/[0.08] text-slate-500 dark:text-slate-400 hover:border-[#008CFF]/40"
                    }`}
                  >
                    First Half (morning)
                  </button>
                  <button
                    type="button"
                    onClick={() => setHalfKind("second")}
                    className={`h-8 rounded-md border text-[11.5px] font-medium transition-colors ${
                      halfKind === "second"
                        ? "border-[#008CFF] bg-[#008CFF]/[0.08] text-[#008CFF] dark:border-[#4a9cff] dark:text-[#4a9cff]"
                        : "border-slate-200 dark:border-white/[0.08] text-slate-500 dark:text-slate-400 hover:border-[#008CFF]/40"
                    }`}
                  >
                    Second Half (afternoon)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Half-day request kind — needs the same First/Second toggle as
              WFH so HR knows which half of the day the employee is taking
              off. The half_day form is inherently half — no checkbox
              gating needed. */}
          {kind === "half_day" && (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Which half? <span className="text-rose-500">*</span>
              </label>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setHalfKind("first")}
                  className={`h-9 rounded-md border text-[12px] font-medium transition-colors ${
                    halfKind === "first"
                      ? "border-[#008CFF] bg-[#008CFF]/[0.08] text-[#008CFF] dark:border-[#4a9cff] dark:text-[#4a9cff]"
                      : "border-slate-200 dark:border-white/[0.08] text-slate-500 dark:text-slate-400 hover:border-[#008CFF]/40"
                  }`}
                >
                  First Half (morning)
                </button>
                <button
                  type="button"
                  onClick={() => setHalfKind("second")}
                  className={`h-9 rounded-md border text-[12px] font-medium transition-colors ${
                    halfKind === "second"
                      ? "border-[#008CFF] bg-[#008CFF]/[0.08] text-[#008CFF] dark:border-[#4a9cff] dark:text-[#4a9cff]"
                      : "border-slate-200 dark:border-white/[0.08] text-slate-500 dark:text-slate-400 hover:border-[#008CFF]/40"
                  }`}
                >
                  Second Half (afternoon)
                </button>
              </div>
            </div>
          )}

          {/* Reason — required. Submit blocks an empty value. */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              Reason <span className="text-rose-500">*</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              required
              aria-required="true"
              placeholder="Why are you applying?"
              className="mt-1.5 w-full px-3 py-2 rounded-lg border bg-white dark:bg-[#0a1526] border-slate-200 dark:border-white/[0.08] text-[13px] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#008CFF] dark:focus:border-[#4a9cff] resize-none"
            />
          </div>

          {/* Handoff details — POC + Work Status (+ Unavailability for WFH).
              Skipped for the regularize flow, where it doesn't apply.
              POC is N/A-eligible — when ticked, the picker hides and
              submit sends pocUserId=null. */}
          {handoffApplies && (
            <HandoffSection
              poc={poc}
              onPocChange={setPoc}
              workStatus={workStatus}
              onWorkStatusChange={setWorkStatus}
              showUnavailability={kind === "wfh"}
              unavailability={unavailability}
              onUnavailabilityChange={setUnavailability}
              allowNa
              naSelected={pocNa}
              onNaChange={setPocNa}
            />
          )}

          {/* Notify */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">Notify</label>
            <div className="mt-1.5">
              <EmployeePicker selected={notify} onChange={setNotify} />
            </div>
            <p className="text-[10.5px] text-slate-400 mt-1">Selected people will receive an in-app notification when you submit.</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-white/[0.06]">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-[13px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-white">Cancel</button>
          <button
            onClick={submit}
            disabled={saving}
            className="h-9 px-5 rounded-lg text-[13px] font-semibold text-white bg-[#008CFF] hover:bg-[#0070cc] disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {saving ? "Submitting…" : (<><Check size={14} strokeWidth={2.5} /> Submit</>)}
          </button>
        </div>
      </div>
    </div>
  );
}

/** WFH monthly balance — shows "X of Y used this month" + remaining.
 *  Reads from the caller's own balance endpoint. Hides entirely if
 *  the limit is disabled (so HR doesn't have to explain a phantom
 *  badge when enforcement is off). */
function WfhBalanceBadge() {
  const { data } = useSWR<{
    credited: number; used: number; remaining: number;
    monthKey: string; brand: string | null; limitEnabled: boolean;
  }>("/api/hr/wfh/balance", fetcher, { revalidateOnFocus: false });

  if (!data || !data.limitEnabled) return null;

  const monthLabel = (() => {
    const m = data.monthKey?.match(/^(\d{4})-M(\d{2})$/);
    if (!m) return data.monthKey ?? "";
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return `${months[Number(m[2]) - 1] ?? ""} ${m[1]}`;
  })();

  const exhausted = data.remaining <= 0;
  const tone = exhausted
    ? "border-rose-200 bg-rose-50 text-rose-800"
    : data.remaining === 1
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-emerald-200 bg-emerald-50 text-emerald-800";

  return (
    <div className={`rounded-lg border ${tone} px-3.5 py-2.5 text-[12px]`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/60 text-[14px] font-bold tabular-nums">
            {data.used}
          </span>
          <div className="min-w-0">
            <p className="font-semibold leading-tight">
              {data.used} of {data.credited} WFH days used this month
            </p>
            <p className="text-[11px] opacity-80 mt-0.5">
              {monthLabel}{data.brand ? ` · ${data.brand}` : ""}
              {exhausted && " · Limit reached"}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] uppercase tracking-wider font-bold opacity-70">Remaining</p>
          <p className="text-[20px] font-bold tabular-nums leading-none">{data.remaining}</p>
        </div>
      </div>
    </div>
  );
}
