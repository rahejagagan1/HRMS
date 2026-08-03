"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import {
  MapPin, ArrowDownLeft, ArrowUpRight, AlertCircle, Home, Briefcase,
  ShieldCheck, Coffee, LogOut, MoreVertical, X,
} from "lucide-react";
import { fetcher } from "@/lib/swr";
import { parseAttLoc, type AttLoc } from "@/lib/attendance-location";
import { isWorkingDay } from "@/lib/hr/shift-working-days";
import HandoffSection from "@/components/hr/HandoffSection";
import SelectField from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/date-field";
import type { PickerUser } from "@/components/hr/EmployeePicker";

// Extracted from src/app/dashboard/hr/people/[id]/page.tsx so the SAME rich
// attendance log + requests component renders on both the HR per-employee
// view and the employee self-service page. Self-view (meDbId === userId with
// isHRAdmin=false) hides every on-behalf / HR-only action automatically.

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtMins(m: number): string {
  if (!m || m <= 0) return "—";
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h}h ${mm}m`;
}

// Shift window for the timeline bar: 9 AM → 6 PM IST (540 minutes).
const SHIFT_START_MIN = 9 * 60;   // minutes since midnight IST
const SHIFT_END_MIN   = 18 * 60;
const SHIFT_LEN       = SHIFT_END_MIN - SHIFT_START_MIN;

// Convert a UTC clock-time to minutes-since-midnight IST.
function toIstMin(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(d).reduce<Record<string, string>>((a, p) => { a[p.type] = p.value; return a; }, {});
  return parseInt(parts.hour || "0", 10) * 60 + parseInt(parts.minute || "0", 10);
}

function LocationLink({ raw }: { raw: string | null | undefined }) {
  const loc: AttLoc = parseAttLoc(raw);
  // Nothing to show if the row never captured a location.
  if (!raw || (loc.lat === undefined && !loc.address && !loc.mode)) return null;

  const hasCoords = typeof loc.lat === "number" && typeof loc.lng === "number";
  const href = hasCoords
    ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}`
    : loc.address
      ? `https://www.google.com/maps/search/${encodeURIComponent(loc.address)}`
      : null;

  // Tooltip — shows the captured address (best-effort reverse-geocode) plus
  // mode/coords as a fallback if no address resolved.
  const tooltip = [
    loc.mode === "remote" ? "Remote" : loc.mode === "office" ? "Office" : null,
    loc.address,
    hasCoords ? `${loc.lat?.toFixed(5)}, ${loc.lng?.toFixed(5)}` : null,
  ].filter(Boolean).join(" · ");

  // Soft mode-tinted dot underneath the pin so HR can scan office vs remote.
  const tone =
    loc.mode === "remote" ? "text-sky-600 hover:bg-sky-50" :
    loc.mode === "office" ? "text-emerald-600 hover:bg-emerald-50" :
                            "text-slate-500 hover:bg-slate-100";

  if (!href) {
    return (
      <span className={`inline-flex h-6 w-6 items-center justify-center rounded ${tone}`} title={tooltip || "Location"}>
        <MapPin className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={tooltip || "Open in Google Maps"}
      className={`inline-flex h-6 w-6 items-center justify-center rounded transition ${tone}`}
      onClick={(e) => e.stopPropagation()}
    >
      <MapPin className="h-3.5 w-3.5" />
    </a>
  );
}

type BarTone = "default" | "pending" | "approved";

function TimelineBar({
  clockIn, clockOut, tone = "default", sessions, isTodayRow, doorEntries,
}: {
  clockIn: string | Date | null;
  clockOut: string | Date | null;
  tone?: BarTone;
  sessions?: Array<{ clockIn: string | Date; clockOut?: string | Date | null }>;
  isTodayRow?: boolean;
  doorEntries?: Array<{ scannedAt: string | Date }>;
}) {
  // 9-to-6 shift window. Clamp the filled bar to the window edges.
  const inMin  = clockIn  ? toIstMin(new Date(clockIn))  : null;
  const outMin = clockOut ? toIstMin(new Date(clockOut)) : null;
  const startPct = inMin  != null ? Math.max(0,   ((inMin  - SHIFT_START_MIN) / SHIFT_LEN) * 100) : 0;
  const endPct   = outMin != null ? Math.min(100, ((outMin - SHIFT_START_MIN) / SHIFT_LEN) * 100) : 0;
  const widthPct = Math.max(0, endPct - startPct);
  const hasBar   = !!(clockIn && clockOut);
  // When there's a clock-in but no clock-out yet (today: open session;
  // past dates: forgot-to-clock-out / regularization needed) we still
  // want a visible marker at the clock-in position so HR can see WHEN
  // the day started without having to hover the empty track.
  const hasStartOnly = !!clockIn && !clockOut;

  // Lowercase, no leading-zero formatting — matches the attendance
  // page's "Logged In 8:00 am" tooltip wording.
  const fmt = (d: Date | null) => d
    ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
        .replace(/^0/, "").toLowerCase()
    : null;
  const inLabel  = clockIn  ? fmt(new Date(clockIn))  : null;
  const outLabel = clockOut ? fmt(new Date(clockOut)) : null;
  const toneSuffix = tone === "pending"  ? " · Regularization pending"
                   : tone === "approved" ? " · Regularization approved"
                   : "";

  // Tone palette: default (sky), pending (amber-striped), approved (emerald)
  const toneCls =
    tone === "pending"
      ? { fill: "from-[#fbbf24] to-[#f59e0b]", glow: "0 2px 5px rgba(245,158,11,0.35)", ring: "#f59e0b", dot: "bg-[#f59e0b]" }
      : tone === "approved"
        ? { fill: "from-[#34d399] to-[#10b981]", glow: "0 2px 5px rgba(16,185,129,0.35)", ring: "#10b981", dot: "bg-[#10b981]" }
        : { fill: "from-[#38bdf8] to-[#0ea5e9]", glow: "0 2px 5px rgba(14,165,233,0.35)", ring: "#0ea5e9", dot: "bg-[#0ea5e9]" };

  // The hover tooltip is portaled to <body> so it can render ABOVE the bar
  // without being clipped by the attendance table's overflow-hidden card.
  // Capture the bar's viewport rect on hover; position the tooltip from it.
  const barRef = useRef<HTMLDivElement>(null);
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null);
  const showTip = () => {
    const r = barRef.current?.getBoundingClientRect();
    if (r) setTipPos({ left: r.left + r.width / 2, top: r.top });
  };
  const hideTip = () => setTipPos(null);

  return (
    <div ref={barRef} onMouseEnter={showTip} onMouseLeave={hideTip} className="group relative h-5 w-full">
      {/* Track */}
      <div className="absolute inset-x-0 top-1/2 h-[8px] -translate-y-1/2 rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/60" />

      {hasBar ? (
        <>
          {/* Filled bar */}
          <div
            className={`absolute top-1/2 h-[8px] -translate-y-1/2 rounded-full bg-gradient-to-r ${toneCls.fill} ${tone === "pending" ? "opacity-80" : ""}`}
            style={{ left: `${startPct}%`, width: `${widthPct}%`, boxShadow: toneCls.glow }}
          />
          {/* Diagonal stripe overlay on PENDING bars — signals "tentative" without
              shouting. Pure CSS, no extra DOM. */}
          {tone === "pending" ? (
            <div
              className="absolute top-1/2 h-[8px] -translate-y-1/2 rounded-full"
              style={{
                left: `${startPct}%`,
                width: `${widthPct}%`,
                backgroundImage:
                  "repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0 4px, transparent 4px 8px)",
              }}
            />
          ) : null}
          {/* Endpoint dots */}
          <span
            className="absolute top-1/2 h-[12px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.20)]"
            style={{ left: `${startPct}%`, boxShadow: `0 0 0 2px ${toneCls.ring}` }}
          />
          <span
            className="absolute top-1/2 h-[12px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.20)]"
            style={{ left: `${endPct}%`, boxShadow: `0 0 0 2px ${toneCls.ring}` }}
          />
        </>
      ) : hasStartOnly ? (
        <>
          {/* Start-only bar: a short amber stub anchored at the clock-in
              position, with a single endpoint dot. Communicates "we know
              when they came in; clock-out is missing." Hover the row for
              the exact time. */}
          <div
            className="absolute top-1/2 h-[8px] -translate-y-1/2 rounded-full bg-gradient-to-r from-amber-300 to-amber-400"
            style={{ left: `${startPct}%`, width: `6px`, boxShadow: "0 2px 5px rgba(245,158,11,0.35)" }}
          />
          <span
            className="absolute top-1/2 h-[12px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.20)]"
            style={{ left: `${startPct}%`, boxShadow: `0 0 0 2px #f59e0b` }}
          />
        </>
      ) : null}

      {/* Themed hover tooltip — same look as the attendance-page bar.
          Pointer-events disabled so it never swallows clicks on the
          row's other interactive children (regularize, on-behalf
          actions, etc.). Hidden when there's no clock-in to show. */}
      {inLabel && tipPos && typeof document !== "undefined" && createPortal(
        <div
          role="tooltip"
          style={{ position: "fixed", left: tipPos.left, top: tipPos.top - 8, transform: "translate(-50%, -100%)" }}
          className="pointer-events-none z-[80] whitespace-nowrap rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0a1526] px-2.5 py-1.5 text-[11.5px] font-medium text-slate-700 dark:text-slate-200 shadow-lg"
        >
          {/* Web Clock In — each session as ↙ clock-in / ↗ clock-out (now /
              Missed), matching the attendance-page LOG tooltip exactly. */}
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Web Clock In</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
            {(sessions && sessions.length > 0
              ? sessions
              : [{ clockIn: clockIn as string | Date, clockOut }]
            ).map((s, i) => {
              const open = !s.clockOut;
              const isLiveNow = open && isTodayRow;
              return (
                <div key={i} className="contents">
                  <span className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-700 dark:text-slate-200">
                    <ArrowDownLeft size={13} strokeWidth={2.4} className="shrink-0 text-emerald-500" />
                    {fmt(new Date(s.clockIn))}
                  </span>
                  {isLiveNow ? (
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium">
                      <span className="relative inline-flex h-3 w-3 shrink-0 items-center justify-center">
                        <span className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      </span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">now</span>
                    </span>
                  ) : open ? (
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium">
                      <AlertCircle size={13} strokeWidth={2.4} className="shrink-0 text-amber-500" />
                      <span className="font-semibold text-amber-600 dark:text-amber-400">Missed</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-700 dark:text-slate-200">
                      <ArrowUpRight size={13} strokeWidth={2.4} className="shrink-0 text-rose-500" />
                      {fmt(new Date(s.clockOut!))}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {toneSuffix && (
            <p className="mt-1 text-[10.5px] font-medium text-slate-500 dark:text-slate-400">{toneSuffix.replace(/^\s*·\s*/, "")}</p>
          )}
          {/* Door entries — mid-day re-entry scans (managers / HR / CEO / devs only). */}
          {Array.isArray(doorEntries) && doorEntries.length > 0 && (
            <div className="mt-1.5 border-t border-slate-200/60 dark:border-white/10 pt-1.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Door Entries</p>
              <div className="flex flex-col gap-1 tabular-nums">
                {doorEntries.map((d, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-700 dark:text-slate-200">
                    <ArrowDownLeft size={13} strokeWidth={2.4} className="shrink-0 text-[#008CFF]" />
                    {fmt(new Date(d.scannedAt))}
                  </span>
                ))}
              </div>
            </div>
          )}
          <span className="absolute left-1/2 -translate-x-1/2 -bottom-[5px] w-2.5 h-2.5 rotate-45 bg-white dark:bg-[#0a1526] border-r border-b border-slate-200 dark:border-white/10" />
        </div>,
        document.body
      )}
    </div>
  );
}

export function EmployeeTimePanel({
  userId, userName, isHRAdmin, meDbId, joiningDate, workLocation,
  targetOrgLevel, targetIsDeveloper,
  shiftStartTime, shiftEndTime, shiftBreakMinutes,
  viewerIsGaganDev = false, onSelfApply,
}: {
  userId: number; userName: string; isHRAdmin: boolean; meDbId: number | null;
  joiningDate?: string | null;
  workLocation?: string | null;
  targetOrgLevel?: string | null;
  targetIsDeveloper?: boolean;
  // Shift coords drive the LATE-chip cutoff per row. Passed in from
  // the parent so we don't refetch — /api/hr/people/[id] already
  // includes shift in its response. endTime feeds the shift MID-POINT,
  // the expected arrival on first-half-leave/WFH days.
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;
  shiftBreakMinutes?: number | null;
  // True ONLY when the signed-in viewer is Gagan's developer account —
  // unlocks the on-behalf "Clock Out" control below. No other developer /
  // CEO / HR sees it. Enforced again server-side in the API.
  viewerIsGaganDev?: boolean;
  // SELF-service apply: when the signed-in user views their OWN attendance,
  // the parent (the employee attendance page) passes this so the per-row 3-dot
  // menu opens the user's OWN apply form (regularize / WFH / on-duty / leave)
  // for that day. This is a SELF action only — it never grants any on-behalf /
  // HR power (those stay gated behind isHRAdmin).
  onSelfApply?: (kind: "regularize" | "wfh" | "on_duty" | "leave", date: string) => void;
}) {
  // CEO + developers don't punch a clock — flexible schedules mean the
  // daily "Absent" cross-marks for every non-clocked-in day are noise.
  // When viewing their profile (or their own page) we skip absent-row
  // synthesis below. Real clock-ins, weekends, and holidays still
  // appear; just the empty-day "Absent" placeholders are dropped.
  const skipAbsentSynthesis = !!(targetOrgLevel === "ceo" || targetIsDeveloper);
  // Normalise the joining date to a UTC midnight Date so we can clamp
  // every date window without re-parsing per call. Anything before this
  // day was pre-employment and shouldn't show as "Absent" — the row
  // never existed.
  const joinedAt = joiningDate ? new Date(`${String(joiningDate).slice(0, 10)}T00:00:00Z`) : null;
  // Remote / hybrid employees already work from home as their baseline,
  // so applying for WFH is meaningless. Hide the quick action — both
  // for self-view and for HR viewing such an employee's profile.
  const targetWorkLocation = String(workLocation ?? "office").toLowerCase();
  const canApplyWfh = targetWorkLocation !== "remote" && targetWorkLocation !== "hybrid";
  // True when the signed-in viewer is looking at their own profile — used
  // to render a "Regularize this day" link in place of the passive Absent
  // cross icon, deep-linking into /dashboard/hr/attendance with the date
  // pre-filled so the user can self-apply.
  const isSelfView = meDbId !== null && meDbId === userId;
  // The employee viewing their OWN attendance gets the per-row 3-dot menu to
  // apply their own requests — only when the parent wired onSelfApply and the
  // viewer isn't an HR admin (HR uses the on-behalf kebab instead).
  const canSelfApply = isSelfView && !isHRAdmin && typeof onSelfApply === "function";
  const today = new Date();

  // Live clock tick — used to add the currently-open session's elapsed
  // minutes onto today's Effective/Gross hours. Without this, the row
  // is stuck on the last clocked-out totalMinutes (which is what the DB
  // stores) and a user mid-session sees stale numbers. 1-minute cadence
  // is plenty; per-second feels jittery in a table cell.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Period selector: "30d" | "YYYY-MM"
  type Period = "30d" | string;
  const [period, setPeriod] = useState<Period>("30d");

  // API URL based on period. The 30-day window is clamped to the
  // employee's joining date so we never fetch (or synthesize) "absent"
  // rows for days before they were employed.
  const url = (() => {
    if (period === "30d") {
      const end = new Date();
      let start = new Date(end); start.setDate(start.getDate() - 29);
      if (joinedAt && start.getTime() < joinedAt.getTime()) start = new Date(joinedAt.getTime());
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      return `/api/hr/attendance?userId=${userId}&from=${iso(start)}&to=${iso(end)}`;
    }
    return `/api/hr/attendance?userId=${userId}&month=${period}`;
  })();
  const { data, isLoading } = useSWR(url, fetcher);
  // This employee's shift + alternate-Saturday anchor (from the attendance
  // API) — drives the weekly-off vs absent synthesis below. Null → Mon–Fri.
  const panelShift = (data?.shift ?? null) as any;
  const panelAnchor = data?.shiftEffectiveFrom ? new Date(data.shiftEffectiveFrom) : null;
  const records: any[] = data?.records ?? [];

  // On-behalf clock-out (Gagan's developer account only — see viewerIsGaganDev
  // and the server enforcement in /api/hr/attendance/clock-out-on-behalf).
  // Closes the target user's open session for TODAY at the current time.
  const [clockingOut, setClockingOut] = useState(false);
  const handleClockOutOnBehalf = async () => {
    if (clockingOut) return;
    if (!window.confirm(`Clock out ${userName} now (current time)?`)) return;
    setClockingOut(true);
    try {
      const res = await fetch("/api/hr/attendance/clock-out-on-behalf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { alert(d.error || "Failed to clock out"); return; }
      await mutate(url);
      await mutate(`/api/hr/people/${userId}`);
    } finally {
      setClockingOut(false);
    }
  };

  // Status rank for "best" choice when multiple requests exist for the same date.
  // Pending > partially_approved > approved > rejected/cancelled.
  const statusRank = (s: string) =>
    s === "pending" ? 4 : s === "partially_approved" ? 3 : s === "approved" ? 2 : 1;

  // Regularization requests — admins fetch all then filter client-side; users get view=my.
  const regsUrl = isHRAdmin ? "/api/hr/attendance/regularize?view=all" : "/api/hr/attendance/regularize?view=my";
  const { data: regsData = [] } = useSWR<any[]>(regsUrl, fetcher);

  // WFH requests
  const wfhUrl = isHRAdmin ? "/api/hr/attendance/wfh?view=all" : "/api/hr/attendance/wfh?view=my";
  const { data: wfhData = [] } = useSWR<any[]>(wfhUrl, fetcher);

  // Leave applications
  const leavesUrl = isHRAdmin ? "/api/hr/leaves?view=all" : "/api/hr/leaves?view=my";
  const { data: leavesRaw } = useSWR<any>(leavesUrl, fetcher);
  const leavesData: any[] = Array.isArray(leavesRaw)
    ? leavesRaw
    : (leavesRaw?.applications ?? leavesRaw?.items ?? []);

  // Build per-date maps for THIS user.
  const regByDate = (() => {
    const map = new Map<string, any>();
    if (!Array.isArray(regsData)) return map;
    for (const r of regsData) {
      if (r.userId !== userId) continue;
      const k = String(r.date).slice(0, 10);
      const prev = map.get(k);
      if (!prev || statusRank(r.status) > statusRank(prev.status)) map.set(k, r);
    }
    return map;
  })();

  const wfhByDate = (() => {
    const map = new Map<string, any>();
    if (!Array.isArray(wfhData)) return map;
    for (const w of wfhData) {
      if (w.userId !== userId) continue;
      const k = String(w.date).slice(0, 10);
      const prev = map.get(k);
      if (!prev || statusRank(w.status) > statusRank(prev.status)) map.set(k, w);
    }
    return map;
  })();

  // Leaves are date-RANGES — find the best applicable leave for a given day.
  const userLeaves = leavesData.filter((l: any) => l.userId === userId);
  const findLeaveForDate = (dateOnly: string): any | null => {
    let best: any = null;
    for (const l of userLeaves) {
      const from = String(l.fromDate).slice(0, 10);
      const to   = String(l.toDate).slice(0, 10);
      if (dateOnly >= from && dateOnly <= to) {
        if (!best || statusRank(l.status) > statusRank(best.status)) best = l;
      }
    }
    return best;
  };

  // Build a complete day-by-day series (incl. weekends + absent gaps), newest first.
  // Start is clamped to the employee's joining date — pre-employment days
  // would otherwise synthesize as "Absent" rows and pollute the log.
  const fullSeries = (() => {
    let start: Date, end: Date;
    if (period === "30d") {
      end = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
      start = new Date(end.getTime()); start.setUTCDate(start.getUTCDate() - 29);
    } else {
      const [y, m] = period.split("-").map(Number);
      start = new Date(Date.UTC(y, m - 1, 1));
      end   = new Date(Date.UTC(y, m, 0));
      const todayUtc = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
      if (end.getTime() > todayUtc.getTime()) end = todayUtc;
    }
    if (joinedAt && start.getTime() < joinedAt.getTime()) start = new Date(joinedAt.getTime());
    // If the entire window is pre-joining, bail out with an empty series.
    if (start.getTime() > end.getTime()) return [] as any[];
    const byDate = new Map<string, any>();
    for (const r of records) byDate.set(String(r.date).slice(0, 10), r);
    const out: any[] = [];
    for (let d = new Date(start.getTime()); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const rec = byDate.get(iso);
      if (rec) out.push(rec);
      else {
        // Off day for THIS employee's shift — weekly-off OR a non-working
        // alternate Saturday. Working Saturdays correctly stay "absent".
        const isWeekend = !isWorkingDay(d, panelShift, panelAnchor);
        // CEO + developers — only synthesize weekends (calendar context).
        // Drop the "Absent" placeholders so the log isn't a wall of
        // cross-marks for someone who doesn't punch a clock.
        if (skipAbsentSynthesis && !isWeekend) continue;
        out.push({
          id: `synth-${iso}`,
          date: `${iso}T00:00:00.000Z`,
          clockIn: null, clockOut: null, totalMinutes: 0,
          status: isWeekend ? "weekly_off" : "absent",
        });
      }
    }
    out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return out;
  })();

  // Period button list — matches the Keka layout (30 DAYS + last 6 months).
  const periodButtons: { key: Period; label: string }[] = [
    { key: "30d", label: "30 DAYS" },
    ...Array.from({ length: 6 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return { key: k as Period, label: MONTH_NAMES[d.getMonth()].toUpperCase() };
    }),
  ];

  const periodLabel = period === "30d"
    ? "Last 30 Days"
    : (() => {
        const [y, m] = period.split("-").map(Number);
        return new Date(y, m - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
      })();

  // ── Regularize-on-behalf modal state ────────────────────────────────
  const [regOpen, setRegOpen] = useState(false);
  const [regForm, setRegForm] = useState<{ date: string; requestedIn: string; requestedOut: string; reason: string }>({
    date: "", requestedIn: "", requestedOut: "", reason: "",
  });
  const [submitting, setSubmitting] = useState(false);

  // ── HR on-behalf actions: 3-dot menu, WFH modal, Leave modal ────────
  // The kebab opens a small popover with three options that map to the
  // three on-behalf POST endpoints (regularize, wfh, leaves). State below
  // is HR-admin only — guarded at each call site by isHRAdmin.
  const [menuOpenKey, setMenuOpenKey]   = useState<string | null>(null);
  // Anchor rect of the open kebab button — the menu is portaled to <body> with
  // fixed positioning so it escapes the attendance table's overflow-hidden card
  // (otherwise the dropdown gets clipped, esp. on the last/only row).
  const [menuRect, setMenuRect]         = useState<DOMRect | null>(null);
  const [wfhOpen,     setWfhOpen]       = useState(false);
  // Tab inside the Apply-Leave-on-behalf modal — switches between
  // submitting a Leave application and granting WFH for the same user
  // without forcing HR to close one modal and open another.
  const [leaveModalTab, setLeaveModalTab] = useState<"leave" | "wfh">("leave");
  // On-Duty on-behalf modal — standalone small modal that POSTs to the
  // existing /api/hr/attendance/on-duty endpoint with targetUserId.
  const [odOpen, setOdOpen] = useState(false);
  // `date` = From, `toDate` = To. Single-day defaults to date == toDate.
  const [odForm, setOdForm] = useState<{ date: string; toDate: string; location: string; purpose: string }>({ date: "", toDate: "", location: "", purpose: "" });
  // WFH on-behalf form: `date` is the FROM date, `toDate` is the TO date.
  // The API treats a missing/equal `toDate` as a single-day grant; when a
  // later toDate is supplied (HR-on-behalf only) it grants WFH for every
  // working day in the range.
  const [wfhForm,     setWfhForm]       = useState<{ date: string; toDate: string; reason: string }>({ date: "", toDate: "", reason: "" });
  const [leaveOpen,   setLeaveOpen]     = useState(false);
  const [leaveForm,   setLeaveForm]     = useState<{ leaveTypeId: number | ""; fromDate: string; toDate: string; reason: string }>({
    leaveTypeId: "", fromDate: "", toDate: "", reason: "",
  });
  // Shared full / first_half / second_half toggle for both the
  // HR-on-behalf Leave and WFH tabs. Picking a half-day collapses the
  // range to a single date and prepends the reason with the marker the
  // backend uses to count as 0.5 days.
  const [grantDayKind, setGrantDayKind] = useState<"full" | "first_half" | "second_half">("full");
  const isGrantHalf = grantDayKind !== "full";

  // Handoff Details — POC + Work Status (+ Unavailability for WFH). Same
  // contract the company's standard leave/WFH form enforces; both APIs
  // reject the request when these are missing, so the HR-on-behalf
  // modal has to surface them too. State sits at the modal level so
  // switching between Leave / WFH tabs doesn't drop a typed-in value.
  const [handoffPoc,            setHandoffPoc]            = useState<PickerUser[]>([]);
  const [handoffWorkStatus,     setHandoffWorkStatus]     = useState("");
  const [handoffUnavailability, setHandoffUnavailability] = useState("");
  // HR filing on behalf can mark POC as N/A — the user's own
  // request flow keeps POC required (allowNa stays default-false there).
  const [handoffPocNa,          setHandoffPocNa]          = useState(false);
  const resetHandoff = () => { setHandoffPoc([]); setHandoffWorkStatus(""); setHandoffUnavailability(""); setHandoffPocNa(false); };
  const [leaveTypes,  setLeaveTypes]    = useState<{ id: number; name: string }[]>([]);
  // Per-type available balance for the target user, keyed by leaveTypeId.
  // available = totalDays - usedDays - pendingDays. Pending MUST be
  // subtracted so the number shown matches what the apply API actually
  // enforces (POST /api/hr/leaves rejects on total-used-pending) — otherwise
  // the form showed a higher "available" than could really be applied for.
  // Refetched each time the modal opens so a stale draft isn't shown.
  const [targetBalances, setTargetBalances] = useState<Record<number, number>>({});
  useEffect(() => {
    if (!isHRAdmin) return;
    fetch("/api/hr/leaves/types").then(r => r.json()).then((d) => {
      if (Array.isArray(d)) setLeaveTypes(d);
    }).catch(() => {});
  }, [isHRAdmin]);
  // External trigger: the profile-page kebab dispatches
  // "hr:apply-leave-on-behalf" so HR can open the leave modal without
  // first clicking through to the per-row kebab. Only honored for HR
  // admins (who'd see the option anyway).
  useEffect(() => {
    if (!isHRAdmin) return;
    const open = () => setLeaveOpen(true);
    window.addEventListener("hr:apply-leave-on-behalf", open);
    return () => window.removeEventListener("hr:apply-leave-on-behalf", open);
  }, [isHRAdmin]);
  useEffect(() => {
    if (!leaveOpen || !isHRAdmin || !userId) return;
    fetch(`/api/hr/leaves/balance?userId=${userId}`)
      .then(r => r.json())
      .then((rows) => {
        if (!Array.isArray(rows)) return;
        const map: Record<number, number> = {};
        for (const b of rows) {
          const total   = parseFloat(b.totalDays   ?? "0");
          const used    = parseFloat(b.usedDays    ?? "0");
          const pending = parseFloat(b.pendingDays ?? "0");
          map[b.leaveTypeId] = total - used - pending;
        }
        setTargetBalances(map);
      })
      .catch(() => {});
  }, [leaveOpen, isHRAdmin, userId]);
  useEffect(() => {
    if (menuOpenKey === null) return;
    // Close on outside click. Using a data-attribute check is more reliable
    // than React's e.stopPropagation() because React 17+ delegates to the
    // root container — a synthetic stopPropagation doesn't always prevent
    // the native event from reaching document-level listeners, which would
    // unmount the menu before the option's click handler fired.
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && !t.closest("[data-hr-menu]")) setMenuOpenKey(null);
    };
    // The menu is position:fixed (portaled), so it would drift on scroll —
    // close it instead. `true` catches scrolls on inner scroll containers.
    const dismiss = () => setMenuOpenKey(null);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [menuOpenKey]);

  const openWfhFor = (rec: any) => {
    const dateOnly = String(rec.date).slice(0, 10);
    // Route through the unified Leave + WFH modal with the WFH tab
    // pre-selected — keeps a single canonical form instead of a
    // standalone WFH modal that duplicated the same fields.
    setWfhForm({ date: dateOnly, toDate: dateOnly, reason: "" });
    setLeaveModalTab("wfh");
    setMenuOpenKey(null);
    setLeaveOpen(true);
  };
  const openOdFor = (rec: any) => {
    const dateOnly = String(rec.date).slice(0, 10);
    setOdForm({ date: dateOnly, toDate: dateOnly, location: "", purpose: "" });
    setMenuOpenKey(null);
    setOdOpen(true);
  };
  const openLeaveFor = (rec: any) => {
    const dateOnly = String(rec.date).slice(0, 10);
    setLeaveForm({ leaveTypeId: "", fromDate: dateOnly, toDate: dateOnly, reason: "" });
    setLeaveModalTab("leave");
    setMenuOpenKey(null);
    setLeaveOpen(true);
  };

  const refreshAttendanceCaches = () => {
    // Mirror submitReg's refresh set: the table + all three request lists
    // so badges (Approved / Pending / on-leave) and the timeline bar update.
    mutate(url);
    mutate(regsUrl);
    mutate(wfhUrl);
    mutate(leavesUrl);
  };

  const submitWfh = async () => {
    if (!wfhForm.date || !wfhForm.reason.trim()) { alert("From date and reason are required."); return; }
    // Handoff Details mirror the standard WFH form. HR on-behalf can
    // mark POC as N/A — when that's ticked we send pocUserId=null and
    // skip the required check.
    const pocId = handoffPocNa ? null : (handoffPoc[0]?.id ?? null);
    if (!handoffPocNa && !pocId)         { alert("POC in Absence is required (or mark as N/A)."); return; }
    if (!handoffWorkStatus.trim())       { alert("Work Status is required."); return; }
    if (!handoffUnavailability.trim())   { alert("Time of Unavailability is required."); return; }
    const effectiveTo = wfhForm.toDate && wfhForm.toDate >= wfhForm.date ? wfhForm.toDate : wfhForm.date;
    setSubmitting(true);
    try {
      // No forceGrant — route through normal approval (same flow as
      // apply-on-behalf on the HR dashboard). The target user's manager
      // sees the request in their L1 queue.
      // Half-day WFH tags the reason with [First Half] / [Second Half]
      // (same convention as leave) and collapses the range to a single
      // date — half-day WFH only makes sense for one day.
      const wfhReasonText = wfhForm.reason.trim();
      const wfhReasonOut =
        grantDayKind === "first_half"  ? `[First Half] ${wfhReasonText}`  :
        grantDayKind === "second_half" ? `[Second Half] ${wfhReasonText}` :
                                          wfhReasonText;
      const wfhEffectiveTo = isGrantHalf ? wfhForm.date : effectiveTo;
      const res = await fetch("/api/hr/attendance/wfh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId:   userId,
          date:           wfhForm.date,
          toDate:         wfhEffectiveTo,
          reason:         wfhReasonOut,
          pocUserId:      pocId,
          workStatus:     handoffWorkStatus.trim(),
          unavailability: handoffUnavailability.trim(),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { alert(d.error || "Failed to grant WFH"); return; }
      setWfhOpen(false);
      resetHandoff();
      refreshAttendanceCaches();
    } finally { setSubmitting(false); }
  };

  const submitOnDuty = async () => {
    if (!odForm.date)            { alert("From date is required."); return; }
    if (!odForm.purpose.trim())  { alert("Purpose is required."); return; }
    // Handoff Details — workStatus is required server-side. POC is
    // N/A-eligible here for the HR-on-behalf path.
    const pocId = handoffPocNa ? null : (handoffPoc[0]?.id ?? null);
    if (!handoffPocNa && !pocId)   { alert("POC in Absence is required (or mark as N/A)."); return; }
    if (!handoffWorkStatus.trim()) { alert("Work Status is required."); return; }
    const effectiveTo = odForm.toDate && odForm.toDate >= odForm.date ? odForm.toDate : odForm.date;
    setSubmitting(true);
    try {
      const res = await fetch("/api/hr/attendance/on-duty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: userId,
          date:         odForm.date,
          toDate:       effectiveTo,
          location:     odForm.location.trim() || undefined,
          purpose:      odForm.purpose.trim(),
          pocUserId:    pocId,
          workStatus:   handoffWorkStatus.trim(),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { alert(d.error || "Failed to submit on-duty request."); return; }
      setOdOpen(false);
      setOdForm({ date: "", toDate: "", location: "", purpose: "" });
      resetHandoff();
      refreshAttendanceCaches();
    } finally { setSubmitting(false); }
  };

  const submitLeave = async () => {
    if (!leaveForm.leaveTypeId) { alert("Leave type is required."); return; }
    if (!leaveForm.fromDate || !leaveForm.toDate) { alert("From and To dates are required."); return; }
    if (!leaveForm.reason.trim()) { alert("Reason is required."); return; }
    // Handoff Details — same contract as the standard leave form. POC
    // may be N/A on HR-on-behalf; workStatus stays required.
    const pocId = handoffPocNa ? null : (handoffPoc[0]?.id ?? null);
    if (!handoffPocNa && !pocId)   { alert("POC in Absence is required (or mark as N/A)."); return; }
    if (!handoffWorkStatus.trim()) { alert("Work Status is required."); return; }
    setSubmitting(true);
    try {
      // Half-day leave: tag the reason and collapse the range so the
      // API's 0.5-day accounting kicks in.
      const leaveReasonText = leaveForm.reason.trim();
      const leaveReasonOut =
        grantDayKind === "first_half"  ? `[First Half] ${leaveReasonText}`  :
        grantDayKind === "second_half" ? `[Second Half] ${leaveReasonText}` :
                                          leaveReasonText;
      const leaveToDateOut = isGrantHalf ? leaveForm.fromDate : leaveForm.toDate;
      const res = await fetch("/api/hr/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId:    userId,
          useLwpFallback:  true,  // HR-on-behalf auto-falls back to LWP if balance missing
          leaveTypeId:     Number(leaveForm.leaveTypeId),
          fromDate:        leaveForm.fromDate,
          toDate:          leaveToDateOut,
          reason:          leaveReasonOut,
          pocUserId:       pocId,
          workStatus:      handoffWorkStatus.trim(),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { alert(d.error || "Failed to grant leave"); return; }
      setLeaveOpen(false);
      resetHandoff();
      refreshAttendanceCaches();
    } finally { setSubmitting(false); }
  };

  // datetime-local <-> IST helpers. The native input is timezone-naive
  // (just "YYYY-MM-DDTHH:mm" text), so we have to format the stored UTC
  // instant in IST when pre-filling, and parse the entered IST string
  // back to a UTC instant on submit. Otherwise HR sees UTC times and a
  // server in UTC re-interprets the entered value, producing day-old
  // garbage on the regularization row.
  const utcToIstInput = (instant: Date | string): string => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(typeof instant === "string" ? new Date(instant) : instant);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
    // formatToParts can emit "24" for midnight on some engines — normalize.
    const hh = get("hour") === "24" ? "00" : get("hour");
    return `${get("year")}-${get("month")}-${get("day")}T${hh}:${get("minute")}`;
  };
  const istInputToUtcIso = (val: string): string => {
    // val is "YYYY-MM-DDTHH:mm" interpreted as IST (+05:30). Append the
    // offset so Date parses unambiguously regardless of the runtime TZ.
    if (!val) return "";
    return new Date(`${val}:00+05:30`).toISOString();
  };

  const openRegFor = (rec: any) => {
    const dateOnly = String(rec.date).slice(0, 10);
    setRegForm({
      date: dateOnly,
      requestedIn:  rec.clockIn  ? utcToIstInput(rec.clockIn)  : `${dateOnly}T09:00`,
      requestedOut: rec.clockOut ? utcToIstInput(rec.clockOut) : `${dateOnly}T18:00`,
      reason: "",
    });
    setRegOpen(true);
  };

  const submitReg = async () => {
    if (!regForm.reason.trim()) { alert("Reason is required."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/hr/attendance/regularize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: regForm.date,
          requestedIn:  regForm.requestedIn  ? istInputToUtcIso(regForm.requestedIn)  : null,
          requestedOut: regForm.requestedOut ? istInputToUtcIso(regForm.requestedOut) : null,
          reason: regForm.reason.trim(),
          userId,
          forceGrant: true,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Regularize failed.");
        return;
      }
      setRegOpen(false);
      mutate(url);
      mutate(regsUrl);
      mutate(wfhUrl);
      mutate(leavesUrl);
    } finally {
      setSubmitting(false);
    }
  };

  // ── ME-tab-style top summary widgets ─────────────────────────────────
  // Computed from the `records` we already fetched so we don't need any
  // new API calls. Avg hours and on-time arrival % cover the last 7
  // calendar days. The Mon→Sun pills show this week with the worked
  // days coloured by status.
  const istToday = (() => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  })();
  // Clamp the 7-day window to the employee's joining date so a brand-new
  // joiner doesn't get diluted to 0% on-time by 6 pre-employment days.
  const joinedIso = joinedAt ? joinedAt.toISOString().slice(0, 10) : null;
  const last7 = (() => {
    const out: string[] = [];
    const base = new Date(istToday + "T00:00:00Z");
    for (let i = 0; i < 7; i++) {
      const d = new Date(base); d.setUTCDate(d.getUTCDate() - i);
      const iso = d.toISOString().slice(0, 10);
      if (joinedIso && iso < joinedIso) continue;
      out.push(iso);
    }
    return out;
  })();
  const last7Records = records.filter((r) => last7.includes(String(r.date).slice(0, 10)));
  // Roll today's LIVE minutes into the 7-day total — the stored
  // totalMinutes is stale for an ongoing session.
  const minsFor = (r: any) => {
    const base = r.totalMinutes || 0;
    if (String(r.date).slice(0, 10) !== istToday) return base;
    const sess = Array.isArray(r.sessions) ? r.sessions : [];
    const open = sess.find((s: any) => !s.clockOut);
    return open
      ? base + Math.max(0, Math.floor((now.getTime() - new Date(open.clockIn).getTime()) / 60000))
      : base;
  };
  const workedMins7  = last7Records.reduce((s, r) => s + minsFor(r), 0);
  const workedDays7  = last7Records.filter((r) => minsFor(r) > 0).length;
  const avgMins      = workedDays7 > 0 ? Math.round(workedMins7 / workedDays7) : 0;
  // On-time = clock-in <= 10:00 IST. Same rule as the daily summary email.
  const onTime7 = last7Records.filter((r) => {
    if (!r.clockIn) return false;
    const ist = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(r.clockIn));
    const [h, m] = ist.split(":").map(Number);
    return h * 60 + m <= 10 * 60;
  }).length;
  const onTimePct = workedDays7 > 0 ? Math.round((onTime7 / workedDays7) * 100) : 0;

  // Mon → Sun this week
  const weekPills = (() => {
    const base = new Date(istToday + "T00:00:00Z");
    const dow = (base.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
    const monday = new Date(base); monday.setUTCDate(monday.getUTCDate() - dow);
    const labels = ["M", "T", "W", "T", "F", "S", "S"];
    return labels.map((lbl, i) => {
      const d = new Date(monday); d.setUTCDate(d.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const rec = records.find((r) => String(r.date).slice(0, 10) === iso);
      const isToday = iso === istToday;
      const status: "today" | "present" | "absent" | "off" | "future" =
        isToday ? "today" :
        iso > istToday ? "future" :
        (i >= 5) ? "off" :  // Sat/Sun
        rec?.clockIn ? "present" : "absent";
      return { lbl, status };
    });
  })();
  const pillColor = (s: string) =>
    s === "today"   ? "bg-[#008CFF] text-white" :
    s === "present" ? "bg-emerald-100 text-emerald-700" :
    s === "absent"  ? "bg-rose-100 text-rose-600" :
    s === "off"     ? "bg-slate-100 text-slate-500" :
                      "bg-slate-50 text-slate-400";

  return (
    <section>
      {/* ── Top summary row — Stats · Timings · Actions ───────────── */}
      {(() => {
        // Today's record + LIVE minute count for ongoing sessions.
        // Mirrors the per-row table logic so the cards stay in sync
        // with the "Today" row below.
        const todayRec = records.find((r) => String(r.date).slice(0, 10) === istToday);
        const todaySessions = Array.isArray(todayRec?.sessions) ? todayRec!.sessions as any[] : [];
        const openSess = todaySessions.find((s) => !s.clockOut);
        const baseTodayMins = todayRec?.totalMinutes ?? 0;
        const liveTodayMins = openSess
          ? baseTodayMins + Math.max(0, Math.floor((now.getTime() - new Date(openSess.clockIn).getTime()) / 60000))
          : baseTodayMins;
        const fmtIstHM = (instant: any) => instant
          ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(instant))
          : null;
        const effMins   = liveTodayMins;
        const grossMins = liveTodayMins; // gross == effective for now (no break tracking)
        const todayIn   = fmtIstHM(todayRec?.clockIn);
        const todayOut  = fmtIstHM(todayRec?.clockOut);
        // 9 AM → 6 PM standard workday → progress bar fill % based on
        // worked minutes vs 9h target.
        const workdayMins = 9 * 60;
        const progressPct = Math.min(100, Math.round((effMins / workdayMins) * 100));
        return (
          <div className="mb-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* ── Attendance Stats ── */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[13px] font-semibold text-slate-800">Attendance Stats</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Last 7 Days</p>
              <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-x-3 items-end pb-2 border-b border-slate-100">
                <span />
                <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Avg Hrs/Day</span>
                <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 text-right">On Time</span>
              </div>
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center py-3 border-b border-slate-100">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 text-[10px] font-bold">
                    {userName?.split(" ").map((p: string) => p[0]).join("").slice(0,2).toUpperCase()}
                  </span>
                  <span className="text-[12.5px] font-semibold text-slate-700">{isSelfView ? "Me" : userName}</span>
                </span>
                <span className="text-[13px] font-bold tabular-nums text-slate-800">{fmtMins(avgMins)}</span>
                <span className="text-[13px] font-bold tabular-nums text-slate-800 text-right">{onTimePct}%</span>
              </div>
            </div>

            {/* ── Timings ── */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[13px] font-semibold text-slate-800">Timings</p>
              <div className="mt-3 flex items-center justify-between gap-1">
                {weekPills.map((p, i) => (
                  <span key={i} className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${pillColor(p.status)}`}>
                    {p.lbl}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-[11.5px] text-slate-500">Today (9:00 AM – 6:00 PM)</p>
              <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-[#008CFF] rounded-full transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-slate-500">
                <span>Duration: <strong className="text-slate-700">{fmtMins(effMins)}</strong></span>
                <span>{todayRec?.clockIn ? `In: ${todayIn}${todayOut ? ` · Out: ${todayOut}` : ""}` : "not clocked in"}</span>
              </div>
            </div>

            {/* ── Actions ── */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[13px] font-semibold text-slate-800">Actions</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {today.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-3 text-[11px] text-slate-500">
                <span>Effective: <strong className="text-slate-800">{fmtMins(effMins)}</strong></span>
                <span>Gross: <strong className="text-slate-800">{fmtMins(grossMins)}</strong></span>
              </div>
              {(isHRAdmin || isSelfView) && (
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {canApplyWfh && (
                    <button onClick={() => { setLeaveOpen(true); setLeaveModalTab("wfh"); }} className="inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-[#008CFF] hover:underline justify-start">
                      <Home size={12} /> Work From Home
                    </button>
                  )}
                  <button onClick={() => setOdOpen(true)} className="inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-[#008CFF] hover:underline justify-start">
                    <Briefcase size={12} /> On Duty
                  </button>
                  <button onClick={() => setRegOpen(true)} className="inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-[#008CFF] hover:underline justify-start">
                    <ShieldCheck size={12} /> Regularization
                  </button>
                  <button onClick={() => { setLeaveOpen(true); setLeaveModalTab("leave"); }} className="inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-[#008CFF] hover:underline justify-start">
                    <Coffee size={12} /> Apply Leave
                  </button>
                </div>
              )}
              {/* On-behalf clock-out — visible ONLY to Gagan's developer
                  account, and only while the user has an open session today
                  (clocked in, not yet out). Server re-checks the identity. */}
              {viewerIsGaganDev && openSess && (
                <button
                  onClick={handleClockOutOnBehalf}
                  disabled={clockingOut}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[12px] font-semibold text-rose-600 hover:bg-rose-100 disabled:opacity-50"
                >
                  <LogOut size={12} /> {clockingOut ? "Clocking out…" : "Clock Out (dev)"}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Logs & Requests sub-tabs (visual parity with the ME tab) ──
          Hidden entirely when the target user is CEO / developer —
          their schedules are flexible and the per-day log doesn't
          represent anything meaningful. The modals below the table
          stay rendered so HR's on-behalf actions still work. */}
      {!skipAbsentSynthesis && (
      <>
      <div className="mb-3 flex items-center justify-between border-b border-slate-100 px-1">
        <p className="text-[13px] font-semibold text-slate-800">Logs &amp; Requests</p>
      </div>

      {/* Period bar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <h3 className="text-[14px] font-semibold text-slate-800">{periodLabel}</h3>
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
          {periodButtons.map((b) => (
            <button
              key={b.key}
              onClick={() => setPeriod(b.key)}
              className={`h-7 rounded px-3 text-[10.5px] font-bold uppercase tracking-wider transition ${
                period === b.key
                  ? "bg-[#008CFF] text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* Attendance table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="w-[150px] px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#0f6ecd]">Date</th>
              <th className="w-[280px] px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#0f6ecd]">Attendance Visual</th>
              <th className="w-[120px] px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#0f6ecd]">Effective Hours</th>
              <th className="w-[110px] px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#0f6ecd]">Gross Hours</th>
              <th className="w-[60px] px-5 py-3 text-center text-[10px] font-bold uppercase tracking-wider text-[#0f6ecd]">Log</th>
              {(isHRAdmin || canSelfApply) ? <th className="w-[40px] px-3 py-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={(isHRAdmin || canSelfApply) ? 6 : 5} className="px-4 py-10 text-center text-[12px] text-slate-400">Loading…</td></tr>
            ) : fullSeries.length === 0 ? (
              <tr><td colSpan={(isHRAdmin || canSelfApply) ? 6 : 5} className="px-4 py-10 text-center text-[12px] text-slate-400">No attendance for this period.</td></tr>
            ) : fullSeries.map((rec) => {
              const dateOnly = String(rec.date).slice(0, 10);
              const dt = new Date(rec.date);
              const dateLabel = dt.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
              const isToday   = dateOnly === today.toISOString().slice(0, 10);
              const isWeekend = rec.status === "weekly_off";
              const isHoliday = rec.status === "holiday";
              const isPresent = rec.status === "present" || rec.status === "late" || rec.status === "half_day";
              // LOP penalties from the auto-LOP job — surfaced so HR (and the
              // employee) can see the day was docked. full = absence, half =
              // unregularized missed clock-out.
              const isFullLop    = rec.status === "lop";
              const isHalfDayLop = rec.status === "half_day_lop";
              const isLop        = isFullLop || isHalfDayLop;

              const reg   = regByDate.get(dateOnly);
              const wfh   = wfhByDate.get(dateOnly);
              const leave = findLeaveForDate(dateOnly);

              const isRegPending  = reg && (reg.status === "pending" || reg.status === "partially_approved");
              const isRegApproved = reg && reg.status === "approved";
              const isWfhPending  = wfh && (wfh.status === "pending" || wfh.status === "partially_approved");
              const isWfhApproved = wfh && wfh.status === "approved";
              const isLeavePending  = leave && (leave.status === "pending" || leave.status === "partially_approved");
              const isLeaveApproved = leave && leave.status === "approved";
              const leaveTypeName = leave?.leaveType?.name || (rec.status === "on_leave" ? "Leave" : null);
              // Half-day markers ([First/Second Half]) on the leave / WFH requests.
              const leaveHalfDir: "first" | "second" | null =
                leave ? (/\[first\s+half\]/i.test(leave.reason ?? "") ? "first" : /\[second\s+half\]/i.test(leave.reason ?? "") ? "second" : null) : null;
              const wfhHalfDir: "first" | "second" | null =
                wfh ? (/\[first\s+half\]/i.test(wfh.reason ?? "") ? "first" : /\[second\s+half\]/i.test(wfh.reason ?? "") ? "second" : null) : null;
              // A FULL-day leave renders as the centered "On <X> Leave" banner and
              // hides the timeline. A HALF-day leave does NOT — the employee works
              // the other half, so keep the timeline and show BOTH segments.
              const isLeaveRow = (rec.status === "on_leave" || isLeaveApproved) && !leaveHalfDir;
              // Both-segment label for a split day (half-day leave and/or half WFH):
              // each half is the leave type / WFH / (expected) Office.
              // A day can carry TWO half-day leaves (e.g. 1st-half Sick +
              // 2nd-half LWP), so check ALL leaves covering the date — not
              // just the single "best" row (2026-07-29).
              const halfLeaveFor = (which: "first" | "second") =>
                userLeaves.find((l: any) => {
                  if (l.status === "rejected" || l.status === "cancelled") return false;
                  const from = String(l.fromDate).slice(0, 10);
                  const to   = String(l.toDate).slice(0, 10);
                  if (!(dateOnly >= from && dateOnly <= to)) return false;
                  const re = which === "first" ? /\[first\s+half\]/i : /\[second\s+half\]/i;
                  return re.test(l.reason ?? "");
                });
              const halfKind = (which: "first" | "second"): string => {
                const lv = halfLeaveFor(which);
                if (lv) return lv.leaveType?.name || "Leave";
                if (wfhHalfDir === which) return "WFH";
                return "Office";
              };
              const isSplitDay = !!(leaveHalfDir || wfhHalfDir);
              const splitLabel = isSplitDay ? `1st Half ${halfKind("first")} · 2nd Half ${halfKind("second")}` : null;
              // An APPROVED PAID half-day leave pays the non-worked half, so a
              // `half_day` attendance row is a fully-paid day — payroll's
              // half-day excuse (generate route) skips the 0.5 LOP. Drives the
              // softer ½-day chips below so the employee isn't shown a pay-cut
              // warning for a day that costs them nothing.
              const paidHalfLeaveApproved = (["first", "second"] as const).some((h) => {
                const lv = halfLeaveFor(h);
                return !!lv && lv.status === "approved" && lv.leaveType?.isPaid !== false;
              });

              // Admins can regularize any past/today row that doesn't already
              // have a regularization in flight — including leave days (employee
              // actually showed up while on leave) and weekends/holidays
              // (worked on a day off). Future dates are skipped.
              const isFuture = dateOnly > today.toISOString().slice(0, 10);
              const canRegularize = isHRAdmin && !isRegPending && !isFuture;

              // Row background tinting per status — matches the Keka light theme.
              const rowBg =
                isToday      ? "bg-sky-50/50"
                : isLeaveRow ? "bg-violet-50/40"
                : isWeekend  ? "bg-slate-100/60"
                : isHoliday  ? "bg-amber-50/40"
                : "bg-white hover:bg-slate-50/60";

              // Today's row keeps ticking live for as long as a session
              // is open. Without this, after clocking back in from a
              // break the row would freeze at the closed-session sum
              // (what Attendance.totalMinutes stores). Mirrors the
              // attendance-page elapsed math: stored total + elapsed
              // since the currently-open session's clockIn.
              const sess = (rec.sessions ?? []) as Array<{ clockIn: string; clockOut: string | null }>;
              const openSess = sess.find((s) => !s.clockOut);
              const baseMin = rec.totalMinutes ?? 0;
              const liveMin = isToday && openSess
                ? baseMin + Math.max(0, Math.floor((now.getTime() - new Date(openSess.clockIn).getTime()) / 60000))
                : baseMin;
              const totalMin = liveMin;
              const effectiveDot = totalMin >= 480 ? "bg-emerald-500" : totalMin >= 240 ? "bg-amber-500" : totalMin > 0 ? "bg-red-500" : "bg-slate-300";

              // ── Status-tag flags (Late / Missed / On break) ──
              // Mirrors the Me-section row badges (in /dashboard/hr/attendance)
              // so HR sees the same context here when they open someone's
              // profile. Suppressed when a pending request covers the day —
              // matches the Me-section's `!hasPendingAny` guard so a pending
              // regularization / WFH / leave hides the harsher "Late" or
              // "Missed" label until the request is decided.
              const hasPendingAny = !!(isRegPending || isWfhPending || isLeavePending);
              const firstIn = sess[0]?.clockIn
                ? new Date(sess[0].clockIn)
                : (rec.clockIn ? new Date(rec.clockIn) : null);
              const isLateFirstIn = !!firstIn && (() => {
                // Late = first clock-in past the SHIFT-SPECIFIC
                // cutoff (shift.startTime + breakMinutes grace).
                // Falls back to 10:00 IST + 0 grace when the
                // employee has no shift assigned (matches clock-in
                // route's legacy rule). UTC + 5:30 → IST minutes-of-
                // day; don't use getHours() — that's the SERVER's
                // local TZ and would skew the cutoff.
                const totalUtcMin = firstIn.getUTCHours() * 60 + firstIn.getUTCMinutes();
                const istMin      = (totalUtcMin + 330) % (24 * 60);
                const [sh, sm]    = shiftStartTime
                  ? String(shiftStartTime).split(":").map((n: string) => Number(n) || 0)
                  : [10, 0];
                const grace       = Number.isFinite(shiftBreakMinutes) ? Number(shiftBreakMinutes) : (shiftStartTime ? 15 : 0);
                // First-half leave/WFH → the employee is only expected from
                // the shift MID-POINT, so judge lateness from there (matches
                // the clock-in route's isFirstHalfOff rule). Pending requests
                // count too — same as the server.
                const firstHalfOff =
                  (leaveHalfDir === "first" && (isLeaveApproved || isLeavePending || rec.status === "on_leave")) ||
                  (wfhHalfDir === "first" && (isWfhApproved || isWfhPending));
                const startMin = sh * 60 + sm;
                let cutoffMin = startMin + grace;
                if (firstHalfOff && shiftEndTime) {
                  const [eh, em] = String(shiftEndTime).split(":").map((n: string) => Number(n) || 0);
                  cutoffMin = Math.round((startMin + eh * 60 + em) / 2) + grace;
                }
                return istMin > cutoffMin;
              })();
              const missedClockOut = !!rec.clockIn && !rec.clockOut && !isToday && !rec.isRegularized && !isLeaveRow;
              // "On break" — today, clocked out, but the day's full bar (per the
              // employee's SHIFT, Saturday-aware) is NOT yet met, so they've
              // likely just stepped out and can resume. Keyed off the server's
              // shift-derived status (present / late = the full day is done)
              // instead of a hardcoded 9h, so a completed SHORT Saturday (e.g.
              // a 6h shift finished at 6h) is never shown "on break".
              const dayComplete = rec.status === "present" || rec.status === "late";
              const isOnBreak = isToday && !openSess && sess.some((s) => s.clockOut) && !rec.isRegularized && !dayComplete;

              return (
                <tr key={rec.id} className={`border-b border-slate-100 transition-colors ${rowBg}`}>
                  {/* Date + badges */}
                  <td className="px-5 py-3 align-middle">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12.5px] font-medium text-slate-800">{dateLabel}</p>
                      {isToday        ? <span className="inline-flex items-center rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-700">Today</span> : null}
                      {isLeaveRow     ? <span className="inline-flex items-center rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-700">Leave</span> : null}
                      {isWeekend      ? <span className="inline-flex items-center rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">W-Off</span> : null}
                      {isHoliday      ? <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">Holiday</span> : null}
                      {isWfhApproved && !isLeaveRow ? <span className="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-700">WFH</span> : null}
                      {/* Request in flight (regularization / WFH / leave) —
                          same chip the employee sees on their own attendance
                          page, so HR knows the day is awaiting a decision
                          (the split-day summary below shows even while
                          pending, which used to read as already-approved). */}
                      {hasPendingAny ? <span className="inline-flex items-center rounded bg-[#008CFF]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#008CFF]">Pending</span> : null}
                      {/* New tags (matches Me-section) */}
                      {/* Waived (isRegularized via the audited LOP-waive flow) →
                          the penalty no longer charges in payroll, so don't show
                          the red LOP chip for it — show a calm "LOP waived". */}
                      {isLop && !rec.isRegularized ? <span className="inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-700">{isHalfDayLop ? "½ Day LOP" : "LOP"}</span> : null}
                      {isLop && rec.isRegularized ? <span title="Penalty waived — this day is fully paid" className="inline-flex items-center rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-700">LOP waived</span> : null}
                      {/* Under-9h day that clocked out but wasn't regularised —
                          payroll counts it as ½ day (0.5 LOP). Surface it loudly
                          so HR doesn't mistake the "completed punch" ✓ for a full
                          day. Suppressed while a request is pending / for today. */}
                      {/* ALL factual tags show together (2026-07-29) —
                          pending requests never hide them; only an approved
                          regularization (isRegularized) clears the day. */}
                      {rec.status === "half_day" && !isToday ? (
                        paidHalfLeaveApproved
                          ? <span title="Worked a half day — the other half is an approved paid half-day leave, so the day is fully paid" className="inline-flex items-center rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-700">½ Half day</span>
                          : <span title="Worked under 9h — counts as ½ day (0.5 LOP) in payroll unless regularized" className="inline-flex items-center gap-0.5 rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-700"><AlertCircle size={10} strokeWidth={2.5} /> ½ Half day</span>
                      ) : null}
                      {/* Unresolved missed clock-out: payroll now REPRICES these
                          at generate time (0.5 day) even if the auto-LOP job
                          never converted the status — say so on the chip, so
                          the badge and the payslip can't tell different
                          stories. Rows auto-LOP already converted carry the
                          ½ Day LOP chip above instead — keep those as plain
                          "Missed" to avoid double-charging language. */}
                      {missedClockOut ? (
                        rec.status === "missed_clock_out"
                          ? <span title="Missed clock-out — payroll charges ½ day unless the day is regularized, waived, or covered by an approved request" className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700"><AlertCircle size={10} strokeWidth={2.5} /> Missed · ½ day</span>
                          : <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">Missed</span>
                      ) : null}
                      {isLateFirstIn && !!rec.clockIn && !rec.isRegularized && !isLeaveRow ? <span className="inline-flex items-center rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-700">Late</span> : null}
                      {isOnBreak ? <span className="inline-flex items-center rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-700">On break</span> : null}
                    </div>
                    {/* Split-day summary so HR + the employee can see BOTH halves
                        at a glance (e.g. 1st Half Sick Leave · 2nd Half WFH). */}
                    {splitLabel && (
                      <p className="mt-1 text-[10.5px] font-semibold text-violet-600">{splitLabel}</p>
                    )}
                  </td>

                  {/* Attendance Visual / centered text — used for all "no real
                      punches" cases (leave / w-off / holiday / pending requests
                      / regularization). Reads cleaner than a striped bar. */}
                  {(() => {
                    // "Has actual punches" means there's at least a real
                    // clock-in on the row. An open session (clockOut still
                    // null) is real data — the live timeline + counter
                    // still tell the user what's been worked so far. The
                    // old `clockIn && clockOut` rule treated today's open
                    // session as "no data" and hid the timeline behind a
                    // centered "Regularization Pending" banner, which made
                    // the row look like attendance was missing.
                    const hasActualPunches = !!rec.clockIn;
                    const isRegOnly = !hasActualPunches && (isRegPending || isRegApproved);
                    const showCentered = isWeekend || isLeaveRow || isHoliday
                      || (isLeavePending && !isPresent)
                      || (isWfhPending && !isPresent && !isWfhApproved)
                      || isRegOnly
                      // Split day (half leave / half WFH) with no punches yet →
                      // show the both-segment label instead of an empty bar.
                      || (isSplitDay && !hasActualPunches)
                      // LOP rows WITHOUT punches show the centered LOP banner.
                      // Punched LOP days (missed clock-out / short WFH) fall
                      // through to the normal bar row (2026-07-28) so HR sees
                      // the same punch evidence as the employee view — the
                      // status icon still carries the LOP label.
                      || (isLop && !isRegApproved && !hasActualPunches);
                    if (!showCentered) return null;
                    const fmt = (d: string | Date | null | undefined) => d
                      ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
                      : null;
                    const regWindow = reg?.requestedIn && reg?.requestedOut
                      ? `${fmt(reg.requestedIn)} → ${fmt(reg.requestedOut)}`
                      : null;
                    const label = isSplitDay
                      ? splitLabel
                      : isLeaveRow
                      ? `On ${leaveTypeName || "Leave"}${leave?.totalDays && leave.totalDays > 1 ? ` (${leave.totalDays} days)` : ""}`
                      : isLeavePending  ? `Leave Pending — ${leave?.leaveType?.name || "Leave"}`
                      : isWfhPending    ? "WFH Pending Approval"
                      : isWeekend       ? "Full day Weekly-off"
                      : isHoliday       ? (rec.notes || "Public Holiday")
                      : isHalfDayLop    ? "Half-day LOP — missed clock-out not regularized in time"
                      : isFullLop       ? "Full-day LOP — absent, no attendance logged"
                      : isRegPending    ? `Regularization Pending${regWindow ? ` · ${regWindow}` : ""}`
                      : isRegApproved   ? `Regularized${regWindow ? ` · ${regWindow}` : ""}`
                      : "";
                    const tone =
                      isLop                                          ? "text-red-600"
                      : isLeavePending || isWfhPending || isRegPending ? "text-amber-700"
                      : isLeaveRow                                    ? "text-violet-700"
                      : isRegApproved                                 ? "text-emerald-700"
                      : isHoliday                                     ? "text-amber-700"
                      :                                                 "text-slate-500";
                    return (
                      <td className="px-5 py-3 text-center align-middle" colSpan={3}>
                        <span className={`text-[12.5px] font-medium ${tone}`}>{label}</span>
                      </td>
                    );
                  })() || (
                    <>
                      <td className="px-5 py-3 align-middle">
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            {/* If actual punches are missing but a regularization
                                is in flight or approved, draw the bar from the
                                regularization's requested times instead — so the
                                row visualises what attendance would look like once
                                approved. Tone changes color: amber-striped while
                                pending, emerald when approved, sky when actual. */}
                            {(() => {
                              // Prefer the real clock-in whenever it exists
                              // (open session counts). Only fall back to the
                              // regularization's requested times when there
                              // are no real punches at all — matches the
                              // hasActualPunches check above so the centered
                              // banner and the bar agree on what to draw.
                              const hasActual = !!rec.clockIn;
                              const useReg = !hasActual && reg && (reg.requestedIn || reg.requestedOut);
                              const barIn  = useReg ? reg.requestedIn  : rec.clockIn;
                              // Parent clockOut is NULL on missed-clock-out days
                              // even when earlier sessions closed properly (e.g.
                              // a double-scan ghost) — fill the bar to the last
                              // CLOSED session so the worked span stays visible.
                              const lastClosedOut = (sess ?? []).filter((s: any) => s.clockOut).slice(-1)[0]?.clockOut ?? null;
                              const barOut = useReg ? reg.requestedOut : (rec.clockOut ?? lastClosedOut);
                              const barTone: BarTone = useReg
                                ? (isRegPending ? "pending" : isRegApproved ? "approved" : "default")
                                : "default";
                              return <TimelineBar clockIn={barIn} clockOut={barOut} tone={barTone} sessions={hasActual ? sess : undefined} isTodayRow={isToday} doorEntries={(rec as any).doorEntries} />;
                            })()}
                          </div>
                          <LocationLink raw={rec.location} />
                        </div>
                      </td>
                      <td className="px-5 py-3 align-middle">
                        {(() => {
                          // Compute regularization-based hours when actual punches are missing.
                          const hasActual = !!rec.clockIn;
                          let mins = totalMin;
                          if (!hasActual && reg && reg.requestedIn && reg.requestedOut) {
                            mins = Math.max(0, Math.round((new Date(reg.requestedOut).getTime() - new Date(reg.requestedIn).getTime()) / 60000));
                          }
                          const dot = isRegPending  ? "bg-amber-500" :
                                      isRegApproved ? "bg-emerald-500" :
                                      mins >= 480 ? "bg-emerald-500" : mins >= 240 ? "bg-amber-500" : mins > 0 ? "bg-red-500" : "bg-slate-300";
                          // Also show hours whenever REAL completed punches
                          // exist (e.g. a split-leave day whose status became
                          // on_leave after approval — the worked half's hours
                          // must not vanish to a dash).
                          if (isPresent || (hasActual && !!rec.clockOut && mins > 0) || (reg && (isRegPending || isRegApproved))) {
                            return (
                              <div className="flex items-center gap-2">
                                <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
                                <span className={`text-[12.5px] ${isRegPending ? "italic text-amber-700" : "text-slate-700"}`}>
                                  {fmtMins(mins) || "0h 0m"}{rec.status === "half_day" ? " +" : ""}
                                </span>
                              </div>
                            );
                          }
                          // Clocked in but never clocked out (status didn't flip to
                          // present/late/half_day). Surface "Incomplete" instead of
                          // a silent dash so HR can see the row needs attention.
                          if (hasActual && !rec.clockOut) {
                            return (
                              <span
                                className="text-[12.5px] italic text-amber-700"
                                title="Clocked in but no clock-out recorded — counts as ½ day in payroll unless regularized or waived"
                              >
                                Incomplete
                              </span>
                            );
                          }
                          return <span className="text-[12.5px] text-slate-400">—</span>;
                        })()}
                      </td>
                      <td className="px-5 py-3 align-middle">
                        {(() => {
                          const hasActual = !!rec.clockIn;
                          let mins = totalMin;
                          if (!hasActual && reg && reg.requestedIn && reg.requestedOut) {
                            mins = Math.max(0, Math.round((new Date(reg.requestedOut).getTime() - new Date(reg.requestedIn).getTime()) / 60000));
                          }
                          // Mirror the Effective cell: real completed punches
                          // always surface their hours (split-leave days).
                          if (isPresent || (hasActual && !!rec.clockOut && mins > 0) || (reg && (isRegPending || isRegApproved))) {
                            return (
                              <span className={`text-[12.5px] ${isRegPending ? "italic text-amber-700" : "text-slate-700"}`}>
                                {fmtMins(mins) || "0h 0m"}
                              </span>
                            );
                          }
                          if (hasActual && !rec.clockOut) {
                            return (
                              <span
                                className="text-[12.5px] italic text-amber-700"
                                title="Clocked in but no clock-out recorded"
                              >
                                Incomplete
                              </span>
                            );
                          }
                          return <span className="text-[12.5px] text-slate-400">—</span>;
                        })()}
                      </td>
                    </>
                  )}

                  {/* Log status — pending requests take priority over the attendance icon */}
                  <td className="px-5 py-3 text-center align-middle">
                    {isLeavePending ? (
                      <span
                        title="Leave application pending approval"
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Leave
                      </span>
                    ) : isWfhPending ? (
                      <span
                        title="WFH request pending approval"
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        WFH
                      </span>
                    ) : isRegPending ? (
                      <span
                        title={reg.status === "partially_approved" ? "Partially approved — awaiting final approver" : "Regularization pending approval"}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Reg.
                      </span>
                    ) : isLeaveRow ? (
                      <span
                        title={`On ${leaveTypeName || "Leave"}`}
                        className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700 ring-1 ring-inset ring-violet-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                        Leave
                      </span>
                    ) : isWfhApproved ? (
                      <span
                        title="Approved Work From Home"
                        className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700 ring-1 ring-inset ring-blue-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                        WFH
                      </span>
                    ) : isRegApproved ? (
                      <span
                        title="Regularization approved"
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 ring-1 ring-inset ring-emerald-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Reg.
                      </span>
                    ) : rec.status === "half_day" && !isToday && paidHalfLeaveApproved ? (
                      // Half worked + approved paid half-day leave = fully paid
                      // day (payroll's half-day excuse skips the 0.5 LOP). Show
                      // a calm violet chip, not the orange pay-cut warning —
                      // nothing here needs regularizing.
                      <span
                        title="Half day worked — the other half is an approved paid half-day leave, so the day is fully paid"
                        className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700 ring-1 ring-inset ring-violet-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                        ½ Day
                      </span>
                    ) : rec.status === "half_day" && !isToday ? (
                      // Clocked out under 9h and not regularised → payroll docks
                      // 0.5 LOP. Show an amber "½ Day" flag instead of the same
                      // green ✓ a full day gets, so HR spots it at a glance. For
                      // admins it doubles as a one-click regularize affordance.
                      isHRAdmin ? (
                        <button
                          type="button"
                          onClick={() => openRegFor(rec)}
                          title="Worked under 9h — counts as ½ day (0.5 LOP) in payroll. Click to regularize."
                          aria-label="Half day — regularize this day"
                          className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-700 ring-1 ring-inset ring-orange-200 shadow-[0_1px_2px_rgba(245,158,11,0.18)] transition hover:bg-orange-100 hover:ring-orange-300"
                        >
                          <AlertCircle className="h-3.5 w-3.5" strokeWidth={2.5} />
                          ½ Day
                        </button>
                      ) : (
                        <span
                          title="Worked under 9h — counts as ½ day (0.5 LOP) in payroll unless regularized"
                          className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-700 ring-1 ring-inset ring-orange-200"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                          ½ Day
                        </span>
                      )
                    ) : isPresent ? (
                      <span
                        title="Clock-in completed"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-200 shadow-[0_1px_2px_rgba(16,185,129,0.18)]"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      </span>
                    ) : isToday && !rec.clockIn ? (
                      <span
                        title="Not clocked in yet"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200 shadow-[0_1px_2px_rgba(245,158,11,0.18)]"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      </span>
                    ) : isLop ? (
                      <span
                        title={isHalfDayLop ? "Half-day LOP — missed clock-out not regularized in time" : "Full-day LOP — absent, no attendance logged"}
                        className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700 ring-1 ring-inset ring-red-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                        {isHalfDayLop ? "½ LOP" : "LOP"}
                      </span>
                    ) : rec.status === "absent" ? (
                      // Absent day → render a "Regularize" affordance instead
                      // of a passive cross. HR admins open the on-behalf
                      // modal; the profile owner is deep-linked into
                      // /dashboard/hr/attendance with the date pre-filled
                      // so they can self-apply. Anyone else (rare: an HR
                      // viewer who's not an admin) still sees the icon but
                      // it's non-interactive.
                      isHRAdmin ? (
                        <button
                          type="button"
                          onClick={() => openRegFor(rec)}
                          title="Regularize this day"
                          aria-label="Regularize this day"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200 shadow-[0_1px_2px_rgba(245,158,11,0.18)] transition hover:bg-amber-100 hover:ring-amber-300"
                        >
                          <ShieldCheck className="h-4 w-4" strokeWidth={2.25} />
                        </button>
                      ) : isSelfView ? (
                        <Link
                          href={`/dashboard/hr/attendance?apply=regularize&date=${dateOnly}`}
                          title="Regularize this day"
                          aria-label="Regularize this day"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200 shadow-[0_1px_2px_rgba(245,158,11,0.18)] transition hover:bg-amber-100 hover:ring-amber-300"
                        >
                          <ShieldCheck className="h-4 w-4" strokeWidth={2.25} />
                        </Link>
                      ) : (
                        <span
                          title="Absent — ask HR to regularize"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-500 ring-1 ring-inset ring-amber-200"
                        >
                          <ShieldCheck className="h-4 w-4" strokeWidth={2.25} />
                        </span>
                      )
                    ) : null}
                  </td>

                  {/* Admin kebab — 3-dot menu opens an on-behalf action picker:
                      Regularization (existing modal), WFH (new modal), Leave (new modal).
                      data-hr-menu lets the outside-click closer skip clicks on these
                      elements so option onClick handlers actually fire. */}
                  {isHRAdmin ? (
                    <td className="px-3 py-3 text-right align-middle relative">
                      {canRegularize ? (
                        <>
                          <button
                            type="button"
                            data-hr-menu
                            onClick={(e) => {
                              if (menuOpenKey === dateOnly) { setMenuOpenKey(null); return; }
                              setMenuRect(e.currentTarget.getBoundingClientRect());
                              setMenuOpenKey(dateOnly);
                            }}
                            title="HR actions"
                            aria-label="Open HR actions menu"
                            className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-sky-50 hover:text-sky-600"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {menuOpenKey === dateOnly && menuRect && typeof document !== "undefined" ? createPortal(
                            <div
                              data-hr-menu
                              className="fixed z-[100] min-w-[160px] rounded-md border border-slate-200 bg-white shadow-lg text-left text-[12.5px]"
                              style={(() => {
                                const vh = typeof window !== "undefined" ? window.innerHeight : 800;
                                const left = Math.max(8, menuRect.right - 160);
                                // Flip up when the button sits low in the viewport
                                // so the menu never spills below the fold.
                                return menuRect.bottom > vh * 0.65
                                  ? { bottom: vh - menuRect.top + 4, left }
                                  : { top: menuRect.bottom + 4, left };
                              })()}
                            >
                              <button
                                type="button"
                                onClick={() => { setMenuOpenKey(null); openRegFor(rec); }}
                                className="block w-full px-3 py-2 text-slate-700 hover:bg-sky-50 hover:text-sky-700"
                              >
                                Regularization
                              </button>
                              <button
                                type="button"
                                onClick={() => openWfhFor(rec)}
                                className="block w-full px-3 py-2 text-slate-700 hover:bg-sky-50 hover:text-sky-700 border-t border-slate-100"
                              >
                                WFH
                              </button>
                              <button
                                type="button"
                                onClick={() => openOdFor(rec)}
                                className="block w-full px-3 py-2 text-slate-700 hover:bg-sky-50 hover:text-sky-700 border-t border-slate-100"
                              >
                                On Duty
                              </button>
                              <button
                                type="button"
                                onClick={() => openLeaveFor(rec)}
                                className="block w-full px-3 py-2 text-slate-700 hover:bg-sky-50 hover:text-sky-700 border-t border-slate-100"
                              >
                                Leave
                              </button>
                            </div>,
                            document.body,
                          ) : null}
                        </>
                      ) : null}
                    </td>
                  ) : canSelfApply ? (
                    /* Self 3-dot menu — the employee applies their OWN request
                       for this day (regularize / WFH / on-duty / leave). Opens
                       the user's own apply form via onSelfApply — NOT an
                       on-behalf action, and never any HR power. */
                    <td className="px-3 py-3 text-right align-middle relative">
                      <button
                        type="button"
                        data-hr-menu
                        onClick={(e) => {
                          if (menuOpenKey === dateOnly) { setMenuOpenKey(null); return; }
                          setMenuRect(e.currentTarget.getBoundingClientRect());
                          setMenuOpenKey(dateOnly);
                        }}
                        title="Apply a request for this day"
                        aria-label="Apply attendance request"
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-sky-50 hover:text-sky-600"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {menuOpenKey === dateOnly && menuRect && typeof document !== "undefined" ? createPortal(
                        <div
                          data-hr-menu
                          className="fixed z-[100] min-w-[170px] rounded-md border border-slate-200 bg-white shadow-lg text-left text-[12.5px]"
                          style={(() => {
                            const vh = typeof window !== "undefined" ? window.innerHeight : 800;
                            const left = Math.max(8, menuRect.right - 170);
                            return menuRect.bottom > vh * 0.65
                              ? { bottom: vh - menuRect.top + 4, left }
                              : { top: menuRect.bottom + 4, left };
                          })()}
                        >
                          {([
                            { kind: "regularize" as const, label: "Regularization", show: true },
                            { kind: "wfh"        as const, label: "Work From Home", show: canApplyWfh },
                            { kind: "on_duty"    as const, label: "On Duty",        show: true },
                            { kind: "leave"      as const, label: "Apply Leave",    show: true },
                          ]).filter((o) => o.show).map((o, i) => (
                            <button
                              key={o.kind}
                              type="button"
                              onClick={() => { setMenuOpenKey(null); onSelfApply?.(o.kind, dateOnly); }}
                              className={`block w-full px-3 py-2 text-slate-700 hover:bg-sky-50 hover:text-sky-700 ${i > 0 ? "border-t border-slate-100" : ""}`}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>,
                        document.body,
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>
      )}

      {/* Regularize-on-behalf modal — admin only */}
      {regOpen && isHRAdmin ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md flex flex-col max-h-[90vh] rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 flex-shrink-0">
              <div>
                <h3 className="text-[14px] font-semibold text-slate-800">Regularize attendance</h3>
                <p className="text-[11.5px] text-slate-500">For {userName} · {regForm.date}</p>
              </div>
              <button onClick={() => setRegOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-5 py-4 flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Clock-in</label>
                  <input
                    type="datetime-local"
                    value={regForm.requestedIn}
                    onChange={(e) => setRegForm((f) => ({ ...f, requestedIn: e.target.value }))}
                    className="mt-1 w-full rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Clock-out</label>
                  <input
                    type="datetime-local"
                    value={regForm.requestedOut}
                    onChange={(e) => setRegForm((f) => ({ ...f, requestedOut: e.target.value }))}
                    className="mt-1 w-full rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Reason <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={regForm.reason}
                  onChange={(e) => setRegForm((f) => ({ ...f, reason: e.target.value }))}
                  rows={3}
                  placeholder="Why is this regularization being granted?"
                  className="mt-1 w-full resize-none rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                />
              </div>

              <div className="rounded bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 ring-1 ring-inset ring-amber-200">
                Submitting marks this regularization as <strong>admin-granted</strong>. It still needs L1 / L2 approval to apply to attendance.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 flex-shrink-0">
              <button
                onClick={() => setRegOpen(false)}
                className="h-8 rounded border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={submitReg}
                disabled={submitting || !regForm.reason.trim()}
                className="h-8 rounded bg-[#008CFF] px-4 text-[12px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-60"
              >
                {submitting ? "Submitting…" : "Grant regularization"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── HR on-behalf: WFH modal ───────────────────────────────────── */}
      {/* ── HR on-behalf: On Duty modal ────────────────────────────── */}
      {odOpen && isHRAdmin ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md flex flex-col max-h-[90vh] rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 flex-shrink-0">
              <div>
                <h3 className="text-[14px] font-semibold text-slate-800">Submit On Duty</h3>
                <p className="text-[11.5px] text-slate-500">For {userName}</p>
              </div>
              <button onClick={() => setOdOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">From</label>
                  <DateField
                    value={odForm.date}
                    onChange={(v) => setOdForm((f) => ({ ...f, date: v, toDate: f.toDate && f.toDate >= v ? f.toDate : v }))}
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">To</label>
                  <DateField
                    value={odForm.toDate}
                    onChange={(v) => setOdForm((f) => ({ ...f, toDate: v }))}
                    className="mt-1 w-full"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Location <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span></label>
                <input
                  value={odForm.location}
                  onChange={(e) => setOdForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="e.g. Client office, Mumbai"
                  className="mt-1 h-9 w-full rounded border border-slate-200 px-2.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Purpose <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={odForm.purpose}
                  onChange={(e) => setOdForm((f) => ({ ...f, purpose: e.target.value }))}
                  rows={3}
                  placeholder="Why is on-duty being submitted on behalf?"
                  className="mt-1 w-full resize-none rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                />
              </div>
              {/* Handoff Details — workStatus is required; POC supports N/A
                  for HR-on-behalf where no specific cover is assigned. */}
              <HandoffSection
                poc={handoffPoc}
                onPocChange={setHandoffPoc}
                workStatus={handoffWorkStatus}
                onWorkStatusChange={setHandoffWorkStatus}
                allowNa
                naSelected={handoffPocNa}
                onNaChange={setHandoffPocNa}
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 flex-shrink-0">
              <button
                onClick={() => { setOdOpen(false); resetHandoff(); }}
                className="h-8 rounded border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={submitOnDuty}
                disabled={submitting || !odForm.date || !odForm.purpose.trim()}
                className="h-8 rounded bg-[#008CFF] px-4 text-[12px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-60"
              >
                {submitting ? "Submitting…" : "Submit On Duty"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {wfhOpen && isHRAdmin ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md flex flex-col max-h-[90vh] rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 flex-shrink-0">
              <div>
                <h3 className="text-[14px] font-semibold text-slate-800">Grant Work From Home</h3>
                <p className="text-[11.5px] text-slate-500">For {userName}</p>
              </div>
              <button onClick={() => setWfhOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">From</label>
                  <DateField
                    value={wfhForm.date}
                    onChange={(v) => setWfhForm((f) => ({ ...f, date: v, toDate: f.toDate && f.toDate >= v ? f.toDate : v }))}
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">To</label>
                  <DateField
                    value={wfhForm.toDate}
                    onChange={(v) => setWfhForm((f) => ({ ...f, toDate: v }))}
                    className="mt-1 w-full"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Reason <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={wfhForm.reason}
                  onChange={(e) => setWfhForm((f) => ({ ...f, reason: e.target.value }))}
                  rows={3}
                  placeholder="Why is WFH being granted on behalf?"
                  className="mt-1 w-full resize-none rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 flex-shrink-0">
              <button
                onClick={() => setWfhOpen(false)}
                className="h-8 rounded border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={submitWfh}
                disabled={submitting || !wfhForm.date || !wfhForm.reason.trim()}
                className="h-8 rounded bg-[#008CFF] px-4 text-[12px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-60"
              >
                {submitting ? "Submitting…" : "Grant WFH"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── HR on-behalf: Leave + WFH unified modal ───────────────────── */}
      {leaveOpen && isHRAdmin ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          {/* Flex column with capped height so the form body scrolls
              while the header + tab strip stay pinned to the top and
              the action footer stays pinned to the bottom. Fixes the
              small-screen bug where the Apply leave / Grant WFH button
              was pushed off the viewport. */}
          <div className="w-full max-w-md flex flex-col max-h-[90vh] rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 flex-shrink-0">
              <div>
                <h3 className="text-[14px] font-semibold text-slate-800">
                  {leaveModalTab === "leave" ? "Apply Leave on behalf" : "Grant Work From Home"}
                </h3>
                <p className="text-[11.5px] text-slate-500">For {userName}</p>
              </div>
              <button onClick={() => { setLeaveOpen(false); resetHandoff(); }} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Tab strip */}
            <div className="flex border-b border-slate-100 px-2 flex-shrink-0">
              {(["leave", "wfh"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setLeaveModalTab(t)}
                  className={`px-4 py-2.5 text-[12px] font-semibold border-b-2 -mb-px transition-colors ${
                    leaveModalTab === t
                      ? "border-[#008CFF] text-[#008CFF]"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {t === "leave" ? "Leave" : "WFH"}
                </button>
              ))}
            </div>

            {/* Scrollable form body — only this region scrolls. */}
            <div className="flex-1 overflow-y-auto">
            {leaveModalTab === "leave" ? (
              <div className="space-y-3 px-5 py-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Leave type</label>
                  <SelectField
                    value={leaveForm.leaveTypeId === "" ? "" : String(leaveForm.leaveTypeId)}
                    onChange={(v) => setLeaveForm((f) => ({ ...f, leaveTypeId: v ? Number(v) : "" }))}
                    placeholder="— Select type —"
                    options={leaveTypes.map((t) => {
                      const bal = targetBalances[t.id];
                      const balLabel = bal == null
                        ? ""
                        : `  ·  ${bal % 1 === 0 ? bal.toFixed(0) : bal.toFixed(1)} available`;
                      return { value: String(t.id), label: `${t.name}${balLabel}` };
                    })}
                    className="mt-1 w-full rounded border border-slate-200 h-9 px-2.5 text-[12.5px]"
                  />
                  {leaveForm.leaveTypeId && targetBalances[Number(leaveForm.leaveTypeId)] != null && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      {userName} has{" "}
                      <span className={`font-semibold ${targetBalances[Number(leaveForm.leaveTypeId)] > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {targetBalances[Number(leaveForm.leaveTypeId)].toFixed(1)} day{targetBalances[Number(leaveForm.leaveTypeId)] === 1 ? "" : "s"}
                      </span>{" "}
                      available in this type.
                    </p>
                  )}
                </div>
                {/* Full / Half day pill — same convention as the user's
                    own leave form. Half-day pins toDate to fromDate. */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Day type</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { k: "full",        label: "Full Day"    },
                      { k: "first_half",  label: "First Half"  },
                      { k: "second_half", label: "Second Half" },
                    ].map((opt) => {
                      const active = grantDayKind === opt.k;
                      return (
                        <button
                          key={opt.k}
                          type="button"
                          onClick={() => {
                            const next = opt.k as typeof grantDayKind;
                            setGrantDayKind(next);
                            if (next !== "full") {
                              setLeaveForm((f) => ({ ...f, toDate: f.fromDate }));
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">From</label>
                    <DateField
                      value={leaveForm.fromDate}
                      onChange={(v) => setLeaveForm((f) => ({ ...f, fromDate: v, toDate: f.toDate < v ? v : f.toDate }))}
                      className="mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">To</label>
                    <DateField
                      value={leaveForm.toDate}
                      onChange={(v) => setLeaveForm((f) => ({ ...f, toDate: v }))}
                      className="mt-1 w-full"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Reason <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    value={leaveForm.reason}
                    onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))}
                    rows={3}
                    placeholder="Why is leave being granted on behalf?"
                    className="mt-1 w-full resize-none rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                  />
                </div>
                {/* Handoff Details — POC + Work Status. Required by the
                    leave API exactly the same as the user's own form.
                    Allow N/A so HR can skip POC when no cover assigned. */}
                <HandoffSection
                  poc={handoffPoc}
                  onPocChange={setHandoffPoc}
                  workStatus={handoffWorkStatus}
                  onWorkStatusChange={setHandoffWorkStatus}
                  allowNa
                  naSelected={handoffPocNa}
                  onNaChange={setHandoffPocNa}
                />
              </div>
            ) : (
              <div className="space-y-3 px-5 py-4">
                {/* Full / Half day pill — same as the Leave tab. Picking
                    a half-day collapses the WFH to a single date. */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Day type</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { k: "full",        label: "Full Day"    },
                      { k: "first_half",  label: "First Half"  },
                      { k: "second_half", label: "Second Half" },
                    ].map((opt) => {
                      const active = grantDayKind === opt.k;
                      return (
                        <button
                          key={opt.k}
                          type="button"
                          onClick={() => {
                            const next = opt.k as typeof grantDayKind;
                            setGrantDayKind(next);
                            if (next !== "full") {
                              setWfhForm((f) => ({ ...f, toDate: f.date }));
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">From</label>
                    <DateField
                      value={wfhForm.date}
                      onChange={(v) => setWfhForm((f) => ({ ...f, date: v, toDate: f.toDate && f.toDate >= v ? f.toDate : v }))}
                      className="mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">To</label>
                    <DateField
                      value={wfhForm.toDate}
                      onChange={(v) => setWfhForm((f) => ({ ...f, toDate: v }))}
                      className="mt-1 w-full"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Reason <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    value={wfhForm.reason}
                    onChange={(e) => setWfhForm((f) => ({ ...f, reason: e.target.value }))}
                    rows={3}
                    placeholder="Why is WFH being granted on behalf?"
                    className="mt-1 w-full resize-none rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                  />
                </div>
                {/* Handoff Details — POC + Work Status + Time of
                    Unavailability (WFH-only). The WFH API rejects the
                    request without workStatus / unavailability; POC is
                    N/A-eligible for HR-on-behalf. */}
                <HandoffSection
                  poc={handoffPoc}
                  onPocChange={setHandoffPoc}
                  workStatus={handoffWorkStatus}
                  onWorkStatusChange={setHandoffWorkStatus}
                  unavailability={handoffUnavailability}
                  onUnavailabilityChange={setHandoffUnavailability}
                  showUnavailability
                  allowNa
                  naSelected={handoffPocNa}
                  onNaChange={setHandoffPocNa}
                />
              </div>
            )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 flex-shrink-0">
              <button
                onClick={() => { setLeaveOpen(false); resetHandoff(); }}
                className="h-8 rounded border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              {leaveModalTab === "leave" ? (
                <button
                  onClick={submitLeave}
                  disabled={submitting || !leaveForm.leaveTypeId || !leaveForm.fromDate || !leaveForm.toDate || !leaveForm.reason.trim()}
                  className="h-8 rounded bg-[#008CFF] px-4 text-[12px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-60"
                >
                  {submitting ? "Submitting…" : "Apply leave"}
                </button>
              ) : (
                <button
                  onClick={submitWfh}
                  disabled={submitting || !wfhForm.date || !wfhForm.reason.trim()}
                  className="h-8 rounded bg-[#008CFF] px-4 text-[12px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-60"
                >
                  {submitting ? "Submitting…" : "Grant WFH"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
