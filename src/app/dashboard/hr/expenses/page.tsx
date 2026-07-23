"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import SelectField from "@/components/ui/SelectField";
import { Receipt, Plus, Plane, Utensils, Monitor, Phone, Car, Package, X, CheckCircle2, XCircle, Clock, IndianRupee } from "lucide-react";
import { isHRAdmin } from "@/lib/access";
import { DateField } from "@/components/ui/date-field";
import { useUrlTab } from "@/lib/hooks/useUrlTab";

const TOP_TABS = [
  { key: "home",        label: "HOME",              href: "/dashboard/hr/home"  },
  { key: "attendance",  label: "ATTENDANCE",        href: "/dashboard/hr/attendance" },
  { key: "leave",       label: "LEAVE",             href: "/dashboard/hr/leaves"     },
  { key: "performance", label: "PERFORMANCE",       href: "/dashboard/hr/goals"      },
  { key: "apps",        label: "APPS",              href: "/dashboard/hr/apps"       },
];

const CATEGORIES = [
  { value: "travel",         label: "Travel",         Icon: Plane    },
  { value: "food",           label: "Food & Meals",   Icon: Utensils },
  { value: "accommodation",  label: "Accommodation",  Icon: Package  },
  { value: "equipment",      label: "Equipment",      Icon: Monitor  },
  { value: "communication",  label: "Communication",  Icon: Phone    },
  { value: "other",          label: "Other",          Icon: Car      },
];

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  pending:  { label: "Pending",  color: "text-amber-600 dark:text-amber-400",   bg: "bg-amber-50 dark:bg-amber-500/10",   icon: Clock         },
  approved: { label: "Approved", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-500/10", icon: CheckCircle2 },
  rejected: { label: "Rejected", color: "text-red-500 dark:text-red-400",       bg: "bg-red-50 dark:bg-red-500/10",       icon: XCircle       },
  paid:     { label: "Paid",     color: "text-[#008CFF]",                        bg: "bg-[#008CFF]/10",                    icon: IndianRupee   },
};

function NewExpenseModal({ onClose, onSave }: { onClose: () => void; onSave: (d: any) => void }) {
  const [form, setForm] = useState({ title: "", category: "travel", amount: "", expenseDate: new Date().toISOString().slice(0, 10), description: "" });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.08] rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
          <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">Add Expense Claim</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Title *</label>
            <input value={form.title} onChange={e => set("title", e.target.value)}
              className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]"
              placeholder="e.g. Client meeting travel" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Category</label>
              <SelectField
                value={form.category}
                onChange={(v) => set("category", v)}
                options={CATEGORIES}
                className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Date *</label>
              <DateField value={form.expenseDate} onChange={(v) => set("expenseDate", v)} className="mt-1 w-full" />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Amount (₹) *</label>
            <input type="number" value={form.amount} onChange={e => set("amount", e.target.value)}
              className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]"
              placeholder="0.00" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Description</label>
            <textarea value={form.description} onChange={e => set("description", e.target.value)} rows={2}
              className="mt-1 w-full px-3 py-2 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none resize-none"
              placeholder="Add details..." />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-white/[0.06]">
          <button onClick={onClose} className="h-8 px-4 text-[13px] font-medium text-slate-500">Cancel</button>
          <button onClick={() => onSave(form)} disabled={!form.title || !form.amount}
            className="h-8 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold disabled:opacity-50 transition-colors">
            Submit Claim
          </button>
        </div>
      </div>
    </div>
  );
}

function NewTravelModal({ onClose, onSave }: { onClose: () => void; onSave: (d: any) => void }) {
  const [form, setForm] = useState({ purpose: "", fromLocation: "", toLocation: "", travelDate: new Date().toISOString().slice(0,10), returnDate: "", estimatedCost: "", advanceNeeded: false, advanceAmount: "" });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.08] rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
          <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">New Travel Request</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white"><X size={18}/></button>
        </div>
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Purpose *</label>
            <input value={form.purpose} onChange={e => set("purpose", e.target.value)}
              className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]"
              placeholder="e.g. Client meeting" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">From *</label>
              <input value={form.fromLocation} onChange={e => set("fromLocation", e.target.value)}
                className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none"
                placeholder="Delhi" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">To *</label>
              <input value={form.toLocation} onChange={e => set("toLocation", e.target.value)}
                className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none"
                placeholder="Mumbai" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Travel Date *</label>
              <DateField value={form.travelDate} onChange={(v) => set("travelDate", v)} className="mt-1 w-full" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Return Date</label>
              <DateField value={form.returnDate} onChange={(v) => set("returnDate", v)} className="mt-1 w-full" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Est. Cost (₹)</label>
              <input type="number" value={form.estimatedCost} onChange={e => set("estimatedCost", e.target.value)}
                className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none"
                placeholder="0" />
            </div>
            <div className="flex items-end pb-1 gap-2">
              <input type="checkbox" id="adv" checked={form.advanceNeeded} onChange={e => set("advanceNeeded", e.target.checked)} className="w-4 h-4 accent-[#008CFF]" />
              <label htmlFor="adv" className="text-[12px] text-slate-600 dark:text-slate-300 cursor-pointer">Advance needed</label>
            </div>
          </div>
          {form.advanceNeeded && (
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Advance Amount (₹)</label>
              <input type="number" value={form.advanceAmount} onChange={e => set("advanceAmount", e.target.value)}
                className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-white/[0.06]">
          <button onClick={onClose} className="h-8 px-4 text-[13px] text-slate-500">Cancel</button>
          <button onClick={() => onSave(form)} disabled={!form.purpose || !form.fromLocation || !form.toLocation}
            className="h-8 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold disabled:opacity-50">
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ExpensesPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  // Mirrors src/lib/access.ts:isHRAdmin — was missing special_access + role=admin.
  const isAdmin = isHRAdmin(user);

  const [view, setView]       = useUrlTab<"my" | "team">("view", "my", ["my", "team"] as const);
  const [mainTab, setMainTab] = useUrlTab<"expenses" | "travel">("kind", "expenses", ["expenses", "travel"] as const);
  const [showNew, setShowNew] = useState(false);
  const [showNewTravel, setShowNewTravel] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: expenses = [] } = useSWR(`/api/hr/expenses?view=${view}`, fetcher);
  const { data: travels = [] }  = useSWR(`/api/hr/travel?view=${view}`, fetcher);

  const filtered = statusFilter === "all" ? expenses : expenses.filter((e: any) => e.status === statusFilter);

  const totalPending  = expenses.filter((e: any) => e.status === "pending").reduce((s: number, e: any) => s + Number(e.amount), 0);
  const totalApproved = expenses.filter((e: any) => e.status === "approved").reduce((s: number, e: any) => s + Number(e.amount), 0);
  const totalPaid     = expenses.filter((e: any) => e.status === "paid").reduce((s: number, e: any) => s + Number(e.amount), 0);

  const handleCreate = async (data: any) => {
    const res = await fetch("/api/hr/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!res.ok) return alert((await res.json()).error);
    setShowNew(false);
    mutate((k: string) => typeof k === "string" && k.includes("/api/hr/expenses"));
  };

  const handleAction = async (id: number, action: string, note?: string) => {
    await fetch(`/api/hr/expenses/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, approvalNote: note }) });
    mutate((k: string) => typeof k === "string" && k.includes("/api/hr/expenses"));
  };

  const handleCreateTravel = async (data: any) => {
    const res = await fetch("/api/hr/travel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!res.ok) return alert((await res.json()).error);
    setShowNewTravel(false);
    mutate((k: string) => typeof k === "string" && k.includes("/api/hr/travel"));
  };

  const handleTravelAction = async (id: number, action: string) => {
    await fetch(`/api/hr/travel/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    mutate((k: string) => typeof k === "string" && k.includes("/api/hr/travel"));
  };

  const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">

      {/* Top Module Tabs */}
      <div className="flex items-center bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-4">
        {TOP_TABS.map(t => (
          <Link key={t.key} href={t.href}
            className={`px-4 py-3 text-[11px] font-bold tracking-widest transition-colors border-b-2 whitespace-nowrap ${
              t.key === "expenses" ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            }`}>{t.label}
          </Link>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06]">
        {[
          { label: "Pending Approval", value: totalPending,  color: "text-amber-500",                    count: expenses.filter((e: any) => e.status === "pending").length },
          { label: "Approved",         value: totalApproved, color: "text-emerald-500",                  count: expenses.filter((e: any) => e.status === "approved").length },
          { label: "Paid Out",         value: totalPaid,     color: "text-[#008CFF]",                    count: expenses.filter((e: any) => e.status === "paid").length     },
        ].map((s, i) => (
          <div key={s.label} className={`p-5 ${i < 2 ? "border-r border-slate-200 dark:border-white/[0.06]" : ""}`}>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">{s.label}</p>
            <p className={`text-[22px] font-bold ${s.color}`}>{fmt(s.value)}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{s.count} claim{s.count !== 1 ? "s" : ""}</p>
          </div>
        ))}
      </div>

      {/* Main Tab Switcher */}
      <div className="px-6 pt-4 flex items-center gap-1 border-b border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]">
        {([["expenses","Expense Claims"],["travel","Travel Requests"]] as const).map(([t, label]) => (
          <button key={t} onClick={() => setMainTab(t)}
            className={`px-5 py-2.5 text-[12px] font-semibold border-b-2 transition-colors ${
              mainTab === t ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}>{label}</button>
        ))}
      </div>

      {/* Controls */}
      <div className="px-6 pt-5 pb-3 flex items-center justify-between">
        {mainTab === "expenses" ? (
          <div className="flex items-center gap-1">
            {["all","pending","approved","rejected","paid"].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`h-7 px-3 rounded-full text-[11px] font-semibold transition-colors capitalize ${
                  statusFilter === s ? "bg-[#008CFF] text-white" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
                }`}>{s === "all" ? "All" : STATUS_META[s]?.label}</button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            {["all","pending","approved","rejected"].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`h-7 px-3 rounded-full text-[11px] font-semibold transition-colors capitalize ${
                  statusFilter === s ? "bg-[#008CFF] text-white" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
                }`}>{s === "all" ? "All" : STATUS_META[s]?.label}</button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="flex border border-slate-200 dark:border-white/[0.08] rounded-lg overflow-hidden">
            {(["my","team"] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 text-[11px] font-semibold transition-colors ${view === v ? "bg-[#008CFF] text-white" : "text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5"}`}>
                {v === "my" ? "Mine" : isAdmin ? "All" : "My Team"}
              </button>
            ))}
          </div>
          {mainTab === "expenses" ? (
            <button onClick={() => setShowNew(true)}
              className="h-8 px-4 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[12px] font-semibold flex items-center gap-1.5">
              <Plus size={13} strokeWidth={2} /> Add Claim
            </button>
          ) : (
            <button onClick={() => setShowNewTravel(true)}
              className="h-8 px-4 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[12px] font-semibold flex items-center gap-1.5">
              <Plus size={13} strokeWidth={2} /> New Request
            </button>
          )}
        </div>
      </div>

      {/* Expense Claims Table */}
      {mainTab === "expenses" && (
        <div className="px-6 pb-8">
          <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/[0.06]">
                  {["DATE","TITLE","CATEGORY","AMOUNT","SUBMITTED BY","STATUS","ACTIONS"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[9px] uppercase tracking-widest text-[#008CFF] dark:text-[#00BCD4] font-bold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((exp: any) => {
                  const meta = STATUS_META[exp.status];
                  const StatusIcon = meta?.icon;
                  const cat = CATEGORIES.find(c => c.value === exp.category);
                  const CatIcon = cat?.Icon || Package;
                  return (
                    <tr key={exp.id} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50/50 dark:hover:bg-white/[0.015]">
                      <td className="px-4 py-3 text-[12px] text-slate-600 dark:text-slate-400">
                        {new Date(exp.expenseDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-white">{exp.title}</p>
                        {exp.description && <p className="text-[11px] text-slate-400 truncate max-w-[160px]">{exp.description}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 text-[12px] text-slate-600 dark:text-slate-400">
                          <CatIcon size={13} strokeWidth={1.75} />
                          {cat?.label || exp.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] font-bold text-slate-800 dark:text-white">
                        {fmt(Number(exp.amount))}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-slate-600 dark:text-slate-400">{exp.user?.name}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${meta?.bg} ${meta?.color}`}>
                          {StatusIcon && <StatusIcon size={11} strokeWidth={2} />}
                          {meta?.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {view === "team" && exp.status === "pending" && (
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => handleAction(exp.id, "approve")}
                              className="h-6 px-2.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded text-[11px] font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-500/20">
                              Approve
                            </button>
                            <button onClick={() => handleAction(exp.id, "reject")}
                              className="h-6 px-2.5 bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 rounded text-[11px] font-semibold hover:bg-red-100 dark:hover:bg-red-500/20">
                              Reject
                            </button>
                          </div>
                        )}
                        {view === "team" && exp.status === "approved" && isAdmin && (
                          <button onClick={() => handleAction(exp.id, "mark_paid")}
                            className="h-6 px-2.5 bg-[#008CFF]/10 text-[#008CFF] rounded text-[11px] font-semibold hover:bg-[#008CFF]/20">
                            Mark Paid
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="py-16 text-center">
                <Receipt size={28} strokeWidth={1.5} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                <p className="text-[13px] text-slate-400">No expense claims {statusFilter !== "all" ? `with status "${statusFilter}"` : ""}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Travel Requests Table */}
      {mainTab === "travel" && (
        <div className="px-6 pb-8">
          <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/[0.06]">
                  {["TRAVEL DATE","PURPOSE","ROUTE","EST. COST","REQUESTED BY","STATUS","ACTIONS"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[9px] uppercase tracking-widest text-[#008CFF] dark:text-[#00BCD4] font-bold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(statusFilter === "all" ? travels : travels.filter((t: any) => t.status === statusFilter)).map((tr: any) => {
                  const meta = STATUS_META[tr.status] ?? STATUS_META["pending"];
                  const StatusIcon = meta.icon;
                  return (
                    <tr key={tr.id} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50/50 dark:hover:bg-white/[0.015]">
                      <td className="px-4 py-3 text-[12px] text-slate-600 dark:text-slate-400">
                        {new Date(tr.travelDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        {tr.returnDate && <span className="block text-[10px] text-slate-400">→ {new Date(tr.returnDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-white">{tr.purpose}</p>
                        {tr.advanceNeeded && <span className="text-[10px] text-amber-500 font-semibold">Advance: {fmt(Number(tr.advanceAmount || 0))}</span>}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-slate-600 dark:text-slate-400">
                        <span className="flex items-center gap-1">
                          <span>{tr.fromLocation}</span>
                          <span className="text-slate-400">→</span>
                          <span>{tr.toLocation}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] font-bold text-slate-800 dark:text-white">
                        {tr.estimatedCost ? fmt(Number(tr.estimatedCost)) : "—"}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-slate-600 dark:text-slate-400">{tr.user?.name}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
                          <StatusIcon size={11} strokeWidth={2} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {view === "team" && tr.status === "pending" && (
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => handleTravelAction(tr.id, "approve")}
                              className="h-6 px-2.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded text-[11px] font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-500/20">
                              Approve
                            </button>
                            <button onClick={() => handleTravelAction(tr.id, "reject")}
                              className="h-6 px-2.5 bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 rounded text-[11px] font-semibold hover:bg-red-100 dark:hover:bg-red-500/20">
                              Reject
                            </button>
                          </div>
                        )}
                        {view === "team" && tr.status === "approved" && (
                          <button onClick={() => handleTravelAction(tr.id, "complete")}
                            className="h-6 px-2.5 bg-[#008CFF]/10 text-[#008CFF] rounded text-[11px] font-semibold hover:bg-[#008CFF]/20">
                            Complete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {travels.length === 0 && (
              <div className="py-16 text-center">
                <Plane size={28} strokeWidth={1.5} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                <p className="text-[13px] text-slate-400">No travel requests yet</p>
              </div>
            )}
          </div>
        </div>
      )}

      {showNew && <NewExpenseModal onClose={() => setShowNew(false)} onSave={handleCreate} />}
      {showNewTravel && <NewTravelModal onClose={() => setShowNewTravel(false)} onSave={handleCreateTravel} />}
    </div>
  );
}
