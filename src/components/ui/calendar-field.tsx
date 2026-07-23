"use client";

// Custom calendar field — replaces the OS-native date picker with a
// proper in-app calendar popover. Shows a 7-column day grid with
// month/year quick-jumps (essential for DOB which can go back
// decades). Portaled to document.body so it escapes ancestor
// overflow-hidden.
//
// Storage format is YYYY-MM-DD (same as DateField), display is
// dd/mm/yyyy.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import SelectField from "@/components/ui/SelectField";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const pad = (n: number) => (n < 10 ? "0" + n : String(n));
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parseIso = (s: string): { y: number; m: number; d: number } | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { y: +m[1], m: +m[2] - 1, d: +m[3] };
};

export function CalendarField({
  value,
  onChange,
  min,
  max,
  placeholder = "dd/mm/yyyy",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef   = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const today = new Date();
  const initial =
    parseIso(value) ?? { y: today.getFullYear(), m: today.getMonth(), d: today.getDate() };
  const [cursor, setCursor] = useState({ y: initial.y, m: initial.m });

  // Recompute popup position each time it opens, scrolls, or resizes
  // so the panel always stays anchored to the trigger.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const panelW = 300;
      // Prefer below; if not enough room, flip above the trigger.
      const top = r.bottom + 6 + panelW > window.innerHeight ? r.top - 360 - 6 : r.bottom + 6;
      const left = Math.min(window.innerWidth - panelW - 12, r.left);
      setPos({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Sync cursor → current value whenever the popup opens.
  useEffect(() => {
    if (open) {
      const p = parseIso(value);
      if (p) setCursor({ y: p.y, m: p.m });
    }
  }, [open, value]);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  // Build day grid for the cursor month.
  const firstDay      = new Date(cursor.y, cursor.m, 1);
  const lastDay       = new Date(cursor.y, cursor.m + 1, 0);
  const startWeekday  = firstDay.getDay();
  const daysInMonth   = lastDay.getDate();
  const days: Array<{ d: number; iso: string }> = [];
  for (let d = 1; d <= daysInMonth; d++) days.push({ d, iso: toIso(cursor.y, cursor.m, d) });

  const display = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
  })();

  const currentYear = today.getFullYear();
  const yearStart = Math.max(1900, parseInt(min?.slice(0, 4) || "1900", 10) || 1900);
  const yearEnd   = Math.min(currentYear + 10, parseInt(max?.slice(0, 4) || `${currentYear + 10}`, 10) || currentYear + 10);
  const years     = Array.from({ length: yearEnd - yearStart + 1 }, (_, i) => yearEnd - i);

  const isDisabled = (iso: string) => {
    if (min && iso < min) return true;
    if (max && iso > max) return true;
    return false;
  };
  const todayIso = toIso(today.getFullYear(), today.getMonth(), today.getDate());

  const stepMonth = (delta: number) =>
    setCursor((c) => {
      let m = c.m + delta;
      let y = c.y;
      while (m < 0)  { m += 12; y -= 1; }
      while (m > 11) { m -= 12; y += 1; }
      return { y, m };
    });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative w-full h-10 pl-3 pr-9 border border-slate-200 rounded-lg bg-white text-[13px] flex items-center text-left transition-colors hover:border-slate-300 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 ${className || ""}`}
      >
        <span className={display ? "text-slate-800" : "text-slate-400"}>
          {display || placeholder}
        </span>
        <CalendarIcon size={14} className="absolute right-3 text-slate-500" />
      </button>

      {mounted && open && pos && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[1000] bg-white rounded-2xl border border-slate-200 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.25)] p-3 w-[300px]"
          style={{ top: pos.top, left: pos.left }}
        >
          {/* Header — month/year navigation */}
          <div className="flex items-center justify-between mb-2.5 px-1">
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              className="h-7 w-7 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 inline-flex items-center justify-center transition-colors"
              title="Previous month"
            ><ChevronLeft size={14} /></button>

            <div className="flex items-center gap-1.5">
              {/* Branded portal-rendered selects — kills the OS-native
                  dark-navy option-highlight (Chromium on Linux) that
                  used to render inside the calendar header. */}
              <SelectField
                value={String(cursor.m)}
                onChange={(v) => setCursor((c) => ({ ...c, m: Number(v) }))}
                options={MONTHS.map((mn, i) => ({ value: String(i), label: mn }))}
                className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[12.5px] font-semibold text-slate-900 flex items-center justify-between gap-1 hover:border-slate-300 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15"
                width={130}
              />
              <SelectField
                value={String(cursor.y)}
                onChange={(v) => setCursor((c) => ({ ...c, y: Number(v) }))}
                options={years.map((y) => ({ value: String(y), label: String(y) }))}
                className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[12.5px] font-semibold text-slate-900 flex items-center justify-between gap-1 hover:border-slate-300 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15"
                width={90}
              />
            </div>

            <button
              type="button"
              onClick={() => stepMonth(1)}
              className="h-7 w-7 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 inline-flex items-center justify-center transition-colors"
              title="Next month"
            ><ChevronRight size={14} /></button>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS.map((w, i) => (
              <div key={i} className="h-7 inline-flex items-center justify-center text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {w}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: startWeekday }, (_, i) => <div key={`pad-${i}`} className="h-8" />)}
            {days.map(({ d, iso }) => {
              const selected = iso === value;
              const isToday  = iso === todayIso;
              const disabled = isDisabled(iso);
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={disabled}
                  onClick={() => { onChange(iso); setOpen(false); }}
                  className={`h-8 rounded-md text-[12.5px] font-medium inline-flex items-center justify-center transition-colors ${
                    selected
                      ? "bg-[#3b82f6] text-white shadow-sm hover:bg-[#2563eb]"
                      : disabled
                      ? "text-slate-300 cursor-not-allowed"
                      : isToday
                      ? "bg-blue-50 text-[#3b82f6] font-semibold"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                if (!isDisabled(todayIso)) { onChange(todayIso); setOpen(false); }
              }}
              className="text-[11.5px] font-semibold text-[#3b82f6] hover:underline disabled:opacity-40"
              disabled={isDisabled(todayIso)}
            >Today</button>
            {value && (
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false); }}
                className="text-[11.5px] font-medium text-slate-500 hover:text-rose-600 transition-colors"
              >Clear</button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
