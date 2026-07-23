"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";

// SearchableSelect — type-to-filter dropdown for long option lists.
//
// Used in places where a native <select> would be unusable because the
// list is long (employee picker on the Violations form, etc.). The
// option panel is rendered via a body-level portal so it can't be
// clipped by parent overflow / modal boundaries.

export type SearchableOption = {
    value: number | string;
    label: string;
    sublabel?: string;
};

export default function SearchableSelect({
    value,
    onChange,
    options,
    placeholder = "Select…",
    className = "",
    disabled = false,
}: {
    value: number | string | null | undefined;
    onChange: (value: number | string) => void;
    options: SearchableOption[];
    placeholder?: string;
    className?: string;
    disabled?: boolean;
}) {
    const [open,    setOpen]    = useState(false);
    const [query,   setQuery]   = useState("");
    const [pos,     setPos]     = useState<{ top: number; left: number; width: number } | null>(null);
    const [hi,      setHi]      = useState(0);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef   = useRef<HTMLDivElement | null>(null);
    const inputRef   = useRef<HTMLInputElement | null>(null);

    const selected = useMemo(
        () => options.find(o => o.value === value) ?? null,
        [options, value],
    );

    // Case-insensitive substring filter across label + sublabel.
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return options;
        return options.filter(o =>
            o.label.toLowerCase().includes(q) ||
            (o.sublabel ?? "").toLowerCase().includes(q),
        );
    }, [options, query]);

    const openPanel = () => {
        if (disabled) return;
        if (!triggerRef.current) return;
        const r = triggerRef.current.getBoundingClientRect();
        setPos({ top: r.bottom + 4, left: r.left, width: r.width });
        setQuery("");
        setHi(0);
        setOpen(true);
        // Defer focus so the input exists in the portal first.
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            const t = e.target as Node;
            if (triggerRef.current?.contains(t)) return;
            if (panelRef.current?.contains(t))   return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        // The panel uses position:fixed, so scrolling an *outer*
        // container (page, modal body, etc.) drifts the trigger out
        // from under it — close in that case. But the listener is in
        // capture phase, which means it ALSO sees scroll events from
        // the panel's own option list. Without this guard, trying to
        // scroll the dropdown immediately collapsed it. Re-position
        // the panel instead of closing when the trigger is still on
        // screen, so wheel-scrolling a long list page works smoothly.
        const onOuterScroll = (e: Event) => {
            if (panelRef.current?.contains(e.target as Node)) return;
            if (!triggerRef.current) { setOpen(false); return; }
            const r = triggerRef.current.getBoundingClientRect();
            const off = 4;
            // Trigger scrolled out of view → no anchor, just close.
            if (r.bottom < 0 || r.top > window.innerHeight) {
                setOpen(false);
                return;
            }
            setPos({ top: r.bottom + off, left: r.left, width: r.width });
        };
        const onResize = () => setOpen(false);
        document.addEventListener("mousedown", onDoc);
        document.addEventListener("keydown",   onKey);
        window.addEventListener("scroll",      onOuterScroll, true);
        window.addEventListener("resize",      onResize);
        return () => {
            document.removeEventListener("mousedown", onDoc);
            document.removeEventListener("keydown",   onKey);
            window.removeEventListener("scroll",      onOuterScroll, true);
            window.removeEventListener("resize",      onResize);
        };
    }, [open]);

    const pick = (opt: SearchableOption) => {
        onChange(opt.value);
        setOpen(false);
    };

    const onInputKey = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setHi(i => Math.min(i + 1, filtered.length - 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setHi(i => Math.max(i - 1, 0)); }
        else if (e.key === "Enter")   { e.preventDefault(); if (filtered[hi]) pick(filtered[hi]); }
    };

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => (open ? setOpen(false) : openPanel())}
                disabled={disabled}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-left focus:outline-none focus:ring-2 focus:ring-violet-500/30 ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:border-slate-300 dark:hover:border-white/20"} ${className}`}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <span className={`truncate ${selected ? "text-slate-700 dark:text-slate-200" : "text-slate-400 dark:text-slate-500"}`}>
                    {selected ? selected.label : placeholder}
                </span>
                <svg className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {open && pos && typeof document !== "undefined" && createPortal(
                <div
                    ref={panelRef}
                    style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 1000 }}
                    className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d1b2a] shadow-xl overflow-hidden flex flex-col"
                >
                    <div className="p-2 border-b border-slate-100 dark:border-white/[0.06]">
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={e => { setQuery(e.target.value); setHi(0); }}
                            onKeyDown={onInputKey}
                            placeholder="Type to search…"
                            className="w-full px-2.5 py-1.5 text-[13px] rounded-md bg-slate-50 dark:bg-white/[0.04] text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-400/40"
                        />
                    </div>
                    <ul className="max-h-[260px] overflow-y-auto py-1" role="listbox">
                        {filtered.length === 0 ? (
                            <li className="px-3 py-2 text-[12.5px] text-slate-400">No matches</li>
                        ) : filtered.map((opt, idx) => {
                            const isSelected = opt.value === value;
                            const isHi       = idx === hi;
                            return (
                                <li
                                    key={String(opt.value)}
                                    role="option"
                                    aria-selected={isSelected}
                                    onMouseEnter={() => setHi(idx)}
                                    onClick={() => pick(opt)}
                                    className={`px-3 py-2 text-[13px] cursor-pointer transition-colors ${
                                        isHi
                                            ? "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300"
                                            : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                                    } ${isSelected ? "font-semibold" : ""}`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="truncate">{opt.label}</span>
                                        {opt.sublabel ? (
                                            <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">{opt.sublabel}</span>
                                        ) : null}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>,
                document.body,
            )}
        </>
    );
}
