"use client";

// All-employees salary table for the HR Dashboard → Salary Structures tab.
// Backed by /api/hr/payroll/salary-structures which joins User +
// EmployeeProfile + SalaryStructure server-side so HR can scan everyone's
// compensation in a single grid. Click an employee row to jump to their
// profile Finances tab where the structure can be edited.

import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/swr";
import { Search, CheckCircle2, AlertCircle } from "lucide-react";

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
  basic: number;
  hra: number;
  dearnessAllowance: number;
  conveyanceAllowance: number;
  medicalAllowance: number;
  specialAllowance: number;
  pfEligible: boolean;
  pfEmployee: number;
  pfEmployer: number;
  esiEmployee: number;
  esiEmployer: number;
  tds: number;
  professionalTax: number;
};

function fmtInrWhole(n: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n || 0);
}

export default function SalaryStructuresList() {
  const { data, isLoading } = useSWR<{ items: StructureRow[] }>(
    "/api/hr/payroll/salary-structures",
    fetcher,
  );
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
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
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
              {["Employee", "Department", "Type", "Annual CTC", "Monthly Gross", "Breakdown", "PF", "Effective From", "Status"].map(h => (
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
                    <p className="text-[11.5px] text-slate-500">{r.employeeId || r.email}</p>
                  </Link>
                </td>
                <td className="px-5 py-3 text-[12.5px] text-slate-600">
                  {r.department || "—"}
                  {r.designation && <span className="block text-[11px] text-slate-400">{r.designation}</span>}
                </td>
                <td className="px-5 py-3 text-[12.5px] text-slate-600 capitalize">{r.salaryType || "—"}</td>
                <td className="px-5 py-3 text-[13px] text-slate-700 tabular-nums">
                  {r.hasStructure ? `₹${fmtInrWhole(r.annualCtc)}` : "—"}
                </td>
                <td className="px-5 py-3 text-[13px] font-semibold text-emerald-700 tabular-nums">
                  {r.hasStructure ? `₹${fmtInrWhole(r.monthlyGross)}` : "—"}
                </td>
                <td className="px-5 py-3 text-[11px] text-slate-600 tabular-nums leading-snug min-w-[200px]">
                  {!r.hasStructure ? (
                    "—"
                  ) : r.salaryType === "intern" ? (
                    <div className="space-y-0.5">
                      <div className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400">Stipend</div>
                      <div className="flex justify-between gap-3">
                        <span className="text-slate-500">Basic</span>
                        <span className="font-semibold text-slate-700">₹{fmtInrWhole(r.basic)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div>
                        <div className="text-[9.5px] font-bold uppercase tracking-wider text-emerald-700">Earnings</div>
                        <div className="flex justify-between gap-3"><span className="text-slate-500">Basic</span><span className="font-semibold text-slate-700">₹{fmtInrWhole(r.basic)}</span></div>
                        <div className="flex justify-between gap-3"><span className="text-slate-500">HRA</span><span className="font-semibold text-slate-700">₹{fmtInrWhole(r.hra)}</span></div>
                        {r.pfEligible && r.pfEmployee > 0 && (
                          <div className="flex justify-between gap-3"><span className="text-slate-500">PF</span><span className="font-semibold text-slate-700">₹{fmtInrWhole(r.pfEmployee)}</span></div>
                        )}
                        {r.dearnessAllowance > 0 && (
                          <div className="flex justify-between gap-3"><span className="text-slate-500">Dearness Allow.</span><span className="font-semibold text-slate-700">₹{fmtInrWhole(r.dearnessAllowance)}</span></div>
                        )}
                        {r.conveyanceAllowance > 0 && (
                          <div className="flex justify-between gap-3"><span className="text-slate-500">Conveyance Allow.</span><span className="font-semibold text-slate-700">₹{fmtInrWhole(r.conveyanceAllowance)}</span></div>
                        )}
                        {r.medicalAllowance > 0 && (
                          <div className="flex justify-between gap-3"><span className="text-slate-500">Medical Allow.</span><span className="font-semibold text-slate-700">₹{fmtInrWhole(r.medicalAllowance)}</span></div>
                        )}
                        <div className="flex justify-between gap-3"><span className="text-slate-500">Spl. Allow.</span><span className="font-semibold text-slate-700">₹{fmtInrWhole(r.specialAllowance)}</span></div>
                      </div>
                      <div className="pt-1 mt-1 border-t border-slate-100 flex justify-between gap-3">
                        <span className="text-[9.5px] font-bold uppercase tracking-wider text-slate-500">Monthly CTC</span>
                        <span className="font-semibold text-slate-800">₹{fmtInrWhole(r.monthlyGross)}</span>
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-5 py-3">
                  {!r.hasStructure ? (
                    <span className="text-[12.5px] text-slate-400">—</span>
                  ) : r.pfEligible ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10.5px] font-bold uppercase tracking-wider">
                      Yes
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10.5px] font-bold uppercase tracking-wider">
                      No
                    </span>
                  )}
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
              <td colSpan={4} />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
