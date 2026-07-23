"use client";

// Shared chip-style employee autocomplete used by every "Notify" /
// "Tag people" surface. Hits /api/hr/employees with the typed query
// (case-insensitive contains on name + email), renders a portalled
// dropdown so parent overflow / modal clipping doesn't hide results,
// and emits the selected users via onChange so the parent can pass
// notifyUserIds straight to the API.
//
// Originally lived inside src/components/LeaveRequestForm.tsx as a
// local function — extracted here so the RequestLeavePanel on the
// Leaves page (which previously had a dead, unwired text input) can
// reuse the exact same widget.

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { Search, X } from "lucide-react";
import { createPortal } from "react-dom";

export type PickerUser = {
  id: number;
  name: string;
  email?: string;
  profilePictureUrl?: string | null;
};

export default function EmployeePicker({
  selected, onChange, placeholder,
}: {
  selected: PickerUser[];
  onChange: (next: PickerUser[]) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen]   = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef    = useRef<HTMLDivElement>(null);
  // Tick state forces re-read of the anchor's rect after scroll / resize.
  const [, forceTick] = useState(0);

  const { data, error } = useSWR(
    open && query.trim().length >= 1
      ? `/api/hr/employees?search=${encodeURIComponent(query.trim())}&isActive=true`
      : null,
    fetcher,
    { dedupingInterval: 500 }
  );
  const all: any[] = Array.isArray(data) ? data : [];
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);
  const results = all.filter((u) => !selectedIds.has(u.id)).slice(0, 8);

  // Re-render the popover when the modal scrolls or the window resizes so the
  // anchor rect stays in sync.
  useEffect(() => {
    if (!open) return;
    const bump = () => forceTick((n) => n + 1);
    window.addEventListener("resize", bump);
    window.addEventListener("scroll", bump, true);
    return () => {
      window.removeEventListener("resize", bump);
      window.removeEventListener("scroll", bump, true);
    };
  }, [open]);

  // Close when clicking outside both the anchor and the popover.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (popRef.current?.contains(t))    return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const add = (u: any) => {
    onChange([...selected, { id: u.id, name: u.name, email: u.email, profilePictureUrl: u.profilePictureUrl }]);
    setQuery("");
  };
  const remove = (id: number) => onChange(selected.filter((s) => s.id !== id));

  const trimmed = query.trim();
  // Read the rect fresh on every render (no state gap). Safe because the
  // anchor div is already mounted whenever the picker is visible.
  const anchorRect = anchorRef.current?.getBoundingClientRect() ?? null;
  const showPopover = open && trimmed.length >= 1;

  return (
    <div ref={anchorRef} className="relative">
      <div className={`flex flex-wrap items-center gap-1.5 w-full min-h-10 px-3 py-1.5 rounded-lg border bg-white dark:bg-[#0a1526] border-slate-200 dark:border-white/[0.08] focus-within:border-[#008CFF] dark:focus-within:border-[#4a9cff] transition-colors`}>
        {selected.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5 h-6 pl-1 pr-1.5 rounded-full bg-[#008CFF]/10 text-[#008CFF] dark:bg-[#4a9cff]/15 dark:text-[#4a9cff] text-[11px] font-medium">
            {s.profilePictureUrl ? (
              <img src={s.profilePictureUrl} alt="" referrerPolicy="no-referrer" className="w-4 h-4 rounded-full object-cover" />
            ) : (
              <span className="w-4 h-4 rounded-full bg-[#008CFF]/25 text-[9px] flex items-center justify-center">
                {s.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            {s.name}
            <button type="button" onClick={() => remove(s.id)} className="hover:opacity-80" aria-label={`Remove ${s.name}`}>
              <X size={11} strokeWidth={2.5} />
            </button>
          </span>
        ))}
        <div className="flex items-center flex-1 min-w-[120px]">
          <Search size={13} strokeWidth={2} className="text-slate-400 mr-1.5 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={selected.length === 0 ? (placeholder ?? "Search employee") : "Add another…"}
            className="flex-1 h-8 bg-transparent text-[13px] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none"
          />
        </div>
      </div>

      {showPopover && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          className="max-h-56 overflow-y-auto bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-lg shadow-2xl"
          style={{
            position: "fixed",
            top:   (anchorRect?.bottom ?? 0) + 4,
            left:  anchorRect?.left  ?? 0,
            width: anchorRect?.width ?? 240,
            zIndex: 10000,
          }}
        >
          {error ? (
            <p className="px-3 py-3 text-[12px] text-red-500">Couldn't load employees</p>
          ) : !data ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">No employees found for "{trimmed}"</p>
          ) : results.map((u) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); add(u); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#008CFF]/[0.06] dark:hover:bg-[#4a9cff]/[0.08]"
            >
              {u.profilePictureUrl ? (
                <img src={u.profilePictureUrl} alt="" referrerPolicy="no-referrer" className="w-7 h-7 rounded-full object-cover" />
              ) : (
                <span className="w-7 h-7 rounded-full bg-[#008CFF]/20 text-[#008CFF] text-[11px] font-semibold flex items-center justify-center">
                  {u.name?.slice(0, 1).toUpperCase() || "?"}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-[12.5px] text-slate-800 dark:text-white font-medium truncate">{u.name}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{u.email}</p>
              </div>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
