"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import SelectField from "@/components/ui/SelectField";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { isAdmin as isAdminUser } from "@/lib/access";
import { useUrlTab } from "@/lib/hooks/useUrlTab";

const TOP_TABS = [
  { key: "home",       label: "HOME",       href: "/dashboard/hr/home"  },
  { key: "attendance", label: "ATTENDANCE", href: "/dashboard/hr/attendance" },
  { key: "leave",      label: "LEAVE",      href: "/dashboard/hr/leaves"     },
  { key: "performance",label: "PERFORMANCE",href: "/dashboard/hr/goals"      },
  { key: "apps",       label: "APPS",       href: "/dashboard/hr/apps"       },
];

const priorityColors: Record<string, string> = {
  urgent: "text-red-400", high: "text-orange-400", medium: "text-amber-400", low: "text-slate-500 dark:text-slate-400",
};
const statusColors: Record<string, string> = {
  open: "bg-[#008CFF]/10 text-[#008CFF]", in_progress: "bg-amber-500/10 text-amber-400",
  resolved: "bg-emerald-500/10 text-emerald-400", closed: "bg-slate-500/10 text-slate-500 dark:text-slate-400",
};

export default function TicketsPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const isAdmin = isAdminUser(user);
  const [subTab, setSubTab] = useUrlTab<"my" | "following">("view", "my", ["my", "following"] as const);
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState("");
  const [timeFilter] = useState("Last 3 months");

  const { data: tickets = [] } = useSWR(`/api/hr/tickets?view=${subTab === "my" ? "my" : "all"}`, fetcher);

  const openTickets = tickets.filter((t: any) => ["open", "in_progress"].includes(t.status));
  const closedTickets = tickets.filter((t: any) => ["resolved", "closed"].includes(t.status));

  const filteredOpen = search ? openTickets.filter((t: any) => t.subject.toLowerCase().includes(search.toLowerCase())) : openTickets;
  const filteredClosed = search ? closedTickets.filter((t: any) => t.subject.toLowerCase().includes(search.toLowerCase())) : closedTickets;

  return (
    <div className="space-y-0">
      {/* ── Top Module Tabs ── */}
      <div className="flex items-center gap-0 bg-[#f4f7f8] dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6">
        {TOP_TABS.map((t) => (
          <Link key={t.key} href={t.href}
            className={`px-5 py-3 text-[12px] font-semibold tracking-wider transition-colors border-b-2 ${
              t.key === "helpdesk" ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white"
            }`}>
            {t.label}
          </Link>
        ))}
      </div>

      {/* ── TICKETS header ── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 dark:border-white/[0.06]">
        <h2 className="text-[14px] font-semibold text-slate-800 dark:text-white tracking-wide">TICKETS</h2>
      </div>

      {/* ── Sub-tabs: My Tickets / Following ── */}
      <div className="flex items-center justify-between px-6 border-b border-slate-200 dark:border-white/[0.06]">
        <div className="flex gap-0">
          {(["my", "following"] as const).map((tab) => (
            <button key={tab} onClick={() => setSubTab(tab)}
              className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                subTab === tab ? "border-[#008CFF] text-slate-800 dark:text-white" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-white"
              }`}>
              {tab === "my" ? "My Tickets" : "Following"}
            </button>
          ))}
        </div>
        <button onClick={() => setShowNew(true)}
          className="h-8 px-4 bg-[#008CFF] hover:bg-[#0077dd] text-slate-800 dark:text-white rounded text-[12px] font-semibold transition-colors">
          + New Ticket
        </button>
      </div>

      <div className="px-6 py-5 space-y-8">
        {/* ── Open Tickets ── */}
        <div>
          <h3 className="text-[15px] font-semibold text-slate-800 dark:text-white mb-1">Open Tickets</h3>
          <p className="text-[12px] text-slate-500 mb-4">These are your tickets that are yet to be addressed.</p>

          {/* Search + Filter */}
          <div className="flex items-center justify-end gap-3 mb-3">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search"
                className="h-8 pl-9 pr-3 w-[200px] bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-800 dark:text-white placeholder-slate-600 focus:outline-none focus:border-[#008CFF]/40" />
            </div>
            <SelectField
              value={timeFilter}
              onChange={() => { /* unwired filter — kept for visual parity */ }}
              options={[timeFilter, "Last 6 months", "All time"]}
              className="h-8 w-[140px] px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-500 dark:text-slate-400"
            />
          </div>

          {/* Table */}
          <div className="bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/[0.06]">
                  {["TICKET NUMBER", "TITLE", "RAISED ON", "PRIORITY", "CATEGORY", "ASSIGNED TO", "TICKET STATUS", "LAST UPDATED"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-[#008CFF] font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredOpen.length > 0 ? filteredOpen.map((t: any, i: number) => (
                  <tr key={t.id} className={`border-b border-slate-100 dark:border-white/[0.03] hover:bg-slate-50 dark:bg-white/[0.02] ${i % 2 === 0 ? "" : "bg-slate-50 dark:bg-white/[0.01]"}`}>
                    <td className="px-4 py-3 text-[12px] text-slate-500 dark:text-slate-400">#{String(t.id).padStart(4, "0")}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-800 dark:text-white font-medium max-w-[250px] truncate">{t.subject}</td>
                    <td className="px-4 py-3 text-[12px] text-slate-500 dark:text-slate-400">{new Date(t.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td className="px-4 py-3"><span className={`text-[12px] font-medium capitalize ${priorityColors[t.priority] || "text-slate-500 dark:text-slate-400"}`}>{t.priority}</span></td>
                    <td className="px-4 py-3 text-[12px] text-slate-500 dark:text-slate-400 capitalize">{t.category}</td>
                    <td className="px-4 py-3 text-[12px] text-slate-500 dark:text-slate-400">{t.assignedTo?.name || "Unassigned"}</td>
                    <td className="px-4 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[t.status] || "bg-slate-500/10 text-slate-500 dark:text-slate-400"}`}>{t.status.replace("_", " ")}</span></td>
                    <td className="px-4 py-3 text-[12px] text-slate-500">{new Date(t.updatedAt || t.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-[13px] text-slate-500">No records found</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end mt-2">
            <span className="text-[11px] text-slate-600">{filteredOpen.length} to {filteredOpen.length} of {filteredOpen.length}</span>
          </div>
        </div>

        {/* ── Closed Tickets ── */}
        <div>
          <h3 className="text-[15px] font-semibold text-slate-800 dark:text-white mb-1">Closed Tickets</h3>
          <p className="text-[12px] text-slate-500 mb-4">These are your tickets that have been addressed.</p>

          <div className="flex items-center justify-end gap-3 mb-3">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input placeholder="Search" className="h-8 pl-9 pr-3 w-[200px] bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-800 dark:text-white placeholder-slate-600 focus:outline-none focus:border-[#008CFF]/40" />
            </div>
            <SelectField
              value="Last 3 months"
              onChange={() => { /* unwired filter — kept for visual parity */ }}
              options={["Last 3 months"]}
              className="h-8 w-[140px] px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-500 dark:text-slate-400"
            />
          </div>

          <div className="bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/[0.06]">
                  {["TICKET NUMBER", "TITLE", "RAISED ON", "PRIORITY", "CATEGORY", "CLOSED BY"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-[#008CFF] font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredClosed.length > 0 ? filteredClosed.map((t: any, i: number) => (
                  <tr key={t.id} className={`border-b border-slate-100 dark:border-white/[0.03] hover:bg-slate-50 dark:bg-white/[0.02] ${i % 2 === 0 ? "" : "bg-slate-50 dark:bg-white/[0.01]"}`}>
                    <td className="px-4 py-3 text-[12px] text-slate-500 dark:text-slate-400">#{String(t.id).padStart(4, "0")}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-800 dark:text-white font-medium max-w-[300px] truncate">{t.subject}</td>
                    <td className="px-4 py-3 text-[12px] text-slate-500 dark:text-slate-400">{new Date(t.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td className="px-4 py-3"><span className={`text-[12px] font-medium capitalize ${priorityColors[t.priority] || "text-slate-500 dark:text-slate-400"}`}>{t.priority}</span></td>
                    <td className="px-4 py-3 text-[12px] text-slate-500 dark:text-slate-400 capitalize">{t.category}</td>
                    <td className="px-4 py-3 text-[12px] text-slate-500 dark:text-slate-400">{t.assignedTo?.name || "—"}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-[13px] text-slate-500">No records found</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end mt-2">
            <span className="text-[11px] text-slate-600">{filteredClosed.length} to {filteredClosed.length} of {filteredClosed.length}</span>
          </div>
        </div>
      </div>

      {/* ── New Ticket Slide Panel ── */}
      {showNew && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowNew(false)} />
          <NewTicketPanel onClose={() => setShowNew(false)} />
        </>
      )}
    </div>
  );
}

function NewTicketPanel({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ subject: "", description: "", category: "general", priority: "medium" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!form.subject || !form.description) return setError("Subject and description are required");
    setSaving(true);
    const res = await fetch("/api/hr/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSaving(false); return; }
    mutate((key: string) => typeof key === "string" && key.includes("/api/hr/tickets"));
    onClose();
  };

  return (
    <div className="fixed top-0 right-0 bottom-0 w-[420px] bg-[#f4f7f8] dark:bg-[#001529] border-l border-slate-200 dark:border-white/[0.08] shadow-2xl z-50 flex flex-col animate-slide-in">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
        <h2 className="text-[16px] font-semibold text-slate-800 dark:text-white">New Ticket</h2>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-800 dark:text-white text-xl">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {error && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}

        <div>
          <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Subject</label>
          <input value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))} placeholder="Brief description of the issue"
            className="w-full h-10 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white placeholder-slate-600 focus:outline-none focus:border-[#008CFF]/40" />
        </div>

        <div>
          <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Category</label>
          <SelectField
            value={form.category}
            onChange={(v) => setForm((p) => ({ ...p, category: v }))}
            options={["general", "it_support", "hr", "finance", "facilities", "other"].map((c) => ({ value: c, label: c.replace("_", " ") }))}
            className="w-full h-10 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white"
          />
        </div>

        <div>
          <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Priority</label>
          <SelectField
            value={form.priority}
            onChange={(v) => setForm((p) => ({ ...p, priority: v }))}
            options={["low", "medium", "high", "urgent"]}
            className="w-full h-10 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white"
          />
        </div>

        <div>
          <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Description</label>
          <textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Detailed description of the issue"
            rows={5} className="w-full px-3 py-2.5 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white placeholder-slate-600 focus:outline-none focus:border-[#008CFF]/40 resize-none" />
        </div>
      </div>

      <div className="px-6 py-4 border-t border-slate-200 dark:border-white/[0.06] flex justify-end gap-3">
        <button onClick={onClose} className="h-9 px-5 text-[13px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white rounded-lg hover:bg-slate-100 dark:bg-white/5">Cancel</button>
        <button onClick={submit} disabled={saving} className="h-9 px-5 bg-[#008CFF] hover:bg-[#0077dd] disabled:opacity-40 text-slate-800 dark:text-white rounded-lg text-[13px] font-semibold">
          {saving ? "Creating..." : "Create Ticket"}
        </button>
      </div>
    </div>
  );
}
