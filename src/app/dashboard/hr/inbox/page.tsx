"use client";
import { useState, useMemo, useEffect } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import SelectField from "@/components/ui/SelectField";
import {
  TreePine, Clock, CheckCircle2, Home, Briefcase, Gift,
  Search, Bell, Archive as ArchiveIcon, Inbox as InboxIcon, XCircle,
  MessageSquare, Activity,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Theme tokens — matches the rest of the HR module.
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  shell:   "bg-[#f1f5f9] dark:bg-[#0b1220]",
  header:  "bg-white dark:bg-[#0d1b2e] border-[#e2e8f0] dark:border-[rgba(255,255,255,0.06)]",
  card:    "bg-white dark:bg-[#001529] border border-[#e2e8f0] dark:border-[rgba(255,255,255,0.06)]",
  t1:      "text-[#1e293b] dark:text-[#e2e8f0]",
  t2:      "text-[#475569] dark:text-[#8892a4]",
  t3:      "text-[#94a3b8] dark:text-[#64748b]",
  divider: "border-[#e2e8f0] dark:border-[rgba(255,255,255,0.06)]",
  accent:  "#008CFF",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const fmtRel  = (s: string) => {
  const diff = Date.now() - new Date(s).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return "just now";
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
};

function Av({ name, url, size = 36 }: { name: string; url?: string; size?: number }) {
  const initials = (name || "?").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  const colors = ["#4f46e5","#0891b2","#059669","#d97706","#dc2626","#7c3aed"];
  const bg = colors[(name || "?").charCodeAt(0) % colors.length];
  if (url) return <img src={url} alt={name} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  return (
    <div className="rounded-full flex items-center justify-center font-bold text-white shrink-0"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.33 }}>
      {initials}
    </div>
  );
}

// Icon-based avatar for system / actor-less notifications. Renders a
// neutral coloured circle with a relevant icon — used when the source
// of a notification is intentionally anonymous (e.g. unplugged
// feedback) so we don't show a misleading "S"/"System" initial.
function SystemAv({ type, size = 36 }: { type: string; size?: number }) {
  // Type → { tint, Icon } mapping. Falls back to a generic Activity
  // glyph for anything we haven't styled yet.
  const META: Record<string, { tint: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = {
    feedback:        { tint: "#7c3aed", Icon: MessageSquare },
    job_application: { tint: "#0891b2", Icon: Briefcase     },
  };
  const { tint, Icon } = META[type] || { tint: "#64748b", Icon: Activity };
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0"
      style={{ width: size, height: size, background: `${tint}1a`, color: tint }}
    >
      <Icon size={Math.round(size * 0.45)} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Category taxonomy — drives the left sidebar.
// ─────────────────────────────────────────────────────────────────────────────
type CatKey = "leaves" | "expenses" | "regularizations" | "wfh" | "onDuty" | "compOff";

type Cat = {
  key: CatKey;
  label: string;
  Icon: any;
  color: string;          // icon colour
  bucket: CatKey;         // matches the key on /api/hr/inbox response
  prefix: string;         // unique prefix for per-item request keys
};

const CATEGORIES: Cat[] = [
  { key: "leaves",          label: "Leave Requests",            Icon: TreePine,     color: "text-violet-500", bucket: "leaves",          prefix: "l"  },
  { key: "regularizations", label: "Attendance Regularization", Icon: Clock,        color: "text-amber-500",  bucket: "regularizations", prefix: "r"  },
  { key: "wfh",             label: "Work From Home",            Icon: Home,         color: "text-cyan-500",   bucket: "wfh",             prefix: "w"  },
  { key: "onDuty",          label: "On Duty",                   Icon: Briefcase,    color: "text-indigo-500", bucket: "onDuty",          prefix: "od" },
  { key: "compOff",         label: "Comp-Off",                  Icon: Gift,         color: "text-pink-500",   bucket: "compOff",         prefix: "co" },
];

// Returns the {from, to} of the range the user originally submitted.
// Range submissions create one WFH/OnDuty row per working day; they
// share the same userId, reason, and createdAt timestamp (transaction-
// wide `now()`). We group on (userId, reason, createdAt within 30s)
// to recover the span so the detail panel can show From / To instead
// of just the current row's date.
function siblingRange(item: any, siblings: any[]): { from: Date; to: Date } {
  const own = new Date(item.date);
  if (!Array.isArray(siblings) || siblings.length <= 1) return { from: own, to: own };
  const seedTs = new Date(item.createdAt).getTime();
  const reason = (item.reason || "").trim();
  const group = siblings.filter((s) => {
    if (s.userId !== item.userId) return false;
    if ((s.reason || "").trim() !== reason) return false;
    const dt = Math.abs(new Date(s.createdAt).getTime() - seedTs);
    return dt <= 30_000;
  });
  if (group.length === 0) return { from: own, to: own };
  const dates = group.map((g) => new Date(g.date).getTime()).sort((a, b) => a - b);
  return { from: new Date(dates[0]), to: new Date(dates[dates.length - 1]) };
}

// Build the right-panel detail rows for each category. `siblings` is
// the rest of the items in the same bucket — used to reconstruct
// from/to for per-day rows that were created from a range submission.
function detailFor(cat: Cat, item: any, siblings: any[]) {
  switch (cat.key) {
    case "leaves":
      return [
        ["Leave Type", item.leaveType?.name],
        ["From",       fmtDate(item.fromDate)],
        ["To",         fmtDate(item.toDate)],
        ["Total Days", `${parseFloat(item.totalDays).toFixed(1)} day${parseFloat(item.totalDays) !== 1 ? "s" : ""}`],
        ["Applied On", fmtDate(item.appliedAt)],
      ];
    case "expenses":
      return [
        ["Title",    item.title],
        ["Category", item.category],
        ["Amount",   `₹${Number(item.amount).toLocaleString("en-IN")}`],
        ["Created",  fmtDate(item.createdAt)],
      ];
    case "regularizations":
      return [
        ["Date",      fmtDate(item.date)],
        ...(item.requestedIn  ? [["Requested In",  new Date(item.requestedIn).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})] as [string, string] ] : []),
        ...(item.requestedOut ? [["Requested Out", new Date(item.requestedOut).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})] as [string, string] ] : []),
        ["Submitted", fmtDate(item.createdAt)],
      ];
    case "wfh": {
      // Prefer the leader's pre-computed range when the items list is
      // collapsed (take_action view); fall back to a sibling scan for
      // anywhere we render raw per-day rows.
      const from = item._rangeFrom ? new Date(item._rangeFrom) : siblingRange(item, siblings).from;
      const to   = item._rangeTo   ? new Date(item._rangeTo)   : siblingRange(item, siblings).to;
      const days = item._groupSize ?? 1;
      return [
        ["From",      fmtDate(from.toISOString())],
        ["To",        fmtDate(to.toISOString())],
        ...(days > 1 ? [["Total Days", `${days} day${days === 1 ? "" : "s"}`] as [string, string]] : []),
        ["Submitted", fmtDate(item.createdAt)],
      ];
    }
    case "onDuty": {
      const from = item._rangeFrom ? new Date(item._rangeFrom) : siblingRange(item, siblings).from;
      const to   = item._rangeTo   ? new Date(item._rangeTo)   : siblingRange(item, siblings).to;
      const days = item._groupSize ?? 1;
      return [
        ["From",      fmtDate(from.toISOString())],
        ["To",        fmtDate(to.toISOString())],
        ...(days > 1 ? [["Total Days", `${days} day${days === 1 ? "" : "s"}`] as [string, string]] : []),
        ...(item.fromTime ? [["From Time", item.fromTime] as [string, string]] : []),
        ...(item.toTime   ? [["To Time",   item.toTime]   as [string, string]] : []),
        ...(item.location ? [["Location",  item.location] as [string, string]] : []),
      ];
    }
    case "compOff":
      return [
        ["Worked Date", fmtDate(item.workedDate)],
        ["Credit",      `${parseFloat(item.creditDays).toFixed(1)} day`],
        ["Submitted",   fmtDate(item.createdAt)],
      ];
  }
}

// Route each approval action to the right endpoint.
function approvalUrlFor(cat: Cat, item: any, action: "approve" | "reject") {
  switch (cat.key) {
    case "leaves":          return { url: `/api/hr/leaves/${item.id}`,           body: { action } };
    case "expenses":        return { url: `/api/hr/expenses/${item.id}`,         body: { action } };
    case "regularizations": return { url: `/api/hr/attendance/regularize`,       body: { id: item.id, action } };
    case "wfh":             return { url: `/api/hr/attendance/wfh`,              body: { id: item.id, action } };
    case "onDuty":          return { url: `/api/hr/attendance/on-duty`,          body: { id: item.id, action } };
    case "compOff":         return { url: `/api/hr/leaves/comp-off`,             body: { id: item.id, action } };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
type TopTab = "take_action" | "notifications" | "archive";

export default function InboxPage() {
  const [topTab, setTopTab]       = useState<TopTab>("take_action");
  const [catKey, setCatKey]       = useState<CatKey>("leaves");
  const [selectedId, setSelected] = useState<number | null>(null);
  const [search, setSearch]       = useState("");
  const [sort, setSort]           = useState<"newest" | "oldest">("newest");
  const [approving, setApproving] = useState<Record<string, boolean>>({});

  const endpoint =
    topTab === "archive"
      ? "/api/hr/inbox?view=archive"
      : topTab === "notifications"
      ? "/api/hr/notifications"
      : "/api/hr/inbox";

  const { data, isLoading } = useSWR(endpoint, fetcher);

  // Counts for sidebar badges — only meaningful for take_action + archive.
  // WFH / OD counts are de-duplicated by range group so a 7-day range
  // counts as one item, matching what the user sees in the list.
  const counts = useMemo(() => {
    if (!data || topTab === "notifications") return {} as Record<CatKey, number>;
    return Object.fromEntries(
      CATEGORIES.map((c) => {
        const arr = (data[c.bucket] ?? []) as any[];
        if (c.key !== "wfh" && c.key !== "onDuty") return [c.key, arr.length];
        const seen = new Set<string>();
        for (const it of arr) {
          seen.add([
            it.userId,
            (it.reason || "").trim(),
            Math.floor(new Date(it.createdAt).getTime() / 1000),
          ].join("|"));
        }
        return [c.key, seen.size];
      })
    ) as Record<CatKey, number>;
  }, [data, topTab]);

  const total = useMemo(() => {
    if (topTab === "notifications") return data?.unreadCount ?? 0;
    return data?.total ?? 0;
  }, [data, topTab]);

  // Items visible in the middle column for the current category.
  // For WFH / OnDuty we collapse per-day rows that came from the same
  // range submission (same userId + same reason + createdAt within
  // 30s) into a single "group leader" item. The leader carries
  // `_groupIds` — the full list of underlying row ids — so an approve
  // / reject on the leader cascades to every day in the range. Other
  // categories (leaves, comp-off, regularizations, expenses) already
  // carry from/to natively, so they pass through unchanged.
  const items: any[] = useMemo(() => {
    if (!data || topTab === "notifications") return [];
    const cat = CATEGORIES.find(c => c.key === catKey);
    if (!cat) return [];
    let list: any[] = data[cat.bucket] ?? [];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((it: any) =>
        (it.user?.name || "").toLowerCase().includes(q) ||
        (it.reason    || "").toLowerCase().includes(q) ||
        (it.title     || "").toLowerCase().includes(q)
      );
    }
    if (cat.key === "wfh" || cat.key === "onDuty") {
      // Bucket by (userId | trimmed reason | createdAt-second). Pick
      // the earliest-date row as the leader so the list reads in
      // calendar order; attach `_groupIds` + `_groupSize` so the UI
      // can show "11 May – 19 May (7 days)" and act on all rows in
      // one go.
      const buckets = new Map<string, any[]>();
      for (const it of list) {
        const key = [
          it.userId,
          (it.reason || "").trim(),
          Math.floor(new Date(it.createdAt).getTime() / 1000),
        ].join("|");
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(it);
      }
      list = Array.from(buckets.values()).map((group) => {
        const sorted = [...group].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const leader = sorted[0];
        return {
          ...leader,
          _groupIds:  sorted.map((g) => g.id),
          _groupSize: sorted.length,
          _rangeFrom: new Date(sorted[0].date),
          _rangeTo:   new Date(sorted[sorted.length - 1].date),
        };
      });
    }
    list = [...list].sort((a, b) => {
      const ta = new Date(a.createdAt ?? a.appliedAt ?? a.updatedAt).getTime();
      const tb = new Date(b.createdAt ?? b.appliedAt ?? b.updatedAt).getTime();
      return sort === "newest" ? tb - ta : ta - tb;
    });
    return list;
  }, [data, catKey, topTab, search, sort]);

  // Default selection: first item whenever the category or dataset changes.
  useEffect(() => {
    if (items.length === 0) { setSelected(null); return; }
    if (!items.find(it => it.id === selectedId)) setSelected(items[0].id);
  }, [items, selectedId]);

  const selected = useMemo(() => items.find(it => it.id === selectedId), [items, selectedId]);
  const activeCat = CATEGORIES.find(c => c.key === catKey)!;

  // ── Approve / Reject ──────────────────────────────────────────────────
  // For grouped WFH / OnDuty leaders we fire one PUT per underlying
  // day row in parallel so the entire range is decided in one click.
  // For everything else there's no `_groupIds` and we hit the single
  // id like before.
  const act = async (action: "approve" | "reject") => {
    if (!selected) return;
    const ids: number[] = Array.isArray(selected._groupIds) && selected._groupIds.length > 0
      ? selected._groupIds
      : [selected.id];
    const key = `${activeCat.prefix}${selected.id}`;
    setApproving(p => ({ ...p, [key]: true }));
    try {
      await Promise.all(ids.map((id) => {
        const { url, body } = approvalUrlFor(activeCat, { ...selected, id }, action);
        return fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      }));
      // Bust every related cache so the user sees the change everywhere.
      mutate((k: string) => typeof k === "string" && (
        k.includes("/api/hr/leaves") || k.includes("/api/hr/expenses") ||
        k.includes("/api/hr/attendance") || k.includes("/api/hr/inbox") ||
        k.includes("/api/hr/notifications")
      ));
    } finally {
      setApproving(p => ({ ...p, [key]: false }));
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────
  return (
    <div className={`min-h-screen ${C.shell}`}>
      {/* ── Header ── */}
      <div className={`${C.header} border-b px-6 py-4`}>
        <h1 className={`text-[17px] font-semibold ${C.t1}`}>Inbox</h1>
        <p className={`text-[12px] ${C.t3} mt-0.5`}>
          {topTab === "notifications"
            ? `${total} unread notification${total !== 1 ? "s" : ""}`
            : topTab === "archive"
            ? `${total} recently resolved`
            : `${total} pending action${total !== 1 ? "s" : ""} require your attention`}
        </p>
      </div>

      {/* ── Top tabs ── */}
      <div className={`${C.header} border-b flex items-center gap-0 px-6`}>
        {([
          { key: "take_action",   label: "TAKE ACTION",   Icon: InboxIcon },
          { key: "notifications", label: "NOTIFICATIONS", Icon: Bell      },
          { key: "archive",       label: "ARCHIVE",       Icon: ArchiveIcon },
        ] as const).map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTopTab(key)}
            className={`flex items-center gap-2 px-4 py-3 text-[11px] font-bold tracking-widest border-b-2 transition-colors ${
              topTab === key
                ? "border-[#008CFF] text-[#008CFF]"
                : `border-transparent ${C.t2} hover:text-[#008CFF]`
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Body ── */}
      {topTab === "notifications" ? (
        <NotificationsPane data={data} isLoading={isLoading} />
      ) : (
        <div className="flex min-h-[calc(100vh-170px)]">
          {/* Left — categories */}
          <aside className={`w-[240px] shrink-0 ${C.header} border-r`}>
            <div className="px-4 py-3">
              <p className={`text-[10px] font-bold tracking-widest ${C.t3} uppercase`}>
                {topTab === "archive" ? "Archive · last 3 months" : "Pending tasks"}
              </p>
            </div>
            <nav className="flex flex-col gap-0.5 px-2">
              {CATEGORIES.map(cat => {
                const n = counts[cat.key] ?? 0;
                const active = catKey === cat.key;
                return (
                  <button
                    key={cat.key}
                    onClick={() => { setCatKey(cat.key); setSelected(null); }}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12.5px] transition-colors text-left ${
                      active
                        ? "bg-[#008CFF]/10 text-[#008CFF]"
                        : `${C.t2} hover:bg-slate-100 dark:hover:bg-white/[0.04]`
                    }`}
                  >
                    <cat.Icon className={`w-4 h-4 ${active ? "text-[#008CFF]" : cat.color}`} />
                    <span className="flex-1 truncate font-medium">{cat.label}</span>
                    {n > 0 && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        active ? "bg-[#008CFF] text-white" : "bg-slate-100 dark:bg-white/10 " + C.t3
                      }`}>{n}</span>
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Middle — list */}
          <div className={`w-[380px] shrink-0 border-r ${C.divider} bg-white dark:bg-[#0a1526]`}>
            <div className={`flex items-center gap-2 px-4 py-3 border-b ${C.divider}`}>
              <p className={`text-[10px] font-bold tracking-widest ${C.t2} uppercase flex-1 truncate`}>
                {activeCat.label}
              </p>
              <SelectField
                value={sort}
                onChange={(v) => setSort(v as any)}
                options={[
                  { value: "newest", label: "NEWEST" },
                  { value: "oldest", label: "OLDEST" },
                ]}
                className={`h-7 w-[110px] text-[10px] font-semibold tracking-wider uppercase bg-transparent ${C.t2} border-0`}
              />
            </div>
            <div className={`px-4 py-2.5 border-b ${C.divider}`}>
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-white/[0.03] px-3 h-8 rounded-lg">
                <Search className={`w-3.5 h-3.5 ${C.t3}`} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search"
                  className={`flex-1 bg-transparent text-[12px] ${C.t1} placeholder-slate-400 focus:outline-none`}
                />
              </div>
            </div>
            <div className="overflow-y-auto max-h-[calc(100vh-260px)]">
              {isLoading ? (
                <div className="flex items-center justify-center h-40">
                  <div className="w-6 h-6 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-center px-4">
                  <CheckCircle2 className="w-7 h-7 text-emerald-400 mb-2" />
                  <p className={`text-[12px] font-medium ${C.t1}`}>All caught up</p>
                  <p className={`text-[11px] ${C.t3} mt-1`}>
                    {topTab === "archive" ? "No resolved items here." : "Nothing pending in this category."}
                  </p>
                </div>
              ) : (
                items.map((item: any) => {
                  const active = item.id === selectedId;
                  const when   = item.createdAt ?? item.appliedAt ?? item.updatedAt;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelected(item.id)}
                      className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b ${C.divider} transition-colors ${
                        active ? "bg-[#008CFF]/5 border-l-2 border-l-[#008CFF]" : "hover:bg-slate-50 dark:hover:bg-white/[0.025]"
                      }`}
                    >
                      <Av name={item.user?.name || "?"} url={item.user?.profilePictureUrl} size={32} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-[12.5px] font-semibold ${C.t1} truncate`}>{item.user?.name || "Employee"}</p>
                          {when && <span className={`text-[10px] ${C.t3} shrink-0`}>{fmtRel(when)}</span>}
                        </div>
                        <p className={`text-[11px] ${C.t2} truncate mt-0.5`}>
                          {previewFor(activeCat, item)}
                        </p>
                        {topTab === "archive" && (
                          <StatusPill status={item.status} />
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right — detail */}
          <section className="flex-1 overflow-y-auto">
            {!selected ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-3" />
                <p className={`text-[14px] font-medium ${C.t1}`}>
                  {topTab === "archive" ? "No resolved items" : "All caught up!"}
                </p>
                <p className={`text-[12px] ${C.t3} mt-1`}>
                  {topTab === "archive" ? "Select an item to view details." : "No pending actions in your inbox."}
                </p>
              </div>
            ) : (
              <div className="p-8 max-w-3xl">
                <div className="flex items-center gap-3">
                  <Av name={selected.user?.name || "?"} url={selected.user?.profilePictureUrl} size={44} />
                  <div>
                    <p className={`text-[15px] font-semibold ${C.t1}`}>{selected.user?.name}</p>
                    <p className={`text-[11px] ${C.t3}`}>
                      {activeCat.label}
                      {selected.createdAt && ` · ${fmtRel(selected.createdAt)}`}
                    </p>
                  </div>
                  {topTab === "archive" && (
                    <div className="ml-auto"><StatusPill status={selected.status} size="lg" /></div>
                  )}
                </div>

                <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4">
                  {detailFor(activeCat, selected, items)?.map(([k, v]) => (
                    <div key={k}>
                      <p className={`text-[10px] font-bold tracking-widest ${C.t3} uppercase`}>{k}</p>
                      <p className={`text-[13px] ${C.t1} mt-1`}>{v}</p>
                    </div>
                  ))}
                </div>

                {(selected.reason || selected.description || selected.purpose) && (
                  <div className="mt-6">
                    <p className={`text-[10px] font-bold tracking-widest ${C.t3} uppercase`}>Reason</p>
                    <p className={`text-[13px] ${C.t1} mt-1 whitespace-pre-wrap`}>
                      {selected.reason || selected.description || selected.purpose}
                    </p>
                  </div>
                )}

                {topTab === "take_action" && (
                  <div className="mt-8 flex items-center gap-3">
                    <button
                      onClick={() => act("approve")}
                      disabled={approving[`${activeCat.prefix}${selected.id}`]}
                      className="h-9 px-5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white rounded-lg text-[12.5px] font-semibold"
                    >Approve</button>
                    <button
                      onClick={() => act("reject")}
                      disabled={approving[`${activeCat.prefix}${selected.id}`]}
                      className="h-9 px-5 bg-white dark:bg-white/5 hover:bg-red-50 dark:hover:bg-red-500/10 border border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400 disabled:opacity-40 rounded-lg text-[12.5px] font-semibold"
                    >Reject</button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// List preview text — one-liner under the employee name in the middle column.
// ─────────────────────────────────────────────────────────────────────────────
function previewFor(cat: Cat, it: any): string {
  // For collapsed WFH / OD groups the leader carries `_rangeFrom` /
  // `_rangeTo` / `_groupSize` — show "11 May → 19 May · 7 days" so the
  // user knows it's a range, not a single-day request.
  const rangeLabel = (): string => {
    if (!it._rangeFrom || !it._rangeTo) return fmtDate(it.date);
    const from = new Date(it._rangeFrom);
    const to   = new Date(it._rangeTo);
    if (from.toDateString() === to.toDateString()) return fmtDate(it.date);
    return `${fmtDate(from.toISOString())} → ${fmtDate(to.toISOString())}`;
  };
  switch (cat.key) {
    case "leaves":          return `${it.leaveType?.name || "Leave"} · ${fmtDate(it.fromDate)}${it.fromDate !== it.toDate ? ` → ${fmtDate(it.toDate)}` : ""}`;
    case "expenses":        return `${it.title || "Expense"} · ₹${Number(it.amount || 0).toLocaleString("en-IN")}`;
    case "regularizations": return `${fmtDate(it.date)}${it.reason ? ` · ${it.reason}` : ""}`;
    case "wfh": {
      const span = rangeLabel();
      const days = it._groupSize > 1 ? ` · ${it._groupSize} days` : "";
      return `${span}${days}${it.reason ? ` · ${it.reason}` : ""}`;
    }
    case "onDuty": {
      const span = rangeLabel();
      const days = it._groupSize > 1 ? ` · ${it._groupSize} days` : "";
      return `${span}${days}${it.location ? ` · ${it.location}` : ""}`;
    }
    case "compOff":         return `Worked ${fmtDate(it.workedDate)} · ${parseFloat(it.creditDays).toFixed(1)} day`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Status pill for archive view.
// ─────────────────────────────────────────────────────────────────────────────
function StatusPill({ status, size = "sm" }: { status: string; size?: "sm" | "lg" }) {
  const map: Record<string, { label: string; cls: string }> = {
    approved:            { label: "Approved",  cls: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
    partially_approved:  { label: "Mgr Approved", cls: "bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400" },
    rejected:            { label: "Rejected",  cls: "bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400" },
    pending:             { label: "Pending",   cls: "bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  };
  const info = map[status] ?? { label: status, cls: "bg-slate-100 dark:bg-white/10 text-slate-500" };
  return (
    <span className={`inline-block font-semibold rounded-full ${
      size === "lg" ? "text-[11px] px-3 py-1" : "text-[9.5px] px-2 py-0.5 mt-1"
    } ${info.cls}`}>{info.label}</span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications pane — simple vertical list.
// ─────────────────────────────────────────────────────────────────────────────
function NotificationsPane({ data, isLoading }: { data: any; isLoading: boolean }) {
  const items: any[] = data?.items ?? [];

  const markRead = async (id: number) => {
    await fetch("/api/hr/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "read" }),
    });
    mutate("/api/hr/notifications");
  };
  const markAllRead = async () => {
    await fetch("/api/hr/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read_all" }),
    });
    mutate("/api/hr/notifications");
  };

  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className={`text-[13px] font-semibold ${C.t1}`}>Notifications</h2>
        <button onClick={markAllRead} className="text-[11px] font-semibold text-[#008CFF] hover:underline">
          Mark all as read
        </button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className={`${C.card} rounded-2xl p-12 text-center`}>
          <Bell className={`w-9 h-9 ${C.t3} mx-auto mb-3`} />
          <p className={`text-[14px] font-medium ${C.t1}`}>You're all caught up</p>
          <p className={`text-[12px] ${C.t3} mt-1`}>No new notifications.</p>
        </div>
      ) : (
        <div className={`${C.card} rounded-2xl overflow-hidden`}>
          {items.map((n: any, i: number) => (
            <div
              key={n.id}
              className={`flex items-start gap-3 px-5 py-4 ${i !== items.length - 1 ? `border-b ${C.divider}` : ""} ${
                n.isRead ? "" : "bg-[#008CFF]/[0.04]"
              }`}
            >
              {/* Actor-less notifications (e.g. anonymous feedback) get a
                  type-themed icon avatar instead of the misleading "S"
                  initial fallback. Real actors keep their photo/initial. */}
              {n.actor
                ? <Av name={n.actor.name} url={n.actor.profilePictureUrl} size={36} />
                : <SystemAv type={n.type || ""} size={36} />}
              <div className="flex-1 min-w-0">
                <p className={`text-[13px] ${C.t1} font-medium`}>{n.title}</p>
                {n.body && <p className={`text-[12px] ${C.t2} mt-0.5`}>{n.body}</p>}
                <p className={`text-[10px] ${C.t3} mt-1`}>{fmtRel(n.createdAt)}</p>
              </div>
              {!n.isRead && (
                <button onClick={() => markRead(n.id)}
                  className="text-[11px] text-[#008CFF] font-semibold hover:underline shrink-0">
                  Mark read
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
