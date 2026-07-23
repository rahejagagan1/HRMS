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
  if (!liveMins || liveMins <= 0) return <span className="text-[11px] text-slate-400">—</span>;
  const SHIFT_LEN = 540; // 9h in minutes
  const pct = Math.min((liveMins / SHIFT_LEN) * 100, 100);
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
  const outLabel = lastOut ? fmt(lastOut) : (isOpen ? "now" : null);
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
       {!skipAbsentSynthesis && (
       <>

        {/* Section header */}
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[15px] font-semibold text-slate-800 dark:text-white">Logs & Requests</h3>
          {/* 24-hour format toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">24 hour format</span>
            <div onClick={() => setUse24(v => !v)}
              className={`w-9 h-5 rounded-full relative transition-colors duration-200 ${use24 ? "bg-[#008CFF]" : "bg-slate-200 dark:bg-white/10"}`}>
              <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-all duration-200 shadow ${use24 ? "left-[calc(100%-18px)]" : "left-0.5"}`} />
            </div>
          </label>
        </div>

        {/* Sub-tabs */}
        <div className="flex gap-0 border-b border-slate-200 dark:border-white/[0.06] mb-5">
          {([
            ["log",      "Attendance Log"],
            ["calendar", "Calendar"],
            ["requests", "Attendance Requests"],
          ] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSubTab(k as any)}
              className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                subTab === k
                  ? "border-[#008CFF] text-[#008CFF]"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white"
              }`}>{l}</button>
          ))}
        </div>

        {subTab === "log" && (
          <>
            {/* Period row */}
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-[14px] font-semibold text-slate-800 dark:text-white">{periodLabel}</h4>
              <div className="flex items-center gap-1">
                {periodBtns.map((btn, i) => {
                  const isActive = btn.kind === "30d" ? period === "30d" : (period === "month" && month === btn.key);
                  const label    = btn.kind === "30d" ? "30 DAYS" : btn.label;
                  return (
                    <button
                      key={btn.kind === "30d" ? "30d" : btn.key}
                      type="button"
                      onClick={() => {
                        if (btn.kind === "30d") setPeriod("30d");
                        else { setPeriod("month"); setMonth(btn.key); }
                      }}
                      className={`h-8 px-3 rounded-full text-[11px] font-semibold transition-colors ${
                        isActive
                          ? "bg-[#008CFF] text-white"
                          : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-800 dark:hover:text-white"
                      }`}
                    >{label}</button>
                  );
                })}
                {/* List/Calendar toggle — mirrors the sub-tab switcher above
                    so users can flip between log and calendar views from the
                    period row as well. */}
                <div className="flex ml-2 border border-slate-200 dark:border-white/[0.08] rounded-lg overflow-hidden">
                  {/* Rendered inside `subTab === "log"`; TS narrows subTab
                      here, so the List toggle is always pressed and the
                      Calendar toggle is always unpressed. */}
                  <button
                    type="button"
                    aria-label="List view"
                    aria-pressed={true}
                    onClick={() => setSubTab("log")}
                    className="px-2 py-1.5 bg-[#008CFF]/10 text-[#008CFF]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label="Calendar view"
                    aria-pressed={false}
                    onClick={() => setSubTab("calendar")}
                    className="px-2 py-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Table — overflow-visible so row kebab dropdowns aren't clipped. */}
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-visible">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/[0.06] bg-slate-50/60 dark:bg-white/[0.02]">
                    {["DATE","TIMELINE","EFFECTIVE","GROSS","LOG",""].map((h) => (
                      <th
                        key={h || "actions"}
                        // DATE stays left (conventional for a row's
                        // anchor/identifier column). Everything else is
                        // centred — both the header label AND the cell
                        // content below — so each column reads as one
                        // visually-aligned stack from header → row.
                        className={`px-5 py-3 ${h === "DATE" ? "text-left" : "text-center"} text-[10.5px] uppercase tracking-[0.14em] font-bold text-slate-500 dark:text-slate-400`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recsWithToday.map((rec: any) => {
                    const date      = new Date(rec.date);
                    const dateIso   = String(rec.date).slice(0, 10);
                    const isTodayRow = dateIso === istTodayIso;
                    const isWeekend = !isWorkingDay(date, myShift, shiftAnchor);
                    const isHoliday = rec.status === "holiday";
                    const isLeave   = rec.status === "on_leave";
                    // LOP penalties applied by the auto-LOP job — must be visible to
                    // the employee + HR (full-day = absence, half-day = unregularized
                    // missed clock-out). Rendered as a badge + row text + LOG icon below.
                    const isFullLop    = rec.status === "lop";
                    const isHalfDayLop = rec.status === "half_day_lop";
                    const isLop        = isFullLop || isHalfDayLop;
                    const isPending = rec.status === "pending" && !rec.clockIn;
                    // Has a pending request for this date? Any type (regularize, WFH,
                    // On-Duty, or Leave that covers this date) flips the row to
                    // "Pending approval" and disables re-submission of the same kind.
                    // BOTH "pending" (L1 not yet acted) AND "partially_approved"
                    // (manager approved, awaiting HR's final L2) count as
                    // pending from the employee's perspective — the request is
                    // still being processed, so MISSED / LATE chips must stay
                    // hidden. (Earlier bug: the boolean only checked "pending",
                    // so the row reverted to MISSED the moment a manager
                    // approved L1.)
                    const isOpen = (s: string) => s === "pending" || s === "partially_approved";
                    const hasPendingReg = Array.isArray(regsData) && regsData.some(
                      (r: any) => isOpen(r.status) && String(r.date).slice(0, 10) === dateIso
                    );
                    const hasPendingWfh = Array.isArray(wfhData) && wfhData.some(
                      (r: any) => isOpen(r.status) && String(r.date).slice(0, 10) === dateIso
                    );
                    const hasPendingOd  = Array.isArray(odData) && odData.some(
                      (r: any) => isOpen(r.status) && String(r.date).slice(0, 10) === dateIso
                    );
                    const hasPendingLeave = myLeaves.some((l: any) => {
                      if (l.status !== "pending" && l.status !== "partially_approved") return false;
                      const from = String(l.fromDate).slice(0, 10);
                      const to   = String(l.toDate).slice(0, 10);
                      return dateIso >= from && dateIso <= to;
                    });
                    const pendingKind =
                      hasPendingReg   ? "regularization" :
                      hasPendingLeave ? "leave" :
                      hasPendingWfh   ? "WFH" :
                      hasPendingOd    ? "On-Duty" :
                      null;
                    const hasPendingAny = pendingKind !== null;
                    // Approved WFH for this date — drives the "WFH" / "Half Day WFH" attendance label.
                    const approvedWfh = Array.isArray(wfhData) && wfhData.find(
                      (r: any) => r.status === "approved" && String(r.date).slice(0, 10) === dateIso
                    );
                    // Half-day WFH is tagged in the reason as [First Half] /
                    // [Second Half] (the request form's marker) — detect which.
                    const wfhReason = String(approvedWfh ? approvedWfh.reason ?? "" : "");
                    const wfhFirst  = /\[first\s+half\]/i.test(wfhReason);
                    const wfhSecond = /\[second\s+half\]/i.test(wfhReason);
                    const approvedWfhKind = approvedWfh
                      ? (wfhFirst ? "1st Half WFH" : wfhSecond ? "2nd Half WFH" : "WFH")
                      : null;
                    // Approved leave that covers this date — shows "On Leave" plus the type name.
                    const approvedLeave = myLeaves.find((l: any) => {
                      if (l.status !== "approved") return false;
                      const from = String(l.fromDate).slice(0, 10);
                      const to   = String(l.toDate).slice(0, 10);
                      return dateIso >= from && dateIso <= to;
                    });
                    const onLeave = !!approvedLeave || rec.status === "on_leave";
                    // Stage 4 — half-day leave parity with WFH: detect which half
                    // is leave (same [First Half]/[Second Half] marker) and show
                    // BOTH segments — the leave half plus the working other half
                    // (WFH if a WFH covers it, else expected office).
                    const leaveReason = String(approvedLeave ? approvedLeave.reason ?? "" : "");
                    const leaveFirst  = /\[first\s+half\]/i.test(leaveReason);
                    const leaveSecond = /\[second\s+half\]/i.test(leaveReason);
                    const leaveHalf   = leaveFirst || leaveSecond;
                    const leaveTypeName = approvedLeave?.leaveType?.name;
                    const leaveLabel = approvedLeave
                      ? (leaveHalf
                          ? `${leaveFirst ? "1st" : "2nd"} Half Leave${leaveTypeName ? ` · ${leaveTypeName}` : ""} · ${leaveFirst ? "2nd" : "1st"} Half ${approvedWfh ? "WFH" : "Office"}`
                          : `On Leave${leaveTypeName ? ` · ${leaveTypeName}` : ""}`)
                      : (approvedLeave?.leaveType?.name ? `On Leave · ${approvedLeave.leaveType.name}` : "On Leave");

                    // Stage 3 — for a HALF-day WFH, describe the OTHER half so the
                    // log shows BOTH segments (e.g. 1st-half WFH + 2nd-half office).
                    // The other half is "Leave" when an approved leave covers this
                    // date, otherwise the employee is expected in office.
                    const wfhOtherHalfLabel =
                      approvedWfh && (wfhFirst || wfhSecond)
                        ? `${wfhFirst ? "2nd" : "1st"} Half ${approvedLeave ? "Leave" : "Office"}`
                        : null;

                    // Specific request rows for this date — used to surface the
                    // requested time window in the centered text label.
                    const pendingRegRow = Array.isArray(regsData)
                      ? regsData.find((r: any) => (r.status === "pending" || r.status === "partially_approved") && String(r.date).slice(0, 10) === dateIso)
                      : null;
                    const approvedRegRow = Array.isArray(regsData)
                      ? regsData.find((r: any) => r.status === "approved" && String(r.date).slice(0, 10) === dateIso)
                      : null;
                    const pendingLeaveRow = myLeaves.find((l: any) => {
                      if (l.status !== "pending" && l.status !== "partially_approved") return false;
                      const from = String(l.fromDate).slice(0, 10);
                      const to   = String(l.toDate).slice(0, 10);
                      return dateIso >= from && dateIso <= to;
                    });
                    const fmtT = (d: any) => d
                      ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
                      : null;
                    const regWindow = (r: any) => r?.requestedIn && r?.requestedOut
                      ? `${fmtT(r.requestedIn)} → ${fmtT(r.requestedOut)}`
                      : null;
                    // Split-day summary for a PENDING half-day WFH / leave — the
                    // employee should see which half is which while the request
                    // is still in flight, not only after approval (parity with
                    // the admin profile view's split label).
                    const pendingWfhRow = Array.isArray(wfhData)
                      ? wfhData.find((r: any) => isOpen(r.status) && String(r.date).slice(0, 10) === dateIso)
                      : null;
                    const pHalf = (reason: any): "first" | "second" | null => {
                      const s = String(reason ?? "");
                      return /\[first\s+half\]/i.test(s) ? "first" : /\[second\s+half\]/i.test(s) ? "second" : null;
                    };
                    const pendingWfhHalf   = pendingWfhRow ? pHalf(pendingWfhRow.reason) : null;
                    const pendingLeaveHalf = pendingLeaveRow ? pHalf(pendingLeaveRow.reason) : null;
                    const pendingSplitLabel = (() => {
                      if (!pendingWfhHalf && !pendingLeaveHalf) return null;
                      const kind = (which: "first" | "second") =>
                        pendingLeaveHalf === which ? (pendingLeaveRow?.leaveType?.name || "Leave")
                        : pendingWfhHalf === which ? "WFH"
                        : "Office";
                      return `1st Half ${kind("first")} · 2nd Half ${kind("second")}`;
                    })();
                    // Missed clock-out: clocked in on a past day but never clocked out.
                    // Either the server has already flagged it (status === "missed_clock_out")
                    // or the sweeper hasn't run yet but the row is stale. Either way, we must
                    // NOT tick the timer — otherwise the display drifts to 24h+ forever.
                    // Once a regularization is approved (isRegularized = true), the row is
                    // considered settled regardless of whether clockOut got a value, so the
                    // missed-clockout banner clears. Same for on-leave days.
                    // NOTE: `onLeave` is computed a few lines down but declared via `var`-like
                    // hoisting via `const` isn't possible; we inline the same check here.
                    const _onLeaveQuickCheck = rec.status === "on_leave" || myLeaves.some((l: any) => {
                      if (l.status !== "approved") return false;
                      const from = String(l.fromDate).slice(0, 10);
                      const to   = String(l.toDate).slice(0, 10);
                      return dateIso >= from && dateIso <= to;
                    });
                    const missedClockOut = rec.clockIn && !rec.clockOut && !isTodayRow && !rec.isRegularized && !_onLeaveQuickCheck;
                    // Sessions list (one entry per (in, out) pair). Older
                    // backends may not yet ship `sessions`; fall back to a
                    // synthetic single-session list so the UI keeps working.
                    // clockInLocation / clockOutLocation are JSON-stringified
                    // geo blobs (or null when the punch had no geo).
                    type Sess = { clockIn: string; clockOut: string | null; clockInLocation?: string | null; clockOutLocation?: string | null };
                    const sessions: Sess[] =
                      Array.isArray(rec.sessions) && rec.sessions.length > 0
                        ? rec.sessions
                        : (rec.clockIn ? [{ clockIn: rec.clockIn, clockOut: rec.clockOut ?? null, clockInLocation: rec.location ?? null, clockOutLocation: null }] : []);
                    const openSession = sessions.find((s) => !s.clockOut);
                    const isCurrentlyClockedIn = isTodayRow && !!openSession;
                    const isOnBreak = isTodayRow && !openSession && sessions.some((s) => s.clockOut) && !rec.isRegularized
                      ? sessions.length > 0 && (rec.totalMinutes || 0) < 540
                      : false;

                    // Live elapsed: sum of all closed sessions + (now - openSession.clockIn)
                    // when there's an open one. While clocked out (on break or done) the
                    // counter is frozen at the recorded totalMinutes — the wall clock keeps
                    // ticking but the worked-hours figure does NOT.
                    const liveMins = (() => {
                      if (!isTodayRow) return rec.totalMinutes || 0;
                      const stored = rec.totalMinutes || 0;
                      if (openSession && clock) {
                        const openStart = new Date(openSession.clockIn).getTime();
                        return stored + Math.max(0, Math.floor((clock.getTime() - openStart) / 60000));
                      }
                      return stored;
                    })();
                    const hrs       = liveMins ? fmtMins(liveMins) : "0h 0m";
                    // GROSS = wall-clock span from the first clock-in to the last
                    // clock-out (or now, while a session is open), INCLUDING break
                    // gaps between sessions. `liveMins`/`hrs` above is EFFECTIVE
                    // (worked time, breaks excluded); gross ≥ effective, and the
                    // difference is the break time. Both agree with the header
                    // tiles (Effective vs Gross) so the two surfaces never
                    // contradict on a day with a lunch break.
                    const grossMins = (() => {
                      const firstInMs = sessions[0]?.clockIn ? new Date(sessions[0].clockIn).getTime() : null;
                      if (firstInMs == null) return liveMins;
                      let endMs: number | null;
                      if (openSession) endMs = isTodayRow && clock ? clock.getTime() : null;
                      else {
                        const lastOut = sessions[sessions.length - 1]?.clockOut ?? rec.clockOut ?? null;
                        endMs = lastOut ? new Date(lastOut).getTime() : null;
                      }
                      if (endMs == null) return liveMins; // open but no live clock / missing data → fall back
                      return Math.max(liveMins, Math.floor((endMs - firstInMs) / 60000));
                    })();
                    const grossStr  = grossMins ? fmtMins(grossMins) : "0h 0m";
                    const pct       = liveMins ? Math.min((liveMins / 540) * 100, 100) : 0;
                    const met9h     = liveMins >= 540;
                    const hasClock  = !!rec.clockIn;
                    // First clock-in past the 10:00 AM IST cutoff → "Late".
                    // Uses the FIRST session's clockIn so resume sessions don't
                    // accidentally clear / set the flag.
                    const firstIn = sessions[0]?.clockIn ? new Date(sessions[0].clockIn) : null;
                    // Late = first clock-in past the SHIFT-SPECIFIC
                    // cutoff (shift.startTime + breakMinutes). The
                    // previous rule was a hardcoded "IST hour >= 10"
                    // which mis-fired on:
                    //   • NB Media's 5-min grace (10:03 was wrongly LATE)
                    //   • YT Labs's 11:00 start (everyone always LATE)
                    // istMinutesOfDay-equivalent inline so we don't
                    // pull an extra import into this large client file.
                    const isLateFirstIn = !!firstIn && (() => {
                      const totalUtcMin = firstIn.getUTCHours() * 60 + firstIn.getUTCMinutes();
                      const istMin      = (totalUtcMin + 330) % (24 * 60); // +5:30
                      return istMin > lateCutoffMin;
                    })();

                    return (
                      <tr key={rec.id || rec.date}
                        className={`border-b border-slate-100 dark:border-white/[0.04] transition-colors ${
                          isTodayRow ? "bg-[#008CFF]/5 dark:bg-[#008CFF]/5"
                          : isHoliday ? "bg-amber-50/60 dark:bg-yellow-900/10"
                          : isWeekend ? "bg-slate-50/80 dark:bg-white/[0.015]"
                          : "hover:bg-slate-50/50 dark:hover:bg-white/[0.02]"
                        }`}>

                        {/* DATE */}
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] text-slate-800 dark:text-white font-medium">
                              {date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", month: "short" })}
                            </span>
                            {isTodayRow && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#008CFF]/15 text-[#008CFF] font-bold uppercase tracking-wider">Today</span>
                            )}
                            {isHoliday && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-600 dark:text-amber-400 font-bold">HLDY</span>
                            )}
                            {isWeekend && !isHoliday && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-slate-400 font-bold">W-OFF</span>
                            )}
                            {onLeave && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 font-bold">LEAVE</span>
                            )}
                            {isLop && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 font-bold uppercase tracking-wider">
                                {isHalfDayLop ? "½ DAY LOP" : "LOP"}
                              </span>
                            )}
                            {/* MISSED — hidden as soon as the employee has
                                either a PENDING or an APPROVED regularization
                                for this day, OR the Attendance row itself
                                has been flagged isRegularized=true (server
                                already corrected the row even if regsData
                                hasn't refreshed in this client yet). */}
                            {missedClockOut && !hasPendingAny && !approvedRegRow && !rec.isRegularized && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold uppercase tracking-wider">Missed</span>
                            )}
                            {/* LATE — first clock-in past 10:00 AM IST.
                                Hidden when a regularization is pending OR
                                approved for the day, OR the Attendance row
                                already carries isRegularized=true. Without
                                the third guard, approved late-clock-in
                                regularizations leave the LATE chip up if
                                regsData hadn't been refreshed yet. */}
                            {isLateFirstIn && hasClock && !hasPendingAny && !approvedRegRow && !rec.isRegularized && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-bold uppercase tracking-wider">Late</span>
                            )}
                            {/* "ON BREAK" — currently between sessions on
                                today's row. Day still in progress, timer
                                paused. */}
                            {isOnBreak && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-bold uppercase tracking-wider">On break</span>
                            )}
                            {hasPendingAny && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#008CFF]/15 text-[#008CFF] font-bold uppercase tracking-wider">Pending</span>
                            )}
                            {/* Pending HALF-day request — show which half is
                                which right next to the Pending chip (matches
                                the admin profile's split-day summary). */}
                            {hasPendingAny && pendingSplitLabel && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-bold uppercase tracking-wider">
                                {pendingSplitLabel}
                              </span>
                            )}
                            {!hasPendingAny && approvedWfhKind && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold uppercase tracking-wider">
                                {approvedWfhKind}
                              </span>
                            )}
                            {!hasPendingAny && wfhOtherHalfLabel && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold uppercase tracking-wider">
                                {wfhOtherHalfLabel}
                              </span>
                            )}
                            {/* Half-day LEAVE without a WFH covering the other half —
                                badge both segments so the employee sees they worked
                                the other half at office (the WFH cases above already
                                show both halves). */}
                            {!hasPendingAny && leaveHalf && !approvedWfh && (
                              <>
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-bold uppercase tracking-wider">
                                  {leaveFirst ? "1st" : "2nd"} Half Leave{leaveTypeName ? ` · ${leaveTypeName}` : ""}
                                </span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold uppercase tracking-wider">
                                  {leaveFirst ? "2nd" : "1st"} Half Office
                                </span>
                              </>
                            )}
                          </div>
                        </td>

                        {/* ATTENDANCE VISUAL — centred text labels for non-clocked rows
                            (matches the admin profile's attendance tab format). The
                            TD is text-center + the flex content gets items-center
                            so spans, the bar+pins row, and the session-pills row
                            all sit aligned under the centred TIMELINE header. */}
                        <td className="px-5 py-3 text-center">
                          {hasPendingAny ? (
                            <span className="text-[12px] font-medium text-amber-600 dark:text-amber-400">
                              {pendingKind === "regularization" && pendingRegRow
                                ? `Regularization Pending${regWindow(pendingRegRow) ? ` · ${regWindow(pendingRegRow)}` : ""}`
                                : pendingKind === "leave" && pendingLeaveRow
                                  ? `Leave Pending — ${pendingLeaveRow?.leaveType?.name || "Leave"}${pendingSplitLabel ? ` · ${pendingSplitLabel}` : ""}`
                                  : pendingKind === "WFH"
                                    ? `WFH Pending Approval${pendingSplitLabel ? ` · ${pendingSplitLabel}` : ""}`
                                    : pendingKind === "On-Duty"
                                      ? "On-Duty Pending Approval"
                                      : `Pending ${pendingKind}`}
                            </span>
                          ) : isLop && !approvedRegRow ? (
                            <span className="text-[12px] font-semibold text-red-600 dark:text-red-400">
                              {isHalfDayLop
                                ? "Half-day LOP — missed clock-out not regularized in time"
                                : "Full-day LOP — absent, no attendance logged"}
                            </span>
                          ) : missedClockOut && !approvedRegRow ? (
                            <span className="text-[12px] font-medium text-amber-600 dark:text-amber-400">
                              Missed clock-out — regularize to log hours
                            </span>
                          ) : approvedRegRow && (missedClockOut || !rec.clockIn) ? (
                            <span className="text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                              Regularized{regWindow(approvedRegRow) ? ` · ${regWindow(approvedRegRow)}` : ""}
                            </span>
                          ) : hasClock ? (
                            // Centered to align under the centred
                            // TIMELINE header. items-center on the
                            // flex-col centres the bar row + pills row;
                            // the bar itself stays at its bounded width
                            // so it doesn't stretch absurdly wide.
                            <div className="flex flex-col items-center gap-1.5">
                              <div className="flex items-center gap-3">
                                {/* Single pin that opens a popover with BOTH
                                    clock-in and clock-out locations stacked
                                    inside (replaces the previous green +
                                    red flank pair — less visual noise). */}
                                <TimelineBar
                                  liveMins={liveMins}
                                  firstIn={sessions[0]?.clockIn ? new Date(sessions[0].clockIn) : null}
                                  lastOut={(() => {
                                    // Last CLOSED session's clockOut. If the
                                    // tail session is open the tooltip shows
                                    // "now" via isOpen below.
                                    for (let i = sessions.length - 1; i >= 0; i--) {
                                      if (sessions[i]?.clockOut) return new Date(sessions[i].clockOut!);
                                    }
                                    return null;
                                  })()}
                                  isOpen={!!sessions.find((s) => !s.clockOut)}
                                  sessions={sessions}
                                  isTodayRow={isTodayRow}
                                />
                                <DayLocationPin
                                  inRaw={sessions[0]?.clockInLocation ?? rec.location}
                                />
                              </div>
                              {/* The multi-session in/out grid lives in the
                                  LOG-icon hover popover (see the LOG TD
                                  below) so the row stays compact. Hover
                                  the status icon at the right edge of
                                  the row to see every Web Clock In/Out
                                  pair for the day. */}
                            </div>
                          ) : approvedRegRow && !rec.clockIn ? (
                            <span className="text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                              Regularized{regWindow(approvedRegRow) ? ` · ${regWindow(approvedRegRow)}` : ""}
                            </span>
                          ) : isHoliday ? (
                            <span className="text-[12px] font-medium text-amber-600 dark:text-amber-400">Holiday</span>
                          ) : isWeekend ? (
                            <span className="text-[12px] text-slate-500 dark:text-slate-400">Full day Weekly-off</span>
                          ) : onLeave ? (
                            <span className="text-[12px] font-medium text-violet-600 dark:text-violet-400">{leaveLabel}</span>
                          ) : isTodayRow ? (
                            <span className="text-[12px] font-medium text-[#008CFF]">Not clocked in yet</span>
                          ) : (
                            <span className="text-[12px] text-slate-400">—</span>
                          )}
                        </td>

                        {/* EFFECTIVE HOURS — centered to match its centred header. */}
                        <td className="px-5 py-3 text-center">
                          {missedClockOut ? (
                            <span className="text-[12px] text-slate-400">—</span>
                          ) : liveMins > 0 ? (
                            <div className="flex items-center justify-center gap-2">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${pct >= 90 ? "bg-emerald-400" : pct >= 50 ? "bg-[#008CFF]" : "bg-orange-400"}`} />
                              <span className="text-[13px] text-slate-800 dark:text-white">{hrs}</span>
                              {pct < 90 && <span className="text-[11px] text-slate-400">+</span>}
                            </div>
                          ) : (isHoliday || isWeekend) ? (
                            <span className="text-slate-400 text-lg">···</span>
                          ) : null}
                        </td>

                        {/* GROSS HOURS — wall-clock incl. breaks (≥ Effective).
                            Centered to match its centred header. */}
                        <td className="px-5 py-3 text-center text-[13px] text-slate-700 dark:text-slate-300">
                          {missedClockOut
                            ? <span className="text-slate-400">—</span>
                            : liveMins > 0
                              ? grossStr
                              : (isHoliday || isWeekend)
                                ? <span className="text-slate-400 text-lg">···</span>
                                : ""}
                        </td>

                        {/* LOG: 9h threshold \u2192 green tick when met, red cross otherwise (once clocked in). */}
                        {/* LOG — icon-only with a hover tooltip describing the
                            row state (e.g. "Present | Missing Swipe(s)" for a
                            partial day, "On Leave · Sick Leave" when leave
                            covers the date). Replaces the old status pill so
                            the row stays compact. Centred to align under
                            the centred LOG header. */}
                        <td className="px-5 py-3 text-center">
                          {(() => {
                            type Cell = { label: string; Icon: typeof CheckCircle2; tone: string };
                            let c: Cell;
                            if (hasPendingAny) {
                              const which =
                                pendingKind === "regularization" ? "Regularization Pending"
                                : pendingKind === "leave"          ? "Leave Pending"
                                : pendingKind === "WFH"            ? "WFH Pending"
                                : pendingKind === "On-Duty"        ? "On-Duty Pending"
                                : "Pending";
                              c = { label: which, Icon: Clock3, tone: "text-[#008CFF]" };
                            } else if (approvedRegRow) {
                              // Approved regularization wins over MISSED /
                              // partial-swipe states — the underlying
                              // Attendance row may still look incomplete,
                              // but HR has signed off and the day counts
                              // as a successful regularized day.
                              c = { label: `Regularized${regWindow(approvedRegRow) ? ` · ${regWindow(approvedRegRow)}` : ""}`, Icon: CheckCircle2, tone: "text-emerald-500" };
                            } else if (isLop) {
                              c = {
                                label: isHalfDayLop
                                  ? "Half-day LOP — missed clock-out not regularized in time"
                                  : "Full-day LOP — absent, no attendance logged",
                                Icon: XCircle,
                                tone: "text-red-600",
                              };
                            } else if (missedClockOut) {
                              c = { label: "Missed clock-out", Icon: AlertCircle, tone: "text-amber-500" };
                            } else if (rec.clockOut && !rec.clockIn && !isTodayRow && !rec.isRegularized) {
                              c = { label: "Missed clock-in", Icon: AlertCircle, tone: "text-amber-500" };
                            } else if (onLeave) {
                              c = { label: leaveLabel, Icon: Coffee, tone: "text-violet-500" };
                            } else if (isHoliday) {
                              c = { label: "Holiday", Icon: CalendarDays, tone: "text-amber-500" };
                            } else if (isWeekend) {
                              c = { label: "Weekly Off", Icon: Calendar, tone: "text-slate-400" };
                            } else if (isTodayRow && !hasClock) {
                              c = { label: "Awaiting clock-in", Icon: Clock3, tone: "text-[#008CFF]" };
                            } else if (hasClock && met9h) {
                              c = { label: "Present", Icon: CheckCircle2, tone: "text-emerald-500" };
                            } else if (hasClock) {
                              c = { label: "Present | Missing Swipe(s)", Icon: AlertCircle, tone: "text-orange-500" };
                            } else {
                              c = { label: "Absent", Icon: XCircle, tone: "text-rose-500" };
                            }
                            const Icon = c.Icon;
                            // Rich popover when there's at least one session
                            // — Keka-style 2-column in/out grid stacked
                            // under a status header. For non-session rows
                            // (Holiday, Weekly Off, Awaiting, etc.) fall
                            // back to the small text tooltip so we don't
                            // render an empty popover.
                            const hasSessions = sessions.length > 0;
                            return (
                              <span className="group relative inline-flex">
                                <Icon size={20} strokeWidth={2} className={c.tone} />
                                {hasSessions ? (
                                  <div
                                    role="tooltip"
                                    className="pointer-events-none absolute right-full top-1/2 z-30 mr-2 -translate-y-1/2 w-[230px] rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0a1526] px-3 py-2.5 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                                  >
                                    {/* Status header — small dot in the
                                        same tone as the icon, then the
                                        label (Present / Missing Swipe(s) /
                                        Missed clock-out). */}
                                    <div className="flex items-center gap-1.5 mb-2">
                                      <span className={`w-1.5 h-1.5 rounded-full ${c.tone.replace("text-", "bg-")}`} />
                                      <span className={`text-[11px] font-bold uppercase tracking-wide ${c.tone}`}>{c.label}</span>
                                    </div>
                                    {/* Web Clock In grid — green ↙ + time
                                        on the left, red ↗ + time on the
                                        right. Live session shows "now". */}
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Web Clock In</p>
                                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
                                      {sessions.map((s, i) => {
                                        const open = !s.clockOut;
                                        // An "open" session on a PAST row isn't
                                        // really live — the user simply forgot
                                        // to clock out. Show "Missed" in amber
                                        // instead of the live ticker, so the
                                        // popover agrees with the badge.
                                        const isLiveNow = open && isTodayRow;
                                        return (
                                          <div key={i} className="contents">
                                            <span className="inline-flex items-center gap-1 text-[12px] text-slate-700 dark:text-slate-200 font-medium">
                                              <ArrowDownLeft size={13} strokeWidth={2.4} className="text-emerald-500 shrink-0" />
                                              {fmtT(s.clockIn)}
                                            </span>
                                            {isLiveNow ? (
                                              <span className="inline-flex items-center gap-1 text-[12px] font-medium">
                                                <span className="relative inline-flex h-3 w-3 shrink-0 items-center justify-center">
                                                  <span className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping" />
                                                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                                </span>
                                                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">now</span>
                                              </span>
                                            ) : open ? (
                                              <span className="inline-flex items-center gap-1 text-[12px] font-medium">
                                                <AlertCircle size={13} strokeWidth={2.4} className="text-amber-500 shrink-0" />
                                                <span className="text-amber-600 dark:text-amber-400 font-semibold">Missed</span>
                                              </span>
                                            ) : (
                                              <span className="inline-flex items-center gap-1 text-[12px] text-slate-700 dark:text-slate-200 font-medium">
                                                <ArrowUpRight size={13} strokeWidth={2.4} className="text-rose-500 shrink-0" />
                                                {fmtT(s.clockOut!)}
                                              </span>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                    {/* Door entries — every mid-day door-open scan (break /
                                        washroom returns). Only present in the payload for
                                        managers / HR / CEO / devs, so this never renders for a
                                        regular employee viewing their own attendance. */}
                                    {Array.isArray((rec as any).doorEntries) && (rec as any).doorEntries.length > 0 && (
                                      <>
                                        <p className="mt-2 border-t border-slate-200/60 dark:border-white/[0.06] pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Door Entries</p>
                                        <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 tabular-nums">
                                          {((rec as any).doorEntries as Array<{ scannedAt: string }>).map((d, i) => (
                                            <span key={i} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-slate-600 dark:text-slate-300">
                                              <ArrowDownLeft size={12} strokeWidth={2.4} className="shrink-0 text-[#008CFF]" />
                                              {fmtT(d.scannedAt)}
                                            </span>
                                          ))}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                ) : (
                                  <span
                                    role="tooltip"
                                    className="pointer-events-none absolute right-full top-1/2 z-20 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg ring-1 ring-white/[0.06] transition-opacity duration-150 group-hover:opacity-100 dark:bg-slate-900"
                                  >
                                    {c.label}
                                  </span>
                                )}
                              </span>
                            );
                          })()}
                        </td>

                        {/* ACTIONS: kebab menu \u2192 Regularize */}
                        <td className="px-5 py-3">
                          {(isHoliday || isWeekend) ? (
                            <span className="text-slate-300 text-lg">···</span>
                          ) : (() => {
                            // Hide Regularize whenever there's nothing to
                            // fix — pending or approved request already
                            // exists, day is already on leave / WFH, or
                            // the user already clocked the full 9 hours
                            // (the rule the rederive step uses to flip
                            // status → "present"). Reason string is
                            // shown as a tooltip on the disabled item so
                            // the menu still surfaces *why* it's gone.
                            let disableReason: string | null = null;
                            if (hasPendingReg)          disableReason = "You already have a pending regularization for this date";
                            else if (approvedRegRow)    disableReason = "Regularization for this date has already been approved";
                            else if (rec.isRegularized) disableReason = "This date has already been regularized";
                            else if (onLeave)           disableReason = "You're on leave for this date";
                            else if (approvedWfh)       disableReason = "WFH is approved for this date";
                            // `met9h` alone isn't a valid disabler when the
                            // clock-out was actually missed — the row's
                            // liveMins can hit 9h via a system estimate /
                            // the missed-clockout sweeper while the real
                            // clock-out time is still unset, which is
                            // exactly the case the user needs to
                            // regularize. Only suppress when the day was
                            // clocked cleanly end-to-end.
                            // …UNLESS the day is flagged LATE: the employee did
                            // 9h but the first clock-in was past the shift cutoff,
                            // and they may legitimately need to regularize a
                            // wrong/late punch to correct it (HR still approves).
                            else if (met9h && !missedClockOut && !isLateFirstIn) disableReason = "9 hours already completed — nothing to regularize";
                            return (
                              <RowMenu
                                onRegularize={() => { setRegPrefillDate(dateIso); setShowRegModal(true); }}
                                onWFH={() => openForm("wfh", dateIso)}
                                onOnDuty={() => openForm("on_duty", dateIso)}
                                onLeave={() => openForm("leave", dateIso)}
                                disableRegularize={!!disableReason}
                                disableRegularizeReason={disableReason ?? undefined}
                              />
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {records.length === 0 && (
                <p className="text-[13px] text-slate-400 text-center py-14">No attendance records for this period</p>
              )}
            </div>
          </>
        )}

        {subTab === "calendar" && (
          <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-white/[0.06]">
              <input type="month" value={month} onChange={e => setMonth(e.target.value)}
                className="h-9 px-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white focus:outline-none" />
              {/* Same List/Calendar toggle — mirrors the one in the log view. */}
              <div className="flex border border-slate-200 dark:border-white/[0.08] rounded-lg overflow-hidden">
                <button
                  type="button"
                  aria-label="List view"
                  aria-pressed={false}
                  onClick={() => setSubTab("log")}
                  className="px-2 py-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="Calendar view"
                  aria-pressed={true}
                  className="px-2 py-1.5 bg-[#008CFF]/10 text-[#008CFF]"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7">
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
                <div key={d} className="p-3 text-center text-[11px] uppercase tracking-wider text-slate-500 font-medium border-b border-slate-100 dark:border-white/[0.04] bg-slate-50 dark:bg-white/[0.02]">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {(() => {
                const [y, m] = month.split("-").map(Number);
                const firstDay = new Date(y, m - 1, 1).getDay();
                const daysInMonth = new Date(y, m, 0).getDate();
                const recMap = new Map(records.map((r: any) => [new Date(r.date).getDate(), r]));
                const cells = [];
                for (let i = 0; i < firstDay; i++)
                  cells.push(<div key={`e${i}`} className="border-b border-r border-slate-100 dark:border-white/[0.03] min-h-[70px]" />);
                for (let d = 1; d <= daysInMonth; d++) {
                  const rec = recMap.get(d) as any;
                  const dd = new Date(y, m - 1, d);
                  // UTC date for the working-day check (helper uses getUTCDay /
                  // getUTCDate); dd above stays local for the display compares.
                  const isWeekend = !isWorkingDay(new Date(Date.UTC(y, m - 1, d)), myShift, shiftAnchor);
                  const isToday   = d === now.getDate() && m === now.getMonth() + 1 && y === now.getFullYear();
                  cells.push(
                    <div key={d} className={`border-b border-r border-slate-100 dark:border-white/[0.03] p-2 min-h-[70px] ${isToday ? "ring-1 ring-inset ring-[#008CFF]/30 bg-[#008CFF]/5" : ""} ${isWeekend ? "bg-slate-50 dark:bg-white/[0.015]" : ""}`}>
                      <span className={`text-[12px] font-medium ${isToday ? "text-[#008CFF]" : "text-slate-500 dark:text-slate-400"}`}>{d}</span>
                      {rec?.clockIn  && <p className="text-[10px] text-slate-400 mt-0.5">In: {new Date(rec.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
                      {rec?.clockOut && <p className="text-[10px] text-slate-400">Out: {new Date(rec.clockOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
                      {rec?.status === "holiday" && <span className="text-[9px] px-1 rounded bg-amber-400/20 text-amber-500 mt-0.5 inline-block font-bold">HLDY</span>}
                    </div>
                  );
                }
                return cells;
              })()}
            </div>
          </div>
        )}

        {subTab === "requests" && (
          <>
            {/* Request type + team toggle */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex border border-slate-200 dark:border-white/[0.08] rounded-lg overflow-hidden">
                  {([["punch","Regularizations"],["wfh","WFH Requests"],["od","On Duty"]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setReqType(v)}
                      className={`px-3 py-1.5 text-[11px] font-semibold transition-colors ${reqType === v ? "bg-[#008CFF] text-white" : "text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5"}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {reqType === "punch" && (
                <button onClick={() => setShowRegModal(true)}
                  className="h-8 px-4 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[12px] font-semibold flex items-center gap-1.5">
                  <Plus size={13} strokeWidth={2} /> New Request
                </button>
              )}
              {reqType === "wfh" && (
                <button onClick={() => openForm("wfh")}
                  className="h-8 px-4 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[12px] font-semibold flex items-center gap-1.5">
                  <Plus size={13} strokeWidth={2} /> New WFH
                </button>
              )}
              {reqType === "od" && (
                <button onClick={() => openForm("on_duty")}
                  className="h-8 px-4 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[12px] font-semibold flex items-center gap-1.5">
                  <Plus size={13} strokeWidth={2} /> New On Duty
                </button>
              )}
            </div>

            {/* Regularizations table */}
            {reqType === "punch" && (
              <div className={`${C.card} overflow-hidden`}>
                {regsData.length === 0 ? (
                  <div className="py-14 text-center"><p className="text-[13px] text-slate-400">No regularization requests found</p></div>
                ) : (
                  <table className="w-full">
                    <thead><tr className="border-b border-slate-200 dark:border-white/[0.06]">
                      {[...(regView === "team" ? ["EMPLOYEE"] : []), "DATE","REQ IN","REQ OUT","REASON","STATUS","ACTIONS"].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-[10px] uppercase tracking-widest text-[#008CFF] dark:text-[#00BCD4] font-semibold">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {regsData.map((r: any) => (
                        <tr key={r.id} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50/50 dark:hover:bg-white/[0.015]">
                          {regView === "team" && <td className="px-5 py-3 text-[12px] text-slate-800 dark:text-white font-medium">{r.user?.name}</td>}
                          <td className="px-5 py-3 text-[12px] text-slate-600 dark:text-slate-300">{new Date(r.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-800 dark:text-white">{r.requestedIn ? new Date(r.requestedIn).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-800 dark:text-white">{r.requestedOut ? new Date(r.requestedOut).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-500 dark:text-slate-400 max-w-[180px] truncate">{r.reason}</td>
                          <td className="px-5 py-3">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${r.status === "approved" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : r.status === "rejected" ? "bg-red-500/10 text-red-500 dark:text-red-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
                              {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            {regView === "team" && r.status === "pending" && (
                              <div className="flex items-center gap-1.5">
                                <button onClick={async () => { await fetch("/api/hr/attendance/regularize", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action: "approve" }) }); mutate((k: string) => typeof k === "string" && k.includes("/api/hr/attendance/regularize")); }} className="h-6 px-2.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded text-[11px] font-semibold">Approve</button>
                                <button onClick={async () => { await fetch("/api/hr/attendance/regularize", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action: "reject" }) }); mutate((k: string) => typeof k === "string" && k.includes("/api/hr/attendance/regularize")); }} className="h-6 px-2.5 bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 rounded text-[11px] font-semibold">Reject</button>
                              </div>
                            )}
                            {r.approvalNote && <p className="text-[10px] text-slate-400 mt-0.5 max-w-[140px] truncate">Note: {r.approvalNote}</p>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* WFH Requests table */}
            {reqType === "wfh" && (
              <div className={`${C.card} overflow-hidden`}>
                {wfhData.length === 0 ? (
                  <div className="py-14 text-center"><p className="text-[13px] text-slate-400">No WFH requests found</p></div>
                ) : (
                  <table className="w-full">
                    <thead><tr className="border-b border-slate-200 dark:border-white/[0.06]">
                      {[...(regView === "team" ? ["EMPLOYEE"] : []), "DATE","REASON","APPLIED ON","STATUS","ACTIONS"].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-[10px] uppercase tracking-widest text-[#008CFF] dark:text-[#00BCD4] font-semibold">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {wfhData.map((r: any) => (
                        <tr key={r.id} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50/50 dark:hover:bg-white/[0.015]">
                          {regView === "team" && <td className="px-5 py-3 text-[12px] text-slate-800 dark:text-white font-medium">{r.user?.name}</td>}
                          <td className="px-5 py-3 text-[12px] text-slate-800 dark:text-white">{new Date(r.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-500 dark:text-slate-400 max-w-[200px] truncate">{r.reason}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-500">{new Date(r.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                          <td className="px-5 py-3">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${r.status === "approved" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : r.status === "rejected" ? "bg-red-500/10 text-red-500 dark:text-red-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
                              {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            {regView === "team" && r.status === "pending" && (
                              <div className="flex items-center gap-1.5">
                                <button onClick={async () => { await fetch("/api/hr/attendance/wfh", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action: "approve" }) }); mutate((k: string) => typeof k === "string" && k.includes("/api/hr/attendance/wfh")); }} className="h-6 px-2.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded text-[11px] font-semibold">Approve</button>
                                <button onClick={async () => { await fetch("/api/hr/attendance/wfh", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action: "reject" }) }); mutate((k: string) => typeof k === "string" && k.includes("/api/hr/attendance/wfh")); }} className="h-6 px-2.5 bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 rounded text-[11px] font-semibold">Reject</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* On Duty Requests table */}
            {reqType === "od" && (
              <div className={`${C.card} overflow-hidden`}>
                {odData.length === 0 ? (
                  <div className="py-14 text-center"><p className="text-[13px] text-slate-400">No On Duty requests found</p></div>
                ) : (
                  <table className="w-full">
                    <thead><tr className="border-b border-slate-200 dark:border-white/[0.06]">
                      {[...(regView === "team" ? ["EMPLOYEE"] : []), "DATE","FROM","TO","PURPOSE","LOCATION","STATUS","ACTIONS"].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-[10px] uppercase tracking-widest text-[#008CFF] dark:text-[#00BCD4] font-semibold">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {odData.map((r: any) => (
                        <tr key={r.id} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50/50 dark:hover:bg-white/[0.015]">
                          {regView === "team" && <td className="px-5 py-3 text-[12px] text-slate-800 dark:text-white font-medium">{r.user?.name}</td>}
                          <td className="px-5 py-3 text-[12px] text-slate-800 dark:text-white">{new Date(r.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-500">{r.fromTime ? new Date(r.fromTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-500">{r.toTime ? new Date(r.toTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-500 dark:text-slate-400 max-w-[160px] truncate">{r.purpose}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-500">{r.location || "—"}</td>
                          <td className="px-5 py-3">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${r.status === "approved" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : r.status === "rejected" ? "bg-red-500/10 text-red-500 dark:text-red-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
                              {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            {regView === "team" && r.status === "pending" && (
                              <div className="flex items-center gap-1.5">
                                <button onClick={async () => { await fetch("/api/hr/attendance/on-duty", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action: "approve" }) }); mutate((k: string) => typeof k === "string" && k.includes("/api/hr/attendance/on-duty")); }} className="h-6 px-2.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded text-[11px] font-semibold">Approve</button>
                                <button onClick={async () => { await fetch("/api/hr/attendance/on-duty", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action: "reject" }) }); mutate((k: string) => typeof k === "string" && k.includes("/api/hr/attendance/on-duty")); }} className="h-6 px-2.5 bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 rounded text-[11px] font-semibold">Reject</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}

       </>
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
