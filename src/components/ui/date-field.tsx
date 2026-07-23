"use client";

// Date input that ALWAYS displays as dd/mm/yyyy and opens a custom
// calendar popover — independent of the browser/OS native picker so
// the UX is consistent across Chrome/Edge/Firefox/Safari. The popup
// is portaled to document.body so it escapes any parent overflow
// clipping. Stores YYYY-MM-DD upstream (drop-in for existing callers
// and the API contract).
//
// Props (unchanged from the old native-backed version):
//   value      — current date as YYYY-MM-DD or "".
//   onChange   — fired with the new YYYY-MM-DD (or "" when cleared).
//   min        — earliest allowed date (YYYY-MM-DD).
//   max        — latest allowed date (YYYY-MM-DD).
//   disabled   — disables the field.
//   className  — extra classes on the outer wrapper.
//   placeholder — text shown when empty (default "dd/mm/yyyy").
//   compact    — h-8 instead of h-9 for tighter layouts.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import SelectField from "@/components/ui/SelectField";

const MONTHS_FULL = [
  "January", "February", "March",     "April",   "May",      "June",
  "July",    "August",   "September", "October", "November", "December",
];
const DOW_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function ymd(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function fromIso(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function DateField({
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  placeholder = "dd/mm/yyyy",
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  compact?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef  = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Anchor month — what the calendar grid is showing. Initialised to
  // the current value if any, else today (clamped to min/max).
  const today = useMemo(() => new Date(), []);
  const minDate = useMemo(() => fromIso(min ?? ""), [min]);
  const maxDate = useMemo(() => fromIso(max ?? ""), [max]);
  const selected = useMemo(() => fromIso(value), [value]);
  const [view, setView] = useState<{ year: number; month: number }>(() => {
    const d = selected ?? today;
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  // Resync the view if the value changes externally (autosave restore, etc.)
  useEffect(() => {
    if (selected) setView({ year: selected.getFullYear(), month: selected.getMonth() });
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Display string
  const display = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
  })();
  const h = compact ? "h-8" : "h-9";

  // Open/close handling
  const openPanel = () => {
    if (disabled) return;
    setOpen(true);
  };
  const closePanel = () => setOpen(false);

  // Position the panel below the trigger; recompute on scroll/resize.
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

  // Click-outside + Esc to close. The month/year SelectFields inside
  // our calendar render their option lists in their OWN portals (so
  // they escape our calendar's clipping) — those clicks land OUTSIDE
  // our panelRef and would close the calendar before the option's
  // onClick gets to run. We honour any element tagged with
  // `data-popover-portal` (a marker every portal-popover in the app
  // sets on its outer wrapper) so nested popovers compose cleanly.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (wrapRef.current?.contains(t))   return;
      if (panelRef.current?.contains(t))  return;
      // Skip clicks inside any other portal popover (SelectField's
      // dropdown lives there).
      if (t.closest?.('[data-popover-portal]')) return;
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

  const clamp = (d: Date) => {
    if (minDate && d < minDate) return false;
    if (maxDate && d > maxDate) return false;
    return true;
  };

  const pickDay = (day: number) => {
    const d = new Date(view.year, view.month, day);
    if (!clamp(d)) return;
    onChange(ymd(d));
    closePanel();
  };

  // Build a 6x7 grid for the current view month, padded with prev /
  // next month days so the grid always has 42 cells.
  const grid = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const startDow = first.getDay();           // 0 = Sunday
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const cells: Array<{ day: number; cur: boolean; date: Date }> = [];
    // leading days from previous month
    for (let i = startDow - 1; i >= 0; i--) {
      const d = new Date(view.year, view.month, -i);
      cells.push({ day: d.getDate(), cur: false, date: d });
    }
    // current month
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, cur: true, date: new Date(view.year, view.month, d) });
    }
    // trailing days
    while (cells.length < 42) {
      const last = cells[cells.length - 1].date;
      const d = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
      cells.push({ day: d.getDate(), cur: false, date: d });
    }
    return cells;
  }, [view]);

  // Year list for the dropdown — bounded by min/max if provided, otherwise
  // ±60 years from today so old DOBs and future close dates both fit.
  const years = useMemo(() => {
    const lo = minDate ? minDate.getFullYear() : today.getFullYear() - 60;
    const hi = maxDate ? maxDate.getFullYear() : today.getFullYear() + 10;
    const ys: number[] = [];
    for (let y = lo; y <= hi; y++) ys.push(y);
    return ys;
  }, [minDate, maxDate, today]);

  // Navigation helpers
  const stepMonth = (delta: number) => {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };
  const setMonth = (m: number) => setView((v) => ({ ...v, month: m }));
  const setYear  = (y: number) => setView((v) => ({ ...v, year: y }));

  return (
    <div
      ref={wrapRef}
      style={className?.match(/\bw-/) ? undefined : { width: "160px" }}
      className={`relative inline-flex items-center ${disabled ? "" : ""} ${className ?? ""}`}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={openPanel}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`relative flex items-center w-full ${h} px-3 pr-9 border border-slate-200 rounded-lg bg-white text-[13px] text-left transition-colors hover:border-slate-300 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 ${
          disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
        }`}
      >
        <span className={display ? "text-slate-800" : "text-slate-400"}>
          {display || placeholder}
        </span>
        <Calendar size={14} className="pointer-events-none absolute right-3 text-slate-500" />
      </button>

      {open && rect && typeof document !== "undefined" && createPortal(
        (() => {
          // Auto-flip up if the panel would extend past the viewport.
          const PANEL_W = 304;
          const PANEL_H = 348;
          const GAP = 4;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const flipUp = (rect.bottom + GAP + PANEL_H > vh) && (rect.top > PANEL_H + GAP);
          const top = flipUp ? Math.max(8, rect.top - PANEL_H - GAP) : rect.bottom + GAP;
          const left = Math.min(Math.max(8, rect.left), vw - PANEL_W - 8);
          return (
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="false"
              data-popover-portal="true"
              // Stop mousedown bubbling so any outer popover's
              // outside-click handler doesn't see clicks inside our
              // calendar (the month/year SelectFields portal their
              // options elsewhere — those panels stop propagation
              // themselves; this covers everything else).
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="fixed rounded-xl border border-slate-200 bg-white shadow-[0_12px_36px_-8px_rgba(15,23,42,0.18)] p-3"
              style={{ top, left, width: PANEL_W, zIndex: 10000 }}
            >
              {/* Header — month + year selectors */}
              <div className="flex items-center justify-between gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => stepMonth(-1)}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                  aria-label="Previous month"
                ><ChevronLeft size={15} /></button>
                <div className="flex items-center gap-1.5">
                  {/* Branded portal-rendered selects so the OS-native
                      dark-navy option-highlight (Chromium on Linux)
                      doesn't appear inside the calendar header. */}
                  <SelectField
                    value={String(view.month)}
                    onChange={(v) => setMonth(Number(v))}
                    options={MONTHS_FULL.map((m, i) => ({ value: String(i), label: m }))}
                    className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[12.5px] font-semibold text-slate-800 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 flex items-center justify-between gap-1"
                    width={130}
                  />
                  <SelectField
                    value={String(view.year)}
                    onChange={(v) => setYear(Number(v))}
                    options={years.map((y) => ({ value: String(y), label: String(y) }))}
                    className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[12.5px] font-semibold text-slate-800 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 flex items-center justify-between gap-1"
                    width={90}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => stepMonth(1)}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                  aria-label="Next month"
                ><ChevronRight size={15} /></button>
              </div>

              {/* Day-of-week header */}
              <div className="grid grid-cols-7 gap-0.5 mb-1">
                {DOW_SHORT.map((d) => (
                  <div key={d} className="h-6 inline-flex items-center justify-center text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
                    {d}
                  </div>
                ))}
              </div>

              {/* 6×7 day grid */}
              <div className="grid grid-cols-7 gap-0.5">
                {grid.map(({ day, cur, date }, i) => {
                  const isSel = selected
                    && date.getFullYear() === selected.getFullYear()
                    && date.getMonth() === selected.getMonth()
                    && date.getDate() === selected.getDate();
                  const isToday =
                    date.getFullYear() === today.getFullYear() &&
                    date.getMonth() === today.getMonth() &&
                    date.getDate() === today.getDate();
                  const inRange = clamp(date);
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={!inRange}
                      onClick={() => {
                        if (!cur) {
                          // Clicking a leading/trailing cell jumps the view + selects.
                          setView({ year: date.getFullYear(), month: date.getMonth() });
                        }
                        pickDay(date.getDate());
                      }}
                      className={`h-8 inline-flex items-center justify-center rounded-md text-[12.5px] font-medium transition-colors ${
                        isSel
                          ? "bg-[#3b82f6] text-white hover:bg-[#2563eb]"
                          : isToday
                            ? "ring-1 ring-[#3b82f6]/40 text-slate-900 hover:bg-slate-100"
                            : cur
                              ? "text-slate-700 hover:bg-slate-100"
                              : "text-slate-300 hover:bg-slate-50"
                      } ${!inRange ? "opacity-30 cursor-not-allowed hover:bg-transparent" : ""}`}
                      aria-pressed={!!isSel}
                      aria-label={date.toDateString()}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>

              {/* Footer — Today shortcut + Clear */}
              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    if (clamp(today)) {
                      setView({ year: today.getFullYear(), month: today.getMonth() });
                      onChange(ymd(today));
                      closePanel();
                    }
                  }}
                  disabled={!clamp(today)}
                  className="text-[11.5px] font-semibold text-[#3b82f6] hover:underline disabled:text-slate-300 disabled:no-underline disabled:cursor-not-allowed"
                >Today</button>
                {value && (
                  <button
                    type="button"
                    onClick={() => { onChange(""); closePanel(); }}
                    className="inline-flex items-center gap-1 text-[11.5px] font-medium text-slate-500 hover:text-rose-600"
                  ><X size={11} /> Clear</button>
                )}
              </div>
            </div>
          );
        })(),
        document.body,
      )}
    </div>
  );
}
