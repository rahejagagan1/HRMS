"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { can } from "@/lib/permissions/can";
import SelectField from "@/components/ui/SelectField";
import Link from "next/link";
import { Search, X, Pencil } from "lucide-react";
import { DateField } from "@/components/ui/date-field";

const CATEGORIES = ["All", "Laptop", "Monitor", "Keyboard", "Mouse", "Headset", "CPU", "Phone", "Other"];

const FIELD_CLS = "mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]";

type Employee = {
  id: number;
  name: string;
  email: string;
  profilePictureUrl?: string | null;
  employeeProfile?: { designation?: string | null; department?: string | null } | null;
};

// Debounced employee search picker. Portalled to body so the slide-panel's
// overflow-y:auto can't clip the dropdown.
function EmployeePicker({
  value, onChange,
}: {
  value: Employee | null;
  onChange: (e: Employee | null) => void;
}) {
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState("");
  const [debounced, setDebounced] = useState("");
  const triggerRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(id);
  }, [query]);

  const { data: results = [] as Employee[], isLoading } = useSWR<Employee[]>(
    open ? `/api/hr/employees?search=${encodeURIComponent(debounced)}&isActive=true` : null,
    fetcher,
    { keepPreviousData: true }
  );

  const openPicker = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        const dd = document.getElementById("employee-picker-dropdown");
        if (!dd || !dd.contains(e.target as Node)) setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={triggerRef} className="relative">
      {value ? (
        <div className="mt-1 flex items-center gap-2 h-9 px-3 border border-slate-200 rounded-lg bg-white">
          <div className="w-6 h-6 rounded-full bg-[#008CFF] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
            {value.name.charAt(0).toUpperCase()}
          </div>
          <span className="flex-1 text-[13px] text-slate-800 truncate">{value.name}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-slate-400 hover:text-slate-700"
            aria-label="Clear"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div
          onClick={openPicker}
          className={`${FIELD_CLS} flex items-center gap-2 cursor-text`}
        >
          <Search size={14} className="text-slate-400 shrink-0" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); if (!open) openPicker(); }}
            onFocus={openPicker}
            placeholder="Search employee by name or email…"
            className="flex-1 bg-transparent outline-none text-[13px] text-slate-800 placeholder-slate-400"
          />
        </div>
      )}

      {open && !value && rect && typeof document !== "undefined" && createPortal(
        <div
          id="employee-picker-dropdown"
          style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width, zIndex: 10000 }}
          className="bg-white border border-slate-200 rounded-lg shadow-xl max-h-[260px] overflow-y-auto py-1"
        >
          {isLoading && results.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">
              {debounced ? "No employees match" : "Type to search"}
            </p>
          ) : (
            results.slice(0, 30).map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => { onChange(e); setOpen(false); setQuery(""); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
              >
                <div className="w-7 h-7 rounded-full bg-[#008CFF] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                  {e.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800 truncate">{e.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {e.employeeProfile?.designation || e.email}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

export default function AssetsPanel({ showHeader = false }: { showHeader?: boolean }) {
  const { data: session } = useSession();
  const user = session?.user as any;
  // Manage-class actions (add / assign new) are gated by MANAGE_ASSETS
  // via can() — this also picks up the developer blanket-pass without
  // an explicit fallback. Anyone without MANAGE_ASSETS sees only their
  // OWN assigned assets ("my assets" view); the server enforces the
  // same scope so a UI bypass can't leak the full register.
  const canManageAssets = can(user, "MANAGE_ASSETS");
  const isAdmin = canManageAssets;
  const employeeView = !canManageAssets;
  const [category, setCategory] = useState("All");
  const [showCreate, setShowCreate] = useState(false);
  // Repeating-rows form: HR can hand a new hire their full kit
  // (laptop + monitor + keyboard + mouse + headset etc.) in ONE
  // submit. Items default to one blank row; HR adds rows as needed.
  // Shared fields (assignee / purchase date / notes) apply to every
  // item in the batch.
  type ItemRow = {
    id: string;          // local React key
    name: string;
    category: string;
    serialNumber: string;
    condition: string;
  };
  const blankRow = (): ItemRow => ({
    id: Math.random().toString(36).slice(2),
    name: "",
    category: "Laptop",
    serialNumber: "",
    condition: "good",
  });
  const [items, setItems] = useState<ItemRow[]>([blankRow()]);
  const [sharedPurchaseDate, setSharedPurchaseDate] = useState<string>("");
  const [sharedNotes, setSharedNotes] = useState<string>("");
  const [assignee, setAssignee] = useState<Employee | null>(null);
  const [saving, setSaving] = useState(false);

  // Edit-asset modal — hybrid: PUTs the original row's edits AND
  // POSTs any extra items added inline. Lets HR fix a typo on a row
  // AND add more kit to the same employee from the same drawer
  // without bouncing between modals. The extra items inherit the
  // current asset's assignee (so adding "Mouse" while editing a
  // laptop assigned to Abhishek auto-assigns the mouse to Abhishek).
  const [editing, setEditing] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    name: "", category: "Laptop", serialNumber: "",
    condition: "good", currentValue: "",
    purchaseDate: "", notes: "",
  });
  // Tracks the assignee for the Edit modal. Initialized to the row's
  // current open assignment on open; setting to null marks the asset
  // unassigned on save; setting to a different user atomically swaps
  // the assignment in the server-side transaction.
  const [editAssignee, setEditAssignee] = useState<Employee | null>(null);
  const [extraItems, setExtraItems] = useState<ItemRow[]>([]);
  const setE = (k: string, v: string) => setEditForm((f) => ({ ...f, [k]: v }));
  const setExtra = (id: string, patch: Partial<ItemRow>) =>
    setExtraItems((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addExtra = () => setExtraItems((rows) => [...rows, blankRow()]);
  const removeExtra = (id: string) =>
    setExtraItems((rows) => rows.filter((r) => r.id !== id));
  const openEdit = (a: any) => {
    setEditing(a);
    setEditForm({
      name: a.name ?? "",
      category: a.category ?? "Laptop",
      serialNumber: a.serialNumber ?? "",
      condition: a.condition ?? "good",
      currentValue: a.currentValue != null ? String(a.currentValue) : "",
      purchaseDate: a.purchaseDate
        ? new Date(a.purchaseDate).toISOString().slice(0, 10)
        : "",
      notes: a.notes ?? "",
    });
    // Pre-fill the assignee from the current open assignment on this
    // asset so HR sees who it's checked out to and can swap them in
    // the same save (the server diff-and-applies in a transaction).
    const cur = a.assignments?.[0]?.user;
    setEditAssignee(cur ? { id: cur.id, name: cur.name } as any : null);
    setExtraItems([]);
  };
  const closeEdit = () => {
    setEditing(null);
    setEditAssignee(null);
    setExtraItems([]);
  };
  const handleSaveEdit = async () => {
    if (!editing) return;
    if (!editForm.name.trim()) return alert("Asset name is required.");
    if (!editForm.category.trim()) return alert("Category is required.");
    // Validate extra rows the same way Add Assets does.
    for (let i = 0; i < extraItems.length; i++) {
      if (!extraItems[i].name.trim()) return alert(`New item #${i + 1}: name is required.`);
      if (!extraItems[i].category.trim()) return alert(`New item #${i + 1}: category is required.`);
    }
    setSaving(true);
    try {
      // 1. PUT the existing row. assigneeId is included whenever the
      //    picker value differs from the current open assignment — the
      //    server diff-and-applies in a transaction (create / close /
      //    swap). Undefined means "leave the assignment alone".
      const currentAssigneeId = editing.assignments?.[0]?.user?.id ?? null;
      const newAssigneeId = editAssignee?.id ?? null;
      const assigneeChanged = currentAssigneeId !== newAssigneeId;
      const body: any = {
        name: editForm.name.trim(),
        category: editForm.category.trim(),
        serialNumber: editForm.serialNumber.trim() || null,
        condition: editForm.condition,
        currentValue: editForm.currentValue ? Number(editForm.currentValue) : null,
        purchaseDate: editForm.purchaseDate
          ? new Date(editForm.purchaseDate).toISOString()
          : null,
        notes: editForm.notes.trim() || null,
      };
      if (assigneeChanged) body.assigneeId = newAssigneeId;  // null = make unassigned
      const res = await fetch(`/api/hr/assets/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return alert(j?.error ?? "Failed to update asset");
      }
      // 2. POST any extra items as a batch, inheriting whatever the
      //    edit just resolved to (so adding a mouse while reassigning
      //    from Abhishek → Aviral assigns the mouse to Aviral too).
      if (extraItems.length > 0) {
        const inheritedAssignee = newAssigneeId;
        const batchBody: any = {
          items: extraItems.map((r) => ({
            name: r.name.trim(),
            category: r.category.trim(),
            serialNumber: r.serialNumber.trim() || undefined,
            condition: r.condition || "good",
          })),
        };
        if (inheritedAssignee) batchBody.assignedToUserId = inheritedAssignee;
        const r2 = await fetch("/api/hr/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batchBody),
        });
        if (!r2.ok) {
          const j = await r2.json().catch(() => ({}));
          return alert(j?.error ?? "Edit saved, but new items failed to add");
        }
      }
      closeEdit();
      mutate(assetsUrl);
    } finally {
      setSaving(false);
    }
  };
  const handleDeleteAsset = async () => {
    if (!editing) return;
    if (!confirm(`Delete "${editing.name}"? This removes the asset and its assignment history.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/assets/${editing.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return alert(j?.error ?? "Failed to delete asset");
      }
      closeEdit();
      mutate(assetsUrl);
    } finally {
      setSaving(false);
    }
  };

  const setItem = (id: string, patch: Partial<ItemRow>) =>
    setItems((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addItem    = () => setItems((rows) => [...rows, blankRow()]);
  const removeItem = (id: string) =>
    setItems((rows) => (rows.length === 1 ? rows : rows.filter((r) => r.id !== id)));

  const resetForm = () => {
    setItems([blankRow()]);
    setSharedPurchaseDate("");
    setSharedNotes("");
    setAssignee(null);
  };

  const handleCreateAsset = async () => {
    // Local validation: every row needs name + category. Surface a
    // specific row index so HR knows where to fix.
    for (let i = 0; i < items.length; i++) {
      if (!items[i].name.trim()) return alert(`Item #${i + 1}: asset name is required.`);
      if (!items[i].category.trim()) return alert(`Item #${i + 1}: category is required.`);
    }
    setSaving(true);
    try {
      const body: any = {
        items: items.map((r) => ({
          name: r.name.trim(),
          category: r.category.trim(),
          serialNumber: r.serialNumber.trim() || undefined,
          condition: r.condition || "good",
        })),
      };
      if (assignee) body.assignedToUserId = assignee.id;
      if (sharedPurchaseDate) body.purchaseDate = new Date(sharedPurchaseDate).toISOString();
      if (sharedNotes.trim()) body.notes = sharedNotes.trim();
      const res = await fetch("/api/hr/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return alert(j?.error ?? "Failed to add assets");
      }
      setShowCreate(false);
      resetForm();
      mutate(assetsUrl);
    } finally {
      setSaving(false);
    }
  };

  // Employee view explicitly asks the API for the mine-scoped list.
  // Admins / managers fetch the full register. The server enforces
  // the same filter regardless of this query param, so a stale UI
  // can't leak assets it isn't supposed to see.
  const assetsUrl = employeeView ? "/api/hr/assets?mine=true" : "/api/hr/assets";
  const { data: assets = [], isLoading } = useSWR(assetsUrl, fetcher);
  const filtered = category === "All" ? assets : assets.filter((a: any) => a.category === category);

  // Admin-view accordion state: which assignee groups are currently
  // expanded. Keyed by user id (number) for assigned rows and by the
  // literal "unassigned" for stock items. First-render default = all
  // collapsed; HR opens the ones they care about.
  const [expandedGroups, setExpandedGroups] = useState<Set<number | "unassigned">>(new Set());
  // Search input that filters the user list (not the assets directly).
  // Typing "anjali" hides everyone else's group entirely instead of
  // filtering down the table — matches HR's "I'm looking at one
  // person's kit" mental model.
  const [userQuery, setUserQuery] = useState("");
  const toggleGroup = (key: number | "unassigned") =>
    setExpandedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });

  // Group the (already category-filtered) assets by their current
  // open assignment's user. "Unassigned" stock collects everything
  // without an active assignment row.
  type Group = {
    key: number | "unassigned";
    name: string;
    userId: number | null;
    profilePictureUrl: string | null;
    assets: any[];
  };
  const grouped: Group[] = (() => {
    const map = new Map<number | "unassigned", Group>();
    for (const a of filtered) {
      const u = a.assignments?.[0]?.user;
      const key = u?.id ?? "unassigned";
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: u?.name ?? "Unassigned (stock)",
          userId: u?.id ?? null,
          profilePictureUrl: u?.profilePictureUrl ?? null,
          assets: [],
        });
      }
      map.get(key)!.assets.push(a);
    }
    // Sort: assigned users alphabetically, "Unassigned" pinned to end.
    const groups = [...map.values()];
    groups.sort((a, b) => {
      if (a.key === "unassigned") return 1;
      if (b.key === "unassigned") return -1;
      return a.name.localeCompare(b.name);
    });
    return groups;
  })();
  const visibleGroups = userQuery.trim()
    ? grouped.filter((g) => g.name.toLowerCase().includes(userQuery.trim().toLowerCase()))
    : grouped;

  const counts = {
    total: assets.length,
    assigned: assets.filter((a: any) => a.status === "assigned").length,
    available: assets.filter((a: any) => a.status === "available").length,
    maintenance: assets.filter((a: any) => a.status === "in_repair" || a.status === "maintenance").length,
  };

  return (
    // Scope Times New Roman to the assets panel (and its slide-in
    // panels, which inherit font-family via the DOM tree even though
    // they render as fixed-position overlays). Page chrome outside
    // AssetsPanel keeps the app's default sans-serif.
    <div style={{ fontFamily: '"Times New Roman", Times, serif' }}>
      {showHeader && (
        <div className="bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6 py-5">
          <div className="flex items-center text-xs text-slate-500 mb-3 gap-1.5">
            <Link href="/dashboard" className="hover:text-slate-800 dark:text-white transition-colors">Home</Link><span>/</span>
            <span className="text-slate-800 dark:text-white">{employeeView ? "My Assets" : "Assets"}</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[20px] font-semibold text-slate-800 dark:text-white tracking-tight">{employeeView ? "My Assets" : "Asset Management"}</h1>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
                {employeeView
                  ? (assets.length === 0 ? "No assets assigned to you yet." : `${assets.length} asset${assets.length === 1 ? "" : "s"} assigned to you`)
                  : `${assets.length} assets registered`}
              </p>
            </div>
            {isAdmin && !employeeView && <button onClick={() => setShowCreate(true)} className="h-9 px-4 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[13px] font-semibold">+ Add Asset</button>}
          </div>
        </div>
      )}

      {!showHeader && (
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-[14px] font-bold text-slate-800 dark:text-white">{employeeView ? "My Assets" : "Asset Management"}</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {employeeView
                ? (assets.length === 0 ? "No assets assigned to you yet." : `${assets.length} asset${assets.length === 1 ? "" : "s"} assigned to you`)
                : `${assets.length} assets registered`}
            </p>
          </div>
          {isAdmin && !employeeView && <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 h-8 px-4 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[12px] font-semibold">+ Add Asset</button>}
        </div>
      )}

      <div className={showHeader ? "px-6 pt-5 space-y-5" : "space-y-5"}>
        {/* Admin view: 4-card breakdown of the full register.
            Employee view: skip the noisy stat grid entirely — the
            subtitle already tells them how many items they have, and
            "Available 0 / Maintenance 0" against their own assets
            isn't useful information. */}
        {!employeeView && (
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Total Assets", value: counts.total, color: "text-cyan-500", bg: "bg-cyan-500/8" },
              { label: "Assigned", value: counts.assigned, color: "text-[#008CFF]", bg: "bg-blue-500/8" },
              { label: "Available", value: counts.available, color: "text-emerald-500", bg: "bg-emerald-500/8" },
              { label: "Maintenance", value: counts.maintenance, color: "text-amber-500", bg: "bg-amber-500/8" },
            ].map((s) => (
              <div key={s.label} className={`${s.bg} rounded-xl px-5 py-4`}>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-0 border-b border-slate-200 dark:border-white/[0.06]">
          {CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${category === c ? "border-[#008CFF] text-slate-800 dark:text-white" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-white"}`}>{c}</button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" /></div>
        ) : employeeView ? (
          // ── EMPLOYEE VIEW — single user, flat table. No need to
          // group; "Assigned To" column dropped since every row is
          // them.
          <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-slate-200 dark:border-white/[0.06]">{["Asset Name","Type","Serial No.","Condition","Date"].map((h, i) => <th key={`${h}-${i}`} className="px-5 py-3 text-left text-[11px] uppercase tracking-wider text-slate-500 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {filtered.map((a: any, i: number) => (
                  <tr key={a.id} className={`border-b border-slate-100 dark:border-white/[0.03] ${i % 2 === 0 ? "" : "bg-slate-50 dark:bg-white/[0.01]"}`}>
                    <td className="px-5 py-3"><span className="text-[13px] text-slate-800 dark:text-white font-medium">{a.name}</span></td>
                    <td className="px-5 py-3"><span className="text-[12px] px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300">{a.category}</span></td>
                    <td className="px-5 py-3 text-[13px] text-slate-500 dark:text-slate-400 font-mono">{a.serialNumber || "—"}</td>
                    <td className="px-5 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full ${a.condition === "good" || a.condition === "new" ? "bg-emerald-500/10 text-emerald-600" : a.condition === "fair" ? "bg-amber-500/10 text-amber-600" : "bg-red-500/10 text-red-600"}`}>{a.condition}</span></td>
                    <td className="px-5 py-3 text-[13px] text-slate-500">{new Date(a.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p className="text-[13px] text-slate-500 text-center py-12">No assets are currently assigned to you.</p>
            )}
          </div>
        ) : (
          // ── ADMIN VIEW — accordion grouped by assignee. Click a
          // person to expand their kit. CPU rows surface specs from
          // the `notes` field as inline chips.
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <input
                type="text"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder="Search by employee name…"
                className="w-72 max-w-full text-[13px] px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#001529] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#008CFF]"
              />
              <p className="text-[12px] text-slate-500">{visibleGroups.length} {visibleGroups.length === 1 ? "person" : "people"} · {filtered.length} asset{filtered.length === 1 ? "" : "s"}</p>
            </div>

            {visibleGroups.map((g) => {
              const isOpen = expandedGroups.has(g.key);
              const types = [...new Set(g.assets.map((a) => a.category))];
              return (
                <div key={String(g.key)} className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.key)}
                    className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors text-left"
                    aria-expanded={isOpen}
                  >
                    <div className="flex items-center gap-3">
                      {g.userId ? (
                        g.profilePictureUrl ? (
                          // Real headshot when the user has one
                          // uploaded. object-cover keeps the circle
                          // crop crisp regardless of source aspect.
                          <img
                            src={g.profilePictureUrl}
                            alt={g.name}
                            className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-white/10"
                          />
                        ) : (
                          // Fallback: gradient circle with first
                          // initial. !text-white because a global
                          // pill-override rule otherwise demotes
                          // white text on rounded-full elements.
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center !text-white text-[13px] font-bold">
                            {g.name.charAt(0).toUpperCase()}
                          </div>
                        )
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center text-slate-500 text-[13px] font-bold">?</div>
                      )}
                      <div>
                        <p className="text-[14px] font-medium text-slate-800 dark:text-white">{g.name}</p>
                        <p className="text-[11.5px] text-slate-500">
                          {g.assets.length} item{g.assets.length === 1 ? "" : "s"}
                          {types.length > 0 ? ` · ${types.join(", ")}` : ""}
                        </p>
                      </div>
                    </div>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}><polyline points="6 9 12 15 18 9" /></svg>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100 dark:border-white/[0.04]">
                      <table className="w-full">
                        <thead><tr className="border-b border-slate-100 dark:border-white/[0.04] bg-slate-50/50 dark:bg-white/[0.02]">{["Asset Name","Type","Serial No.","Condition","Date",""].map((h, i) => <th key={`${h}-${i}`} className="px-5 py-2 text-left text-[11px] uppercase tracking-wider text-slate-500 font-medium">{h}</th>)}</tr></thead>
                        <tbody>
                          {g.assets.map((a: any) => {
                            // CPU rows surface the `notes` field
                            // (free-text specs like "i7-12700K /
                            // RTX 4060Ti / 32GB") as chips below the
                            // main row. Split on newlines and commas;
                            // no deeper parsing — HR writes the
                            // format they want.
                            const isCpu = a.category === "CPU";
                            const specLines = isCpu && a.notes
                              ? String(a.notes).split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean)
                              : [];
                            return (
                              <Fragment key={a.id}>
                                <tr className="border-b border-slate-100 dark:border-white/[0.03]">
                                  <td className="px-5 py-2.5"><span className="text-[13px] text-slate-800 dark:text-white font-medium">{a.name}</span></td>
                                  <td className="px-5 py-2.5"><span className="text-[12px] px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300">{a.category}</span></td>
                                  <td className="px-5 py-2.5 text-[13px] text-slate-500 dark:text-slate-400 font-mono">{a.serialNumber || "—"}</td>
                                  <td className="px-5 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded-full ${a.condition === "good" || a.condition === "new" ? "bg-emerald-500/10 text-emerald-600" : a.condition === "fair" ? "bg-amber-500/10 text-amber-600" : "bg-red-500/10 text-red-600"}`}>{a.condition}</span></td>
                                  <td className="px-5 py-2.5 text-[13px] text-slate-500">{new Date(a.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                                  <td className="px-5 py-2.5 text-right">
                                    <button
                                      type="button"
                                      onClick={() => openEdit(a)}
                                      className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-[#008CFF] transition-colors"
                                      aria-label={`Edit ${a.name}`}
                                    >
                                      <Pencil size={13} />
                                      Edit
                                    </button>
                                  </td>
                                </tr>
                                {specLines.length > 0 && (
                                  <tr className="border-b border-slate-100 dark:border-white/[0.03] bg-blue-50/40 dark:bg-blue-500/[0.04]">
                                    <td colSpan={6} className="px-5 pb-3 pt-1">
                                      <div className="flex items-start gap-2">
                                        <span className="text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400 font-semibold mt-1 whitespace-nowrap">CPU Specs</span>
                                        <div className="flex flex-wrap gap-1.5">
                                          {specLines.map((line: string, idx: number) => (
                                            <span key={idx} className="text-[12px] px-2 py-0.5 rounded bg-white dark:bg-white/5 border border-blue-200/60 dark:border-blue-500/20 text-slate-700 dark:text-slate-200 font-mono">{line}</span>
                                          ))}
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}

            {visibleGroups.length === 0 && (
              <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl">
                <p className="text-[13px] text-slate-500 text-center py-12">
                  {userQuery.trim() ? `No employees match "${userQuery}".` : "No assets found"}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {showCreate && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowCreate(false)} />
          <div className="fixed top-0 right-0 bottom-0 w-[440px] bg-[#f4f7f8] dark:bg-[#001529] border-l border-slate-200 dark:border-white/[0.08] shadow-2xl z-50 flex flex-col animate-slide-in">
            <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
              <div>
                <h2 className="text-[16px] font-semibold text-slate-800 dark:text-white">Add Assets</h2>
                <p className="mt-0.5 text-[11.5px] text-slate-500">Add one or more items in a single entry.</p>
              </div>
              <button onClick={() => { setShowCreate(false); }} aria-label="Close" className="text-slate-400 hover:text-slate-700 dark:hover:text-white -mt-1">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Assignee — top, optional. Leaving it empty stocks the
                  register without an owner (status defaults to 'available'). */}
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Assign To <span className="text-slate-400 font-normal normal-case tracking-normal">(optional)</span></label>
                <EmployeePicker value={assignee} onChange={setAssignee} />
              </div>

              {/* ITEMS — each row is a clean two-field card. Stacked
                  divider style (no heavy borders per row), trash icon
                  on hover, "+ Add item" sits below as a quiet ghost
                  button. Drops the Value field that crowded the row
                  for a 50/50 Category+Name top, 50/50 Serial+Condition
                  bottom layout — same fields, less visual noise. */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Items</label>
                  <span className="text-[11px] text-slate-400">{items.length} item{items.length === 1 ? "" : "s"}</span>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0a1526] divide-y divide-slate-100 dark:divide-white/[0.05]">
                  {items.map((row, idx) => (
                    <div key={row.id} className="p-4 group relative">
                      <div className="flex items-center justify-between mb-2.5">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-slate-100 dark:bg-white/[0.06] text-[10px] font-bold text-slate-600 dark:text-slate-300 px-1.5">{idx + 1}</span>
                          <span className="text-slate-500">{row.name.trim() || "New item"}</span>
                        </span>
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(row.id)}
                            aria-label="Remove item"
                            className="text-slate-400 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                          >
                            <X size={15} />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                        <div>
                          <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Category</label>
                          <SelectField
                            value={row.category}
                            onChange={(v) => setItem(row.id, { category: v })}
                            options={CATEGORIES.filter((c) => c !== "All")}
                            className={FIELD_CLS}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Asset Name</label>
                          <input
                            value={row.name}
                            onChange={(e) => setItem(row.id, { name: e.target.value })}
                            className={FIELD_CLS}
                            placeholder="e.g. MacBook Pro 14"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Serial No.</label>
                          <input
                            value={row.serialNumber}
                            onChange={(e) => setItem(row.id, { serialNumber: e.target.value })}
                            className={FIELD_CLS}
                            placeholder="Optional"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Condition</label>
                          <SelectField
                            value={row.condition}
                            onChange={(v) => setItem(row.id, { condition: v })}
                            options={["new","good","fair","poor"].map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))}
                            className={FIELD_CLS}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addItem}
                  className="mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#008CFF] hover:text-[#0070cc] transition-colors"
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#008CFF]/10">+</span>
                  Add another item
                </button>
              </div>

              {/* Shared fields collapse into one compact section —
                  fewer headings, lighter visual weight. Both fields
                  apply to every item above. */}
              <div className="border-t border-slate-100 dark:border-white/[0.05] pt-4 space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Purchase Date <span className="text-slate-400 font-normal normal-case tracking-normal">(optional)</span></label>
                  <DateField value={sharedPurchaseDate} onChange={setSharedPurchaseDate} className="mt-1 w-full max-w-[180px]" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">CPU Specs</label>
                  <textarea
                    value={sharedNotes}
                    onChange={(e) => setSharedNotes(e.target.value)}
                    rows={2}
                    placeholder="e.g. intel i7-12700K, RTX 4060Ti, 32GB RAM…"
                    className="mt-1 w-full px-3 py-2 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none focus:border-slate-300 resize-none"
                  />
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 dark:border-white/[0.06] flex justify-end gap-3">
              <button
                onClick={() => setShowCreate(false)}
                disabled={saving}
                className="h-9 px-5 text-[13px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white rounded-lg disabled:opacity-50"
              >Cancel</button>
              <button
                onClick={handleCreateAsset}
                disabled={saving}
                className="h-9 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold disabled:opacity-60 disabled:cursor-wait"
              >{saving ? "Saving…" : `Add ${items.length} asset${items.length === 1 ? "" : "s"}`}</button>
            </div>
          </div>
        </>
      )}

      {/* Edit Asset drawer — single-asset edit. Mirrors the visual
          shell of the Add Assets drawer but with one fixed item
          instead of repeating rows; the assignee isn't editable here
          (re-assign goes through the existing assign/return actions
          to keep the audit trail clean). */}
      {editing && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closeEdit} />
          <div className="fixed top-0 right-0 bottom-0 w-[440px] bg-[#f4f7f8] dark:bg-[#001529] border-l border-slate-200 dark:border-white/[0.08] shadow-2xl z-50 flex flex-col animate-slide-in">
            <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
              <div>
                <h2 className="text-[16px] font-semibold text-slate-800 dark:text-white">Edit Asset</h2>
                <p className="mt-0.5 text-[11.5px] text-slate-500">{editing.name}</p>
              </div>
              <button onClick={closeEdit} aria-label="Close" className="text-slate-400 hover:text-slate-700 dark:hover:text-white -mt-1">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {/* Assignee picker — pre-filled with whoever the asset
                  is currently checked out to. Setting to "Unassigned"
                  (clearing the picker) atomically closes the active
                  assignment; picking a different employee atomically
                  closes the current one and opens a new one. Server
                  uses a transaction so the swap is all-or-nothing. */}
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Assigned To
                  {(() => {
                    const cur = editing.assignments?.[0]?.user;
                    const curId = cur?.id ?? null;
                    const newId = editAssignee?.id ?? null;
                    if (curId === newId) return null;
                    return (
                      <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 px-1.5 py-0.5 text-[9.5px] font-bold normal-case tracking-normal">
                        will reassign
                      </span>
                    );
                  })()}
                </label>
                <EmployeePicker value={editAssignee} onChange={setEditAssignee} />
                <p className="mt-1 text-[10.5px] text-slate-400">
                  Clear to mark unassigned; pick a different employee to swap. Assignment history is preserved.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Category</label>
                  <SelectField
                    value={editForm.category}
                    onChange={(v) => setE("category", v)}
                    options={CATEGORIES.filter((c) => c !== "All")}
                    className={FIELD_CLS}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Asset Name</label>
                  <input
                    value={editForm.name}
                    onChange={(e) => setE("name", e.target.value)}
                    className={FIELD_CLS}
                    placeholder="e.g. MacBook Pro 14"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Serial No.</label>
                  <input
                    value={editForm.serialNumber}
                    onChange={(e) => setE("serialNumber", e.target.value)}
                    className={FIELD_CLS}
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Condition</label>
                  <SelectField
                    value={editForm.condition}
                    onChange={(v) => setE("condition", v)}
                    options={["new","good","fair","poor"].map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))}
                    className={FIELD_CLS}
                  />
                </div>
              </div>
              <div className="border-t border-slate-100 dark:border-white/[0.05] pt-4 space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Purchase Date <span className="text-slate-400 font-normal normal-case tracking-normal">(optional)</span></label>
                  <DateField value={editForm.purchaseDate} onChange={(v) => setE("purchaseDate", v)} className="mt-1 w-full max-w-[180px]" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">CPU Specs</label>
                  <textarea
                    value={editForm.notes}
                    onChange={(e) => setE("notes", e.target.value)}
                    rows={2}
                    placeholder="e.g. intel i7-12700K, RTX 4060Ti, 32GB RAM…"
                    className="mt-1 w-full px-3 py-2 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none focus:border-slate-300 resize-none"
                  />
                </div>
              </div>
              {/* "+ Add more items" — extra rows inherit this asset's
                  current assignee so HR doesn't have to re-pick them.
                  Saves alongside the edit (batch POST + PUT in
                  parallel paths under one click). */}
              <div className="border-t border-slate-100 dark:border-white/[0.05] pt-4 space-y-3">
                {extraItems.length === 0 ? (
                  <button
                    type="button"
                    onClick={addExtra}
                    className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#008CFF] hover:text-[#0070cc] transition-colors"
                  >
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#008CFF]/10">+</span>
                    Add more items for {editing.assignments?.[0]?.user?.name ?? "stock"}
                  </button>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        New items
                        <span className="ml-1.5 text-slate-400 font-normal normal-case tracking-normal">
                          (for {editing.assignments?.[0]?.user?.name ?? "stock"})
                        </span>
                      </label>
                      <span className="text-[11px] text-slate-400">{extraItems.length} new</span>
                    </div>
                    <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0a1526] divide-y divide-slate-100 dark:divide-white/[0.05]">
                      {extraItems.map((row, idx) => (
                        <div key={row.id} className="p-3.5 group relative">
                          <div className="flex items-center justify-between mb-2.5">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-slate-100 dark:bg-white/[0.06] text-[10px] font-bold text-slate-600 dark:text-slate-300 px-1.5">+{idx + 1}</span>
                              <span className="text-slate-500">{row.name.trim() || "New item"}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => removeExtra(row.id)}
                              aria-label="Remove item"
                              className="text-slate-400 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                            >
                              <X size={15} />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                            <div>
                              <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Category</label>
                              <SelectField
                                value={row.category}
                                onChange={(v) => setExtra(row.id, { category: v })}
                                options={CATEGORIES.filter((c) => c !== "All")}
                                className={FIELD_CLS}
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Asset Name</label>
                              <input
                                value={row.name}
                                onChange={(e) => setExtra(row.id, { name: e.target.value })}
                                className={FIELD_CLS}
                                placeholder="e.g. Logitech MX Mouse"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2.5">
                            <div>
                              <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Serial No.</label>
                              <input
                                value={row.serialNumber}
                                onChange={(e) => setExtra(row.id, { serialNumber: e.target.value })}
                                className={FIELD_CLS}
                                placeholder="Optional"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Condition</label>
                              <SelectField
                                value={row.condition}
                                onChange={(v) => setExtra(row.id, { condition: v })}
                                options={["new","good","fair","poor"].map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))}
                                className={FIELD_CLS}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={addExtra}
                      className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#008CFF] hover:text-[#0070cc] transition-colors"
                    >
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#008CFF]/10">+</span>
                      Add another item
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 dark:border-white/[0.06] flex items-center justify-between gap-3">
              {/* Delete sits on the left — destructive actions get
                  visual separation from the safe primary action so a
                  reflex click on Save doesn't trigger it. */}
              <button
                onClick={handleDeleteAsset}
                disabled={saving}
                className="h-9 px-4 text-[13px] font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg disabled:opacity-50"
              >Delete</button>
              <div className="flex items-center gap-3">
                <button
                  onClick={closeEdit}
                  disabled={saving}
                  className="h-9 px-5 text-[13px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white rounded-lg disabled:opacity-50"
                >Cancel</button>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="h-9 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold disabled:opacity-60 disabled:cursor-wait"
                >{saving
                  ? "Saving…"
                  : extraItems.length > 0
                    ? `Save & add ${extraItems.length} more`
                    : "Save changes"}</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
