"use client";

import Link from "next/link";
import MyFinancesSummaryPanel from "@/components/hr/my-finances/MyFinancesSummaryPanel";

// Thin shell around MyFinancesSummaryPanel. Same panel renders for HR
// inside /dashboard/hr/people/[id]?tab=Finances with a userId prop.

const MODULE_TABS = [
  { key: "home",         label: "HOME",        href: "/dashboard/hr/analytics"       },
  { key: "attendance",   label: "ATTENDANCE",  href: "/dashboard/hr/attendance"      },
  { key: "leave",        label: "LEAVE",       href: "/dashboard/hr/leaves"          },
  { key: "performance",  label: "PERFORMANCE", href: "/dashboard/hr/goals"           },
  { key: "payroll",      label: "MY FINANCES", href: "/dashboard/hr/payroll/summary" },
];

const PAYROLL_TABS = [
  { key: "summary",  label: "SUMMARY",    href: "/dashboard/hr/payroll/summary" },
  { key: "my-pay",   label: "MY PAY",     href: "/dashboard/hr/payroll"         },
  { key: "tax",      label: "MANAGE TAX", href: "/dashboard/hr/payroll/tax"     },
];

export default function PayrollSummaryPage() {
  return (
    <div className="min-h-screen bg-[#f4f7f8]">
      <div className="flex items-center bg-white border-b border-slate-200 px-4 overflow-x-auto">
        {MODULE_TABS.map((t) => (
          <Link key={t.key} href={t.href}
            className={`px-4 py-3 text-[11px] font-bold tracking-widest border-b-2 transition-colors whitespace-nowrap ${
              t.key === "payroll" ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-400 hover:text-slate-600"
            }`}>{t.label}</Link>
        ))}
      </div>

      <div className="flex items-center bg-white border-b border-slate-200 px-4">
        {PAYROLL_TABS.map((t) => (
          <Link key={t.key} href={t.href}
            className={`relative px-4 py-3 text-[11px] font-bold tracking-widest transition-colors whitespace-nowrap ${
              t.key === "summary" ? "text-[#0f4e93]" : "text-slate-400 hover:text-slate-600"
            }`}>
            {t.label}
            {t.key === "summary" && (
              <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-[#0f4e93]" />
            )}
          </Link>
        ))}
      </div>

      <div className="mx-auto max-w-6xl space-y-5 p-6">
        <MyFinancesSummaryPanel />
      </div>
    </div>
  );
}
