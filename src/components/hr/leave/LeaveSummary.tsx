"use client";
import { useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// Shared, Keka-style leave summary. Rendered by BOTH the self-service leave
// page (/dashboard/hr/leaves) and the read-only employee-profile leave view
// (Attendance → Leave) so the two never drift. Data is passed in by the
// parent (each page fetches its own scope: own balances vs ?userId=).
//
// readOnly=true hides the apply/right-rail actions (HR viewing an employee).

export type LeaveSummaryProps = {
  balances: any[];            // balance rows for `year`, each with leaveType included
  applications: any[];        // leave applications for the subject
  year: number;
  years: number[];
  onYearChange: (y: number) => void;
  readOnly?: boolean;
  subjectName?: string;       // employee name, used in empty-state copy
  onRequestLeave?: () => void;
  onCompOff?: () => void;
  compOffHistoryHref?: string;
  policyHref?: string;
  onCancel?: (id: number) => void;   // cancel a pending request (self page)
  // HR-admin row actions (employee-profile view): a ⋮ menu per leave with
  // "Change leave type" + "Cancel leave". Independent of readOnly so HR can
  // act while the rest of the panel stays read-only.
  manageActions?: boolean;
  leaveTypes?: { id: number; name: string }[];
  onCancelLeave?: (id: number) => void;
  onChangeType?: (id: number, leaveTypeId: number) => void;
};

const COLORS = ["#22d3ee", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#f87171", "#008CFF", "#6366f1"];
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const num = (v: any) => parseFloat(v ?? "0") || 0;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function halfOf(reason: string): "First" | "Second" | null {
  if (/^\[First Half\]/i.test(reason || "")) return "First";
  if (/^\[Second Half\]/i.test(reason || "")) return "Second";
  return null;
}
function cleanNote(reason: string): string {
  return (reason || "").replace(/^\[(First|Second) Half\]\s*/i, "");
}
function fmtDate(d: any, withYear = false) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}
function statusPill(s: string) {
  const map: Record<string, string> = {
    approved: "bg-emerald-500/10 text-emerald-600",
    partially_approved: "bg-sky-500/10 text-sky-600",
    rejected: "bg-red-500/10 text-red-500",
    cancelled: "bg-slate-400/15 text-slate-500",
    pending: "bg-amber-500/10 text-amber-600",
  };
  return map[s] ?? "bg-slate-400/15 text-slate-500";
}
function prettyStatus(s: string) {
  return (s || "").split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// Big availability ring used on each balance card.
function Ring({ available, accrued, color }: { available: number; accrued: number; color: string }) {
  const pct = accrued > 0 ? Math.min(100, (available / accrued) * 100) : 0;
  const r = 52, cx = 64, cy = 64, circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <div className="relative w-[128px] h-[128px]">
      <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eef2f6" strokeWidth="11" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset} className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
        <span className="text-[18px] font-bold text-slate-800 tabular-nums leading-none">{fmt(available)}</span>
        <span className="text-[10.5px] text-slate-500 mt-1 leading-tight">Days<br />Available</span>
      </div>
    </div>
  );
}

export default function LeaveSummary({
  balances, applications, year, years, onYearChange,
  readOnly = false, subjectName, onRequestLeave, onCompOff,
  compOffHistoryHref, policyHref, onCancel,
  manageActions = false, leaveTypes = [], onCancelLeave, onChangeType,
}: LeaveSummaryProps) {
  // Per-row HR action menu (⋮). Portalled to <body> at the button's screen
  // position so it escapes the table's overflow clipping ("outside the box").
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [menuRect, setMenuRect]     = useState<DOMRect | null>(null);
  const [typeListOpen, setTypeListOpen] = useState(false);   // "Change leave type" expanded?
  const typeMenuTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRowMenu = () => { setOpenMenuId(null); setMenuRect(null); setTypeListOpen(false); };
  // Available balance per leave type (total − used − pending) for the picker.
  const balByType = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of (Array.isArray(balances) ? balances : [])) {
      const id = b.leaveTypeId ?? b.leaveType?.id;
      if (id == null) continue;
      m.set(id, num(b.totalDays) - num(b.usedDays) - num(b.pendingDays));
    }
    return m;
  }, [balances]);
  // Close the portalled row menu on scroll / resize so it never drifts away
  // from its row (the menu is fixed-positioned from a one-time button rect).
  useEffect(() => {
    if (openMenuId == null) return;
    const close = () => closeRowMenu();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [openMenuId]);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 8;

  const apps = Array.isArray(applications) ? applications : [];
  const bals = Array.isArray(balances) ? balances : [];

  // Only ACTIVE leave types render. Deprecated / deactivated types (e.g. the
  // old "Half Day" type — now a duration option on a normal leave, not its own
  // type) can still carry a stale zero-balance row in the DB; keep them out.
  const cardBalances = bals.filter((b) => b.leaveType && b.leaveType.isActive !== false && b.leaveType.applicable !== false);
  const otherTypes = bals
    .filter((b) => b.leaveType && b.leaveType.isActive !== false && b.leaveType.applicable === false)
    .map((b) => b.leaveType.name);

  const pending = apps.filter((a) => a.status === "pending");

  // ── My Leave Stats (this `year`) ──
  const usedApps = apps.filter((a) => ["approved", "partially_approved"].includes(a.status) && new Date(a.fromDate).getFullYear() === year);
  const dow = [0, 0, 0, 0, 0, 0, 0];
  for (const a of usedApps) {
    const cur = new Date(a.fromDate), end = new Date(a.toDate);
    while (cur.getTime() <= end.getTime()) { dow[cur.getUTCDay()] += 1; cur.setUTCDate(cur.getUTCDate() + 1); }
  }
  const dowVals = [1, 2, 3, 4, 5, 6, 0].map((i) => dow[i]);
  const dowMax = Math.max(1, ...dowVals);
  const monthVals = new Array(12).fill(0);
  for (const a of usedApps) monthVals[new Date(a.fromDate).getMonth()] += num(a.totalDays);
  const monthMax = Math.max(1, ...monthVals);
  const consumed = cardBalances
    .map((b, i) => ({ name: b.leaveType.name, used: num(b.usedDays), color: COLORS[i % COLORS.length] }))
    .filter((c) => c.used > 0);
  const consumedTotal = consumed.reduce((s, c) => s + c.used, 0);
  const hasStats = usedApps.length > 0;

  // ── Leave history (filtered + paginated) ──
  const typeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bals) if (b.leaveType) m.set(String(b.leaveType.id), b.leaveType.name);
    for (const a of apps) if (a.leaveType) m.set(String(a.leaveTypeId ?? a.leaveType.id), a.leaveType.name);
    return Array.from(m.entries());
  }, [balances, applications]);

  const filtered = apps.filter((a) => {
    if (new Date(a.fromDate).getFullYear() !== year) return false;
    if (typeFilter !== "all" && String(a.leaveTypeId ?? a.leaveType?.id) !== typeFilter) return false;
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const hay = `${a.leaveType?.name ?? ""} ${a.reason ?? ""} ${a.user?.name ?? ""} ${fmtDate(a.fromDate, true)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const viewDetails = (typeId: number) => {
    setTypeFilter(String(typeId));
    setStatusFilter("all");
    setPage(0);
    if (typeof document !== "undefined") {
      document.getElementById("leave-history")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="space-y-7">
      {/* ── Pending header + year selector ── */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[16px] font-semibold text-slate-800">Pending leave requests</h3>
        <select
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
          className="h-9 rounded-lg border border-[#008CFF]/40 bg-white px-3 text-[12.5px] font-semibold text-[#008CFF] focus:outline-none focus:ring-2 focus:ring-[#008CFF]/15"
        >
          {years.map((y) => (
            <option key={y} value={y}>Jan {y} - Dec {y}</option>
          ))}
        </select>
      </div>

      {/* ── Pending + right rail ── */}
      <div className={`grid gap-4 ${readOnly ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-[1fr_300px]"}`}>
        <div className="space-y-3">
          {pending.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-7 flex items-center gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#008CFF]/10 text-[#008CFF] text-xl">🎉</div>
              <div>
                <p className="text-[14px] font-semibold text-slate-800">Hurray! No pending leave requests</p>
                <p className="text-[12px] text-slate-500 mt-0.5">
                  {readOnly ? `${subjectName ?? "This employee"} has no requests awaiting approval.` : "Request leave on the right!"}
                </p>
              </div>
            </div>
          ) : (
            pending.map((a) => {
              const half = halfOf(a.reason);
              return (
                <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center gap-x-8 gap-y-2">
                  <div className="min-w-[150px]">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Leave Dates</span>
                    <span className="text-[13px] text-slate-800">
                      {fmtDate(a.fromDate, true)}{half ? ` (${half} half)` : a.toDate && new Date(a.toDate).toDateString() !== new Date(a.fromDate).toDateString() ? ` – ${fmtDate(a.toDate, true)}` : ""} · {fmt(num(a.totalDays))} day{num(a.totalDays) === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="min-w-[120px]">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Leave Type</span>
                    <span className="text-[13px] text-slate-800">{a.leaveType?.name}</span>
                  </div>
                  <div className="flex-1 min-w-[120px]">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Status</span>
                    <span className="text-[13px] text-amber-600">Pending</span>
                  </div>
                  {!readOnly && onCancel && (
                    <button onClick={() => onCancel(a.id)} className="h-7 px-3 rounded text-[11px] font-medium text-red-500 hover:bg-red-50">Cancel</button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {!readOnly && (
          <aside className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 h-fit">
            <button onClick={onRequestLeave}
              className="w-full h-10 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13.5px] font-semibold inline-flex items-center justify-center gap-2">
              Request Leave
            </button>
            <button onClick={onCompOff} className="w-full text-left text-[12.5px] font-medium text-[#008CFF] hover:underline">
              Request Credit for Compensatory Off
            </button>
            {compOffHistoryHref && (
              <a href={compOffHistoryHref} className="block text-[12.5px] font-medium text-[#008CFF] hover:underline">Comp-Off History</a>
            )}
            {policyHref && (
              <a href={policyHref} className="block text-[12.5px] font-medium text-[#008CFF] hover:underline">Leave Policy Explanation</a>
            )}
          </aside>
        )}
      </div>

      {/* ── My Leave Stats ── */}
      <div>
        <h3 className="text-[15px] font-bold text-slate-800 mb-3">{readOnly ? "Leave Stats" : "My Leave Stats"}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Weekly */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h4 className="text-[12.5px] font-bold text-slate-800 mb-1">Weekly Pattern</h4>
            <p className="text-[10.5px] text-slate-500 mb-4">Weekdays taken off in {year}.</p>
            {hasStats ? (
              <div className="flex items-end gap-2 h-20">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => {
                  const v = dowVals[i]; const h = Math.round((v / dowMax) * 60) + (v > 0 ? 6 : 0);
                  return (
                    <div key={d} className="flex-1 flex flex-col items-center gap-1.5">
                      <span className="text-[10px] text-slate-600 tabular-nums">{v || ""}</span>
                      <div className={`w-full rounded-sm ${v > 0 ? "bg-[#a78bfa]" : "bg-slate-100"}`} style={{ height: `${Math.max(h, 4)}px` }} />
                      <span className="text-[10px] text-slate-500">{d}</span>
                    </div>
                  );
                })}
              </div>
            ) : <p className="h-20 flex items-center justify-center text-[12px] text-slate-400">No leaves taken in {year}.</p>}
          </div>
          {/* Consumed donut */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h4 className="text-[12.5px] font-bold text-slate-800 mb-1">Consumed Leave Types</h4>
            <p className="text-[10.5px] text-slate-500 mb-3">Where used days have gone.</p>
            {consumed.length > 0 ? (
              <div className="flex items-center gap-4">
                <div className="relative w-[90px] h-[90px] shrink-0">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx="50" cy="50" r="40" fill="none" className="stroke-slate-100" strokeWidth="12" />
                    {(() => { let prev = 0; const c = 2 * Math.PI * 40; return consumed.map((cc, i) => {
                      const pct = (cc.used / consumedTotal) * 100;
                      const seg = <circle key={i} cx="50" cy="50" r="40" fill="none" stroke={cc.color} strokeWidth="12" strokeDasharray={`${(pct / 100) * c} ${c}`} strokeDashoffset={-(prev / 100) * c} />;
                      prev += pct; return seg;
                    }); })()}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[15px] font-bold text-slate-800 tabular-nums leading-none">{fmt(consumedTotal)}</span>
                    <span className="text-[9px] text-slate-500 mt-0.5 uppercase tracking-wider">days</span>
                  </div>
                </div>
                <ul className="flex-1 min-w-0 space-y-1.5">
                  {consumed.slice(0, 4).map((c) => (
                    <li key={c.name} className="flex items-center gap-2 text-[11px]">
                      <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: c.color }} />
                      <span className="text-slate-700 truncate">{c.name}</span>
                      <span className="ml-auto text-slate-500 tabular-nums">{fmt(c.used)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : <p className="h-20 flex items-center justify-center text-[12px] text-slate-400">No consumed leaves.</p>}
          </div>
          {/* Monthly */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h4 className="text-[12.5px] font-bold text-slate-800 mb-1">Monthly Stats</h4>
            <p className="text-[10.5px] text-slate-500 mb-4">Leave days taken each month.</p>
            {hasStats ? (
              <div className="flex items-end gap-1 h-20">
                {MONTHS.map((m, i) => {
                  const v = monthVals[i]; const h = Math.round((v / monthMax) * 58) + (v > 0 ? 6 : 0);
                  return (
                    <div key={m} className="flex-1 flex flex-col items-center gap-1.5">
                      <div className={`w-full rounded-sm ${v > 0 ? "bg-[#a78bfa]" : "bg-slate-100"}`} style={{ height: `${Math.max(h, 4)}px` }} title={`${m}: ${fmt(v)}`} />
                      <span className="text-[9px] text-slate-500">{m}</span>
                    </div>
                  );
                })}
              </div>
            ) : <p className="h-20 flex items-center justify-center text-[12px] text-slate-400">No leaves taken in {year}.</p>}
          </div>
        </div>
      </div>

      {/* ── Leave Balances ── */}
      <div>
        <h3 className="text-[15px] font-bold text-slate-800 mb-3">Leave Balances</h3>
        {cardBalances.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center">
            <p className="text-[13px] text-slate-500">No leave balances yet{subjectName ? ` for ${subjectName}` : ""}.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {cardBalances.map((lb, i) => {
              const total = num(lb.totalDays), used = num(lb.usedDays), pend = num(lb.pendingDays);
              const avail = Math.max(0, total - used - pend);
              const quota = num(lb.leaveType?.daysPerYear);
              const empty = total === 0 && used === 0 && pend === 0 && quota === 0;
              const color = COLORS[i % COLORS.length];
              return (
                <div key={lb.id} className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-bold text-slate-800 truncate" title={lb.leaveType.name}>{lb.leaveType.name}</p>
                    <button onClick={() => viewDetails(lb.leaveType.id)} className="text-[11px] font-medium text-[#008CFF] hover:underline shrink-0">View details</button>
                  </div>
                  {empty ? (
                    <div className="flex-1 flex items-center justify-center min-h-[150px]">
                      <p className="text-[12px] text-slate-400">No data to display.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-center py-4">
                        <Ring available={avail} accrued={total > 0 ? total : quota} color={color} />
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-[11.5px]">
                        <Stat label="Available" value={fmt(avail)} />
                        <Stat label="Consumed" value={fmt(used)} />
                        <Stat label="Annual Quota" value={fmt(quota)} />
                        <Stat label="Accrued So Far" value={fmt(total)} />
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {otherTypes.length > 0 && (
          <p className="mt-3 text-[12px] text-slate-500">
            <span className="font-semibold text-slate-600">Other Leave Types Available:</span> {otherTypes.join(", ")}
          </p>
        )}
      </div>

      {/* ── Leave History ── */}
      <div id="leave-history">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-bold text-slate-800">Leave History</h3>
          <span className="text-[11.5px] text-slate-400">Total: {filtered.length}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] text-slate-700 focus:outline-none">
            <option value="all">Leave Type</option>
            {typeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] text-slate-700 focus:outline-none">
            {["all", "pending", "partially_approved", "approved", "rejected", "cancelled"].map((s) => (
              <option key={s} value={s}>{s === "all" ? "Status" : prettyStatus(s)}</option>
            ))}
          </select>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search…"
            className="h-9 min-w-[180px] flex-1 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] text-slate-700 focus:outline-none" />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-200">
              {["Leave Dates", "Leave Type", "Status", "Requested By", "Action Taken On", "Leave Note", "Reject/Cancellation Reason", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-slate-500 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-[13px] text-slate-400">No leave history for {year}.</td></tr>
              ) : pageRows.map((a) => {
                const half = halfOf(a.reason);
                const approverName = a.finalApprover?.name ?? a.approver?.name ?? null;
                const decidedOn = a.finalApprovedAt ?? a.approvedAt ?? (a.status !== "pending" ? a.updatedAt : null);
                const rejectReason = (a.status === "rejected" || a.status === "cancelled") ? (a.finalApprovalNote || a.approvalNote || "—") : "—";
                return (
                  <tr key={a.id} className="border-b border-slate-100 align-top">
                    <td className="px-4 py-3">
                      <div className="text-[13px] text-slate-800">{fmtDate(a.fromDate, true)}{half ? ` (${half} half)` : (a.toDate && new Date(a.toDate).toDateString() !== new Date(a.fromDate).toDateString() ? ` – ${fmtDate(a.toDate, true)}` : "")}</div>
                      <div className="text-[11px] text-slate-400">{fmt(num(a.totalDays))} Day{num(a.totalDays) === 1 ? "" : "s"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[13px] text-slate-800">{a.leaveType?.name}</div>
                      <div className="text-[11px] text-slate-400">Requested on {fmtDate(a.appliedAt, true)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${statusPill(a.status)}`}>{prettyStatus(a.status)}</span>
                      {approverName && <div className="text-[11px] text-slate-400 mt-1">by {approverName}</div>}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-slate-700 whitespace-nowrap">{a.user?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap">{decidedOn ? fmtDate(decidedOn, true) : "—"}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-500 max-w-[220px]"><span className="line-clamp-2">{cleanNote(a.reason) || "—"}</span></td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-500 max-w-[180px]"><span className="line-clamp-2">{rejectReason}</span></td>
                    <td className="px-4 py-3">
                      {manageActions ? (() => {
                        const cancellable = ["pending", "partially_approved", "approved"].includes(a.status);
                        const open = openMenuId === a.id;
                        return (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                if (open) { closeRowMenu(); return; }
                                setMenuRect(e.currentTarget.getBoundingClientRect());
                                setTypeListOpen(false);   // start collapsed
                                setOpenMenuId(a.id);
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                              aria-label="Leave actions"
                            >⋮</button>
                            {open && menuRect && typeof document !== "undefined" && createPortal(
                              <>
                                <div className="fixed inset-0 z-[90]" onClick={closeRowMenu} />
                                <div
                                  className="fixed z-[100] w-60 rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
                                  style={(() => {
                                    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
                                    const left = Math.max(8, menuRect.right - 240);
                                    // Open upward when the button sits in the lower part of the
                                    // viewport so the menu never spills below the fold.
                                    return menuRect.bottom > vh * 0.6
                                      ? { bottom: vh - menuRect.top + 4, left }
                                      : { top: menuRect.bottom + 4, left };
                                  })()}
                                >
                                  <div
                                    className="relative"
                                    onMouseEnter={() => { if (typeMenuTimer.current) clearTimeout(typeMenuTimer.current); setTypeListOpen(true); }}
                                    onMouseLeave={() => { typeMenuTimer.current = setTimeout(() => setTypeListOpen(false), 180); }}
                                  >
                                  <button
                                    type="button"
                                    onClick={() => setTypeListOpen((v) => !v)}
                                    className="flex w-full items-center justify-between px-3 py-2 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50"
                                  >
                                    Change leave type
                                    <span className="text-slate-400">›</span>
                                  </button>
                                  {typeListOpen && (
                                  <div className="absolute left-full top-0 ml-1 w-56 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
                                    {leaveTypes.length === 0 ? (
                                      <p className="px-3 py-2 text-[11.5px] text-slate-400">No leave types.</p>
                                    ) : leaveTypes.map((t) => {
                                      const isCurrent = t.id === a.leaveTypeId;
                                      const avail = balByType.get(t.id);
                                      return (
                                        <button
                                          key={t.id}
                                          type="button"
                                          disabled={isCurrent}
                                          onClick={() => { onChangeType?.(a.id, t.id); closeRowMenu(); }}
                                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-[12.5px] hover:bg-sky-50 disabled:cursor-default disabled:bg-transparent"
                                        >
                                          <span className={isCurrent ? "text-slate-400" : "text-slate-700"}>{t.name}</span>
                                          <span className={`shrink-0 text-[11px] ${isCurrent ? "text-slate-400" : (avail ?? 0) > 0 ? "text-emerald-600" : "text-slate-400"}`}>
                                            {isCurrent ? "current" : avail != null ? `${fmt(avail)} left` : "—"}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                  )}
                                  </div>
                                  {cancellable && (
                                    <>
                                      <div className="my-1 border-t border-slate-100" />
                                      <button
                                        type="button"
                                        onClick={() => { onCancelLeave?.(a.id); closeRowMenu(); }}
                                        className="flex w-full items-center px-3 py-2 text-[12.5px] font-medium text-red-600 hover:bg-red-50"
                                      >Cancel leave</button>
                                    </>
                                  )}
                                </div>
                              </>,
                              document.body,
                            )}
                          </>
                        );
                      })() : !readOnly && a.status === "pending" && onCancel ? (
                        <button onClick={() => onCancel(a.id)} className="text-[11px] font-medium text-red-500 hover:underline">Cancel</button>
                      ) : <span className="text-slate-300">⋯</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-end gap-3 mt-3 text-[12px] text-slate-500">
            <span>{safePage * PAGE_SIZE + 1} to {Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
            <button disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="h-7 w-7 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">‹</button>
            <span>Page {safePage + 1} of {pageCount}</span>
            <button disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className="h-7 w-7 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">›</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-[13px] font-bold text-slate-700 tabular-nums mt-0.5">{value}</p>
    </div>
  );
}
