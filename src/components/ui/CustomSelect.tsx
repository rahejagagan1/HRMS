"use client";

// Reusable dropdown that combines a fixed `defaults` list with custom
// values stored in OptionList (keyed by `listKey`). Drop-in replacement
// for a plain <select> wherever HR wants to be able to add their own
// values on the fly.
//
// Usage:
//   <CustomSelect
//     listKey="department"
//     defaults={["HR", "Researcher", "QA", ...]}
//     value={form.department}
//     onChange={(v) => set("department", v)}
//     placeholder="Select a department"
//   />
//
// Behaviour:
//   • Default values are non-deletable. Custom values get a 🗑 icon.
//   • Anyone authed can pick a value. Only HR admin tier can add /
//     delete (the API enforces this; the UI hides the buttons too).
//   • Component falls back gracefully when /api/hr/options is
//     unreachable — the defaults still render.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { ChevronDown, Plus, Trash2, Check, X, Search } from "lucide-react";

type CustomItem = { id: number; listKey: string; value: string };

type Props = {
  listKey: string;
  value: string;
  onChange: (v: string) => void;
  /** Built-in values that always appear and can't be deleted. */
  defaults?: string[];
  /** Placeholder shown when no value is selected. */
  placeholder?: string;
  /** Disables the field entirely (still shows current value as text). */
  disabled?: boolean;
  /** Override the input's class set if the parent uses a custom field style. */
  className?: string;
  /** Hide the add/delete affordances even for HR admins. */
  readOnlyOptions?: boolean;
  /** Required field — surfaces native validation. */
  required?: boolean;
};

const DEFAULT_FIELD_CLS =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 pr-9 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 disabled:bg-slate-50 disabled:text-slate-500";

export default function CustomSelect({
  listKey,
  value,
  onChange,
  defaults = [],
  placeholder = "Select…",
  disabled = false,
  className,
  readOnlyOptions = false,
  required = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Free-text filter typed into the search box at the top of the
  // dropdown. Reset whenever the popup closes so re-opening starts
  // fresh.
  const [query, setQuery] = useState("");
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const btnRef     = useRef<HTMLButtonElement>(null);
  const panelRef   = useRef<HTMLDivElement>(null);
  // Trigger geometry — recomputed on open and on scroll/resize so the
  // portal-rendered popup follows the button when the page moves.
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

  const apiUrl = `/api/hr/options?key=${encodeURIComponent(listKey)}`;
  const { data } = useSWR<{ items: CustomItem[] }>(apiUrl, fetcher, {
    revalidateOnFocus: false,
  });
  const customs = data?.items ?? [];

  // Combined list, with defaults first, then custom values alphabetised
  // by the API. Dedup so a custom value matching a default doesn't show
  // twice.
  const allOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ value: string; isCustom: boolean; id?: number }> = [];
    for (const v of defaults) {
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push({ value: v, isCustom: false });
    }
    for (const c of customs) {
      if (seen.has(c.value)) continue;
      seen.add(c.value);
      out.push({ value: c.value, isCustom: true, id: c.id });
    }
    return out;
  }, [defaults, customs]);

  // Filtered view of the list based on the search input.
  const visibleOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter((o) => o.value.toLowerCase().includes(q));
  }, [allOptions, query]);

  // Close on outside-click / Escape. The popup now lives in a portal,
  // so a click on it isn't inside `wrapperRef` — we have to check the
  // panel ref separately.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapperRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t))   return;
      setOpen(false);
      setAdding(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); setAdding(false); }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onPick = (v: string) => {
    onChange(v);
    setOpen(false);
    setAdding(false);
    setErr("");
  };

  const onAdd = async () => {
    const v = draft.trim();
    if (!v) { setErr("Enter a value."); return; }
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/hr/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listKey, value: v }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not add value");
      await mutate(apiUrl);
      onPick(v);
      setDraft("");
    } catch (e: any) {
      setErr(e?.message || "Could not add value");
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (e: React.MouseEvent, id: number, v: string) => {
    e.stopPropagation();
    if (!confirm(`Remove "${v}"? Anyone selecting it will keep their saved value, but it'll vanish from the dropdown.`)) return;
    try {
      const res = await fetch(`/api/hr/options?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Delete failed");
      }
      await mutate(apiUrl);
      // If the user had this value selected, leave it alone — the saved
      // record still has it. They'll just see the literal value next
      // time they open the dropdown.
    } catch (e: any) {
      alert(e?.message || "Delete failed");
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`${className || DEFAULT_FIELD_CLS} flex items-center justify-between text-left ${
          value ? "" : "text-slate-400"
        }`}
      >
        <span className="truncate">{value || placeholder}</span>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
      </button>
      {/* Hidden mirror input so the field participates in native form
          required-validation when the parent uses <form required>. */}
      {required && (
        <input
          tabIndex={-1}
          required
          value={value}
          onChange={() => {}}
          className="sr-only"
          aria-hidden
        />
      )}

      {open && rect && typeof document !== "undefined" && createPortal((() => {
        // Portal-positioned popup so it escapes ancestor overflow-hidden
        // (the EditProfilePanel section card clips otherwise). Auto-flip
        // up when the option list would extend past the viewport.
        const POPUP_MAX = 320;          // slightly taller than SelectField — needs room for the Add row
        const GAP       = 4;
        const vh        = typeof window !== "undefined" ? window.innerHeight : 0;
        const spaceBelow = vh - rect.bottom;
        const spaceAbove = rect.top;
        // Desired height = exactly what the rows need (row ~36px + the
        // ~60px footer with the "Add custom value" button). Cap by what
        // the viewport gives. Clamping to `desired` keeps the panel
        // hugging the trigger when flipping up — without this, the
        // panel was sized to the entire space-above and the trigger
        // ended up ~250px below the popup.
        const desired = Math.min(POPUP_MAX, allOptions.length * 36 + 60);
        const flipUp  = spaceBelow < desired && spaceAbove > spaceBelow;
        const avail   = (flipUp ? spaceAbove : spaceBelow) - GAP - 8;
        const popupMaxH = Math.max(140, Math.min(desired, avail));
        const top     = flipUp ? Math.max(8, rect.top - popupMaxH - GAP) : rect.bottom + GAP;
        return (
        <div
          ref={panelRef}
          role="listbox"
          className="flex flex-col rounded-lg border border-slate-200 bg-white shadow-2xl"
          style={{
            position:  "fixed",
            top,
            left:      rect.left,
            width:     rect.width,
            maxHeight: popupMaxH,
            zIndex:    10000,
          }}
        >
        {/* Search bar — sticky at the top of the popup. Only shown
            when there are more than a handful of options so a 3-
            item list doesn't look over-engineered. */}
        {allOptions.length > 5 && (
          <div className="px-2 pt-2 pb-1.5 border-b border-slate-100 bg-white">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
                  // Enter selects the first visible option — fast keyboard
                  // workflow for "type a few letters, hit return".
                  if (e.key === "Enter" && visibleOptions.length > 0) {
                    e.preventDefault();
                    onPick(visibleOptions[0].value);
                  }
                }}
                placeholder="Search…"
                className="h-8 w-full rounded-md border border-slate-200 bg-white pl-7 pr-2 text-[12.5px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15"
              />
            </div>
          </div>
        )}
        {/* Options list — flex-1 so the search bar (above) and the
            "+ Add custom value" footer (below) stay visible while
            the middle list scrolls. Previously the footer lived
            INSIDE this scroll area, so with 8+ options the button
            got pushed below the fold and HR Managers thought the
            feature was missing entirely. User report: "again same
            issue why?". */}
        <div className="overflow-y-auto flex-1 min-h-0">
          {allOptions.length === 0 && !adding && (
            <p className="px-3 py-2 text-[12px] text-slate-400">No options yet</p>
          )}
          {allOptions.length > 0 && visibleOptions.length === 0 && !adding && (
            <p className="px-3 py-3 text-[12px] text-slate-400">
              No matches for "{query}".{!readOnlyOptions && <> Try <button type="button" onClick={() => { setAdding(true); setDraft(query); }} className="font-semibold text-[#3b82f6] hover:underline">adding it as a new value</button>.</>}
            </p>
          )}
          {visibleOptions.map((opt) => {
            const selected = opt.value === value;
            return (
              <div
                key={opt.value}
                role="option"
                aria-selected={selected}
                onClick={() => onPick(opt.value)}
                className={`group flex items-center gap-2 cursor-pointer px-3 py-2 text-[13px] ${
                  selected ? "bg-[#3b82f6]/10 text-[#1d4ed8]" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {selected ? (
                  <Check size={13} className="shrink-0 text-[#3b82f6]" />
                ) : (
                  <span className="w-[13px] shrink-0" />
                )}
                <span className="flex-1 truncate">{opt.value}</span>
                {opt.isCustom && !readOnlyOptions && opt.id != null && (
                  <button
                    type="button"
                    onClick={(e) => onRemove(e, opt.id!, opt.value)}
                    title="Remove this value"
                    aria-label={`Remove ${opt.value}`}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 transition-opacity"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* "+ Add custom value" footer — pinned at the BOTTOM of
            the popup, OUTSIDE the scroll area so it's always
            visible regardless of how many options exist. `shrink-0`
            stops it from being squeezed when the option list is
            taller than the popup. */}
        {!readOnlyOptions && (
          <div className="border-t border-slate-100 shrink-0 bg-white rounded-b-lg">
            {adding ? (
              <div className="px-3 py-2 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); onAdd(); }
                      if (e.key === "Escape") { setAdding(false); setDraft(""); setErr(""); }
                    }}
                    placeholder="Type a new value…"
                    maxLength={120}
                    className="h-8 flex-1 rounded-md border border-slate-200 bg-white px-2.5 text-[12.5px] text-slate-800 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15"
                  />
                  <button
                    type="button"
                    disabled={busy || !draft.trim()}
                    onClick={onAdd}
                    className="h-8 inline-flex items-center gap-1 rounded-md bg-[#3b82f6] px-2.5 text-[11.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 hover:bg-[#2563eb]"
                  >
                    {busy ? "…" : "Add"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAdding(false); setDraft(""); setErr(""); }}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Cancel"
                  >
                    <X size={13} />
                  </button>
                </div>
                {err && <p className="text-[11px] text-rose-600">{err}</p>}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setAdding(true); setDraft(""); setErr(""); }}
                className="w-full inline-flex items-center gap-2 px-3 py-2 text-[12.5px] font-semibold text-[#3b82f6] hover:bg-[#3b82f6]/5 rounded-b-lg"
              >
                <Plus size={13} />
                Add custom value
              </button>
            )}
          </div>
        )}
        </div>
        );
      })(), document.body)}
    </div>
  );
}
