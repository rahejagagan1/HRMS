"use client";
import { useState, useMemo, useEffect } from "react";
import useSWR, { mutate } from "swr";
import { useSearchParams } from "next/navigation";
import { fetcher } from "@/lib/swr";
import { Search, Check, Shield, Save } from "lucide-react";
import { TAB_CATALOG, defaultTabPermissions, type TabKey } from "@/lib/permissions/tabs";
import { brandFromSlug, inBrandScope } from "@/lib/hr-brand-scope";

type UserRow = {
  id: number; name: string; email: string; profilePictureUrl?: string | null;
  orgLevel?: string | null; role?: string | null;
  businessUnit?: string | null;
  isNew: boolean;
};

type DetailResponse = {
  user: UserRow & { isDeveloper?: boolean };
  protected: boolean;
  /// True when the *viewer* is a developer (DEVELOPER_EMAILS env). Devs
  /// can override the protected lock and edit any user's permissions —
  /// they're the ultimate power-users.
  actorIsDeveloper?: boolean;
  permissions: Record<TabKey, boolean>;
  wasNew: boolean;
};

export default function PermissionsPage() {
  const { data: users = [] as UserRow[] } = useSWR<UserRow[]>("/api/hr/admin/tab-permissions", fetcher);
  const searchParams = useSearchParams();
  // Auto-scope to the brand of the HR sub-dashboard the rail link came from
  // (?brand=). Super-admins on "all"/no param see every brand. UI-only filter.
  const brand = brandFromSlug(searchParams?.get("brand"));
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const xs = users.filter((u) => inBrandScope(u.businessUnit, brand));
    const q = search.trim().toLowerCase();
    if (!q) return xs;
    return xs.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [users, search, brand]);

  // Default-select the first "NEW" user, or the first user overall.
  useEffect(() => {
    if (selectedId !== null) return;
    if (filtered.length === 0) return;
    const firstNew = filtered.find((u) => u.isNew);
    setSelectedId((firstNew ?? filtered[0]).id);
  }, [filtered, selectedId]);

  return (
    <div className="min-h-screen bg-[#f4f7f8]">
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center gap-2">
          <h1 className="text-[15px] font-bold text-slate-800">Tab Permissions</h1>
          {brand && brand !== "all" && (
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${brand === "YT Labs" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"}`}>
              {brand}
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-0 h-[calc(100vh-82px)]">
        {/* ── Left: user list ── */}
        <aside className="w-[320px] shrink-0 border-r border-slate-200 bg-white flex flex-col">
          <div className="p-3 border-b border-slate-200">
            <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 h-9">
              <Search size={14} className="text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search users…"
                className="flex-1 bg-transparent text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none"
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <p className="px-4 py-8 text-[12px] text-slate-400 text-center">No users match "{search}"</p>
            ) : (
              filtered.map((u) => {
                const active = u.id === selectedId;
                return (
                  <button
                    key={u.id}
                    onClick={() => setSelectedId(u.id)}
                    className={`w-full text-left flex items-center gap-3 px-4 py-3 border-b border-slate-100 transition-colors ${
                      active ? "bg-[#008CFF]/10 border-l-2 border-l-[#008CFF]" : "hover:bg-slate-50"
                    }`}
                  >
                    {u.profilePictureUrl ? (
                      <img src={u.profilePictureUrl} alt="" referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-[#008CFF]/15 text-[#008CFF] text-[12px] font-semibold flex items-center justify-center shrink-0">
                        {u.name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[12.5px] font-semibold text-slate-800 truncate">{u.name}</p>
                        {u.isNew && (
                          <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 shrink-0">
                            NEW
                          </span>
                        )}
                      </div>
                      <p className="text-[10.5px] text-slate-500 truncate">{u.email}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ── Right: selected user's toggles ── */}
        <section className="flex-1 overflow-y-auto">
          {selectedId === null ? (
            <div className="flex items-center justify-center h-full text-[13px] text-slate-400">
              Select a user on the left to manage their tab access.
            </div>
          ) : (
            <UserDetail userId={selectedId} />
          )}
        </section>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
function UserDetail({ userId }: { userId: number }) {
  const key = `/api/hr/admin/tab-permissions/${userId}`;
  const { data } = useSWR<DetailResponse>(key, fetcher);
  const [draft, setDraft] = useState<Record<TabKey, boolean>>({} as Record<TabKey, boolean>);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data?.permissions) setDraft(data.permissions);
    // If the user was just seeded, refresh the list-pane so the NEW tag goes away.
    if (data?.wasNew) mutate("/api/hr/admin/tab-permissions");
  }, [data]);

  if (!data) {
    return <div className="p-8 text-[13px] text-slate-400">Loading…</div>;
  }

  const toggle = (k: TabKey) => setDraft((d) => ({ ...d, [k]: !d[k] }));
  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      await fetch(key, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: draft }),
      });
      await mutate(key);
      await mutate("/api/hr/admin/tab-permissions");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  const dirty = Object.keys(draft).some((k) => draft[k as TabKey] !== data.permissions[k as TabKey]);

  // Role-aware defaults for the currently-selected user — used to show
  // "Default for this role: X tabs on" and the Reset button.
  const roleDefaults = defaultTabPermissions(data.user.orgLevel);
  const roleDefaultOnCount = Object.values(roleDefaults).filter(Boolean).length;
  const resetToRoleDefaults = () => setDraft(roleDefaults);

  return (
    <div className="p-6 max-w-3xl">
      {/* Developers (the *viewer*) get an override — toggles stay
          editable for everyone, including CEO / special-access / other
          devs. Treat the lock as gone for them.
      */}
      {(() => null)()}
      {/* User header */}
      <div className="flex items-center gap-4 mb-6">
        {data.user.profilePictureUrl ? (
          <img src={data.user.profilePictureUrl} alt="" referrerPolicy="no-referrer"
            className="w-14 h-14 rounded-full object-cover" />
        ) : (
          <div className="w-14 h-14 rounded-full bg-[#008CFF]/15 text-[#008CFF] text-[16px] font-semibold flex items-center justify-center">
            {data.user.name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}
          </div>
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[16px] font-bold text-slate-800">{data.user.name}</h2>
            {data.protected && (
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                <Shield size={11} /> Protected role
                {data.actorIsDeveloper ? " · dev override" : ""}
              </span>
            )}
          </div>
          <p className="text-[12px] text-slate-500">{data.user.email}</p>
          <p className="text-[10.5px] text-slate-400 mt-0.5 uppercase tracking-wider">
            {data.user.orgLevel?.replace(/_/g, " ")}
            {data.user.isDeveloper ? " · developer" : ""}
          </p>
        </div>

        <button
          onClick={save}
          disabled={!dirty || saving || (data.protected && !data.actorIsDeveloper)}
          className="flex items-center gap-1.5 h-9 px-5 bg-[#008CFF] hover:bg-[#0070cc] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-[12.5px] font-semibold transition-colors"
        >
          {saved ? <><Check size={13} /> Saved</> : <><Save size={13} /> {saving ? "Saving…" : "Save Changes"}</>}
        </button>
      </div>

      {data.protected && !data.actorIsDeveloper && (
        <div className="mb-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-[12px] text-amber-900 flex items-start gap-2">
          <Shield size={14} className="shrink-0 mt-0.5" />
          <div>
            <strong>Protected role.</strong> CEO / special-access / developer accounts always see every tab
            and can't be restricted — this is a safety net so admins can't accidentally lock themselves
            (or the CEO) out of the app.
          </div>
        </div>
      )}

      {data.protected && data.actorIsDeveloper && (
        <div className="mb-5 px-4 py-3 bg-violet-50 border border-violet-200 rounded-lg text-[12px] text-violet-900 flex items-start gap-2">
          <Shield size={14} className="shrink-0 mt-0.5" />
          <div>
            <strong>Developer override active.</strong> This is normally a Protected role, but as a
            developer you can edit these toggles. Use carefully — locking out the CEO or other devs
            is unusual and will affect their access immediately.
          </div>
        </div>
      )}

      {/* Role-default banner — tells the admin what this user's role
          normally gets, and offers a one-click reset so overrides can
          be undone easily. */}
      {(!data.protected || data.actorIsDeveloper) && (
        <div className="mb-5 flex items-center justify-between px-4 py-2.5 bg-[#008CFF]/[0.06] border border-[#008CFF]/20 rounded-lg text-[12px] text-slate-700">
          <div>
            <strong className="text-[#0070cc]">Role default:</strong>{" "}
            <span className="capitalize">{data.user.orgLevel?.replace(/_/g, " ") || "member"}</span>
            {" "}sees <strong>{roleDefaultOnCount}</strong> of {TAB_CATALOG.length} tabs by default.
          </div>
          <button
            onClick={resetToRoleDefaults}
            disabled={saving}
            className="text-[11.5px] font-semibold text-[#008CFF] hover:underline disabled:opacity-40"
          >
            Reset to role defaults
          </button>
        </div>
      )}

      {/* Toggle grid — split into "Top-level tabs" and grouped sections
          so HR Dashboard sub-tabs aren't a confusing flat list. Tabs
          without a `group` go in the default top section. */}
      {(() => {
        const topLevel = TAB_CATALOG.filter((t) => !t.group);
        const groups = new Map<string, typeof TAB_CATALOG>();
        for (const t of TAB_CATALOG) {
          if (!t.group) continue;
          if (!groups.has(t.group)) groups.set(t.group, []);
          groups.get(t.group)!.push(t);
        }

        const renderTabRow = (tab: (typeof TAB_CATALOG)[number], i: number, total: number) => {
          const on = draft[tab.key] ?? false;
          const disabled = (data.protected && !data.actorIsDeveloper) || saving;
          const roleDefault = roleDefaults[tab.key];
          const overridden  = (!data.protected || data.actorIsDeveloper) && on !== roleDefault;
          return (
            <div
              key={tab.key}
              className={`flex items-center justify-between px-5 py-3.5 ${i !== total - 1 ? "border-b border-slate-100" : ""}`}
            >
              <div className="flex-1 min-w-0 pr-4">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-semibold text-slate-800">{tab.label}</p>
                  {overridden && (
                    <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                      Override
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">{tab.description}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Role default: <span className={roleDefault ? "text-emerald-600 font-semibold" : "text-slate-500"}>
                    {roleDefault ? "Enabled" : "Disabled"}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => !disabled && toggle(tab.key)}
                disabled={disabled}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  on ? "bg-[#008CFF]" : "bg-slate-300"
                } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                aria-pressed={on}
                aria-label={`Toggle ${tab.label}`}
              >
                <span className={`block w-[18px] h-[18px] bg-white rounded-full absolute top-[3px] shadow-sm transition-transform ${
                  on ? "translate-x-[22px]" : "translate-x-[3px]"
                }`} />
              </button>
            </div>
          );
        };

        return (
          <>
            {/* Top-level tabs */}
            <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Top-level tabs</p>
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {topLevel.map((t, i) => renderTabRow(t, i, topLevel.length))}
            </div>

            {/* Grouped sub-tabs (HR Dashboard sections, etc.) */}
            {Array.from(groups.entries()).map(([groupName, list]) => (
              <div key={groupName} className="mt-6">
                <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{groupName}</p>
                <p className="mb-2 text-[11px] text-slate-500">
                  These toggles only matter for users who already have HR Dashboard access — they hide individual sections within it.
                </p>
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {list.map((t, i) => renderTabRow(t, i, list.length))}
                </div>
              </div>
            ))}
          </>
        );
      })()}
    </div>
  );
}
