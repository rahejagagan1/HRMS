"use client";

// Cascading multi-select case picker. Used by the Researchers Monthly
// Report Section B — one instance per row (RTC / FOIA).
//
// UX:
//   • Closed: a button showing "N cases selected" + chevron.
//   • Open  : a body-portaled panel listing all production lists in the
//     given folder. Click a list → expand to show its cases with
//     checkboxes. Search across all cases / lists at the top.
//   • Selected cases are remembered across list toggles and surface as
//     a tiny "X selected" hint at the bottom of the panel.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";

export type PickedCase = { id: number; name: string };

type ApiCase = {
    id: number;
    name: string;
    status: string;
    dateDone: string | null;
};
type ApiList = {
    id: number;
    name: string;
    clickupListId: string;
    cases: ApiCase[];
};
type ApiResp = {
    folder: { id: number; name: string } | null;
    lists:  ApiList[];
    hint?:  string;
};

export default function CasePicker({
    folder,
    month, year,
    selected,
    onChange,
    disabled = false,
    placeholder = "Pick cases…",
}: {
    folder: string;                            // exact folder name (e.g. "Ready To Cover 2026")
    month?: number;                            // 0-indexed; optional
    year?: number;
    selected: PickedCase[];
    onChange: (next: PickedCase[]) => void;
    disabled?: boolean;
    placeholder?: string;
}) {
    const [open, setOpen] = useState(false);
    const [pos,  setPos]  = useState<{ top: number; left: number; width: number } | null>(null);
    const [query, setQuery] = useState("");
    const [expandedListIds, setExpandedListIds] = useState<Set<number>>(new Set());
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef   = useRef<HTMLDivElement | null>(null);

    const qs = new URLSearchParams({ folder });
    if (Number.isFinite(month)) qs.set("month", String(month));
    if (Number.isFinite(year))  qs.set("year",  String(year));
    const { data, isLoading, error } = useSWR<ApiResp>(
        open ? `/api/reports/cases-picker?${qs}` : null,
        fetcher,
        { revalidateOnFocus: false, dedupingInterval: 30_000 },
    );

    // Open / close behaviour and outside-click handling.
    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            const t = e.target as Node;
            if (triggerRef.current?.contains(t)) return;
            if (panelRef.current?.contains(t))   return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        const onScroll = (e: Event) => {
            if (panelRef.current?.contains(e.target as Node)) return;
            if (!triggerRef.current) { setOpen(false); return; }
            const r = triggerRef.current.getBoundingClientRect();
            if (r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return; }
            setPos({ top: r.bottom + 4, left: r.left, width: Math.max(420, r.width) });
        };
        document.addEventListener("mousedown", onDoc);
        document.addEventListener("keydown",   onKey);
        window.addEventListener("scroll",      onScroll, true);
        return () => {
            document.removeEventListener("mousedown", onDoc);
            document.removeEventListener("keydown",   onKey);
            window.removeEventListener("scroll",      onScroll, true);
        };
    }, [open]);

    const openPanel = () => {
        if (disabled) return;
        if (!triggerRef.current) return;
        const r = triggerRef.current.getBoundingClientRect();
        setPos({ top: r.bottom + 4, left: r.left, width: Math.max(420, r.width) });
        setQuery("");
        setOpen(true);
    };

    const lists = data?.lists ?? [];
    const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);

    const filteredLists: ApiList[] = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return lists;
        return lists
            .map((l) => ({
                ...l,
                cases: l.cases.filter((c) => c.name.toLowerCase().includes(q)),
            }))
            .filter((l) => l.name.toLowerCase().includes(q) || l.cases.length > 0);
    }, [lists, query]);

    const toggleList = (listId: number) =>
        setExpandedListIds((cur) => {
            const next = new Set(cur);
            if (next.has(listId)) next.delete(listId);
            else                  next.add(listId);
            return next;
        });

    const toggleCase = (c: ApiCase) => {
        const exists = selectedIds.has(c.id);
        if (exists) onChange(selected.filter((s) => s.id !== c.id));
        else        onChange([...selected, { id: c.id, name: c.name }]);
    };

    const clearAll = () => onChange([]);

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                onClick={() => (open ? setOpen(false) : openPanel())}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-[12.5px] rounded-md border border-slate-200 bg-white text-left focus:outline-none focus:ring-2 focus:ring-violet-500/30 ${disabled ? "opacity-60 cursor-not-allowed" : "hover:border-slate-300"}`}
            >
                <span className={`truncate ${selected.length === 0 ? "text-slate-400" : "text-slate-700"}`}>
                    {selected.length === 0
                        ? placeholder
                        : selected.length === 1
                            ? selected[0].name
                            : `${selected.length} cases selected`}
                </span>
                <svg className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {open && pos && typeof document !== "undefined" && createPortal(
                <div
                    ref={panelRef}
                    style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 1000 }}
                    className="rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden flex flex-col"
                >
                    <div className="p-2 border-b border-slate-100 flex items-center gap-2">
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={`Search in ${folder}…`}
                            className="flex-1 px-2.5 py-1.5 text-[12.5px] rounded-md bg-slate-50 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-400/40"
                        />
                        {selected.length > 0 && (
                            <button type="button" onClick={clearAll} className="text-[11px] font-semibold text-rose-500 hover:text-rose-600 px-2">
                                Clear
                            </button>
                        )}
                    </div>

                    <div className="max-h-[360px] overflow-y-auto">
                        {isLoading && <p className="px-3 py-3 text-[12px] text-slate-400">Loading…</p>}
                        {error && <p className="px-3 py-3 text-[12px] text-rose-500">Failed to load</p>}
                        {!isLoading && !error && data?.hint && (
                            <p className="px-3 py-3 text-[11.5px] text-amber-700 bg-amber-50">{data.hint}</p>
                        )}
                        {!isLoading && !error && filteredLists.length === 0 && !data?.hint && (
                            <p className="px-3 py-3 text-[12px] text-slate-400">No matches.</p>
                        )}
                        {filteredLists.map((l) => {
                            const isOpen = expandedListIds.has(l.id) || query.trim().length > 0;
                            const pickedInList = l.cases.filter((c) => selectedIds.has(c.id)).length;
                            return (
                                <div key={l.id} className="border-b border-slate-100 last:border-b-0">
                                    <button
                                        type="button"
                                        onClick={() => toggleList(l.id)}
                                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
                                    >
                                        <span className="flex items-center gap-1.5 min-w-0">
                                            <svg className={`h-3 w-3 text-slate-400 transition-transform shrink-0 ${isOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                            </svg>
                                            <span className="text-[12.5px] font-semibold text-slate-700 truncate">{l.name}</span>
                                            <span className="text-[10.5px] text-slate-400 shrink-0">{l.cases.length}</span>
                                        </span>
                                        {pickedInList > 0 && (
                                            <span className="text-[10.5px] font-bold text-violet-600 bg-violet-50 rounded-full px-1.5 py-0.5">{pickedInList} picked</span>
                                        )}
                                    </button>
                                    {isOpen && (
                                        <ul className="pl-6 pb-1">
                                            {l.cases.length === 0 && (
                                                <li className="px-3 py-1.5 text-[11.5px] text-slate-400 italic">No cases</li>
                                            )}
                                            {l.cases.map((c) => {
                                                const checked = selectedIds.has(c.id);
                                                return (
                                                    <li key={c.id}>
                                                        <label className="flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-violet-50/50 transition-colors">
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={() => toggleCase(c)}
                                                                className="mt-0.5 h-3.5 w-3.5 accent-violet-600"
                                                            />
                                                            <span className="min-w-0 flex-1">
                                                                <span className="block text-[12px] text-slate-700 truncate">{c.name}</span>
                                                                <span className="block text-[10px] text-slate-400">
                                                                    {c.status}{c.dateDone ? ` · ${new Date(c.dateDone).toLocaleDateString()}` : ""}
                                                                </span>
                                                            </span>
                                                        </label>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {selected.length > 0 && (
                        <div className="px-3 py-2 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-500">
                            {selected.length} selected
                        </div>
                    )}
                </div>,
                document.body,
            )}
        </>
    );
}
