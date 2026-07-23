"use client";

// Finances tab on /dashboard/hr/people/[id]. HR sees the EXACT same three
// sections an employee sees on their own /dashboard/hr/payroll/* pages —
// Summary, My Pay (with My Salary / Pay Slips / Income Tax sub-tabs), and
// Manage Tax — but scoped to the viewed employee via userId props.

import { useState } from "react";
import MyFinancesSummaryPanel from "@/components/hr/my-finances/MyFinancesSummaryPanel";
import MyPayPanel from "@/components/hr/my-finances/MyPayPanel";
import ManageTaxPanel from "@/components/hr/my-finances/ManageTaxPanel";

type Props = { userId: number; userName: string };

const TABS = ["Summary", "Pay", "Manage Tax"] as const;
type Tab = typeof TABS[number];

export default function EmployeeFinancesPanel({ userId }: Props) {
  const [tab, setTab] = useState<Tab>("Summary");

  return (
    <div className="space-y-5">
      {/* Top tab strip — mirrors the SUMMARY / MY PAY / MANAGE TAX bar
          on the employee's /dashboard/hr/payroll/* pages so HR sees the
          exact same navigation shape. */}
      <div className="flex items-center bg-white border-b border-slate-200 px-2 rounded-t-2xl">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`relative px-4 py-3 text-[11px] font-bold tracking-widest transition-colors whitespace-nowrap ${
              tab === t ? "text-[#0f4e93]" : "text-slate-400 hover:text-slate-600"
            }`}>
            {t.toUpperCase()}
            {tab === t && (
              <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-[#0f4e93]" />
            )}
          </button>
        ))}
      </div>

      {/* Mirrored panels — same components the employee renders */}
      {tab === "Summary"    && <MyFinancesSummaryPanel userId={userId} />}
      {tab === "Pay"        && <MyPayPanel userId={userId} />}
      {tab === "Manage Tax" && <ManageTaxPanel userId={userId} />}
    </div>
  );
}
