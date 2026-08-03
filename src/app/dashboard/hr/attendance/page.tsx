"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Home, Briefcase, ShieldCheck, Info, User, Users, Clock3, Plus, X, MapPin, MoreVertical, Coffee, AlertCircle, CheckCircle2, XCircle, Calendar, CalendarDays, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { parseAttLoc } from "@/lib/attendance-location";
import LeaveRequestForm, { LeaveRequestKind } from "@/components/LeaveRequestForm";
import SelectField from "@/components/ui/SelectField";
import { isHRAdmin, canApplyRestrictedLeave } from "@/lib/access";
import { isMobileDevice as detectMobileDevice } from "@/lib/is-mobile-device";
import { DateField } from "@/components/ui/date-field";
import { useClockActions } from "@/lib/hr/use-clock-actions";
import PulseGateModal from "@/components/hr/PulseGateModal";
import ExitSurveyGateModal from "@/components/hr/ExitSurveyGateModal";
import DesktopGateModal from "@/components/hr/DesktopGateModal";
import { isWorkingDay } from "@/lib/hr/shift-working-days";
import { isDesktopBypassActive } from "@/lib/desktop-bypass";
import { useUrlTab } from "@/lib/hooks/useUrlTab";
import { EmployeeTimePanel } from "@/components/hr/EmployeeTimePanel";

// ── Form copy per kind ───────────────────────────────────────────────────────
const FORM_TITLE: Record<LeaveRequestKind, string> = {
  wfh:        "Request Work From Home",
  on_duty:    "Apply for On Duty",
  half_day:   "Apply for Half Day",
  leave:      "Request Leave",
  regularize: "Request Regularization",
};
const FORM_POLICY: Record<LeaveRequestKind, string | undefined> = {
  wfh:        "As per the policy assigned only Monday, Tuesday, Wednesday, Thursday, Friday, Saturday will be considered for WFH. Clock in is necessary on WFH days to avoid being marked absent.",
  on_duty:    "On-duty time counts as working hours. Log the purpose clearly — your manager will review before approval.",
  half_day:   "Half day leave covers either the first (9:00 AM – 2:00 PM) or second half (2:00 PM – 6:00 PM) of the day.",
  leave:      undefined,
  regularize: "Use this to fix missed punches or incorrect clock-in/out. Attach a clear reason so approval is quick.",
};

// ── Tab config ────────────────────────────────────────────────────────────────
const TOP_TABS = [
  { key: "home",             label: "HOME",               href: "/dashboard/hr/home"  },
  { key: "attendance",       label: "ATTENDANCE",         href: "/dashboard/hr/attendance" },
  { key: "leave",            label: "LEAVE",              href: "/dashboard/hr/leaves"     },
  { key: "performance",      label: "PERFORMANCE",        href: "/dashboard/hr/goals"      },
  { key: "apps",             label: "APPS",               href: "/dashboard/hr/apps"       },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtMins(m: number) { return `${Math.floor(m / 60)}h ${m % 60}m`; }

// ── Kebab row menu with Regularize / WFH / On Duty / Leave actions ──────────
type RowMenuProps = {
  onRegularize: () => void;
  onWFH:        () => void;
  onOnDuty:     () => void;
  onLeave:      () => void;
  disableRegularize?: boolean;
  disableRegularizeReason?: string;
};
function RowMenu({ onRegularize, onWFH, onOnDuty, onLeave, disableRegularize, disableRegularizeReason }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  // When a regularization is already in flight for this date, drop the
  // "Regularize" option from the menu entirely instead of greying it out —
  // a pending request can't be re-submitted, so showing it is just noise.
  const items: { label: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>; onSelect: () => void; disabled?: boolean; title?: string }[] = [
    ...(disableRegularize
      ? []
      : [{ label: "Regularize", Icon: ShieldCheck, onSelect: onRegularize, title: disableRegularizeReason }]),
    { label: "Apply WFH Request", Icon: Home,        onSelect: onWFH        },
    { label: "Apply On Duty",     Icon: Briefcase,   onSelect: onOnDuty     },
    { label: "Request Leave",     Icon: Coffee,      onSelect: onLeave      },
  ];

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className="w-7 h-7 rounded hover:bg-slate-100 dark:hover:bg-white/[0.06] flex items-center justify-center text-slate-500 hover:text-slate-800 dark:text-slate-300 dark:hover:text-white"
        aria-label="Row actions"
        aria-expanded={open}
      >
        <MoreVertical size={16} strokeWidth={2.25} />
      </button>
      {open && (
        <div className="absolute z-40 right-0 top-8 w-[210px] bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-lg shadow-2xl py-1">
          {items.map(({ label, Icon, onSelect, disabled, title }, i) => {
            // Hairline divider after "Regularize" — separates "fix the past"
            // from "request the future". Skip when Regularize was filtered out.
            const showDivider = i === 0 && label === "Regularize";
            return (
              <button
                key={label}
                type="button"
                disabled={disabled}
                title={disabled ? title : undefined}
                onClick={() => { if (disabled) return; setOpen(false); onSelect(); }}
                className={`w-full text-left px-3 py-2 text-[12.5px] text-slate-700 dark:text-slate-200 transition-colors flex items-center gap-2.5 ${
                  showDivider ? "border-b border-slate-200 dark:border-white/[0.06]" : ""
                } ${
                  disabled
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:bg-[#008CFF]/[0.06] dark:hover:bg-[#008CFF]/[0.1] hover:text-[#008CFF] dark:hover:text-[#4a9cff]"
                }`}
              >
                <Icon size={14} strokeWidth={2} className="text-[#008CFF] dark:text-[#4a9cff] shrink-0" />
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Location pin with click-to-view popover (Keka-style) ─────────────────────
// Shows whatever location was captured at clock-in. Location is mandatory at
// clock-in (enforced client + server), so new rows will always have coords.
// Older rows created before that rule may have no location — we just say so.
function LocationPin({ raw, kind = "in", tintOverride }: { raw?: string | null; kind?: "in" | "out"; tintOverride?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const info = parseAttLoc(raw);
  const hasAddress = !!info.address;
  const hasCoords  = typeof info.lat === "number" && typeof info.lng === "number";
  const has        = hasAddress || hasCoords;
  // Tint priority: explicit override > out-default red > in-default
  // green/blue (blue for remote, green for office). The override is
  // how the timeline row pins both ends (green start, red end) so
  // they read as "in" / "out" regardless of mode.
  const tint = tintOverride
    ? tintOverride
    : !has
      ? "#94a3b8"
      : kind === "out"
        ? "#ef4444"
        : (info.mode === "remote" ? "#008CFF" : "#10b981");

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t))   return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const rect = btnRef.current?.getBoundingClientRect() ?? null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={has ? (info.address || `${info.lat!.toFixed(4)}, ${info.lng!.toFixed(4)}`) : "No location recorded for this entry"}
        className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full border border-[#008CFF]/20 bg-[#008CFF]/5 text-[#008CFF] cursor-pointer transition-all hover:bg-[#008CFF]/15 hover:border-[#008CFF]/40 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/30"
        style={has ? { color: tint, borderColor: `${tint}33`, background: `${tint}14` } : undefined}
        aria-label="Clock-in location"
      >
        <MapPin size={14} strokeWidth={2} />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top:   (rect?.bottom ?? 0) + 6,
            left:  Math.min((rect?.left ?? 0), (typeof window !== "undefined" ? window.innerWidth - 260 : 0)),
            zIndex: 10000,
          }}
          className="w-[260px] bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-lg shadow-2xl p-3"
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: tint }} />
            <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: tint }}>
              {kind === "out"
                ? "Clock-out"
                : info.mode === "remote" ? "Remote Clock-in" : info.mode === "office" ? "Office Clock-in" : "Clock-in"}
            </span>
          </div>

          {info.address && (
            <p className="text-[12px] text-slate-700 dark:text-slate-200 leading-snug mb-1">{info.address}</p>
          )}
          {hasCoords && (
            <>
              <p className="text-[11px] text-slate-400 font-mono">{info.lat!.toFixed(5)}, {info.lng!.toFixed(5)}</p>
              <a
                href={`https://www.google.com/maps?q=${info.lat},${info.lng}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-[#008CFF] hover:underline mt-1.5 inline-block"
              >Open in Maps ↗</a>
            </>
          )}

          {!has && (
            <p className="text-[11.5px] text-slate-500 leading-snug">
              No location recorded for this entry. (Older records may not have one — new clock-ins always do.)
            </p>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

// One pin per row that opens a popover with BOTH clock-in AND
// clock-out locations stacked. Replaces the previous "green pin
// flanking the bar on the left + red pin on the right" layout —
// less visual noise, single click to see the whole day's geo.
function DayLocationPin({ inRaw }: { inRaw?: string | null }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const inInfo  = parseAttLoc(inRaw);
  const hasIn   = !!inInfo.address  || (typeof inInfo.lat  === "number" && typeof inInfo.lng  === "number");
  // Geo is only captured on clock-in, so the pin reflects that
  // single state — emerald when we have it, slate when we don't.
  const tint = hasIn ? "#10b981" : "#94a3b8";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t))   return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const rect = btnRef.current?.getBoundingClientRect() ?? null;
  // Auto-flip: if there's not enough room below the trigger for the
  // popover, anchor it to grow UPWARD from just above the pin instead.
  // Using CSS `bottom` (rather than computing `top` from a max height
  // estimate) means the popover's bottom edge sits flush with the
  // trigger no matter how tall the actual content renders — no more
  // popovers floating multiple rows above the clicked pin.
  const PANEL_H_ESTIMATE = 280;
  const PANEL_W = 280;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const flipUp = rect ? (viewportH - rect.bottom) < PANEL_H_ESTIMATE : false;
  const popoverLeft = rect ? Math.min(rect.left, (typeof window !== "undefined" ? window.innerWidth - PANEL_W - 8 : 0)) : 0;

  // Renders a single labelled section inside the popover. Pulled out
  // so the in / out sections render identically modulo colour + label.
  const Section = ({ label, info, color }: { label: string; info: ReturnType<typeof parseAttLoc>; color: string }) => {
    const has = !!info.address || (typeof info.lat === "number" && typeof info.lng === "number");
    return (
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
          <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color }}>{label}</span>
        </div>
        {!has ? (
          <p className="text-[11.5px] text-slate-400 leading-snug">No location recorded.</p>
        ) : (
          <>
            {info.address && (
              <p className="text-[12px] text-slate-700 dark:text-slate-200 leading-snug mb-0.5">{info.address}</p>
            )}
            {typeof info.lat === "number" && typeof info.lng === "number" && (
              <>
                <p className="text-[10.5px] text-slate-400 font-mono">{info.lat.toFixed(5)}, {info.lng.toFixed(5)}</p>
                <a
                  href={`https://www.google.com/maps?q=${info.lat},${info.lng}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-[#008CFF] hover:underline mt-0.5 inline-block"
                >Open in Maps ↗</a>
              </>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={hasIn ? "Clock-in location" : "No location recorded for this entry"}
        className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full cursor-pointer transition-all hover:scale-105 focus:outline-none focus:ring-2"
        style={{ color: tint, borderColor: `${tint}33`, background: `${tint}14`, border: `1px solid ${tint}33` }}
        aria-label="Day location"
      >
        <MapPin size={14} strokeWidth={2} />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            // Flip-up anchors the popover's BOTTOM edge 6px above the
            // trigger's TOP edge. Flip-down anchors its TOP edge 6px
            // below the trigger's BOTTOM edge. Either way the popover
            // sits flush against the pin regardless of its real height.
            ...(flipUp
              ? { bottom: viewportH - (rect?.top ?? 0) + 6 }
              : { top: (rect?.bottom ?? 0) + 6 }),
            left:   popoverLeft,
            zIndex: 10000,
          }}
          className="w-[280px] bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-lg shadow-2xl p-3"
        >
          <Section label="Clock-In"  info={inInfo}  color="#10b981" />
        </div>,
        document.body
      )}
    </>
  );
}

// ── Timeline bar (same proportional grid as Keka) ────────────────────────────
// Shift-progress bar: fills from 0 → 100% of a 9h shift based on elapsed minutes.
// Orange < 50% · blue < 100% · green once the full 9h is met.
function TimelineBar({ liveMins, firstIn, lastOut, isOpen, sessions, isTodayRow }: {
  liveMins: number;
  firstIn?: Date | null;
  lastOut?: Date | null;
  isOpen?: boolean; // true when there's still an open session (no final clock-out yet)
  sessions?: Array<{ clockIn: string | Date; clockOut?: string | Date | null }>;
  isTodayRow?: boolean;
}) {
  // Rows with punch sessions ALWAYS render the track + hover log — even at
  // 0 recorded minutes (e.g. a never-clocked-out LOP day) so the punch
  // evidence is visible. Only rows with no sessions at all show "—".
  if ((!liveMins || liveMins <= 0) && !(sessions && sessions.length > 0)) {
    return <span className="text-[11px] text-slate-400">—</span>;
  }
  const SHIFT_LEN = 540; // 9h in minutes
  const pct = Math.min((Math.max(0, liveMins || 0) / SHIFT_LEN) * 100, 100);
  const color    = pct >= 100 ? "bg-emerald-400" : pct >= 50 ? "bg-[#008CFF]" : "bg-orange-400";
  const dotColor = pct >= 100 ? "bg-emerald-400" : pct >= 50 ? "bg-[#008CFF]" : "bg-orange-400";

  // Tooltip text — Keka shows "Logged In 8:13 AM - 5:18 PM" on hover.
  // Mirror that: first session's clock-in to last session's clock-out
  // (or "now" if still active).
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
      .replace(/^0/, "")  // strip leading zero on hour ("08:00" → "8:00")
      .toLowerCase();
  const inLabel  = firstIn ? fmt(firstIn) : null;
  // Open session: "now" only while the day is still running — on a past
  // day an open session is a MISSED punch, not an ongoing one.
  const outLabel = lastOut ? fmt(lastOut) : (isOpen ? (isTodayRow ? "now" : "missed") : null);
  const tooltip  = inLabel && outLabel ? `Logged In ${inLabel} – ${outLabel}` : null;

  return (
    <div className="group relative flex-1 min-w-[200px] max-w-[420px]">
      {/* The bar itself — same look as before. */}
      <div className="relative h-2 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-[width] duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Hover tooltip — themed to match the rest of the dashboard:
          white card, soft shadow, slate text, coloured status dot.
          Positioned above the bar, centred horizontally. Pointer-events
          are disabled so it never blocks clicks on the bar / pin. */}
      {(tooltip || (sessions && sessions.length > 1)) && (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-20 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0a1526] px-2.5 py-1.5 text-[11.5px] font-medium text-slate-700 dark:text-slate-200 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150"
        >
          {sessions && sessions.length > 1 ? (
            // Multiple clock-in/out segments → list each in/out so HR can see
            // the breaks, not just the overall span.
            <div className="space-y-1 whitespace-nowrap">
              <div className="mb-0.5 flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                <span className="font-semibold">{sessions.length} sessions</span>
              </div>
              {sessions.map((s, i) => {
                const open = !s.clockOut;
                return (
                  <div key={i} className="flex items-center gap-1 tabular-nums">
                    <ArrowDownLeft size={12} strokeWidth={2.4} className="shrink-0 text-emerald-500" />
                    <span className="font-semibold">{fmt(new Date(s.clockIn))}</span>
                    <span className="px-0.5 opacity-40">–</span>
                    {open && isTodayRow ? (
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">now</span>
                    ) : open ? (
                      <span className="font-semibold text-amber-600 dark:text-amber-400">missed</span>
                    ) : (
                      <>
                        <ArrowUpRight size={12} strokeWidth={2.4} className="shrink-0 text-rose-500" />
                        <span className="font-semibold">{fmt(new Date(s.clockOut!))}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
              <span>Logged In <span className="font-semibold tabular-nums">{inLabel}</span> <span className="opacity-50">–</span> <span className="font-semibold tabular-nums">{outLabel}</span></span>
            </div>
          )}
          {/* Little notch pointing down at the bar. Two stacked
              elements give it a border so it matches the card's edge. */}
          <span className="absolute left-1/2 -translate-x-1/2 -bottom-[5px] w-2.5 h-2.5 rotate-45 bg-white dark:bg-[#0a1526] border-r border-b border-slate-200 dark:border-white/10" />
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const C = {
  card:    "bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl",
  t1:      "text-slate-800 dark:text-white",
  t2:      "text-slate-600 dark:text-slate-300",
  t3:      "text-slate-400 dark:text-slate-500",
};

// Predefined reason categories for regularization. Picking one is required;
// the free-text "note" below it is optional context for the approver.
const REGULARIZATION_REASONS = [
  "Early check-in and out",
  "Late check-in and out",
  "Early check-in",
  "Late check-in",
  "Early check-out",
  "Late check-out",
] as const;

function RegularizeModal({ onClose, prefillDate }: { onClose: () => void; prefillDate?: string }) {
  const [form, setForm] = useState({ date: prefillDate || "", reasonCategory: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Monthly regularization quota for the selected date's IST month. Uses the
  // same SWR key as the prefetch on the parent page so the first open is
  // instant; changing the date triggers a fresh fetch for that month.
  const balanceUrl = form.date
    ? `/api/hr/attendance/regularize/balance?date=${form.date}`
    : `/api/hr/attendance/regularize/balance`;
  const { data: balance } = useSWR<{ used: number; limit: number | null; remaining: number | null; unlimited?: boolean; month: string }>(
    balanceUrl, fetcher, { keepPreviousData: true, revalidateOnFocus: false }
  );

  const submit = async () => {
    setErr("");
    if (!form.date || !form.reasonCategory) return setErr("Date and reason are required");
    setSaving(true);
    // Combine the dropdown reason + optional note into a single `reason`
    // string for the API. Format: "<Reason>" or "<Reason> — <note>".
    const reason = form.note.trim()
      ? `${form.reasonCategory} — ${form.note.trim()}`
      : form.reasonCategory;
    const res = await fetch("/api/hr/attendance/regularize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: form.date, reason }),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data.error || "Failed"); setSaving(false); return; }
    mutate((k: string) => typeof k === "string" && k.includes("/api/hr/attendance/regularize"));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.08] rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
          <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">Request Regularization</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {err && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{err}</p>}
          {balance && (
            balance.unlimited ? (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg text-[12px] bg-emerald-500/10 text-emerald-600">
                <span className="font-semibold">{balance.used} used · {balance.month}</span>
                <span>Unlimited</span>
              </div>
            ) : (
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg text-[12px] ${
                balance.remaining === 0
                  ? "bg-red-500/10 text-red-500"
                  : balance.remaining === 1
                  ? "bg-amber-500/10 text-amber-600"
                  : "bg-[#008CFF]/10 text-[#008CFF]"
              }`}>
                <span className="font-semibold">{balance.used} of {balance.limit} used · {balance.month}</span>
                <span>{balance.remaining} left</span>
              </div>
            )
          )}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Date *</label>
            <DateField value={form.date} onChange={(v) => set("date", v)} className="mt-1 w-full" />
          </div>
          {/* Reason category dropdown — required */}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Reason for Regularisation <span className="text-rose-500">*</span></label>
            <SelectField
              value={form.reasonCategory}
              onChange={(v) => set("reasonCategory", v)}
              placeholder="Select a reason…"
              options={REGULARIZATION_REASONS.map((r) => ({ value: r, label: r }))}
              className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white"
            />
          </div>
          {/* Optional free-text note for the approver */}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Note</label>
            <textarea value={form.note} onChange={e => set("note", e.target.value)} rows={3}
              placeholder="Any additional context for the approver (optional)…"
              className="mt-1 w-full px-3 py-2 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none resize-none" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-white/[0.06]">
          <button onClick={onClose} className="h-8 px-4 text-[13px] font-medium text-slate-500">Cancel</button>
          <button onClick={submit} disabled={saving || balance?.remaining === 0}
            className="h-8 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? "Submitting..." : balance?.remaining === 0 ? "Quota exhausted" : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
}

// WFHModal / OnDutyModal lived here previously but were superseded by
// `LeaveRequestForm` (the unified leave-style form that carries the
// Handoff Details — POC, Work Status, Time of Unavailability). They
// were never referenced in JSX from this page, so removing them removes
// a stale entry-point that would have submitted without handoff fields
// and been rejected by the API.

export default function AttendancePage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  // Mirrors src/lib/access.ts:isHRAdmin — was missing special_access + role=admin.
  const isAdmin = isHRAdmin(user);
  // Own dbId — feeds the shared EmployeeTimePanel below (userId === meDbId ⇒ isSelfView).
  const myId = Number(user?.dbId) || null;

  // `now` ticks with the clock so week-day highlight, calendar "today", and
  // month default all track the actual wall-clock time rather than mount time.
  const [clock, setClock] = useState<Date | null>(null);
  const now = clock ?? new Date();
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  );
  const [subTab, setSubTab] = useUrlTab<"log" | "calendar" | "requests">("view", "log", ["log", "calendar", "requests"] as const);
  const [reqType, setReqType] = useState<"punch" | "wfh" | "od">("punch");
  const [use24, setUse24] = useState(false);
  const [period, setPeriod] = useState<"30d" | "month">("30d");
  const [showRegModal, setShowRegModal] = useState(false);
  const [regPrefillDate, setRegPrefillDate] = useState<string | undefined>(undefined);
  // New unified form (WFH / On-Duty / Half Day / Leave / Regularize-via-form).
  const [formState, setFormState] = useState<{ kind: LeaveRequestKind; prefillDate?: string } | null>(null);
  const openForm = (kind: LeaveRequestKind, prefillDate?: string) => setFormState({ kind, prefillDate });

  // Deep-link support: `?apply=wfh|on_duty|leave|half_day|regularize` opens
  // the matching apply form on first paint. Used by the Home page's
  // "Other" menu so users land directly on the form they want.
  //
  // We strip the query string with `window.history.replaceState` rather
  // than `router.replace` — the latter dispatches a Next.js router action
  // and in Next 16 that fires "Router action dispatched before initialization"
  // when called from a layout-level effect. The native History API is
  // a no-op for routing and just rewrites the URL bar.
  const searchParams = useSearchParams();
  useEffect(() => {
    const v = searchParams?.get("apply");
    const valid: LeaveRequestKind[] = ["wfh", "on_duty", "leave", "half_day", "regularize"];
    if (v && (valid as string[]).includes(v)) {
      openForm(v as LeaveRequestKind);
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", "/dashboard/hr/attendance");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [regView, setRegView] = useUrlTab<"my" | "team">("regs", "my", ["my", "team"] as const);

  // Browser geolocation permission state. Attendance needs location, so we
  // check this up-front and show a banner + disable the clock-in button when
  // permission has been permanently blocked. "prompt" is fine — clicking the
  // button will trigger the browser's native ask.
  type LocPerm = "granted" | "denied" | "prompt" | "unsupported" | "checking";
  const [locPerm, setLocPerm] = useState<LocPerm>("checking");
  // Two-step Clock-Out confirmation (Keka pattern). First click flips
  // this to true and the button splits into a Clock-out / Cancel pair
  // so a stray click doesn't end the day. Auto-cancels after 6s if the
  // user walks away. Mirrors the home Quick-Access tile's behaviour.
  const [confirmingClockOut, setConfirmingClockOut] = useState(false);
  // `clockingOut` lives in the useClockActions hook below — it tracks
  // the actual fetch in-flight, not just the visual confirm state.
  // The auto-collapse useEffect needs the hook's `clockingOut` value,
  // so it's defined further down (after the hook).

  // Mobile gate w/ two bypasses (mirrors /dashboard/hr/home):
  //   1. Developers (DEVELOPER_EMAILS env → user.isDeveloper) — stable
  //      identity-bound bypass.
  //   2. ?desktop=13 query param — short-term emergency override for
  //      anyone whose laptop is unavailable. Not a secret; pair with
  //      a regularization request if used.
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  useEffect(() => {
    const isDev = user?.isDeveloper === true;
    // isDesktopBypassActive() persists `?desktop=13` for the session, so the
    // override survives navigation that drops the query string.
    setIsMobileDevice(detectMobileDevice() && !isDev && !isDesktopBypassActive());
  }, [user]);

  // "Day Complete · 9h reached" toast — set after a successful clock-out
  // whose final totalMinutes ≥ 540. Auto-dismisses after 5 seconds; user
  // can also close it manually. Replaces the previous inline badge on the
  // re-clockin button.
  const [dayCompleteToast, setDayCompleteToast] = useState(false);
  useEffect(() => {
    if (!dayCompleteToast) return;
    const t = setTimeout(() => setDayCompleteToast(false), 5000);
    return () => clearTimeout(t);
  }, [dayCompleteToast]);

  useEffect(() => {
    setClock(new Date());
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) {
      setLocPerm("unsupported");
      return;
    }
    let status: PermissionStatus | null = null;
    const check = () => {
      navigator.permissions.query({ name: "geolocation" as PermissionName })
        .then((s) => {
          if (status) status.onchange = null;
          status = s;
          setLocPerm(s.state as LocPerm);
          // `onchange` fires reliably in some cases but Chrome won't always
          // fire it when the user toggles permission from the address-bar
          // popup. The focus listener below covers that gap.
          s.onchange = () => setLocPerm(s.state as LocPerm);
        })
        .catch(() => setLocPerm("unsupported"));
    };
    check();
    // When the user closes the browser's site-settings popup, focus returns
    // to this window — re-query so the banner clears immediately.
    window.addEventListener("focus", check);
    return () => {
      window.removeEventListener("focus", check);
      if (status) status.onchange = null;
    };
  }, []);

  // Build the attendance query: rolling 30-day window when period="30d",
  // otherwise the currently-selected month.
  const attendanceQs = (() => {
    if (period === "30d") {
      const end = clock ?? new Date();
      const start = new Date(end); start.setDate(start.getDate() - 29);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      return `from=${iso(start)}&to=${iso(end)}`;
    }
    return `month=${month}`;
  })();
  const { data: myData }    = useSWR(`/api/hr/attendance?${attendanceQs}`, fetcher);
  const { data: boardData } = useSWR(`/api/hr/attendance/board`, fetcher);
  // Caller's own shift — drives the per-row LATE chip cutoff (shift
  // startTime + breakMinutes). Without it the page falls back to a
  // hardcoded 10:00 IST rule which mis-flags both the 5-min grace
  // window and YT Labs's 11:00 start. Cheap single-row fetch.
  const { data: myShiftData } = useSWR<{
    shift: { startTime: string | null; breakMinutes: number | null } | null;
  }>(`/api/hr/me/shift`, fetcher);
  // Late cutoff in IST minutes-of-day. Default 10:00 + 0 grace when
  // no shift is assigned (matches clock-in route's legacy fallback).
  const lateCutoffMin: number = (() => {
    const s = myShiftData?.shift;
    if (!s?.startTime) return 10 * 60;
    const [sh, sm] = String(s.startTime).split(":").map((n) => Number(n) || 0);
    const grace    = Number.isFinite(s.breakMinutes) ? Number(s.breakMinutes) : 15;
    return sh * 60 + sm + grace;
  })();
  const { data: regsData = [] } = useSWR(`/api/hr/attendance/regularize?view=${regView}`, fetcher);
  // Prefetch regularization balance so the modal shows it instantly on open.
  // Same key the modal uses — SWR dedupes and serves from cache.
  useSWR(`/api/hr/attendance/regularize/balance`, fetcher);
  const { data: wfhData  = [] } = useSWR(`/api/hr/attendance/wfh?view=${regView}`, fetcher);
  const { data: odData   = [] } = useSWR(`/api/hr/attendance/on-duty?view=${regView}`, fetcher);
  // My pending leave applications — used to show "Pending leave" on affected days.
  const { data: leavesData } = useSWR(`/api/hr/leaves?view=my`, fetcher);
  const myLeaves: any[] = Array.isArray(leavesData) ? leavesData : (leavesData?.applications ?? leavesData?.items ?? []);
  const { data: leaveTypesData = [] } = useSWR(`/api/hr/admin/leave-types`, fetcher);
  // Rolling team-stats comparison: me vs everyone sharing my `teamCapsule`.
  const { data: teamStats } = useSWR(`/api/hr/attendance/team-stats?period=week`, fetcher);
  // My profile — used to clamp the attendance log to the day my account
  // was first created so we don't render "Absent" rows for days before I
  // started using the app. `createdAt` is always populated (set to now()
  // on the first sign-in), so no fallback is needed.
  const { data: profileData } = useSWR(`/api/hr/profile`, fetcher);
  const appStartIso: string | null = (() => {
    const c = (profileData as any)?.createdAt;
    if (!c) return null;
    return String(c).slice(0, 10); // YYYY-MM-DD (UTC component is fine — User.createdAt is a timestamp)
  })();
  // Remote / hybrid employees already work from home as their default
  // mode — surfacing a "Work From Home" leave option would be confusing
  // (they don't need to apply for what's already their baseline). Hide
  // it for them; office-based folks still see it.
  const myWorkLocation = String((profileData as any)?.employeeProfile?.workLocation ?? "office").toLowerCase();
  const canApplyWfh = myWorkLocation !== "remote" && myWorkLocation !== "hybrid";
  // Clock button label flips to "WFH …" when working from home today — a
  // remote/hybrid worker, or an approved WFH for today.
  const myWfhTodayKey = new Date().toISOString().slice(0, 10);
  const { data: myWfhList = [] } = useSWR("/api/hr/attendance/wfh?view=my", fetcher);
  const hasWfhToday = Array.isArray(myWfhList) && myWfhList.some((r: any) =>
    (r.status === "approved" || r.status === "pending") && typeof r.date === "string" && r.date.slice(0, 10) === myWfhTodayKey
  );
  const isRemoteMode = myWorkLocation === "remote" || myWorkLocation === "hybrid" || hasWfhToday;
  const clockInLabel         = isRemoteMode ? "WFH Clock-In"  : "Web Clock-In";
  const clockOutLabel        = isRemoteMode ? "WFH Clock-Out" : "Web Clock-Out";
  const confirmClockOutLabel = isRemoteMode ? "Confirm WFH Clock-Out" : "Confirm Web Clock-Out";
  // Drop balance-only types (legacy `applicable=false` buckets) and
  // restricted-admin types (`adminOnly`) when the viewer isn't CEO /
  // HR Manager / developer. Server enforces the same gate so a
  // hand-crafted POST still 403s.
  const me = session?.user as any;
  const canApplyRestricted = canApplyRestrictedLeave(me);
  const leaveTypes: { id: number; name: string }[] = Array.isArray(leaveTypesData)
    ? leaveTypesData
        .filter((t: any) => t.applicable !== false)
        .filter((t: any) => t.adminOnly !== true || canApplyRestricted)
        .map((t: any) => ({ id: t.id, name: t.name }))
    : [];

  // Clock-in / clock-out actions are owned by a shared hook so the
  // home page and this page behave identically. The hook handles:
  //   • re-entry guards (synchronous useRef — survives React's
  //     batched re-renders so a double-click can't fire two POSTs)
  //   • try/catch around fetch + json parse so transient network
  //     failures surface as a visible banner instead of a silent
  //     spinner reset (the old behaviour that made users click 3-4
  //     times before anything happened)
  //   • one automatic retry on 5xx / network failure
  //   • per-page SWR refresh after success
  const { clockIn, clockOut, clockingIn, clockingOut, error: clockError, clearError: clearClockError, pulseGate, dismissPulseGate, exitSurveyGate, dismissExitSurveyGate, desktopGate, dismissDesktopGate } = useClockActions({
    mutateKeys: [`/api/hr/attendance?${attendanceQs}`],
    onClockOutSuccess: (rec) => {
      if (typeof rec?.totalMinutes === "number" && rec.totalMinutes >= 540) {
        setDayCompleteToast(true);
      }
    },
  });
  // Auto-collapse the Confirm/Cancel pair after 6s of idle (matches the
  // home page). Lives here so it has both `confirmingClockOut` from
  // local state and `clockingOut` from the hook in scope.
  useEffect(() => {
    if (!confirmingClockOut || clockingOut) return;
    const t = setTimeout(() => setConfirmingClockOut(false), 6000);
    return () => clearTimeout(t);
  }, [confirmingClockOut, clockingOut]);

  const todayRec  = myData?.todayRecord;
  const summary   = myData?.summary || {};
  const records   = myData?.records  || [];
  // Mobile clock-in/out is normally blocked, but ANY non-dismissed
  // On-Duty for today (pending / partially_approved / approved)
  // unlocks it — same rule the server enforces. The flag is
  // pre-computed server-side in /api/hr/attendance and ridden through
  // myData so the UI doesn't need a separate fetch.
  const hasOdToday: boolean = !!(myData?.hasOdToday ?? myData?.hasApprovedOdToday);
  // Effective mobile-block: true only when on mobile AND no OD bypass.
  const mobileBlocked = isMobileDevice && !hasOdToday;
  const days      = ["M","T","W","T","F","S","S"];
  const todayDow  = now.getDay() === 0 ? 6 : now.getDay() - 1;

  const presentRecs = records.filter((r: any) => r.totalMinutes > 0);
  const avgMins     = presentRecs.length > 0
    ? Math.round(presentRecs.reduce((s: number, r: any) => s + r.totalMinutes, 0) / presentRecs.length) : 0;
  const onTimePct   = summary.present > 0
    ? Math.round(((summary.present - (summary.late || 0)) / summary.present) * 100) : 0;

  // GROSS elapsed since the day's FIRST clock-in (live while open; snapshot
  // after clock-out). This is wall-clock time and INCLUDES any break gaps
  // (clocked out for lunch, then back in). Drives the "Gross" tile + the
  // "Since Last Login" counter.
  // Clamp to 0: if the client clock is even one second behind the
  // server-stored clockIn (small drift, post-DST, or just-clocked-in
  // race), Math.floor(-1/60) is -1 and the formatter spits out
  // "-1h -1m" instead of "0h 0m".
  const elapsedMins = todayRec?.clockIn && !todayRec?.clockOut && clock
    ? Math.max(0, Math.floor((clock.getTime() - new Date(todayRec.clockIn).getTime()) / 60000))
    : Math.max(0, todayRec?.totalMinutes || 0);
  const elapsedStr  = fmtMins(elapsedMins);

  // EFFECTIVE worked minutes = Σ each session's own duration, EXCLUDING break
  // gaps between sessions. Mirrors the per-day timeline row's `liveMins`
  // (stored totalMinutes = sum of closed sessions, + the open session's live
  // elapsed) so the header's "Effective" tile agrees with the log below it.
  // Previously the Effective tile reused the gross figure, so a day with a
  // lunch break showed e.g. 7h43m up top vs 7h24m in the log — the gap was
  // the break. Now they match.
  const effectiveMins = (() => {
    if (!todayRec?.clockIn) return 0;
    const stored = Math.max(0, todayRec?.totalMinutes || 0); // Σ closed sessions
    const daySessions: Array<{ clockIn: string; clockOut: string | null }> =
      Array.isArray(todayRec?.sessions) && todayRec.sessions.length > 0
        ? todayRec.sessions
        : [{ clockIn: todayRec.clockIn, clockOut: todayRec.clockOut ?? null }];
    const openSess = daySessions.find((s) => !s.clockOut);
    if (openSess && clock) {
      return stored + Math.max(0, Math.floor((clock.getTime() - new Date(openSess.clockIn).getTime()) / 60000));
    }
    return stored;
  })();
  const effectiveStr = fmtMins(effectiveMins);

  // IST minutes-since-midnight for an arbitrary instant (live clock tick).
  const toIstMinutes = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata", hour12: false, hour: "2-digit", minute: "2-digit",
    }).formatToParts(d).reduce<Record<string, string>>((a, p) => { a[p.type] = p.value; return a; }, {});
    return parseInt(parts.hour || "0", 10) * 60 + parseInt(parts.minute || "0", 10);
  };
  const istMinsSinceMidnight = clock ? toIstMinutes(clock) : 0;

  // Shift window comes from the user's assigned shift template (myData.shift),
  // falling back to the legacy 9:00\u201318:00 when no shift is assigned. Drives the
  // Timings widget, the shift-progress bar, and the "time left" calc \u2014 so each
  // employee sees their OWN hours instead of a hardcoded 9\u20136.
  const parseHM = (s: any, fallback: number): number => {
    if (typeof s !== "string") return fallback;
    const [h, m] = s.split(":").map(Number);
    return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : fallback;
  };
  const SHIFT_START = parseHM(myData?.shift?.startTime, 9 * 60);   // e.g. 10:00 \u2192 600
  const SHIFT_END   = parseHM(myData?.shift?.endTime, 18 * 60);    // e.g. 19:00 \u2192 1140
  const SHIFT_MID   = Math.round((SHIFT_START + SHIFT_END) / 2);   // first/second-half boundary
  const SHIFT_LEN   = Math.max(1, SHIFT_END - SHIFT_START);
  const MID_POS     = SHIFT_MID - SHIFT_START;
  const MID_PCT     = (MID_POS / SHIFT_LEN) * 100;
  // "10:00 AM" style label from minutes-of-day, for the Timings header.
  const fmtShiftTime = (mins: number) => {
    const h24 = Math.floor(mins / 60), mm = mins % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(mm).padStart(2, "0")} ${h24 >= 12 ? "PM" : "AM"}`;
  };
  // Shift used for working-day (weekly-off vs absent) decisions, with its
  // alternate-Saturday anchor (the user's UserShift.effectiveFrom). Null shift
  // → the helper falls back to Mon–Fri.
  const myShift = (myData?.shift ?? null) as any;
  const shiftAnchor = myData?.shiftEffectiveFrom ? new Date(myData.shiftEffectiveFrom) : null;

  // Map an IST minutes value to a 0..540 position within the shift window.
  const toShiftPos = (m: number) => Math.max(0, Math.min(SHIFT_LEN, m - SHIFT_START));

  // Worked span inside the shift window. Null when not clocked in \u2014 bar stays empty.
  let workedStartPos: number | null = null;
  let workedEndPos:   number | null = null;
  if (todayRec?.clockIn) {
    workedStartPos = toShiftPos(toIstMinutes(new Date(todayRec.clockIn)));
    const endIst = todayRec.clockOut
      ? toIstMinutes(new Date(todayRec.clockOut))
      : istMinsSinceMidnight;
    workedEndPos = toShiftPos(endIst);
    if (workedEndPos < workedStartPos) workedEndPos = workedStartPos;
  }

  // Half-day yellow bands (boundary = 2:00 PM IST):
  //  \u2022 first half  (9:00\u20132:00)  yellow when user clocked in on/after 14:00 IST.
  //  \u2022 second half (2:00\u20136:00)  yellow when clock-out landed on/before 14:00 IST.
  const missedFirstHalf  = workedStartPos !== null && workedStartPos >= MID_POS;
  const missedSecondHalf = !!todayRec?.clockOut && workedEndPos !== null && workedEndPos <= MID_POS;

  const progressMins = todayRec?.clockIn ? elapsedMins : 0;

  // "Time left" is relative to a full 9-hour (SHIFT_LEN) shift counted from the
  // employee's actual clock-in, not a wall-clock countdown to 6 PM. If they
  // clock in late, they still owe 9 hours.
  const remainingLabel = !todayRec?.clockIn
    ? "not clocked in"
    : todayRec.clockOut
      ? "\u2713 done"
      : elapsedMins >= SHIFT_LEN
        ? `+${fmtMins(elapsedMins - SHIFT_LEN)} OT`
        : `${fmtMins(SHIFT_LEN - elapsedMins)} left`;

  // Synthesize a "today" row at the top of the log if the server returned none
  // (user hasn't clocked in yet today). Keeps the current day always visible.
  const istTodayIso = (() => {
    const d = clock ?? new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d);
    const y = parts.find(p => p.type === "year")!.value;
    const m = parts.find(p => p.type === "month")!.value;
    const dd = parts.find(p => p.type === "day")!.value;
    return `${y}-${m}-${dd}`;
  })();
  // CEO and developers don't punch a clock — their schedules are flexible
  // and the daily "Absent" markers don't represent anything meaningful for
  // them. Skip synthesizing absent rows in their log. Real clock-ins (if
  // any), weekends, and today's "pending" row are still kept so they can
  // see the few times they did clock in + know what day it is + still
  // click Clock-In if they want.
  const skipAbsentSynthesis = user?.orgLevel === "ceo" || user?.isDeveloper === true;

  const recsWithToday = (() => {
    // Build the list of every IST calendar day in the current view, then fill
    // each day with the matching server record (if any) or a synthetic empty
    // row. This way weekends, holidays, and absent days all appear in the log
    // — the rendering layer already knows how to label W-OFF and Holiday rows.
    const byDate = new Map<string, any>();
    for (const r of records) {
      const k = String(r.date).slice(0, 10);
      byDate.set(k, r);
    }

    // View bounds — start / end IST calendar days, inclusive.
    let start: Date, end: Date;
    if (period === "30d") {
      end = new Date(`${istTodayIso}T00:00:00Z`);
      start = new Date(end.getTime());
      start.setUTCDate(start.getUTCDate() - 29);
    } else {
      const [yy, mm] = month.split("-").map(Number);
      start = new Date(Date.UTC(yy, mm - 1, 1));
      end   = new Date(Date.UTC(yy, mm, 0)); // last day of month
      // Cap month view at today — we don't show future dates.
      const today = new Date(`${istTodayIso}T00:00:00Z`);
      if (end.getTime() > today.getTime()) end = today;
    }

    // Clamp the start to the day my account was created so we don't
    // render "Absent" rows for days before I started using the app.
    // If my account was created mid-period, the log starts at that day.
    // If `appStartIso` is past `end`, the loop yields no rows.
    if (appStartIso) {
      const appStart = new Date(`${appStartIso}T00:00:00Z`);
      if (appStart.getTime() > start.getTime()) start = appStart;
    }

    const out: any[] = [];
    for (let d = new Date(start.getTime()); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const rec = byDate.get(iso);
      if (rec) {
        out.push(rec);
      } else {
        // Off day for THIS user's shift — weekly-off OR a non-working
        // alternate Saturday. Working Saturdays correctly stay "absent".
        const isWeekend = !isWorkingDay(d, myShift, shiftAnchor);
        const isToday = iso === istTodayIso;
        // For CEO / developers, skip synthesizing the "absent" rows —
        // they don't punch a clock, so the cross-mark noise is wrong.
        // Today's pending row + weekends still get synthesized (today
        // so they can still clock in; weekends for calendar context).
        if (skipAbsentSynthesis && !isToday && !isWeekend) continue;
        out.push({
          id: `synthetic-${iso}`,
          date: `${iso}T00:00:00.000Z`,
          clockIn: null,
          clockOut: null,
          totalMinutes: 0,
          // For today with no record yet → "pending" so the existing
          // "Not clocked in yet" branch renders. Weekends → "weekly_off"
          // (rendering looks at isWeekend, not status, but this keeps the
          // status field meaningful for any future consumers). Other gaps →
          // "absent" (no clock-in on a working day).
          status: isToday ? "pending" : isWeekend ? "weekly_off" : "absent",
          location: null,
        });
      }
    }
    // Newest first, matching the original ordering.
    out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return out;
  })();

  // Month period buttons (30 DAYS + last 6 months). Each month carries its
  // YYYY-MM key so December/November correctly fall into the previous year
  // when we're early in the current year.
  type PeriodBtn = { kind: "30d" } | { kind: "month"; label: string; key: string };
  const periodBtns: PeriodBtn[] = [
    { kind: "30d" },
    ...Array.from({ length: 6 }, (_, i): PeriodBtn => {
      const anchor = clock ?? new Date();
      const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
      return {
        kind: "month",
        label: d.toLocaleString("default", { month: "short" }).toUpperCase(),
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      };
    }),
  ];

  const periodLabel = (() => {
    if (period === "30d") return "Last 30 Days";
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
  })();

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">

      {/* ── Day Complete toast — fires once on a clock-out where the
          day's total crossed 9h. Auto-dismisses after 5s. Positioned
          fixed top-center, above all panel content. */}
      {dayCompleteToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] pointer-events-auto animate-toast-in"
        >
          <div className="flex items-center gap-3 bg-white dark:bg-[#001529] border border-emerald-200 dark:border-emerald-500/30 shadow-lg shadow-emerald-500/10 rounded-xl px-4 py-3 min-w-[280px] max-w-[420px]">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 size={18} strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-slate-800 dark:text-white">Day Complete</p>
              <p className="text-[11.5px] text-slate-500 dark:text-slate-400 leading-snug">
                You've reached the 9-hour shift target. Great work!
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDayCompleteToast(false)}
              aria-label="Dismiss"
              className="shrink-0 -mr-1 -my-1 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.05]"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Top Module Tabs ── */}
      <div className="flex items-center bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-4">
        {TOP_TABS.map((t) => (
          <Link key={t.key} href={t.href}
            className={`px-4 py-3 text-[11px] font-bold tracking-widest transition-colors border-b-2 whitespace-nowrap ${
              t.key === "attendance"
                ? "border-[#008CFF] text-[#008CFF]"
                : "border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            }`}>
            {t.label}
          </Link>
        ))}
      </div>

      {/* ── 3-Panel Header ── */}
      <div className="grid grid-cols-2 bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06]">

        {/* ── Panel 1: Attendance Stats ── */}
        <div className="p-5 border-r border-slate-200 dark:border-white/[0.06]">
          <h3 className="text-[13px] font-bold text-slate-800 dark:text-white mb-3">Attendance Stats</h3>

          {/* Period label (matches the API window) + info icon */}
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700 dark:text-white">
              {teamStats?.period?.label || "Last 7 Days"}
            </span>
            <span title="Average effective hours and on-time arrival across the window.">
              <Info size={13} strokeWidth={1.75} className="text-slate-400" />
            </span>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_90px_90px] mb-1 px-3">
            <span />
            <span className="text-[9px] uppercase tracking-widest text-slate-400 font-bold text-right">AVG HRS / DAY</span>
            <span className="text-[9px] uppercase tracking-widest text-slate-400 font-bold text-right">ON TIME ARRIVAL</span>
          </div>

          {/* Me row — falls back to local calc if the team-stats request is still loading. */}
          <div className="grid grid-cols-[1fr_90px_90px] items-center py-3 px-3 rounded-lg bg-slate-50 dark:bg-[#002140]/60 mb-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center shrink-0">
                <User size={14} strokeWidth={2} className="text-white" />
              </div>
              <span className="text-[13px] font-semibold text-slate-800 dark:text-white">Me</span>
            </div>
            <span className="text-[15px] font-bold text-slate-800 dark:text-white text-right">
              {fmtMins(teamStats?.me?.avgMinutes ?? avgMins)}
            </span>
            <span className="text-[15px] font-bold text-slate-800 dark:text-white text-right">
              {(teamStats?.me?.onTimePct ?? onTimePct)}%
            </span>
          </div>

          {/* My Team row — resolves peers by matching teamCapsule. */}
          <div className="grid grid-cols-[1fr_90px_90px] items-center py-3 px-3 rounded-lg bg-slate-50 dark:bg-[#002140]/60">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[#008CFF] flex items-center justify-center shrink-0">
                <Users size={13} strokeWidth={2} className="text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-slate-800 dark:text-white leading-tight">My Team</p>
                {teamStats?.team?.teamCapsule && (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight truncate">
                    {teamStats.team.teamCapsule} · {teamStats.team.memberCount} {teamStats.team.memberCount === 1 ? "member" : "members"}
                  </p>
                )}
                {!teamStats?.team?.teamCapsule && teamStats && (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">No team assigned</p>
                )}
              </div>
            </div>
            <span className="text-[15px] font-bold text-slate-800 dark:text-white text-right">
              {teamStats?.team?.memberCount ? fmtMins(teamStats.team.avgMinutes) : "—"}
            </span>
            <span className="text-[15px] font-bold text-slate-800 dark:text-white text-right">
              {teamStats?.team?.memberCount ? `${teamStats.team.onTimePct}%` : "—"}
            </span>
          </div>
        </div>

        {/* ── Panel 3: Actions ── */}
        <div className="p-5">
          <h3 className="text-[13px] font-bold text-slate-800 dark:text-white mb-4">Actions</h3>

          {/* Clock cluster on top, quick-action pills below it. */}
          <div className="flex flex-col gap-4">

            {/* Top row aligned to the 4-pill grid below: clock in the first
                column, totals centred in the middle, button right-aligned in
                the last column. Fills the width without flinging items apart. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 items-stretch">

            {/* Tile 1 — current time + date */}
            <div className="flex flex-col justify-center rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-[#0a1526] px-3 py-2">
              <p className="font-bold text-slate-800 dark:text-white leading-none whitespace-nowrap" suppressHydrationWarning
                style={{ fontSize: "1.15rem", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                {clock
                  ? clock.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: !use24 }).replace(/\s?(am|pm)/i, "")
                  : "--:--:--"}
                {!use24 && clock && (
                  <span className="text-[11px] font-bold ml-1.5">{clock.getHours() >= 12 ? "PM" : "AM"}</span>
                )}
              </p>
              <p className="mt-1 text-[10.5px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap" suppressHydrationWarning>
                {clock ? clock.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", month: "short", year: "numeric" }) : ""}
              </p>
            </div>

            {/* Tile 2 — effective hours (worked time, breaks EXCLUDED — matches
                the timeline log's Effective/Gross column). */}
            <div className="flex flex-col justify-center rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-[#0a1526] px-3 py-2">
              <p className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-slate-400 font-bold leading-none mb-1.5">Effective <Info size={9} strokeWidth={2} /></p>
              <p className="text-[15px] font-bold text-slate-800 dark:text-white leading-none tabular-nums">{todayRec?.clockIn ? effectiveStr : "0h 0m"}</p>
            </div>

            {/* Tile 3 — gross hours (wall-clock since first clock-in, breaks
                INCLUDED). */}
            <div className="flex flex-col justify-center rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-[#0a1526] px-3 py-2">
              <p className="text-[9px] uppercase tracking-wider text-slate-400 font-bold leading-none mb-1.5">Gross</p>
              <p className="text-[15px] font-bold text-slate-800 dark:text-white leading-none tabular-nums">{todayRec?.clockIn ? elapsedStr : "0h 0m"}</p>
            </div>

            {/* Tile 4 — clock-in/out button, centred in the last column */}
            <div className="flex flex-col gap-2 items-center justify-center">
              {/* Location permission warning — attendance requires location. */}
              {!todayRec?.clockIn && locPerm === "denied" && (
                <div className="max-w-xs px-3 py-2 rounded-md bg-red-50 text-red-700 border border-red-200 text-[11px] leading-snug">
                  <strong>Location access blocked.</strong> You must enable location in your browser settings to clock in. Reload the page after allowing it.
                </div>
              )}
              {!todayRec?.clockIn && locPerm === "unsupported" && (
                <div className="max-w-xs px-3 py-2 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-[11px] leading-snug">
                  <strong>Location unavailable.</strong> Your browser can't share your location (HTTPS or a supported browser is required). Clock-in needs location.
                </div>
              )}
              {/* Button — multi-session aware:
                  · Not clocked in yet         → "Web Clock-In"
                  · Currently clocked in       → "Web Clock-Out"
                  · Clocked out, on break      → "Web Clock-In" (same
                    label — was "Resume Clock-In" but that wording felt
                    wrong on a half-day where the employee isn't really
                    "resuming" anything; treat every new session as a
                    plain clock-in regardless of prior sessions).
                  Day Complete is shown as an adjacent badge when 9h has
                  been accumulated, NOT as a terminal state — the rule is
                  employees can keep punching in/out throughout the day. */}
              {/* Color = action affordance: green for any clock-IN
                  (start / resume), red for clock-OUT. Same scheme as
                  the home Quick-Access tile.
                  Look: vertical gradient (lit-from-above), inset
                  white sheen at top so the button reads as raised,
                  and a soft outer halo in the button's own colour
                  that grows on hover (subtle "press to act" feel
                  without animation gimmicks). */}
              {/* `bg-green-600` / `bg-red-600` are kept on these buttons
                  (in addition to the inline gradient) only because
                  globals.css forces `.text-white` → near-black in light
                  mode UNLESS the element also has a `bg-*color*-*`
                  class. The class is visually overridden by the
                  inline gradient — its only job is to trigger the
                  "preserve white text" rule. Don't remove. */}
              {!todayRec?.clockIn ? (
                <div className="flex flex-col gap-1 w-fit">
                  {/* Sticky error banner — replaces the old `alert()`
                      which users dismissed without reading. Stays put
                      until the user clicks ✕ or retries successfully. */}
                  {clockError && (
                    <div className="flex items-start gap-1.5 max-w-[420px] px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-[11.5px] leading-tight">
                      <AlertCircle size={13} className="shrink-0 mt-px" />
                      <span className="flex-1">{clockError.message}</span>
                      <button onClick={clearClockError} className="shrink-0 text-rose-500 hover:text-rose-700" aria-label="Dismiss">
                        <X size={11} />
                      </button>
                    </div>
                  )}
                  <button onClick={mobileBlocked ? undefined : clockIn}
                    disabled={clockingIn || mobileBlocked}
                    style={{
                      background: "linear-gradient(180deg, #22c55e 0%, #15803d 100%)",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 14px -4px rgba(34,197,94,0.55), 0 1px 2px rgba(0,0,0,0.08)",
                    }}
                    className="h-8 px-4 bg-green-600 text-white rounded-lg text-[12.5px] font-semibold whitespace-nowrap w-fit transition-all duration-150 hover:brightness-110 hover:-translate-y-px disabled:opacity-70 disabled:cursor-wait disabled:hover:translate-y-0">
                    {clockingIn ? "Getting location…" : clockInLabel}
                  </button>
                  {mobileBlocked && (
                    <span className="text-center text-[10px] leading-tight text-slate-500 dark:text-slate-400">
                      Only accessible on Laptop &amp; Desktop
                    </span>
                  )}
                  {isMobileDevice && hasOdToday && (
                    <span className="text-center text-[10px] leading-tight text-emerald-600 dark:text-emerald-400">
                      Mobile enabled — On-Duty today
                    </span>
                  )}
                </div>
              ) : !todayRec?.clockOut ? (
                // Two-step confirmation. First click splits the single
                // Web Clock-Out button into a red Confirm + dark Cancel
                // pair (Keka pattern). Auto-collapses after 6s.
                confirmingClockOut ? (
                  <div className="flex items-center gap-1.5 w-fit">
                    <button
                      onClick={async () => {
                        // The hook owns the in-flight guard. After it
                        // resolves we collapse the Confirm/Cancel pair.
                        await clockOut();
                        setConfirmingClockOut(false);
                      }}
                      disabled={clockingOut}
                      style={{
                        background: "linear-gradient(180deg, #ef4444 0%, #b91c1c 100%)",
                        boxShadow:  "inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 14px -4px rgba(239,68,68,0.55), 0 1px 2px rgba(0,0,0,0.08)",
                      }}
                      className="h-8 px-4 bg-red-600 text-white rounded-lg text-[12.5px] font-semibold whitespace-nowrap transition-all duration-150 hover:brightness-110 hover:-translate-y-px disabled:opacity-70 disabled:cursor-wait disabled:hover:translate-y-0"
                    >
                      {clockingOut ? "Clocking out…" : confirmClockOutLabel}
                    </button>
                    <button
                      onClick={() => setConfirmingClockOut(false)}
                      disabled={clockingOut}
                      style={{
                        background: "linear-gradient(180deg, #334155 0%, #1e293b 100%)",
                        boxShadow:  "inset 0 1px 0 rgba(255,255,255,0.12), 0 1px 2px rgba(0,0,0,0.10)",
                      }}
                      className="h-8 px-4 bg-slate-700 text-white rounded-lg text-[12.5px] font-semibold whitespace-nowrap transition-all duration-150 hover:brightness-110 disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 w-fit">
                    {clockError && (
                      <div className="flex items-start gap-1.5 max-w-[420px] px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-[11.5px] leading-tight">
                        <AlertCircle size={13} className="shrink-0 mt-px" />
                        <span className="flex-1">{clockError.message}</span>
                        <button onClick={clearClockError} className="shrink-0 text-rose-500 hover:text-rose-700" aria-label="Dismiss">
                          <X size={11} />
                        </button>
                      </div>
                    )}
                    <button onClick={mobileBlocked ? undefined : () => setConfirmingClockOut(true)}
                      disabled={mobileBlocked}
                      style={{
                        background: "linear-gradient(180deg, #ef4444 0%, #b91c1c 100%)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 14px -4px rgba(239,68,68,0.55), 0 1px 2px rgba(0,0,0,0.08)",
                      }}
                      className="h-8 px-4 bg-red-600 text-white rounded-lg text-[12.5px] font-semibold whitespace-nowrap w-fit transition-all duration-150 hover:brightness-110 hover:-translate-y-px disabled:opacity-70 disabled:cursor-not-allowed">
                      {clockOutLabel}
                    </button>
                    {mobileBlocked && (
                      <span className="text-center text-[10px] leading-tight text-slate-500 dark:text-slate-400">
                        Only accessible on Laptop &amp; Desktop
                      </span>
                    )}
                    {isMobileDevice && hasOdToday && (
                      <span className="text-center text-[10px] leading-tight text-emerald-600 dark:text-emerald-400">
                        Mobile enabled — On-Duty today
                      </span>
                    )}
                  </div>
                )
              ) : (
                <div className="flex flex-col gap-1.5 w-fit">
                  {/* Sticky error banner — see comment on the matching
                      banner above. Shown next to whichever clock-in
                      variant the day is in. */}
                  {clockError && (
                    <div className="flex items-start gap-1.5 max-w-[420px] px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-[11.5px] leading-tight">
                      <AlertCircle size={13} className="shrink-0 mt-px" />
                      <span className="flex-1">{clockError.message}</span>
                      <button onClick={clearClockError} className="shrink-0 text-rose-500 hover:text-rose-700" aria-label="Dismiss">
                        <X size={11} />
                      </button>
                    </div>
                  )}
                  <button onClick={mobileBlocked ? undefined : clockIn} disabled={clockingIn || mobileBlocked}
                    style={{
                      background: "linear-gradient(180deg, #22c55e 0%, #15803d 100%)",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 14px -4px rgba(34,197,94,0.55), 0 1px 2px rgba(0,0,0,0.08)",
                    }}
                    className="h-8 px-4 bg-green-600 text-white rounded-lg text-[12.5px] font-semibold whitespace-nowrap w-fit transition-all duration-150 hover:brightness-110 hover:-translate-y-px disabled:opacity-70 disabled:cursor-wait disabled:hover:translate-y-0">
                    {clockingIn ? "Getting location…" : clockInLabel}
                  </button>
                  {mobileBlocked && (
                    <span className="text-center text-[10px] leading-tight text-slate-500 dark:text-slate-400">
                      Only accessible on Laptop &amp; Desktop
                    </span>
                  )}
                  {isMobileDevice && hasOdToday && (
                    <span className="text-center text-[10px] leading-tight text-emerald-600 dark:text-emerald-400">
                      Mobile enabled — On-Duty today
                    </span>
                  )}
                </div>
              )}

              {/* Elapsed since clock-in — lives right under the button, Keka-style */}
              {todayRec?.clockIn && (
                <div className="w-fit">
                  <p className="text-[14px] font-bold text-[#008CFF] leading-none tabular-nums">
                    {elapsedStr.replace(" ", ":")}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Since {todayRec.clockOut ? "Last Clock-in" : "Last Login"}
                  </p>
                </div>
              )}

            </div>
          </div>

          {/* Full-width quick-action row — 4 across, fills the panel width */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-slate-100 dark:border-white/[0.06] pt-4">
            {[
              ...(canApplyWfh ? [{ label: "Work From Home", Icon: Home, onClick: () => openForm("wfh") }] : []),
              { label: "On Duty",           Icon: Briefcase,  onClick: () => openForm("on_duty")   },
              { label: "Regularization",    Icon: ShieldCheck,onClick: () => { setSubTab("requests"); setReqType("punch"); setShowRegModal(true); } },
              { label: "Apply Leave",       Icon: Coffee,     onClick: () => openForm("leave")     },
            ].map(({ label, Icon, onClick }) => (
              <button key={label} onClick={onClick}
                className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0a1526] px-3 text-[12px] font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap transition-colors hover:border-[#008CFF]/40 hover:text-[#008CFF] hover:bg-[#008CFF]/[0.04]">
                <Icon size={13} strokeWidth={1.9} className="shrink-0 text-[#008CFF]" />
                {label}
              </button>
            ))}
          </div>
          </div>{/* end actions stack */}
        </div>{/* end Panel 3 */}
      </div>{/* end 3-panel header */}

      {/* ── Logs & Requests ──────────────────────────────────────
          Hidden entirely for CEO + Developer users — their schedules
          are flexible and the per-day log is just noise. The Stats
          card + clock-in button at the top still apply if they ever
          want to record a punch; only this big table is gone.
          `skipAbsentSynthesis` is the same predicate we use above to
          drop the synthesised "Absent" rows.

          NOTE: the modals (RegularizeModal / LeaveRequestForm) sit
          inside the same wrapper but render `fixed inset-0`, so they
          must STAY in the tree even for CEO/dev — only the table
          chrome is wrapped in the conditional. */}
      <div className="px-6 pt-5 pb-8">
        {/* ── Logs & Requests ──────────────────────────────
            The SAME rich component HR / developers see on a person’s profile
            (src/components/hr/EmployeeTimePanel). Rendered in SELF mode:
            isHRAdmin=false + meDbId === userId ⇒ isSelfView, so every
            on-behalf / HR-only action is hidden and only the employee’s own
            self-actions show. The server also forces a non-admin to their own
            record, so no other person’s data is reachable. */}
        {myId != null && (
          <EmployeeTimePanel
            userId={myId}
            userName={String(user?.name ?? "")}
            isHRAdmin={false}
            meDbId={myId}
            joiningDate={appStartIso}
            workLocation={myWorkLocation}
            targetOrgLevel={user?.orgLevel ?? null}
            targetIsDeveloper={user?.isDeveloper === true}
            shiftStartTime={myShiftData?.shift?.startTime ?? null}
            shiftEndTime={null}
            shiftBreakMinutes={myShiftData?.shift?.breakMinutes ?? null}
            viewerIsGaganDev={false}
            onSelfApply={(kind, date) => openForm(kind, date)}
          />
        )}
      {showRegModal && (
        <RegularizeModal
          prefillDate={regPrefillDate}
          onClose={() => { setShowRegModal(false); setRegPrefillDate(undefined); }}
        />
      )}
      {formState && (
        <LeaveRequestForm
          kind={formState.kind}
          title={FORM_TITLE[formState.kind]}
          policyText={FORM_POLICY[formState.kind]}
          leaveTypes={leaveTypes}
          prefillDate={formState.prefillDate}
          onClose={() => setFormState(null)}
        />
      )}
      <PulseGateModal gate={pulseGate} onDismiss={dismissPulseGate} />
      <ExitSurveyGateModal gate={exitSurveyGate} onDismiss={dismissExitSurveyGate} />
      <DesktopGateModal gate={desktopGate} onDismiss={dismissDesktopGate} />
      </div>
    </div>
  );
}
