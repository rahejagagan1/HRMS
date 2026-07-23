"use client";

// Month picker — same calendar-style popover UX as `DateField`, but the
// grid is a 3×4 of months and the value is "YYYY-MM" (or "" for "All").
// Trigger button shows e.g. "Jun 2026" / "All time".
//
// Portaled to document.body so it escapes parent overflow clipping.
//
// Props:
//   value      — "YYYY-MM" or "" for none/all.
//   onChange   — fires with the new "YYYY-MM" (or "" when cleared).
//   placeholder — shown when value is "" (default "All time").
//   className  — extra classes on the outer wrapper.
//   compact    — h-8 instead of h-9 for tighter layouts.
//   width      — pixel width of the trigger (default 160).
//   minYear / maxYear — clamp the year navigator. Defaults to ±10y of today.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function parseYm(s: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(s || "");
  if (!m) return null;
  const year  = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, month: month - 1 }; // store month as 0-based internally
}
function fmtYm(year: number, month0: number): string {
  return `${year}-${pad(month0 + 1)}`;
}

export default function MonthField({
  value,
  onChange,
  placeholder = "All time",
  className,
  compact,
  width = 160,
  minYear,
  maxYear,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  compact?: boolean;
  width?: number;
  minYear?: number;
  maxYear?: number;
  /** When set, renders FilterDropdown-style pill: label text always
   *  visible, the selected month shown as a blue chip on the right.
   *  Pairs visually with `<FilterDropdown />` in the same row. */
  label?: string;
}) {
  const wrapRef  = useRef<HTMLDivElement>(null);
  const btnRef   = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen]   = useState(false);
  const [rect, setRect]   = useState<DOMRect | null>(null);

  const today = useMemo(() => new Date(), []);
  const selected = useMemo(() => parseYm(value), [value]);

  // Year currently being shown in the grid. Initialised to the value's
  // year, else current year.
  const [viewYear, setViewYear] = useState<number>(() =>
    selected?.year ?? today.getFullYear(),
  );
  useEffect(() => {
    if (selected) setViewYear(selected.year);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const lo = minYear ?? today.getFullYear() - 10;
  const hi = maxYear ?? today.getFullYear() + 10;

  const display = (() => {
    if (!selected) return "";
    return `${MONTHS_SHORT[selected.month]} ${selected.year}`;
  })();
  const h = compact ? "h-8" : "h-9";

  const openPanel  = () => setOpen(true);
  const closePanel = () => setOpen(false);

  // Anchor the panel under the trigger; recompute on scroll/resize.
  useLayoutEffect(() => {
    if (!open) { setRect(null); return; }
    const compute = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setRect(r);
    };
    compute();
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [open]);

  // Click-outside + Esc to close. Honour nested portal popovers via the
  // shared `data-popover-portal` marker.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (wrapRef.current?.contains(t))  return;
      if (panelRef.current?.contains(t)) return;
      if (t.closest?.("[data-popover-portal]")) return;
      closePanel();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closePanel(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const stepYear = (delta: number) => {
    setViewYear((y) => Math.min(hi, Math.max(lo, y + delta)));
  };
  const pickMonth = (m0: number) => {
    onChange(fmtYm(viewYear, m0));
    closePanel();
  };

  return (
    <div
      ref={wrapRef}
      style={className?.match(/\bw-/) ? undefined : { width }}
      className={`relative inline-flex items-center ${className ?? ""}`}
    >
      {label ? (
        <button
          ref={btnRef}
          type="button"
          onClick={openPanel}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`relative flex items-center gap-1.5 w-full ${h} px-3 pr-3 border border-slate-200 dark:border-white/[0.08] rounded-lg bg-white dark:bg-[#0a1e3a] text-[13px] text-left transition-colors hover:border-slate-300 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 cursor-pointer`}
        >
          <span className="whitespace-nowrap text-slate-700 dark:text-white font-medium">{label}</span>
          {display ? (
            <span className="min-w-[18px] h-[18px] px-2 rounded-full bg-[#008CFF] text-white text-[10px] font-bold inline-flex items-center justify-center whitespace-nowrap">
              {display}
            </span>
          ) : null}
          <Calendar size={13} className="ml-auto text-slate-500" />
        </button>
      ) : (
        <button
          ref={btnRef}
          type="button"
          onClick={openPanel}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`relative flex items-center w-full ${h} px-3 pr-9 border border-slate-200 dark:border-white/[0.08] rounded-lg bg-white dark:bg-[#0a1e3a] text-[13px] text-left transition-colors hover:border-slate-300 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 cursor-pointer`}
        >
          <span className={display ? "text-slate-800 dark:text-white" : "text-slate-400"}>
            {display || placeholder}
          </span>
          <Calendar size={14} className="pointer-events-none absolute right-3 text-slate-500" />
        </button>
      )}

      {open && rect && typeof document !== "undefined" && createPortal(
        (() => {
          // Auto-flip up if the panel would overshoot the viewport.
          const PANEL_W = 264;
          const PANEL_H = 232;
          const GAP = 4;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const flipUp = (rect.bottom + GAP + PANEL_H > vh) && (rect.top > PANEL_H + GAP);
          const top  = flipUp ? Math.max(8, rect.top - PANEL_H - GAP) : rect.bottom + GAP;
          const left = Math.min(Math.max(8, rect.left), vw - PANEL_W - 8);
          const todayY = today.getFullYear();
          const todayM = today.getMonth();
          return (
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="false"
              data-popover-portal="true"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="fixed rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#001529] shadow-[0_12px_36px_-8px_rgba(15,23,42,0.18)] p-3"
              style={{ top, left, width: PANEL_W, zIndex: 10000 }}
            >
              {/* Year navigator */}
              <div className="flex items-center justify-between mb-3">
                <button
                  type="button"
                  onClick={() => stepYear(-1)}
                  disabled={viewYear <= lo}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  aria-label="Previous year"
                ><ChevronLeft size={15} /></button>
                <div className="text-[13px] font-semibold text-slate-800 dark:text-white tabular-nums">
                  {viewYear}
                </div>
                <button
                  type="button"
                  onClick={() => stepYear(1)}
                  disabled={viewYear >= hi}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  aria-label="Next year"
                ><ChevronRight size={15} /></button>
              </div>

              {/* 3×4 month grid */}
              <div className="grid grid-cols-3 gap-1.5">
                {MONTHS_SHORT.map((label, i) => {
                  const isSel    = selected && selected.year === viewYear && selected.month === i;
                  const isToday  = viewYear === todayY && i === todayM;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => pickMonth(i)}
                      className={`h-9 inline-flex items-center justify-center rounded-md text-[12.5px] font-semibold transition-colors ${
                        isSel
                          ? "bg-[#3b82f6] text-white hover:bg-[#2563eb]"
                          : isToday
                            ? "ring-1 ring-[#3b82f6]/50 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                            : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                      }`}
                      aria-pressed={!!isSel}
                      aria-label={`${label} ${viewYear}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Footer — "This month" shortcut + "All time" / clear */}
              <div className="mt-3 pt-2 border-t border-slate-100 dark:border-white/[0.06] flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setViewYear(todayY);
                    onChange(fmtYm(todayY, todayM));
                    closePanel();
                  }}
                  className="text-[11.5px] font-semibold text-[#3b82f6] hover:underline"
                >This month</button>
                <button
                  type="button"
                  onClick={() => { onChange(""); closePanel(); }}
                  className="inline-flex items-center gap-1 text-[11.5px] font-medium text-slate-500 hover:text-rose-600"
                ><X size={11} /> All time</button>
              </div>
            </div>
          );
        })(),
        document.body,
      )}
    </div>
  );
}
