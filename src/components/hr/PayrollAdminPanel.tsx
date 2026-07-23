"use client";

// Payroll admin section of the HR Dashboard — pulled out of the
// employee-facing /dashboard/hr/payroll page because creating runs,
// generating slips, locking, marking paid, and assigning salary
// structures are admin actions that belong alongside the rest of
// the HR Dashboard tools.
//
// Lives under the "Payroll" tab in /dashboard/hr/admin. Read access is
// gated by the HR Dashboard's `hr_admin_payroll` tab permission.

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/swr";
import { isSalaryDeveloper } from "@/lib/access";
import { useUrlTab } from "@/lib/hooks/useUrlTab";
import SelectField from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/date-field";
import {
  Play, CheckCircle2, Clock, Plus, X, Search,
  Lock as LockIcon, Banknote, RotateCcw, AlertCircle,
} from "lucide-react";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtInrWhole(n: any) {
  const v = parseFloat(n || 0);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v);
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft:        "bg-amber-50 text-amber-600",
    processing:   "bg-violet-50 text-violet-600",
    generated:    "bg-blue-50 text-[#008CFF]",
    locked:       "bg-indigo-50 text-indigo-600",
    paid:         "bg-green-50 text-green-600",
    completed:    "bg-blue-50 text-[#008CFF]",
    sent:         "bg-emerald-50 text-emerald-600",
    acknowledged: "bg-slate-100 text-slate-600",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${map[status] || "bg-slate-100 text-slate-500"}`}>
      {status}
    </span>
  );
}

export default function PayrollAdminPanel() {
  const { data: session } = useSession();
  // Unlocking a locked run is restricted to the salary-trusted developer
  // (gagan) — the transition API enforces the same, so hide the button for
  // everyone else rather than show one that 403s.
  const canUnlock = isSalaryDeveloper((session?.user ?? null) as any);
  const [adminTab, setAdminTab] = useUrlTab<"runs" | "structures">("payroll", "runs", ["runs", "structures"] as const);
  const [showNewRun, setShowNewRun] = useState(false);
  const [showNewStructure, setShowNewStructure] = useState(false);
  const [generating, setGenerating] = useState<number | null>(null);
  const [form, setForm] = useState({ month: new Date().getMonth(), year: new Date().getFullYear() });
  const [structureForm, setStructureForm] = useState({
    userId: "", ctc: "", basic: "", hra: "", specialAllowance: "",
    pfEmployee: "", pfEmployer: "", tds: "", professionalTax: "", effectiveFrom: "",
  });

  const { data: payrollRuns = [] } = useSWR("/api/hr/payroll/runs", fetcher);
  const { data: employees = [] }   = useSWR("/api/hr/employees", fetcher);

  const createRun = async () => {
    const res = await fetch("/api/hr/payroll/runs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) { setShowNewRun(false); mutate("/api/hr/payroll/runs"); }
    else alert((await res.json()).error);
  };

  const generatePayslips = async (runId: number) => {
    setGenerating(runId);
    const res = await fetch("/api/hr/payroll/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    });
    setGenerating(null);
    if (res.ok) mutate("/api/hr/payroll/runs");
    else alert((await res.json()).error);
  };

  // lock / mark_paid / reopen all share the same transition endpoint —
  // server enforces the source-status guard so a stale tab can't race a
  // run from "paid" back to "draft".
  const transitionRun = async (runId: number, action: "lock" | "mark_paid" | "reopen") => {
    const confirmMsg =
      action === "mark_paid" ? "Mark all payslips for this run as paid? Employees will be able to see their payslips after this." :
      action === "reopen"    ? "Re-open this run? It will move back so payslips can be edited or regenerated."
                             : null;
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    const res = await fetch(`/api/hr/payroll/runs/${runId}/transition`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) mutate("/api/hr/payroll/runs");
    else alert((await res.json()).error || "Transition failed");
  };

  const saveStructure = async () => {
    const res = await fetch("/api/hr/payroll/salary-structure", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(structureForm),
    });
    if (res.ok) { setShowNewStructure(false); mutate("/api/hr/payroll/salary-structure"); }
    else alert((await res.json()).error);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-4">
          <h3 className="text-[13px] font-bold text-slate-800">Payroll Management</h3>
          <div className="flex items-center gap-0 bg-slate-100 rounded-lg p-0.5">
            {(["runs", "structures"] as const).map(t => (
              <button key={t} onClick={() => setAdminTab(t)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                  adminTab === t ? "bg-white text-[#008CFF] shadow-sm" : "text-slate-500"
                }`}>
                {t === "runs" ? "Payroll Runs" : "Salary Structures"}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => adminTab === "runs" ? setShowNewRun(true) : setShowNewStructure(true)}
          className="flex items-center gap-1.5 h-8 px-4 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[12px] font-semibold transition-colors">
          <Plus className="w-3.5 h-3.5" />
          {adminTab === "runs" ? "New Payroll Run" : "Assign Structure"}
        </button>
      </div>

      {adminTab === "runs" ? (
        payrollRuns.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[13px] text-slate-500">No payroll runs yet</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                {["Period","Status","Employees","Total CTC","Total Net Pay","Actions"].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payrollRuns.map((r: any) => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-5 py-3 text-[13px] font-medium text-slate-800">{MONTHS[r.month]} {r.year}</td>
                  <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-5 py-3 text-[13px] text-slate-600">{r._count?.payslips ?? 0}</td>
                  <td className="px-5 py-3 text-[13px] text-slate-700">₹{fmtInrWhole(r.totalCTC)}</td>
                  <td className="px-5 py-3 text-[13px] font-bold text-emerald-600">₹{fmtInrWhole(r.totalNetPay)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {(r.status === "draft" || r.status === "processing") && (
                        <button onClick={() => generatePayslips(r.id)}
                          disabled={generating === r.id}
                          className="flex items-center gap-1 h-7 px-3 bg-[#008CFF]/10 hover:bg-[#008CFF]/20 text-[#008CFF] rounded text-[11px] font-semibold transition-colors disabled:opacity-50">
                          {generating === r.id
                            ? <><Clock className="w-3 h-3 animate-spin" />Processing…</>
                            : <><Play className="w-3 h-3" />Generate</>}
                        </button>
                      )}
                      {r.status === "generated" && (
                        <>
                          <button onClick={() => generatePayslips(r.id)}
                            disabled={generating === r.id}
                            className="flex items-center gap-1 h-7 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-semibold transition-colors disabled:opacity-50">
                            <Play className="w-3 h-3" />Regenerate
                          </button>
                          <button onClick={() => transitionRun(r.id, "lock")}
                            className="flex items-center gap-1 h-7 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-[11px] font-semibold transition-colors">
                            <LockIcon className="w-3 h-3" />Lock
                          </button>
                          <button onClick={() => transitionRun(r.id, "reopen")}
                            title="Move back to draft to fix structures or attendance"
                            className="flex items-center gap-1 h-7 px-2 text-slate-500 hover:text-slate-700 rounded text-[11px] font-semibold transition-colors">
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        </>
                      )}
                      {r.status === "locked" && (
                        <>
                          <button onClick={() => transitionRun(r.id, "mark_paid")}
                            className="flex items-center gap-1 h-7 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded text-[11px] font-semibold transition-colors">
                            <Banknote className="w-3 h-3" />Mark Paid
                          </button>
                          {canUnlock && (
                            <button onClick={() => transitionRun(r.id, "reopen")}
                              title="Unlock — return to generated state to fix payslips before paying"
                              className="flex items-center gap-1 h-7 px-2 text-slate-500 hover:text-slate-700 rounded text-[11px] font-semibold transition-colors">
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          )}
                        </>
                      )}
                      {(r.status === "paid" || r.status === "completed") && (
                        <span className="flex items-center gap-1 text-[12px] text-emerald-500">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {r.status === "paid" ? "Paid" : "Done"}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        <SalaryStructuresListInline />
      )}

      {/* Modal: New Payroll Run */}
      {showNewRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-[360px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-bold text-slate-800">New Payroll Run</h3>
              <button onClick={() => setShowNewRun(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Month</label>
                <SelectField
                  value={String(form.month)}
                  onChange={(v) => setForm(f => ({ ...f, month: parseInt(v) }))}
                  options={MONTHS.map((m, i) => ({ value: String(i), label: m }))}
                  className="mt-1 h-9 w-full px-3 rounded-lg border border-slate-200 bg-white text-slate-800 text-[13px]"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Year</label>
                <input type="number" value={form.year}
                  onChange={e => setForm(f => ({ ...f, year: parseInt(e.target.value) }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 text-[13px]" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowNewRun(false)}
                className="flex-1 h-9 border border-slate-200 rounded-lg text-[13px] text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={createRun}
                className="flex-1 h-9 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[13px] font-semibold transition-colors">
                Create Run
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Assign Salary Structure */}
      {showNewStructure && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-[480px] max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-bold text-slate-800">Assign Salary Structure</h3>
              <button onClick={() => setShowNewStructure(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Employee</label>
                <SelectField
                  value={String(structureForm.userId ?? "")}
                  onChange={(v) => setStructureForm(f => ({ ...f, userId: v }))}
                  placeholder="Select employee…"
                  options={employees.map((e: any) => ({ value: String(e.id), label: e.name }))}
                  className="mt-1 h-9 w-full px-3 rounded-lg border border-slate-200 bg-white text-slate-800 text-[13px]"
                />
              </div>
              {[
                { field: "ctc",              label: "Annual CTC (₹)"         },
                { field: "basic",            label: "Annual Basic (₹)"       },
                { field: "hra",              label: "Annual HRA (₹)"         },
                { field: "specialAllowance", label: "Special Allowance (₹)"  },
                { field: "pfEmployee",       label: "PF Employee Annual (₹)" },
                { field: "pfEmployer",       label: "PF Employer Annual (₹)" },
                { field: "tds",              label: "Annual TDS (₹)"         },
                { field: "professionalTax",  label: "Professional Tax/mo (₹)"},
              ].map(({ field, label }) => (
                <div key={field}>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{label}</label>
                  <input type="number" value={(structureForm as any)[field]}
                    onChange={e => setStructureForm(f => ({ ...f, [field]: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 text-[13px]" />
                </div>
              ))}
              <div className="col-span-2">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Effective From</label>
                <DateField value={structureForm.effectiveFrom}
                  onChange={(v) => setStructureForm(f => ({ ...f, effectiveFrom: v }))}
                  className="mt-1 w-full" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowNewStructure(false)}
                className="flex-1 h-9 border border-slate-200 rounded-lg text-[13px] text-slate-600">
                Cancel
              </button>
              <button onClick={saveStructure}
                className="flex-1 h-9 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[13px] font-semibold">
                Save Structure
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Salary Structures — full org table. One row per active employee with their
// assigned salary. Employees without a structure render as a "Not assigned"
// row so HR can spot gaps. Click a row to jump to that user's Finances tab
// where the structure can be edited.
// ──────────────────────────────────────────────────────────────────────────────
type StructureRow = {
  userId: number;
  name: string;
  email: string;
  employeeId: string | null;
  department: string | null;
  designation: string | null;
  hasStructure: boolean;
  salaryType: string | null;
  annualCtc: number;
  monthlyGross: number;
  effectiveFrom: string | null;
};

function SalaryStructuresListInline() {
  const { data, isLoading } = useSWR<{ items: StructureRow[] }>("/api/hr/payroll/salary-structures", fetcher);
  const rows = data?.items ?? [];

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "assigned" | "missing">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (filter === "assigned" && !r.hasStructure) return false;
      if (filter === "missing"  &&  r.hasStructure) return false;
      if (!q) return true;
      return (
        r.name?.toLowerCase().includes(q) ||
        r.email?.toLowerCase().includes(q) ||
        r.employeeId?.toLowerCase().includes(q) ||
        r.department?.toLowerCase().includes(q)
      );
    });
  }, [rows, query, filter]);

  const totalAnnual  = filtered.reduce((s, r) => s + r.annualCtc, 0);
  const totalMonthly = totalAnnual / 12;
  const missingCount = rows.filter(r => !r.hasStructure).length;

  return (
    <div>
      {/* Search + filter strip */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 bg-slate-50/60">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, employee ID, department…"
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12.5px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/30" />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0 bg-slate-100 rounded-lg p-0.5">
            {([
              ["all",      "All"      ],
              ["assigned", "Assigned" ],
              ["missing",  "Missing"  ],
            ] as const).map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)}
                className={`px-3 py-1 rounded-md text-[11px] font-bold transition-colors ${
                  filter === key ? "bg-white text-[#008CFF] shadow-sm" : "text-slate-500"
                }`}>
                {label}
                {key === "missing" && missingCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-amber-100 text-amber-700 text-[9.5px] tabular-nums">
                    {missingCount}
                  </span>
                )}
              </button>
            ))}
          </div>
          <span className="text-[11.5px] text-slate-500 tabular-nums">
            {filtered.length} {filtered.length === 1 ? "employee" : "employees"}
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="px-5 py-10 text-center text-[13px] text-slate-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="px-5 py-10 text-center text-[13px] text-slate-500">No employees match your filter.</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              {["Employee", "Department", "Type", "Annual CTC", "Monthly Gross", "Effective From", "Status"].map(h => (
                <th key={h} className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.userId} className="border-b border-slate-50 hover:bg-slate-50/60">
                <td className="px-5 py-3">
                  <Link href={`/dashboard/hr/people/${r.userId}?tab=Finances`}
                    className="block hover:text-[#008CFF]">
                    <p className="text-[13px] font-semibold text-slate-800">{r.name}</p>
                    <p className="text-[11.5px] text-slate-500">
                      {r.employeeId || r.email}
                    </p>
                  </Link>
                </td>
                <td className="px-5 py-3 text-[12.5px] text-slate-600">
                  {r.department || "—"}
                  {r.designation && <span className="block text-[11px] text-slate-400">{r.designation}</span>}
                </td>
                <td className="px-5 py-3 text-[12.5px] text-slate-600 capitalize">
                  {r.salaryType || "—"}
                </td>
                <td className="px-5 py-3 text-[13px] text-slate-700 tabular-nums">
                  {r.hasStructure ? `₹${fmtInrWhole(r.annualCtc)}` : "—"}
                </td>
                <td className="px-5 py-3 text-[13px] font-semibold text-emerald-700 tabular-nums">
                  {r.hasStructure ? `₹${fmtInrWhole(r.monthlyGross)}` : "—"}
                </td>
                <td className="px-5 py-3 text-[12.5px] text-slate-600">
                  {r.effectiveFrom
                    ? new Date(r.effectiveFrom).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
                    : "—"}
                </td>
                <td className="px-5 py-3">
                  {r.hasStructure ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10.5px] font-bold uppercase tracking-wider">
                      <CheckCircle2 className="w-3 h-3" />
                      Assigned
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10.5px] font-bold uppercase tracking-wider">
                      <AlertCircle className="w-3 h-3" />
                      Not assigned
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200">
              <td colSpan={3} className="px-5 py-3 text-[11.5px] font-bold uppercase tracking-wider text-slate-500">
                Totals ({filtered.length} {filtered.length === 1 ? "employee" : "employees"})
              </td>
              <td className="px-5 py-3 text-[13px] font-bold text-slate-800 tabular-nums">₹{fmtInrWhole(totalAnnual)}</td>
              <td className="px-5 py-3 text-[13px] font-bold text-emerald-700 tabular-nums">₹{fmtInrWhole(totalMonthly)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
