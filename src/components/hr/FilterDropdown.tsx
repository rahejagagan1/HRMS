"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check } from "lucide-react";

export type FilterOption = { value: string; label: string };

export default function FilterDropdown({
  label,
  options,
  selected,
  onChange,
  width = 200,
}: {
  label: string;
  options: FilterOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  width?: number;
}) {
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState("");
  const btnRef   = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

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
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const allSelected = options.length > 0 && options.every((o) => selected.has(o.value));
  const someSelected = options.some((o) => selected.has(o.value));

  const toggle = (value: string) => {
    const next = new Set(selected);
    next.has(value) ? next.delete(value) : next.add(value);
    onChange(next);
  };
  const toggleAll = () => onChange(allSelected ? new Set() : new Set(options.map((o) => o.value)));

  const countLabel = selected.size > 0 ? `${selected.size}` : "";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`h-9 px-3 flex items-center gap-2 rounded-lg border text-[12px] font-medium transition-colors ${
          someSelected
            ? "border-[#008CFF] text-[#008CFF] bg-[#008CFF]/[0.06] dark:bg-[#008CFF]/[0.1]"
            : "border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 bg-white dark:bg-[#001529] hover:border-[#008CFF]/40 dark:hover:border-[#008CFF]/40"
        }`}
        style={{ minWidth: 130 }}
      >
        <span className="whitespace-nowrap">{label}</span>
        {countLabel && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#008CFF] text-white text-[10px] font-bold flex items-center justify-center">
            {countLabel}
          </span>
        )}
        <ChevronDown
          size={14}
          strokeWidth={2}
          className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && rect && (
        <div
          ref={panelRef}
          className="bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-lg shadow-2xl overflow-hidden"
          style={{
            position: "fixed",
            top:   rect.bottom + 6,
            left:  rect.left,
            width: Math.max(rect.width, width),
            maxHeight: 380,
            zIndex: 10000,
          }}
        >
          <div className="p-2 border-b border-slate-200 dark:border-white/[0.06]">
            <div className="relative">
              <Search size={13} strokeWidth={2} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                autoFocus
                className="w-full h-8 pl-8 pr-2 rounded-md border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#001529] text-[12px] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#008CFF]"
              />
            </div>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: 300 }}>
            {/* Empty state (no options at all — e.g. field not populated yet) */}
            {options.length === 0 ? (
              <p className="text-[12px] text-slate-400 text-center py-6">No values available yet</p>
            ) : (
              <>
                {/* Select All */}
                <button
                  type="button"
                  onClick={toggleAll}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03] border-b border-slate-100 dark:border-white/[0.04]"
                >
                  <CheckBox checked={allSelected} partial={!allSelected && someSelected} />
                  <span className="text-[12.5px] font-medium text-slate-700 dark:text-slate-200">Select All</span>
                </button>

                {filtered.length === 0 ? (
                  <p className="text-[12px] text-slate-400 text-center py-5">No matches</p>
                ) : filtered.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(o.value)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#008CFF]/[0.06] dark:hover:bg-[#008CFF]/[0.1] transition-colors"
                  >
                    <CheckBox checked={selected.has(o.value)} />
                    <span className="text-[12.5px] text-slate-700 dark:text-slate-200 truncate">{o.label}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function CheckBox({ checked, partial = false }: { checked: boolean; partial?: boolean }) {
  return (
    <span
      className={`w-4 h-4 rounded flex items-center justify-center border transition-colors shrink-0 ${
        checked || partial
          ? "bg-[#008CFF] border-[#008CFF] text-white"
          : "bg-transparent border-slate-300 dark:border-white/20"
      }`}
    >
      {checked && <Check size={11} strokeWidth={3} />}
      {!checked && partial && <span className="w-2 h-0.5 bg-white rounded" />}
    </span>
  );
}
