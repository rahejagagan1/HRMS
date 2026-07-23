"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Search } from "lucide-react";

/**
 * Single-select dropdown with full visual control. Use in place of a
 * native `<select>` whenever the dropdown is HR-facing so we can override
 * the OS-native option-highlight color (Chromium on Linux paints it dark
 * navy in dark-mode systems, which clashes with the rest of the form).
 *
 * API mirrors the bits of `<select>` we actually use across this app:
 *   <SelectField value={x} onChange={setX} options={[{value, label}, ...]} />
 *
 * Props:
 *   - options can be `string[]` (value === label) or `{value, label}[]`
 *   - placeholder shows when value is "" or undefined
 *   - className overrides only the BUTTON; popup styling stays consistent
 *   - disabled is supported (greyed out, popup won't open)
 *
 * The popup positions to the trigger via getBoundingClientRect on open
 * and re-pins on resize/scroll so it survives sidebar collapses, etc.
 */

// Optional small chip rendered on the right of an option (e.g. a brand badge so
// HR can tell which brand a designation belongs to).
export type SelectBadge = { text: string; className?: string };
export type SelectOption = { value: string; label: string; badge?: SelectBadge };
type SelectInput = SelectOption | string;

function Chip({ badge }: { badge: SelectBadge }) {
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${badge.className ?? "bg-slate-100 text-slate-600"}`}>
      {badge.text}
    </span>
  );
}

function normalize(opts: SelectInput[]): SelectOption[] {
  return opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}

export default function SelectField({
  value,
  onChange,
  options,
  placeholder = "—",
  className,
  disabled = false,
  width,
}: {
  value: string;
  onChange: (next: string) => void;
  options: SelectInput[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  width?: number;
}) {
  const [open, setOpen]   = useState(false);
  const [rect, setRect]   = useState<DOMRect | null>(null);
  const [query, setQuery] = useState("");
  const btnRef            = useRef<HTMLButtonElement>(null);
  const panelRef          = useRef<HTMLDivElement>(null);
  const searchRef         = useRef<HTMLInputElement>(null);

  const items = useMemo(() => normalize(options), [options]);
  const current = items.find((o) => o.value === value);

  // Type-to-search: only worth showing once a list is long enough that
  // scanning is annoying. Filters by label (case-insensitive contains).
  const SEARCH_THRESHOLD = 8;
  const showSearch = items.length > SEARCH_THRESHOLD;
  const q = query.trim().toLowerCase();
  const filtered = showSearch && q
    ? items.filter((o) => o.label.toLowerCase().includes(q))
    : items;

  // Reset the query on each open and focus the search box so the user can
  // just start typing.
  useEffect(() => {
    if (!open) { setQuery(""); return; }
    if (!showSearch) return;
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, showSearch]);

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

  // Default trigger styling matches the existing `cls.field` look in
  // EditProfilePanel — h-9, rounded-lg, focus ring, disabled state.
  const triggerCls =
    className ??
    "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`${triggerCls} flex items-center justify-between gap-2 text-left`}
      >
        <span className={`flex items-center gap-1.5 min-w-0 ${current ? "" : "text-slate-400"}`}>
          <span className="truncate">{current?.label ?? placeholder}</span>
          {current?.badge && <Chip badge={current.badge} />}
        </span>
        <ChevronDown size={14} strokeWidth={2} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && rect && typeof document !== "undefined" && createPortal((() => {
        // Compute available space below vs above the trigger; flip when
        // there's not enough room below so the list stays fully visible
        // (and doesn't poke past the bottom of the viewport / card).
        const POPUP_MAX = 280;
        const GAP       = 4;
        const vh        = typeof window !== "undefined" ? window.innerHeight : 0;
        const spaceBelow = vh - rect.bottom;
        const spaceAbove = rect.top;
        // Desired = exactly what the rows need. Clamp to viewport. Cap
        // popupMaxH at `desired` so a short list flipped above the
        // trigger hugs it instead of stretching to fill space-above.
        const searchH   = showSearch ? 46 : 0;
        const desired   = Math.min(POPUP_MAX, searchH + Math.max(1, filtered.length) * 36 + 12);
        const flipUp    = spaceBelow < desired && spaceAbove > spaceBelow;
        const avail     = (flipUp ? spaceAbove : spaceBelow) - GAP - 8;
        const popupMaxH = Math.max(120, Math.min(desired, avail));
        const top       = flipUp ? Math.max(8, rect.top - popupMaxH - GAP) : rect.bottom + GAP;
        return (
          <div
            ref={panelRef}
            // Marker so parent popovers (e.g. DateField's calendar)
            // don't treat clicks on this dropdown's options as
            // "outside" and close themselves before our onClick fires.
            data-popover-portal="true"
            // Belt + suspenders: stop mousedown from bubbling to
            // document so any parent's outside-click listener
            // (DateField, PopupPanel, modal backdrops, etc.) never
            // sees this click at all, regardless of marker checks.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-lg shadow-2xl overflow-hidden"
            style={{
              position: "fixed",
              top,
              left:  rect.left,
              width: width ?? rect.width,
              maxHeight: popupMaxH,
              zIndex: 10000,
            }}
          >
            {showSearch && (
              <div className="flex items-center gap-2 px-2.5 h-[46px] border-b border-slate-100">
                <Search size={14} className="shrink-0 text-slate-400" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && filtered.length > 0) {
                      onChange(filtered[0].value);
                      setOpen(false);
                    }
                  }}
                  placeholder="Search…"
                  className="w-full bg-transparent text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none"
                />
              </div>
            )}
            <div className="overflow-y-auto" style={{ maxHeight: popupMaxH - searchH }}>
              {filtered.length === 0 ? (
                <p className="text-[12px] text-slate-400 text-center py-5">{items.length === 0 ? "No options" : "No matches"}</p>
              ) : (
                filtered.map((o) => {
                  const isSel = o.value === value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => { onChange(o.value); setOpen(false); }}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition-colors ${
                        isSel
                          ? "bg-[#3b82f6]/10 text-[#1e40af] font-medium"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <span className="truncate flex-1">{o.label}</span>
                      {o.badge && <Chip badge={o.badge} />}
                      {isSel && <Check size={14} strokeWidth={2.5} className="text-[#3b82f6] shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        );
      })(), document.body)}
    </>
  );
}
