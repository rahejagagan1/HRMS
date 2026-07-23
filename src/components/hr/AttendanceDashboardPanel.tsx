"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { fetcher } from "@/lib/swr";
import { Users, CalendarOff, CheckCircle2, Home, Search, CircleUser, Clock, ChevronLeft, ChevronRight, ChevronDown, MapPin, Monitor } from "lucide-react";
import FilterDropdown, { FilterOption } from "@/components/hr/FilterDropdown";
import { useUrlTab } from "@/lib/hooks/useUrlTab";

type Row = {
  id: number; name: string; email: string; role: string; orgLevel: string;
  profilePictureUrl: string | null;
  teamCapsule: string | null;
  employeeId: string | null; designation: string | null; department: string | null;
  businessUnit: string | null;
  // Two related-but-distinct policy fields. workLocation is the
  // org's classification (office / remote / hybrid); attendanceCaptureScheme
  // is the operational mode their punches are tracked under
  // (On-Site / Remote / Hybrid). Often only the scheme has been
  // updated for remote workers, so the off-site banner consults both.
  workLocation: string | null;
  attendanceCaptureScheme: string | null;
  clockIn: string | null; clockOut: string | null; totalMinutes: number;
  rawStatus: string; locationAddress: string | null; locationMode: string | null;
  locationLat: number | null; locationLng: number | null;
  // Office-geofence result computed at clock-in. Null for legacy
  // punches that pre-date the feature or when OFFICE_LAT/LNG weren't
  // configured. The UI surfaces an "At Office" badge when
  // atOffice=true and a "Off-site" warning when atOffice=false.
  atOffice:            boolean | null;
  distanceFromOfficeM: number | null;
  status: "office" | "remote" | "hybrid" | "wfh" | "on_leave" | "absent";
  wfhToday: boolean;
  wfhKind?: "full" | "first_half" | "second_half" | null;
};

type Counts = {
  total: number; present: number; office: number; remote: number;
  hybrid: number;
  // wfh        = wfhToday intent count (for the WFH tab badge)
  // wfhWorking = status-based count (WFH applicants who clocked in) —
  //              used by the donut so segments don't overlap with absent
  wfh: number; wfhWorking: number;
  onLeave: number; notClockedIn: number; late: number;
};

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }) : "—";

const fmtMins = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;

function StatCard({ label, value, tint, Icon }: { label: string; value: number; tint: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }) {
  return (
    <div className="flex-1 bg-white border border-slate-200 rounded-xl p-4 min-w-[150px]">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${tint}18`, color: tint }}>
          <Icon size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-slate-500 leading-none">{label}</p>
          <p className="text-[22px] font-extrabold text-slate-800 mt-1 leading-none tabular-nums">{value}</p>
        </div>
      </div>
    </div>
  );
}

// SVG donut chart: segments sized by status count.
function StatusDonut({ c }: { c: Counts }) {
  const segs = [
    { label: "In Office",      n: c.office,       color: "#10b981" },
    { label: "Remote",         n: c.remote,       color: "#008CFF" },
    { label: "Hybrid",         n: c.hybrid,       color: "#14b8a6" },
    { label: "WFH",            n: c.wfhWorking,   color: "#f59e0b" },
    { label: "On Leave",       n: c.onLeave,      color: "#8b5cf6" },
    { label: "Not Clocked In", n: c.notClockedIn, color: "#cbd5e1" },
  ];
  const total = segs.reduce((s, x) => s + x.n, 0);
  const size = 120, stroke = 20, r = (size - stroke) / 2, C = 2 * Math.PI * r;

  let acc = 0;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-[12px] font-semibold text-slate-700 mb-3">Distribution</p>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
            {total > 0 && segs.map((s) => {
              if (s.n === 0) return null;
              const frac = s.n / total;
              const dash = frac * C;
              const el = (
                <circle
                  key={s.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={-acc}
                />
              );
              acc += dash;
              return el;
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[17px] font-extrabold text-slate-800 leading-none tabular-nums">{total}</span>
            <span className="text-[9px] text-slate-500 mt-0.5">employees</span>
          </div>
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          {segs.map((s) => {
            const pct = total > 0 ? Math.round((s.n / total) * 100) : 0;
            return (
              <div key={s.label} className="flex items-center gap-2 text-[11px]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="text-slate-600 flex-1 truncate">{s.label}</span>
                <span className="font-semibold tabular-nums text-slate-800">{s.n}</span>
                <span className="text-slate-400 tabular-nums w-8 text-right">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type MonthSummaryRow = {
  id: number; name: string; email: string; role: string; orgLevel: string;
  profilePictureUrl: string | null; teamCapsule: string | null;
  employeeId: string | null; designation: string | null; department: string | null;
  presentDays: number; onLeaveDays: number; lateDays: number; halfDayDays: number; absentDays: number; avgHours: number;
};

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_NAMES_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Click-to-open popover with a year stepper + 12-month grid. Portalled to body
// so the surrounding card's overflow can never clip it.
function MonthYearPicker({
  year, month, onChange, compact,
}: {
  year: number; month: number;
  onChange: (y: number, m: number) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draftYear, setDraftYear] = useState(year);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null);

  const today = new Date();
  const curY = today.getFullYear();
  const curM = today.getMonth() + 1;

  const POP_W = 260;
  const POP_H = 260; // approx; only used for vertical flip
  const MARGIN = 8;

  useEffect(() => { if (open) setDraftYear(year); }, [open, year]);

  const place = () => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const vw = typeof window !== "undefined" ? window.innerWidth  : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    // Horizontal clamp: prefer trigger.left; if that would overflow right, align to trigger.right; never below margin.
    let left = r.left;
    if (left + POP_W + MARGIN > vw) left = Math.max(MARGIN, r.right - POP_W);
    if (left < MARGIN) left = MARGIN;
    // Vertical flip: open upward if dropping down would overflow.
    let top = r.bottom + 4;
    if (top + POP_H + MARGIN > vh) top = Math.max(MARGIN, r.top - POP_H - 4);
    setRect({ left, top });
  };

  const openPicker = () => { place(); setOpen(true); };

  // Keep position correct on resize / scroll while the picker is open.
  useEffect(() => {
    if (!open) return;
    const handler = () => place();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (triggerRef.current && triggerRef.current.contains(e.target as Node)) return;
      const pop = document.getElementById("month-year-picker-pop");
      if (!pop || !pop.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        className={`h-8 px-3 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-semibold tabular-nums ${compact ? "text-[12px]" : "text-[13px]"} min-w-[140px] justify-center`}
      >
        {MONTH_NAMES[month - 1]} {year}
        <ChevronDown size={13} className="text-slate-400" />
      </button>

      {open && rect && typeof document !== "undefined" && createPortal(
        <div
          id="month-year-picker-pop"
          style={{ position: "fixed", left: rect.left, top: rect.top, zIndex: 10000 }}
          className="w-[260px] bg-white border border-slate-200 rounded-xl shadow-xl p-3"
        >
          <div className="flex items-center justify-between mb-3">
            <button type="button"
              onClick={() => setDraftYear((y) => y - 1)}
              className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-600">
              <ChevronLeft size={14} />
            </button>
            <span className="text-[13px] font-bold text-slate-800 tabular-nums">{draftYear}</span>
            <button type="button"
              onClick={() => setDraftYear((y) => y + 1)}
              disabled={draftYear >= curY}
              className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {MONTH_NAMES_SHORT.map((name, i) => {
              const m = i + 1;
              const isSel    = draftYear === year && m === month;
              const isCurrMo = draftYear === curY && m === curM;
              const isFuture = draftYear > curY || (draftYear === curY && m > curM);
              return (
                <button
                  key={name}
                  type="button"
                  disabled={isFuture}
                  onClick={() => { onChange(draftYear, m); setOpen(false); }}
                  className={`h-9 rounded-lg text-[12px] font-semibold transition-colors
                    ${isSel ? "bg-[#008CFF] text-white" :
                      isCurrMo ? "border border-[#008CFF] text-[#008CFF] bg-[#008CFF]/5 hover:bg-[#008CFF]/10" :
                      "text-slate-700 hover:bg-slate-100"}
                    disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex justify-between">
            <button type="button"
              onClick={() => { onChange(curY, curM); setOpen(false); }}
              className="text-[11.5px] font-semibold text-[#008CFF] hover:underline">
              Jump to this month
            </button>
            <button type="button"
              onClick={() => setOpen(false)}
              className="text-[11.5px] text-slate-500 hover:text-slate-800">
              Close
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function MonthNav({ year, month, onChange, compact = false }: {
  year: number; month: number;
  onChange: (y: number, m: number) => void;
  compact?: boolean;
}) {
  const prev = () => { if (month === 1) onChange(year - 1, 12); else onChange(year, month - 1); };
  const next = () => { if (month === 12) onChange(year + 1, 1); else onChange(year, month + 1); };
  const today = new Date();
  const isCurrent = year === today.getFullYear() && month === today.getMonth() + 1;
  const isFuture = year > today.getFullYear() || (year === today.getFullYear() && month > today.getMonth() + 1);
  return (
    <div className="inline-flex items-center gap-1">
      <button type="button" onClick={prev}
        className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600">
        <ChevronLeft size={14} />
      </button>
      <MonthYearPicker year={year} month={month} onChange={onChange} compact={compact} />
      <button type="button" onClick={next} disabled={isFuture}
        className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed">
        <ChevronRight size={14} />
      </button>
      {!isCurrent && (
        <button type="button"
          onClick={() => onChange(today.getFullYear(), today.getMonth() + 1)}
          className="ml-1 h-8 px-3 rounded-lg border border-[#008CFF] text-[#008CFF] bg-[#008CFF]/5 hover:bg-[#008CFF]/10 text-[11.5px] font-semibold">
          This month
        </button>
      )}
    </div>
  );
}

type MonthSummary = {
  month: string;
  workingDays: number;
  workingDaysElapsed: number;
  weekendDays: number;
  holidayDays: number;
  daysInMonth: number;
  employeeCount: number;
  rows: MonthSummaryRow[];
};

function MonthlyReport({ year, month, onChange }: {
  year: number; month: number;
  onChange: (y: number, m: number) => void;
}) {
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const { data, isLoading } = useSWR<MonthSummary>(
    `/api/hr/admin/attendance-month-summary?month=${monthKey}`,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true }
  );
  const rows = data?.rows ?? [];
  const workingDays        = data?.workingDays        ?? 0;
  const workingDaysElapsed = data?.workingDaysElapsed ?? 0;
  const weekendDays        = data?.weekendDays        ?? 0;
  const holidayDays        = data?.holidayDays        ?? 0;
  const daysInMonth        = data?.daysInMonth        ?? 0;
  const employeeCount      = data?.employeeCount      ?? 0;

  // Aggregates across all employees for the month
  const totals = rows.reduce(
    (acc, r) => {
      acc.present += r.presentDays;
      acc.onLeave += r.onLeaveDays;
      acc.late    += r.lateDays;
      acc.halfDay += r.halfDayDays;
      acc.absent  += r.absentDays;
      return acc;
    },
    { present: 0, onLeave: 0, late: 0, halfDay: 0, absent: 0 }
  );

  // Live attendance % — computed against working days ELAPSED so it reflects
  // actual performance to date instead of being diluted by future days.
  const empWorkingDaysElapsed = workingDaysElapsed * employeeCount;
  const attendancePct = empWorkingDaysElapsed > 0
    ? Math.round((totals.present / empWorkingDaysElapsed) * 100)
    : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <p className="text-[12px] font-semibold text-slate-700">Monthly Report</p>
        <MonthNav year={year} month={month} onChange={onChange} compact />
      </div>
      {isLoading ? (
        <div className="py-8 text-center"><div className="inline-block w-6 h-6 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          {/* Calendar breakdown for the month */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 mb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-[9.5px] uppercase tracking-[0.1em] text-slate-500 font-semibold">Working Days</p>
                <p className="text-[20px] font-extrabold text-[#008CFF] tabular-nums leading-none mt-1">
                  {workingDays}
                  <span className="text-[11px] text-slate-400 font-medium ml-1">/ {daysInMonth} days</span>
                </p>
              </div>
              <div className="text-right text-[11px] text-slate-600 space-y-0.5">
                <p><span className="font-semibold tabular-nums text-slate-800">{weekendDays}</span> weekend days</p>
                <p><span className="font-semibold tabular-nums text-slate-800">{holidayDays}</span> holidays</p>
                <p><span className="font-semibold tabular-nums text-slate-800">{employeeCount}</span> employees</p>
              </div>
            </div>
          </div>

          {/* Clock-in counts across the whole month */}
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Present"  value={totals.present} tint="#10b981" />
            <Stat label="On Leave" value={totals.onLeave} tint="#8b5cf6" />
            <Stat label="Absent"   value={totals.absent}  tint="#ef4444" />
            <Stat label="Late"     value={totals.late}    tint="#f59e0b" />
            <Stat label="Half Day" value={totals.halfDay} tint="#64748b" />
            <Stat label="Attendance" value={attendancePct} tint="#008CFF" suffix="%" />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tint, suffix }: { label: string; value: number; tint: string; suffix?: string }) {
  return (
    <div className="rounded-lg border border-slate-100 p-2.5" style={{ background: `${tint}0d` }}>
      <p className="text-[9.5px] uppercase tracking-[0.1em] text-slate-500 font-semibold">{label}</p>
      <p className="text-[16px] font-extrabold tabular-nums mt-1" style={{ color: tint }}>
        {value}{suffix ?? ""}
      </p>
    </div>
  );
}

// Google's CDN (`lh3.googleusercontent.com`) blocks <img> loads that
// send a Referer header — without `referrerPolicy="no-referrer"` the
// browser shows a broken-image icon (a green silhouette in some
// themes) instead of the photo. The onError swap covers expired /
// deleted URLs by flipping the img out for the initials chip at
// runtime so the user still sees something meaningful.
function Avatar({ name, url, size = 32 }: { name: string; url?: string | null; size?: number }) {
  const initials = name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      <img
        src={url}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className="rounded-full object-cover shrink-0"
      />
    );
  }
  return (
    <div style={{ width: size, height: size }} className="rounded-full bg-[#008CFF] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
      {initials}
    </div>
  );
}

function StatusPill({ s, rawStatus }: { s: Row["status"]; rawStatus: string }) {
  const map: Record<Row["status"], { bg: string; text: string; label: string; dot: string }> = {
    office:   { bg: "bg-emerald-50",  text: "text-emerald-700",  label: "In Office",    dot: "#10b981" },
    remote:   { bg: "bg-[#008CFF]/10", text: "text-[#008CFF]",   label: "Remote",       dot: "#008CFF" },
    hybrid:   { bg: "bg-teal-50",     text: "text-teal-700",     label: "Hybrid",       dot: "#14b8a6" },
    wfh:      { bg: "bg-amber-50",    text: "text-amber-700",    label: "WFH",          dot: "#f59e0b" },
    on_leave: { bg: "bg-violet-50",   text: "text-violet-700",   label: "On Leave",     dot: "#8b5cf6" },
    absent:   { bg: "bg-slate-100",   text: "text-slate-600",    label: "Not Clocked In", dot: "#94a3b8" },
  };
  const m = map[s];
  const late = rawStatus === "late";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.bg} ${m.text}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />
      {m.label}{late && <span className="text-[10px] text-amber-600 font-bold ml-1">· LATE</span>}
    </span>
  );
}

export default function AttendanceDashboardPanel({
  initialBrand,
}: {
  /** Locks the panel to a specific brand on mount (NB Media / YT Labs)
   *  — comes from the `?brand=` URL param on /dashboard/hr/admin. When
   *  null, the panel auto-detects from the viewer's businessUnit (or
   *  "all" for super-admins) as before. */
  initialBrand?: "NB Media" | "YT Labs" | "all" | null;
} = {}) {
  const { data: session } = useSession();
  const me = session?.user as any;
  const canView =
    me?.isDeveloper === true ||
    me?.role === "admin" ||
    me?.orgLevel === "ceo" ||
    me?.orgLevel === "hr_manager";

  const { data, isLoading, error } = useSWR<{ rows: Row[]; counts: Counts; date: string }>(
    canView ? "/api/hr/admin/attendance-dashboard" : null,
    fetcher,
    { refreshInterval: 60_000 }
  );

  const [tab, setTab] = useUrlTab<"all" | "office" | "remote" | "hybrid" | "wfh" | "on_leave" | "absent">(
    "presence", "all",
    ["all", "office", "remote", "hybrid", "wfh", "on_leave", "absent"] as const,
  );
  const [search, setSearch] = useState("");
  const [fDept, setFDept] = useState<Set<string>>(new Set());

  // ── Company scope tabs ──────────────────────────────────────────────
  // Same pattern as ApprovalsPanel / RegularizationBalancePanel: auto-
  // default to the viewer's brand (founder lands on "all"). Every
  // downstream calculation (counts donut, stat cards, status sub-tabs,
  // table rows) scopes to the selected brand.
  type CompanyTab = "NB Media" | "YT Labs" | "all";
  const [companyTab, setCompanyTab] = useState<CompanyTab>(initialBrand ?? "all");
  // When the URL prop is set, treat it like a manual selection so the
  // auto-detect block below doesn't overwrite it once /api/hr/profile
  // resolves. The user can still re-pick via the Brand Scope pills —
  // that path calls setCompanyTabTouched(true) explicitly.
  const [companyTabTouched, setCompanyTabTouched] = useState<boolean>(initialBrand != null);
  const { data: viewerProfile } = useSWR<any>(
    me ? "/api/hr/profile" : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  // Sync to a changing URL param without remounting (sidebar flyout
  // navigates between brand variants of the same route).
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

  // Shared month state (drives both the Monthly Report card and the month-mode table)
  const now = new Date();
  const [selYear,  setSelYear]  = useState(now.getFullYear());
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1);
  const monthKey = `${selYear}-${String(selMonth).padStart(2, "0")}`;
  const [tableView, setTableView] = useUrlTab<"today" | "month">("table", "today", ["today", "month"] as const);

  const { data: monthData, isLoading: monthLoading } = useSWR<{ month: string; rows: MonthSummaryRow[] }>(
    tableView === "month" ? `/api/hr/admin/attendance-month-summary?month=${monthKey}` : null,
    fetcher,
    { keepPreviousData: true }
  );
  const monthRows = monthData?.rows ?? [];

  const rawRows: Row[] = data?.rows ?? [];
  const apiCounts: Counts = data?.counts ?? { total: 0, present: 0, office: 0, remote: 0, hybrid: 0, wfh: 0, wfhWorking: 0, onLeave: 0, notClockedIn: 0, late: 0 };

  // Scope every downstream calculation to the selected brand. Empty
  // businessUnit → bucketed as "NB Media" (parent-brand default).
  const rows: Row[] = useMemo(() => {
    if (companyTab === "all") return rawRows;
    return rawRows.filter((r) => (r.businessUnit || "NB Media") === companyTab);
  }, [rawRows, companyTab]);

  // Per-brand counts on the tab chips (computed from rawRows so the
  // chips reflect totals regardless of which tab is currently active).
  const brandCounts = useMemo(() => {
    let nb = 0, yt = 0;
    rawRows.forEach((r) => {
      const bu = r.businessUnit || "NB Media";
      if (bu === "YT Labs") yt++;
      else nb++;
    });
    return { nb, yt, all: rawRows.length };
  }, [rawRows]);

  // Recompute the stat-card / donut counts when scoped to a single
  // brand — otherwise "Total Employees" + "On Leave" + "Not Clocked In"
  // would still reflect the merged total while the table below shows
  // only one brand. When tab is "all" we keep the API-supplied counts
  // verbatim (they include attendance-policy filtering the client
  // can't easily replicate).
  const counts: Counts = useMemo(() => {
    if (companyTab === "all") return apiCounts;
    let total = 0, office = 0, remote = 0, hybrid = 0, wfh = 0, wfhWorking = 0, onLeave = 0, notClockedIn = 0;
    rows.forEach((r) => {
      total++;
      if (r.wfhToday) wfh++;
      switch (r.status) {
        case "office":   office++;   break;
        case "remote":   remote++;   break;
        case "hybrid":   hybrid++;   break;
        case "wfh":      wfhWorking++; break;
        case "on_leave": onLeave++;  break;
        case "absent":   notClockedIn++; break;
      }
    });
    const present = office + remote + hybrid + wfhWorking;
    return { total, present, office, remote, hybrid, wfh, wfhWorking, onLeave, notClockedIn, late: apiCounts.late };
  }, [rows, apiCounts, companyTab]);

  const deptOpts = useMemo(() => {
    const dSet = new Set<string>();
    for (const r of rows) if (r.department) dSet.add(r.department);
    return Array.from(dSet).sort().map((v): FilterOption => ({ value: v, label: v }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      // WFH is an overlay tab — gated on the wfhToday flag, not status,
      // so a WFH applicant who clocked in remote still appears here even
      // though their status is "remote".
      if (tab === "wfh") {
        if (!r.wfhToday) return false;
      } else if (tab !== "all" && r.status !== tab) {
        return false;
      }
      if (fDept.size > 0 && (!r.department || !fDept.has(r.department))) return false;
      if (q) {
        const hay = `${r.name} ${r.email} ${r.employeeId ?? ""} ${r.designation ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, tab, fDept, search]);

  const filteredMonth = useMemo(() => {
    const q = search.trim().toLowerCase();
    return monthRows.filter((r) => {
      if (fDept.size > 0 && (!r.department || !fDept.has(r.department))) return false;
      if (q) {
        const hay = `${r.name} ${r.email} ${r.employeeId ?? ""} ${r.designation ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [monthRows, fDept, search]);

  const clearFilters = () => { setFDept(new Set()); setSearch(""); };
  const anyFilter = fDept.size || search;

  if (!canView) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[14px] text-slate-600 font-medium">You don't have permission to view this.</p>
          <Link href="/dashboard/hr/home" className="text-[12px] text-[#008CFF] hover:underline mt-2 inline-block">Back to HR Home</Link>
        </div>
      </div>
    );
  }

  const TABS: { key: typeof tab; label: string; n: number }[] = [
    { key: "all",      label: "All",              n: counts.total        },
    { key: "office",   label: "In Office",        n: counts.office       },
    { key: "remote",   label: "Remote Clock-in",  n: counts.remote       },
    { key: "hybrid",   label: "Hybrid",           n: counts.hybrid       },
    { key: "wfh",      label: "WFH",              n: counts.wfh          },
    { key: "on_leave", label: "On Leave",         n: counts.onLeave      },
    { key: "absent",   label: "Not Clocked In",   n: counts.notClockedIn },
  ];

  return (
    <div className="space-y-5">
      {/* ── Page header card ───────────────────────────────────────
          Wraps the title + subtitle and the company-scope tab strip
          into a single bordered surface, matching the polish of the
          Approvals / Regularization Balance / Leave Balances panels. */}
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[18px] font-bold text-slate-800">Attendance Dashboard</h1>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Live snapshot for {data?.date ? new Date(data.date).toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }) : "today"}
            <span className="mx-1.5 text-slate-300">·</span>
            Refreshes every minute
            {companyTab !== "all" && (
              <>
                <span className="mx-1.5 text-slate-300">·</span>
                Scope: <span className="font-semibold text-slate-700">{companyTab}</span>
              </>
            )}
          </p>
        </div>
        {/* Company scope tabs — hidden when the HR Dashboard sidebar
            flyout already picked a brand (initialBrand set). Auto-
            default to viewer's brand for standalone mounts. */}
        {initialBrand == null && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {([
              { key: "NB Media", count: brandCounts.nb  },
              { key: "YT Labs",  count: brandCounts.yt  },
              { key: "all",      count: brandCounts.all },
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
                      : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
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
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <StatCard label="Total Employees" value={counts.total}        tint="#475569" Icon={Users}          />
        <StatCard label="Present Today"   value={counts.present}      tint="#10b981" Icon={CheckCircle2}   />
        <StatCard label="Not Clocked In"  value={counts.notClockedIn} tint="#64748b" Icon={CircleUser}     />
        <StatCard label="On Leave"        value={counts.onLeave}      tint="#8b5cf6" Icon={CalendarOff}    />
        <StatCard label="Working Remotely" value={counts.remote}      tint="#008CFF" Icon={Home}           />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <StatusDonut c={counts} />
        <MonthlyReport
          year={selYear}
          month={selMonth}
          onChange={(y, m) => { setSelYear(y); setSelMonth(m); }}
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        {/* View toggle + month nav — segmented control for a cleaner
            split between Today vs Month view. */}
        <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-4 border-b border-slate-100">
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            {([
              { key: "today", label: "Today" },
              { key: "month", label: "Month view" },
            ] as const).map((opt) => {
              const active = tableView === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setTableView(opt.key)}
                  className={`h-8 px-3.5 rounded-md text-[12px] font-semibold transition-all ${
                    active
                      ? "bg-white text-[#008CFF] shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {tableView === "month" && (
            <MonthNav year={selYear} month={selMonth} onChange={(y, m) => { setSelYear(y); setSelMonth(m); }} />
          )}
        </div>

        {/* Status pill tabs — today only. Modern chip styling instead
            of underlined tabs so the count chips stand out and the
            active state reads instantly. */}
        {tableView === "today" && (
          <div className="flex items-center gap-1.5 px-5 py-3 border-b border-slate-100 overflow-x-auto flex-wrap">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 h-8 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-colors inline-flex items-center gap-2 ${
                    active
                      ? "bg-[#008CFF] text-white shadow-sm"
                      : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span>{t.label}</span>
                  <span className={`inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-bold !text-white ${
                    active ? "bg-white/20" : "bg-[#008CFF]"
                  }`} style={{ color: "#fff" }}>{t.n}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Filter row — department + search, with consistent padding. */}
        <div className="flex items-center gap-2 flex-wrap px-5 py-3 border-b border-slate-100">
          <FilterDropdown label="Department" options={deptOpts} selected={fDept} onChange={setFDept} width={260} />
          {anyFilter ? (
            <button
              type="button"
              onClick={clearFilters}
              className="h-9 px-3 text-[12px] font-medium text-slate-500 hover:text-[#008CFF] transition-colors"
            >
              Clear filters
            </button>
          ) : null}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, employee #…"
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 bg-white text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#008CFF] focus:ring-2 focus:ring-[#008CFF]/15 transition-shadow"
            />
          </div>
        </div>

        {tableView === "today" ? (
          isLoading ? (
            <div className="py-16 text-center"><div className="inline-block w-7 h-7 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" /></div>
          ) : error ? (
            <p className="py-16 text-center text-[13px] text-rose-500">Couldn't load attendance</p>
          ) : filtered.length === 0 ? (
            <p className="py-16 text-center text-[13px] text-slate-400">No employees match the current filters</p>
          ) : (
            <>
            {/* ── Off-site punch warning ─────────────────────────────────
                Surfaces today's clock-ins that landed OUTSIDE the office
                geofence (OFFICE_RADIUS_M in env). Skipped entirely on
                the WFH / Remote tabs — those folks are off-site by
                design.

                Excluded from the flag list:
                  • atOffice !== false           → already in office or no GPS
                  • locationMode !== "office"    → punch recorded as remote
                  • workLocation = remote/hybrid → org policy is remote
                  • attendanceCaptureScheme =
                       remote/hybrid             → capture mode is remote
                       (often the only field
                       HR updates for fully-
                       remote workers)
                  • wfhToday = true              → approved WFH for today
                Together those gates collapse the banner to a clean
                "office workers who clocked in from somewhere unexpected"
                list. */}
            {(() => {
              if (tab !== "all" && tab !== "office") return null;
              const offSite = filtered.filter((r) => {
                if (r.atOffice !== false)              return false;
                if (r.locationMode !== "office")        return false;
                if (r.wfhToday)                         return false;
                const wl = (r.workLocation ?? "").toLowerCase();
                if (wl === "remote" || wl === "hybrid") return false;
                const cs = (r.attendanceCaptureScheme ?? "").toLowerCase();
                if (cs === "remote" || cs === "hybrid") return false;
                return true;
              });
              if (offSite.length === 0) return null;
              return (
                <div className="mb-3 rounded-lg ring-1 ring-inset ring-amber-200 bg-amber-50/70 px-4 py-3">
                  <p className="text-[12px] font-bold text-amber-800 mb-1.5 inline-flex items-center gap-1.5">
                    <MapPin size={13} strokeWidth={2.2} />
                    {offSite.length === 1
                      ? "1 off-site clock-in flagged today"
                      : `${offSite.length} off-site clock-ins flagged today`}
                  </p>
                  <p className="text-[11px] text-amber-700/90 mb-2">
                    These employees clocked in from <strong>outside the office geofence</strong>.
                    Could be a WiFi-positioning misfire, or genuinely off-site. Click a name to investigate.
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {offSite.slice(0, 10).map((r) => (
                      <li key={r.id}>
                        <Link
                          href={`/dashboard/hr/people/${r.id}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md ring-1 ring-inset ring-amber-300 bg-white hover:bg-amber-100 text-[11px] font-semibold text-amber-800 transition-colors"
                          title={`${r.name} — ${r.distanceFromOfficeM ?? "?"} m from office`}
                        >
                          {r.name}
                          <span className="text-amber-600 font-normal">
                            {r.distanceFromOfficeM != null && r.distanceFromOfficeM < 1000
                              ? ` · ${r.distanceFromOfficeM}m`
                              : r.distanceFromOfficeM != null
                                ? ` · ${(r.distanceFromOfficeM / 1000).toFixed(1)}km`
                                : ""}
                          </span>
                        </Link>
                      </li>
                    ))}
                    {offSite.length > 10 && (
                      <li className="text-[11px] text-amber-700 inline-flex items-center px-1">
                        +{offSite.length - 10} more
                      </li>
                    )}
                  </ul>
                </div>
              );
            })()}
            {/* ── PC clock-in at office warning ──────────────────────────
                The inverse of the off-site flag: employees who are
                provably INSIDE the office geofence (atOffice=true from
                their punch's GPS) but clocked in from the web/PC app
                instead of scanning at the biometric terminal. Office
                policy is terminal-first — a PC punch from inside the
                office usually means they skipped the scanner (or the
                terminal failed). Biometric punches are excluded by
                their stamped location label (see DEVICE_LOCATION in
                src/lib/hr/device-punch.ts); remote / hybrid / WFH
                folks are excluded the same way as the off-site flag
                since PC clock-in is their expected path. */}
            {(() => {
              if (tab !== "all" && tab !== "office") return null;
              const pcAtOffice = filtered.filter((r) => {
                if (!r.clockIn)                          return false;
                if (r.atOffice !== true)                 return false; // must be provably inside the geofence
                if (/biometric/i.test(r.locationAddress ?? "")) return false; // terminal punch — expected path
                if (r.wfhToday)                          return false;
                const wl = (r.workLocation ?? "").toLowerCase();
                if (wl === "remote" || wl === "hybrid")  return false;
                const cs = (r.attendanceCaptureScheme ?? "").toLowerCase();
                if (cs === "remote" || cs === "hybrid")  return false;
                return true;
              });
              if (pcAtOffice.length === 0) return null;
              return (
                <div className="mb-3 rounded-lg ring-1 ring-inset ring-sky-200 bg-sky-50/70 px-4 py-3">
                  <p className="text-[12px] font-bold text-sky-800 mb-1.5 inline-flex items-center gap-1.5">
                    <Monitor size={13} strokeWidth={2.2} />
                    {pcAtOffice.length === 1
                      ? "1 PC clock-in from inside the office flagged today"
                      : `${pcAtOffice.length} PC clock-ins from inside the office flagged today`}
                  </p>
                  <p className="text-[11px] text-sky-700/90 mb-2">
                    These employees are <strong>at the office</strong> but clocked in from the
                    web/PC app instead of the biometric terminal. Could be a forgotten scan or a
                    terminal issue. Click a name to investigate.
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {pcAtOffice.slice(0, 10).map((r) => (
                      <li key={r.id}>
                        <Link
                          href={`/dashboard/hr/people/${r.id}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md ring-1 ring-inset ring-sky-300 bg-white hover:bg-sky-100 text-[11px] font-semibold text-sky-800 transition-colors"
                          title={`${r.name} — clocked in ${fmtTime(r.clockIn)} via ${r.locationAddress || "web/PC"}`}
                        >
                          {r.name}
                          <span className="text-sky-600 font-normal"> · {fmtTime(r.clockIn)}</span>
                        </Link>
                      </li>
                    ))}
                    {pcAtOffice.length > 10 && (
                      <li className="text-[11px] text-sky-700 inline-flex items-center px-1">
                        +{pcAtOffice.length - 10} more
                      </li>
                    )}
                  </ul>
                </div>
              );
            })()}
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm">
                <tr className="border-b border-slate-200">
                  {["EMPLOYEE","EMP #","DEPARTMENT","TEAM CAPSULE","CLOCK IN","CLOCK OUT","DURATION","LOCATION","STATUS"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.name} url={r.profilePictureUrl} size={34} />
                        <div className="min-w-0">
                          <Link href={`/dashboard/hr/people/${r.id}`} className="block text-[13px] font-semibold text-slate-800 hover:text-[#008CFF] truncate">
                            {r.name}
                          </Link>
                          <p className="text-[11px] text-slate-500 truncate">{r.designation || r.role || "—"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 font-mono">{r.employeeId || "—"}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 truncate max-w-[180px]">{r.department || "—"}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 truncate max-w-[160px]">{r.teamCapsule || "—"}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 tabular-nums">{fmtTime(r.clockIn)}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 tabular-nums">{fmtTime(r.clockOut)}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 tabular-nums">
                      {r.totalMinutes > 0 ? fmtMins(r.totalMinutes) : (r.clockIn ? <span className="inline-flex items-center gap-1 text-[#008CFF]"><Clock size={12} /> ongoing</span> : "—")}
                    </td>
                    {/* Where they clocked in from. Mode-coloured pin + truncated
                        address with the full address as a tooltip; clicking
                        opens Google Maps if we have GPS coords for the row.
                        The "At Office" / "Off-site" badge below the address
                        is computed server-side from OFFICE_LAT/LNG + the
                        clock-in's Haversine distance, so it doesn't depend on
                        Nominatim's sometimes-wrong sector label. */}
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 max-w-[200px]">
                      {r.clockIn && (r.locationAddress || r.locationLat != null) ? (
                        <div className="flex flex-col gap-1 min-w-0">
                          {r.locationLat != null && r.locationLng != null ? (
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${r.locationLat},${r.locationLng}`}
                              target="_blank"
                              rel="noreferrer"
                              title={r.locationAddress || `${r.locationLat}, ${r.locationLng}`}
                              className="inline-flex items-center gap-1.5 max-w-full truncate hover:text-[#008CFF] hover:underline"
                            >
                              <MapPin size={12} className={r.locationMode === "remote" ? "text-violet-500" : "text-emerald-500"} />
                              <span className="truncate">{r.locationAddress || "View on map"}</span>
                            </a>
                          ) : (
                            <span title={r.locationAddress ?? undefined} className="inline-flex items-center gap-1.5 max-w-full truncate">
                              <MapPin size={12} className={r.locationMode === "remote" ? "text-violet-500" : "text-emerald-500"} />
                              <span className="truncate">{r.locationAddress}</span>
                            </span>
                          )}
                          {r.atOffice === true && (
                            <span
                              className="inline-flex items-center gap-1 self-start text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ring-1 ring-inset ring-emerald-200 bg-emerald-50 text-emerald-700"
                              title={`Clocked in ${r.distanceFromOfficeM ?? 0} m from office`}
                            >
                              <CheckCircle2 size={10} strokeWidth={2.5} /> At Office
                            </span>
                          )}
                          {r.atOffice === false && (
                            <span
                              className="inline-flex items-center gap-1 self-start text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ring-1 ring-inset ring-amber-200 bg-amber-50 text-amber-700"
                              title={`Clocked in ${r.distanceFromOfficeM ?? "?"} m from office`}
                            >
                              <MapPin size={10} strokeWidth={2.5} />
                              {(r.distanceFromOfficeM != null && r.distanceFromOfficeM < 1000)
                                ? `${r.distanceFromOfficeM} m off-site`
                                : (r.distanceFromOfficeM != null
                                    ? `${(r.distanceFromOfficeM / 1000).toFixed(1)} km off-site`
                                    : "Off-site")}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusPill s={r.status} rawStatus={r.rawStatus} />
                        {r.wfhToday && (r.wfhKind === "first_half" || r.wfhKind === "second_half") && (
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset ring-[#008CFF]/30 bg-[#008CFF]/10 text-[#008CFF]">
                            {r.wfhKind === "first_half" ? "1st half" : "2nd half"}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            </>
          )
        ) : (
          monthLoading ? (
            <div className="py-16 text-center"><div className="inline-block w-7 h-7 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" /></div>
          ) : filteredMonth.length === 0 ? (
            <p className="py-16 text-center text-[13px] text-slate-400">No employees match the current filters</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm">
                <tr className="border-b border-slate-200">
                  {["EMPLOYEE","EMP #","DEPARTMENT","PRESENT","ON LEAVE","LATE","HALF-DAY","ABSENT","AVG HRS"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMonth.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.name} url={r.profilePictureUrl} size={34} />
                        <div className="min-w-0">
                          <Link href={`/dashboard/hr/people/${r.id}`} className="block text-[13px] font-semibold text-slate-800 hover:text-[#008CFF] truncate">
                            {r.name}
                          </Link>
                          <p className="text-[11px] text-slate-500 truncate">{r.designation || r.role || "—"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 font-mono">{r.employeeId || "—"}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 truncate max-w-[180px]">{r.department || "—"}</td>
                    <td className="px-4 py-3 text-[12.5px] text-emerald-600 tabular-nums">{r.presentDays}</td>
                    <td className="px-4 py-3 text-[12.5px] text-violet-600 tabular-nums">{r.onLeaveDays}</td>
                    <td className="px-4 py-3 text-[12.5px] text-amber-600 tabular-nums">{r.lateDays}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-600 tabular-nums">{r.halfDayDays}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-600 tabular-nums">{r.absentDays}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-800 tabular-nums font-semibold">{r.avgHours ? `${r.avgHours}h` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
