"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import SelectField from "@/components/ui/SelectField";
import { canApplyRestrictedLeave } from "@/lib/access";
import { DateField } from "@/components/ui/date-field";
import HandoffSection from "@/components/hr/HandoffSection";
import { type PickerUser } from "@/components/hr/EmployeePicker";
import LeaveSummary from "@/components/hr/leave/LeaveSummary";
import LeaveRequestForm from "@/components/LeaveRequestForm";

const TOP_TABS = [
  { key: "home",        label: "HOME",              href: "/dashboard/hr/home"  },
  { key: "attendance",  label: "ATTENDANCE",        href: "/dashboard/hr/attendance" },
  { key: "leave",       label: "LEAVE",             href: "/dashboard/hr/leaves"     },
  { key: "performance", label: "PERFORMANCE",       href: "/dashboard/hr/goals"      },
  { key: "apps",        label: "APPS",              href: "/dashboard/hr/apps"       },
];

// Personal leave summary. The whole rich body (pending, stats, balances,
// history) lives in the shared <LeaveSummary>, reused by the employee-profile
// Leave view so the two never drift. Team approvals live on the dedicated
// Approvals / My Team pages.
export default function LeavesPage() {
  const { data: session } = useSession();
  const me = session?.user as any;
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(nowYear);
  const years = [nowYear, nowYear - 1, nowYear - 2];
  const [showApply, setShowApply] = useState(false);
  const [showCompOff, setShowCompOff] = useState(false);

  const { data: balances = [] } = useSWR(`/api/hr/leaves/balance?year=${year}`, fetcher);
  const { data: applications = [] } = useSWR(`/api/hr/leaves?view=my`, fetcher);
  const { data: leaveTypes = [] } = useSWR("/api/hr/leaves/types", fetcher);

  // Apply-form dropdown: drop balance-only (applicable=false) types and
  // restricted-admin (adminOnly) types for non-CEO/HR-Manager/dev. Server
  // enforces the same gate.
  const applyable = (Array.isArray(leaveTypes) ? leaveTypes : [])
    .filter((lt: any) => lt.applicable !== false)
    .filter((lt: any) => lt.adminOnly !== true || canApplyRestrictedLeave(me))
    .map((lt: any) => ({ id: lt.id, name: lt.name }));

  const refreshLeaves = () => mutate((k: string) => typeof k === "string" && k.includes("/api/hr/leaves"));

  const handleCancel = async (id: number) => {
    const res = await fetch(`/api/hr/leaves/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }),
    });
    if (!res.ok) { const d = await res.json(); return alert(d.error); }
    refreshLeaves();
  };

  return (
    <div className="space-y-0 relative">
      {/* ── Top Module Tabs (Keka exact) ── */}
      <div className="flex items-center gap-0 bg-[#f4f7f8] dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6">
        {TOP_TABS.map((t) => (
          <Link key={t.key} href={t.href}
            className={`px-5 py-3 text-[12px] font-semibold tracking-wider transition-colors border-b-2 ${
              t.key === "leave" ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white"
            }`}>
            {t.label}
          </Link>
        ))}
      </div>

      {/* ── Sub-tab: Summary ── */}
      <div className="flex items-center px-6 border-b border-slate-200 dark:border-white/[0.06] bg-[#f4f7f8] dark:bg-[#001529]">
        <button className="px-4 py-2.5 text-[13px] font-medium border-b-2 border-[#008CFF] text-slate-800 dark:text-white">Summary</button>
      </div>

      <div className="px-6 py-6 bg-[#f4f7f8] dark:bg-[#001529] min-h-[calc(100vh-110px)]">
        <LeaveSummary
          balances={balances as any[]}
          applications={applications as any[]}
          year={year}
          years={years}
          onYearChange={setYear}
          onRequestLeave={() => setShowApply(true)}
          onCompOff={() => setShowCompOff(true)}
          compOffHistoryHref="/dashboard/hr/leaves/comp-off-history"
          policyHref="/dashboard/hr/admin"
          onCancel={handleCancel}
        />
      </div>

      {showApply && (
        <LeaveRequestForm
          kind="leave"
          title="Request Leave"
          leaveTypes={applyable}
          onClose={() => setShowApply(false)}
          onSaved={refreshLeaves}
        />
      )}
      {showCompOff && <CompOffModal onClose={() => setShowCompOff(false)} />}
    </div>
  );
}

function CompOffModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ workedDate: "", creditDays: "1", reason: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  // Handoff fields — POC + Work Status apply across every leave-style request
  // per the company-standard format. POC supports an N/A toggle.
  const [poc, setPoc] = useState<PickerUser[]>([]);
  const [pocNa, setPocNa] = useState(false);
  const [workStatus, setWorkStatus] = useState("");

  const submit = async () => {
    setErr("");
    if (!form.workedDate || !form.reason) return setErr("All fields required");
    if (!pocNa && poc.length === 0) return setErr("POC in Absence is required (or mark as N/A).");
    if (!workStatus.trim()) return setErr("Work Status is required.");
    setSaving(true);
    const res = await fetch("/api/hr/leaves/comp-off", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, pocUserId: pocNa ? null : (poc[0]?.id ?? null), workStatus: workStatus.trim() }),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data.error || "Failed"); setSaving(false); return; }
    mutate((k: string) => typeof k === "string" && k.includes("/api/hr/leaves/comp-off"));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-[#f4f7f8] dark:bg-[#001529] border border-slate-200 dark:border-white/[0.08] rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
          <h2 className="text-[16px] font-semibold text-slate-800 dark:text-white">Request Compensatory Off</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800 dark:text-white text-xl">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {err && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{err}</p>}
          <div>
            <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Date You Worked Extra *</label>
            <DateField value={form.workedDate} onChange={(v) => set("workedDate", v)} className="w-full" />
          </div>
          <div>
            <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Credit Days</label>
            <SelectField
              value={form.creditDays}
              onChange={(v) => set("creditDays", v)}
              options={[
                { value: "0.5", label: "Half Day (0.5)" },
                { value: "1", label: "Full Day (1.0)" },
              ]}
              className="w-full h-10 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Reason <span className="text-rose-500">*</span></label>
            <textarea value={form.reason} onChange={(e) => set("reason", e.target.value)} rows={3}
              placeholder="Describe the extra work done..."
              className="w-full px-3 py-2.5 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none resize-none" />
          </div>
          <HandoffSection
            poc={poc}
            onPocChange={setPoc}
            workStatus={workStatus}
            onWorkStatusChange={setWorkStatus}
            allowNa
            naSelected={pocNa}
            onNaChange={setPocNa}
          />
          <p className="text-[11px] text-slate-400">Credits are valid for 3 months from worked date.</p>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 dark:border-white/[0.06] flex justify-end gap-3">
          <button onClick={onClose} className="h-9 px-5 text-[13px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white rounded-lg">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="h-9 px-5 bg-[#008CFF] hover:bg-[#0077dd] disabled:opacity-40 text-white rounded-lg text-[13px] font-semibold">
            {saving ? "Submitting..." : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
}
