"use client";

// Inner content of the "My Finances → Manage Tax" page.

import useSWR from "swr";
import { fetcher } from "@/lib/swr";

type Props = { userId?: number };

function fmt(n: any) {
  const v = parseFloat(n || 0);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v);
}

export default function ManageTaxPanel({ userId }: Props) {
  const url = userId ? `/api/hr/payroll/salary-structure?userId=${userId}` : "/api/hr/payroll/salary-structure";
  const { data: myStructure } = useSWR<any>(url, fetcher);
  const annualCtc = parseFloat(myStructure?.ctc || 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <h3 className="text-[15px] font-semibold text-slate-800 mb-2">Tax Regime</h3>
      <p className="text-[13px] text-slate-500 mb-4">
        Income and tax liability is being computed as per <span className="font-semibold text-slate-700">New Tax Regime</span>.
      </p>
      {!myStructure ? (
        <p className="text-[13px] text-slate-500">No salary structure assigned yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "Annual CTC",              value: fmt(annualCtc) },
            { label: "TDS / Income Tax (FY)",   value: fmt(myStructure.tds) },
            { label: "Professional Tax (₹/mo)", value: fmt(myStructure.professionalTax) },
            { label: "PF — Employee (FY)",      value: fmt(myStructure.pfEmployee) },
            { label: "PF — Employer (FY)",      value: fmt(myStructure.pfEmployer) },
            { label: "Net Pay (Annual, est.)",  value: fmt(annualCtc - parseFloat(myStructure.pfEmployee || 0) - parseFloat(myStructure.tds || 0) - parseFloat(myStructure.professionalTax || 0) * 12) },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">{c.label}</p>
              <p className="mt-1.5 text-[16px] font-semibold text-slate-800">INR {c.value}</p>
            </div>
          ))}
        </div>
      )}
      <p className="mt-5 text-[11.5px] text-slate-400">
        Declarations and proof submissions will live here in a future update.
      </p>
    </div>
  );
}
