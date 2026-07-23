"use client";

// Admin → Emails Automation. Two layers of toggles:
//   • Global per email type — kills that email for everyone when off.
//   • Per role (CEO / HR Manager / Special Access / Admin) per type —
//     when global is ON, individual roles can still be turned off
//     ("stop emailing the CEO about leave, keep emailing HR").
//
// Each flip auto-saves (PATCH /api/admin/email-toggles) the moment the
// switch moves — same UX as the Regularization Policy card. The change
// is honored on the next email dispatch, no restart.
//
// Catalog comes from the server so this UI auto-updates when new kinds
// get added to src/lib/email/toggles.ts.

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Mail, Users, ChevronDown, ChevronRight, Clock } from "lucide-react";

type CatalogItem = {
    key: string;
    label: string;
    description: string;
    group: string;
};
type RoleItem = {
    key: string;
    label: string;
    description: string;
};
type Toggles  = Record<string, boolean>;
type PerRole  = Record<string, Record<string, boolean>>;
type HistoryEntry = { by: string; byId: number | null; at: string };
type History = Record<string, HistoryEntry>;

// "27 May 2026, 03:16 pm" — matches the screenshot format. Renders in
// the viewer's local timezone (Intl handles DST + offset automatically).
function formatChangedAt(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }).toLowerCase();
    return `${date}, ${time}`;
}

export default function EmailsAutomationPanel() {
    const [catalog,     setCatalog]     = useState<CatalogItem[]>([]);
    const [roleCatalog, setRoleCatalog] = useState<RoleItem[]>([]);
    const [toggles,     setToggles]     = useState<Toggles>({});
    const [perRole,     setPerRole]     = useState<PerRole>({});
    const [history,     setHistory]     = useState<History>({});
    const [openRole,    setOpenRole]    = useState<string | null>(null);
    const [loading,     setLoading]     = useState(true);
    // Per-row save state — keyed by toggle.key. While a key is in this
    // set, its switch shows "Saving…" and is disabled to avoid stacking
    // requests on the same row.
    const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
    // Bulk-mode save state — used by "All on" / "All off" buttons.
    const [bulkSaving, setBulkSaving] = useState(false);
    const [banner,   setBanner]   = useState<{ type: "ok" | "err"; text: string } | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetch("/api/admin/email-toggles")
            .then((r) => r.json())
            .then((d) => {
                if (cancelled) return;
                if (d?.error) { setBanner({ type: "err", text: d.error }); return; }
                setCatalog(d.catalog ?? []);
                setRoleCatalog(d.roleCatalog ?? []);
                setToggles(d.toggles ?? {});
                setPerRole(d.perRole ?? {});
                setHistory(d.history ?? {});
            })
            .catch(() => { if (!cancelled) setBanner({ type: "err", text: "Failed to load toggles" }); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    // Auto-save on flip: optimistically apply the new value, fire the
    // PATCH, revert on failure. Banner toasts success briefly so the
    // user knows it landed; errors stick until the next interaction.
    const flipAndSave = async (key: string) => {
        if (savingKeys.has(key) || bulkSaving) return;
        const before = !!toggles[key];
        const next   = !before;
        // Optimistic update.
        setToggles((t) => ({ ...t, [key]: next }));
        setSavingKeys((s) => {
            const n = new Set(s);
            n.add(key);
            return n;
        });
        setBanner(null);
        try {
            const res = await fetch("/api/admin/email-toggles", {
                method:  "PATCH",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ [key]: next }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) {
                // Revert and surface the error.
                setToggles((t) => ({ ...t, [key]: before }));
                setBanner({ type: "err", text: d?.error || "Save failed" });
                return;
            }
            // Trust the server response as the new truth.
            if (d?.toggles && typeof d.toggles === "object") setToggles(d.toggles);
            if (d?.history && typeof d.history === "object") setHistory(d.history);
            setBanner({ type: "ok", text: `${labelFor(key) ?? key} ${next ? "enabled" : "disabled"}.` });
            setTimeout(() => setBanner(null), 2500);
        } catch {
            setToggles((t) => ({ ...t, [key]: before }));
            setBanner({ type: "err", text: "Save failed" });
        } finally {
            setSavingKeys((s) => {
                const n = new Set(s);
                n.delete(key);
                return n;
            });
        }
    };

    // Bulk apply — sets every catalog key to `value` in one PATCH. Used
    // by "All on" / "All off". Optimistic + revert on error, same as
    // single-flip.
    const bulkApply = async (value: boolean) => {
        if (bulkSaving) return;
        const before = { ...toggles };
        const next: Toggles = {};
        for (const c of catalog) next[c.key] = value;
        setToggles(next);
        setBulkSaving(true);
        setBanner(null);
        try {
            const res = await fetch("/api/admin/email-toggles", {
                method:  "PATCH",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(next),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) {
                setToggles(before);
                setBanner({ type: "err", text: d?.error || "Save failed" });
                return;
            }
            if (d?.toggles && typeof d.toggles === "object") setToggles(d.toggles);
            setBanner({ type: "ok", text: value ? "All emails turned on." : "All emails turned off." });
            setTimeout(() => setBanner(null), 2500);
        } catch {
            setToggles(before);
            setBanner({ type: "err", text: "Save failed" });
        } finally {
            setBulkSaving(false);
        }
    };

    const labelFor = (key: string) => catalog.find((c) => c.key === key)?.label;

    /** Flip a per-role toggle. Mirror of flipAndSave but for the
     *  `perRole[role][kind]` cell. Missing keys default to ON in the
     *  server view, so we materialise that default on first interaction. */
    const flipRoleAndSave = async (role: string, kind: string) => {
        const flipKey = `${role}:${kind}`;
        if (savingKeys.has(flipKey) || bulkSaving) return;
        const before = perRole[role]?.[kind] !== false; // missing = ON
        const next   = !before;
        // Optimistic update.
        setPerRole((p) => ({
            ...p,
            [role]: { ...(p[role] ?? {}), [kind]: next },
        }));
        setSavingKeys((s) => {
            const n = new Set(s);
            n.add(flipKey);
            return n;
        });
        setBanner(null);
        try {
            const res = await fetch("/api/admin/email-toggles", {
                method:  "PATCH",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ perRole: { [role]: { [kind]: next } } }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) {
                setPerRole((p) => ({
                    ...p,
                    [role]: { ...(p[role] ?? {}), [kind]: before },
                }));
                setBanner({ type: "err", text: d?.error || "Save failed" });
                return;
            }
            if (d?.perRole && typeof d.perRole === "object") setPerRole(d.perRole);
            if (d?.history && typeof d.history === "object") setHistory(d.history);
            const roleLabel = roleCatalog.find((r) => r.key === role)?.label ?? role;
            setBanner({ type: "ok", text: `${labelFor(kind) ?? kind} for ${roleLabel} ${next ? "enabled" : "disabled"}.` });
            setTimeout(() => setBanner(null), 2500);
        } catch {
            setPerRole((p) => ({
                ...p,
                [role]: { ...(p[role] ?? {}), [kind]: before },
            }));
            setBanner({ type: "err", text: "Save failed" });
        } finally {
            setSavingKeys((s) => {
                const n = new Set(s);
                n.delete(flipKey);
                return n;
            });
        }
    };

    // Group catalog items by their `group` field for visual sectioning.
    const grouped: Record<string, CatalogItem[]> = {};
    for (const c of catalog) {
        if (!grouped[c.group]) grouped[c.group] = [];
        grouped[c.group].push(c);
    }
    // Group order — Recipients first (it's a meta-control that gates
    // recipient classes across every email kind, so it deserves the top
    // slot), then the per-kind groups in their original order.
    const KNOWN_ORDER = ["Recipients", "Requests", "Reports & Feedback", "Recruiting", "Cron jobs"];
    const groupOrder = [
        ...KNOWN_ORDER.filter((g) => grouped[g]),
        ...Object.keys(grouped).filter((g) => !KNOWN_ORDER.includes(g)),
    ];
    const enabledCount = Object.values(toggles).filter(Boolean).length;
    const totalCount   = catalog.length;

    if (loading) {
        return (
            <div className="max-w-4xl rounded-2xl bg-white border border-slate-200 p-12 text-center text-slate-400 text-[13px]">
                <span className="inline-flex h-7 w-7 items-center justify-center">
                    <span className="h-5 w-5 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
                </span>
                <p className="mt-3">Loading email toggles…</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl space-y-4">
            <div className="rounded-2xl bg-white border border-slate-200 shadow-[0_1px_3px_rgba(15,23,42,0.04)] p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-xl bg-violet-500/10 text-violet-600 flex items-center justify-center shrink-0">
                            <Mail size={18} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-[15px] font-semibold text-slate-800">Emails Automation</h2>
                            <p className="mt-1 text-[12.5px] text-slate-500">
                                Turn outbound emails on / off per type. Changes save automatically the moment you flip a switch.
                                In-app notifications keep flowing — only the email channel is gated.
                            </p>
                        </div>
                    </div>
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200">
                        {enabledCount} / {totalCount} active
                    </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                    <button
                        onClick={() => bulkApply(true)}
                        disabled={bulkSaving}
                        className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 hover:border-emerald-300 hover:text-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {bulkSaving ? "Saving…" : "All on"}
                    </button>
                    <button
                        onClick={() => bulkApply(false)}
                        disabled={bulkSaving}
                        className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {bulkSaving ? "Saving…" : "All off"}
                    </button>
                </div>
            </div>

            {banner && (
                <div className={`rounded-xl px-4 py-2.5 text-[12.5px] font-medium flex items-start gap-2 ${
                    banner.type === "ok"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-rose-50 text-rose-700 border border-rose-200"
                }`}>
                    {banner.type === "ok"
                        ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                        : <XCircle size={14} className="shrink-0 mt-0.5" />}
                    <span>{banner.text}</span>
                </div>
            )}

            {groupOrder.map((g) => grouped[g] && (
                <div key={g} className="rounded-2xl bg-white border border-slate-200 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-100">
                        <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-500">{g}</h3>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {grouped[g].map((t) => {
                            const on    = !!toggles[t.key];
                            const busy  = savingKeys.has(t.key) || bulkSaving;
                            const last  = history[t.key];
                            return (
                                <div key={t.key} className="flex items-start justify-between gap-4 px-5 py-3.5">
                                    <div className="min-w-0">
                                        <p className="text-[13.5px] font-semibold text-slate-800">{t.label}</p>
                                        <p className="mt-0.5 text-[11.5px] text-slate-500 leading-relaxed">{t.description}</p>
                                        <code className="mt-1 inline-block text-[10px] text-slate-400 bg-slate-50 px-1.5 rounded">{t.key}</code>
                                        {last && (
                                            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                                                <Clock size={11} className="shrink-0 text-slate-400" />
                                                <span>Last changed by <span className="font-medium text-slate-700">{last.by}</span> · {formatChangedAt(last.at)}</span>
                                            </p>
                                        )}
                                    </div>
                                    <div className="shrink-0 flex flex-col items-end gap-1">
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={on}
                                            aria-label={`${on ? "Disable" : "Enable"} ${t.label}`}
                                            onClick={() => flipAndSave(t.key)}
                                            disabled={busy}
                                            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 disabled:cursor-wait ${on ? "bg-emerald-500" : "bg-slate-300"}`}
                                        >
                                            <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform ${on ? "translate-x-[23px]" : "translate-x-[3px]"}`} />
                                        </button>
                                        <span className={`text-[10px] font-bold uppercase tracking-wider transition-colors ${
                                            busy
                                                ? "text-slate-400"
                                                : on
                                                ? "text-emerald-600"
                                                : "text-slate-400"
                                        }`}>
                                            {busy ? "Saving…" : on ? "On" : "Off"}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}

            {/* ── Per-role overrides ─────────────────────────────────
                One accordion section per role. Each row is the same
                email kind from the catalog above, but the toggle
                writes into perRole[role][kind] instead of the global
                map. Global OFF still kills the email for everyone —
                these per-role switches only refine WHO inside an
                org-broadcast actually gets it. */}
            {roleCatalog.length > 0 && (
                <div className="rounded-2xl bg-white border border-slate-200 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2.5">
                        <Users size={14} className="text-violet-500" />
                        <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-500">Recipients by role</h3>
                        <span className="ml-auto text-[11px] text-slate-400">
                            Per-role overrides — global OFF above still wins.
                        </span>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {roleCatalog.map((role) => {
                            const open = openRole === role.key;
                            const roleMap = perRole[role.key] ?? {};
                            // Count enabled within this role (default = ON for
                            // missing keys, matching server semantics).
                            const enabled = catalog.filter((k) => roleMap[k.key] !== false).length;
                            return (
                                <div key={role.key}>
                                    <button
                                        type="button"
                                        onClick={() => setOpenRole(open ? null : role.key)}
                                        className="w-full px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50/60 transition-colors text-left"
                                    >
                                        <div className="min-w-0 flex items-center gap-2.5">
                                            {open
                                                ? <ChevronDown  size={14} className="text-slate-400 shrink-0" />
                                                : <ChevronRight size={14} className="text-slate-400 shrink-0" />}
                                            <div className="min-w-0">
                                                <p className="text-[13.5px] font-semibold text-slate-800">{role.label}</p>
                                                <p className="mt-0.5 text-[11.5px] text-slate-500 leading-relaxed">{role.description}</p>
                                            </div>
                                        </div>
                                        <span className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200">
                                            {enabled} / {catalog.length}
                                        </span>
                                    </button>
                                    {open && (
                                        <div className="px-5 pb-4 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-slate-50/40">
                                            {catalog.map((t) => {
                                                const on    = roleMap[t.key] !== false; // missing = ON
                                                const busy  = savingKeys.has(`${role.key}:${t.key}`) || bulkSaving;
                                                const globalOn = !!toggles[t.key];
                                                return (
                                                    <div key={t.key} className={`flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 ${globalOn ? "" : "opacity-60"}`}>
                                                        <div className="min-w-0">
                                                            <p className="text-[12.5px] font-semibold text-slate-800 truncate">{t.label}</p>
                                                            <p className="text-[10.5px] text-slate-400 truncate">{t.key}</p>
                                                            {!globalOn && (
                                                                <p className="text-[10px] text-amber-600 mt-0.5">Global is off — this toggle has no effect.</p>
                                                            )}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            role="switch"
                                                            aria-checked={on}
                                                            aria-label={`${on ? "Disable" : "Enable"} ${t.label} for ${role.label}`}
                                                            onClick={() => flipRoleAndSave(role.key, t.key)}
                                                            disabled={busy}
                                                            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60 disabled:cursor-wait ${on ? "bg-emerald-500" : "bg-slate-300"}`}
                                                        >
                                                            <span className={`absolute top-[2.5px] h-[15px] w-[15px] rounded-full bg-white shadow transition-transform ${on ? "translate-x-[19px]" : "translate-x-[2.5px]"}`} />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
