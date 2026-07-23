"use client";

// Inner content of the "My Finances → My Pay" page. Same component
// drives both the employee's own view (userId omitted, defaults to
// self via the API) and HR's view of another employee (userId passed
// in from the people-detail Finances tab).

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { canViewSalary } from "@/lib/access";
import SelectField from "@/components/ui/SelectField";
import {
  Download, FileText, X, TrendingUp, ChevronRight, ChevronDown, Lightbulb, Paperclip,
} from "lucide-react";

type Props = { userId?: number; initialSub?: SubTab };
type SubTab = "my-salary" | "pay-slips" | "income-tax";
type BonusRow = {
  id: number;
  amount: string;
  reason: string | null;
  effectiveDate: string;
  bonusType: string | null;
  paymentStatus: string;
  attachmentName: string | null;
};

const MONTHS_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const round2 = (n: number) => Math.round(n * 100) / 100;
function fmtInr(n: any) {
  const v = parseFloat(n || 0);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(v);
}
function fmtInrWhole(n: any) {
  const v = parseFloat(n || 0);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v);
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

// Indian-English amount-in-words for the net pay line ("Fifty Four Thousand
// Eight Hundred Rupees only"). Whole rupees only — payslip nets are integral.
function amountInWords(amount: number): string {
  const n = Math.round(amount);
  if (!Number.isFinite(n) || n === 0) return "Zero Rupees only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number): string => x < 20 ? ones[x] : (tens[Math.floor(x / 10)] + (x % 10 ? " " + ones[x % 10] : ""));
  const three = (x: number): string => {
    const h = Math.floor(x / 100), r = x % 100;
    return (h ? ones[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
  };
  const crore = Math.floor(n / 10000000), restCr = n % 10000000;
  const lakh = Math.floor(restCr / 100000), restLk = restCr % 100000;
  const thousand = Math.floor(restLk / 1000), rest = restLk % 1000;
  let w = "";
  if (crore) w += two(crore) + " Crore ";
  if (lakh) w += two(lakh) + " Lakh ";
  if (thousand) w += two(thousand) + " Thousand ";
  if (rest) w += three(rest);
  return w.trim() + " Rupees only";
}

// Per-legal-entity company header (name + address lines). Keyed by
// EmployeeProfile.legalEntity. TODO(YT Labs): replace the placeholder with the
// real registered name + address once HR provides it.
const COMPANY_HEADERS: Record<string, { name: string; address: string[] }> = {
  "NB Media Productions": {
    name: "YT MONEY PRODUCTIONS PRIVATE LIMITED",
    address: ["1ST FLOOR, 209,", "NB MEDIA, MODEL TOWN MAIN ROAD,", "BATHINDA PUNJAB 151001"],
  },
  "YT Labs": {
    name: "YT MONEY PRODUCTIONS PRIVATE LIMITED", // PLACEHOLDER — awaiting YT Labs' legal name + address
    address: ["1ST FLOOR, 209,", "NB MEDIA, MODEL TOWN MAIN ROAD,", "BATHINDA PUNJAB 151001"],
  },
};
function companyHeader(legalEntity?: string | null) {
  return (legalEntity && COMPANY_HEADERS[legalEntity]) || COMPANY_HEADERS["NB Media Productions"];
}

// "Monthly Salary" header = the employee's full monthly CTC total, i.e. the
// sum of the monthly earning components. Mirrors the `monthlyEarnings` figure
// payroll generation uses (generate/route.ts) and the earnings rows rendered
// below, so the header always shows the month's total salary regardless of LOP
// or a missing/stale `ctc` value. Falls back to the frozen payslip base (÷ LOP)
// or CTC/12 only when the structure has no usable component split.
function monthlyBaseSalary(p: any, structure: any): number {
  if (structure) {
    const monthly = (
      (parseFloat(structure.basic               || 0) || 0)
      + (parseFloat(structure.hra               || 0) || 0)
      + (parseFloat(structure.dearnessAllowance || 0) || 0)
      + (parseFloat(structure.conveyanceAllowance || 0) || 0)
      + (parseFloat(structure.medicalAllowance  || 0) || 0)
      + (parseFloat(structure.specialAllowance  || 0) || 0)
      + (parseFloat(structure.pfEmployee        || 0) || 0)
    ) / 12;
    if (monthly > 0) return Math.round(monthly);
  }
  const gross = parseFloat(p?.grossEarnings || 0) || 0;
  const bonus = parseFloat(p?.bonus || 0) || 0;
  const adhoc = (Array.isArray(p?.adhocPayments) ? p.adhocPayments : [])
    .reduce((s: number, a: any) => s + (parseFloat(String(a.amount)) || 0), 0);
  const wd = parseFloat(p?.workingDays || 0) || 0;
  const lop = parseFloat(p?.lopDays || 0) || 0;
  const lopFactor = wd > 0 ? Math.max(0, (wd - lop) / wd) : 1;
  const base = Math.max(0, gross - bonus - adhoc);
  if (base > 0 && lopFactor > 0) return Math.round(base / lopFactor);
  return Math.round((parseFloat(structure?.ctc || 0) || 0) / 12);
}

// Bonuses (EmployeeBonus rows) whose effectiveDate falls in the payslip's month.
function bonusesForPayslip(p: any, all: BonusRow[]): BonusRow[] {
  return (all || []).filter((b) => {
    const d = new Date(b.effectiveDate);
    return !Number.isNaN(d.getTime()) && d.getUTCFullYear() === p.year && d.getUTCMonth() === p.month;
  });
}
function bonusLabel(b: BonusRow): string {
  return (b.bonusType && b.bonusType.trim()) ? b.bonusType.trim() : "Bonus";
}

// "Net Salary Payable" figure. For a Full & Final payslip we show the true
// payable = Total Earnings (A) − Deductions (B) computed from the payslip's own
// figures, rather than the separately-stored `netPay` — so the printed
// "( A − B )" is literally A − B. Non-F&F payslips keep `netPay` (which already
// equals A − B). Regex mirrors renderEarnings' F&F detection.
const FF_RE = /ff.?settlement|full.?and.?final|f\s*&\s*f/i;
function netPayable(p: any): number {
  const items = Array.isArray(p?.adhocPayments) ? p.adhocPayments : [];
  const hasFf = items.some((a: any) => FF_RE.test(String(a?.type ?? "")));
  if (!hasFf) return parseFloat(p?.netPay || 0) || 0;
  return (parseFloat(p?.grossEarnings || 0) || 0) - (parseFloat(p?.totalDeductions || 0) || 0);
}

// Non-zero deduction rows. The fixed ₹200 `additionalTax` is shown as
// "Professional Tax" to match the company payslip format. Shared by the
// on-screen preview and the printable download so they stay identical.
function deductionRows(p: any): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (parseFloat(p.pfEmployee || 0) > 0)      rows.push({ label: "Provident Fund (Employee)", value: fmtInr(p.pfEmployee) });
  if (parseFloat(p.tds || 0) > 0)             rows.push({ label: "TDS / Income Tax", value: fmtInr(p.tds) });
  if (parseFloat(p.professionalTax || 0) > 0) rows.push({ label: "Professional Tax", value: fmtInr(p.professionalTax) });
  if (parseFloat(p.additionalTax || 0) > 0)   rows.push({ label: "Professional Tax", value: fmtInr(p.additionalTax) });
  // Residual — ESI / LWF / adhoc recoveries (e.g. salary-advance recovery) are
  // baked into totalDeductions but aren't stored as their own payslip fields.
  // Surface them so the deductions column sums to Total (B).
  const itemised = parseFloat(p.pfEmployee || 0) + parseFloat(p.tds || 0) + parseFloat(p.professionalTax || 0) + parseFloat(p.additionalTax || 0);
  const other = (parseFloat(p.totalDeductions || 0) || 0) - itemised;
  if (other >= 0.5) rows.push({ label: "Other Deductions", value: fmtInr(other) });
  return rows;
}

function downloadPayslip(
  p: any,
  structure: any,
  profile?: any,
  bonuses: BonusRow[] = [],
  header?: { name: string; address: string[] },
) {
  const co = header || companyHeader(profile?.legalEntity);
  const period = `${MONTHS_FULL[p.month].toUpperCase()} ${p.year}`;
  const name = (profile?.firstName || profile?.lastName)
    ? [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")
    : (p.user?.name || "—");
  const loc = profile?.jobLocation || profile?.city || "—";
  const days = (parseFloat(p.workingDays || 0) - parseFloat(p.lopDays || 0));
  const logoUrl = (typeof window !== "undefined" ? window.location.origin : "") + "/logo.png";

  // Earnings rows — itemised, bonuses labelled by their bonusType.
  const earnRows = renderEarnings(p, structure, bonuses)
    .map((r) => `<div class="line"><span>${r.label}</span><span class="amt">${r.value}</span></div>`).join("");

  // Non-zero deductions (shared with the on-screen preview). Stipend-only
  // employees (no deductions) get NO Taxes & Deductions section at all —
  // Earnings spans full width and the net line reads "( A )".
  const ded = deductionRows(p);
  const hasDed = ded.length > 0;
  const dedRows = ded.map((d) => `<div class="line"><span>${d.label}</span><span class="amt">${d.value}</span></div>`).join("");
  const earningsCol =
    `<div class="col left">
      <div class="colh">EARNINGS</div>
      ${earnRows}
      <div class="line tot"><span>Total Earnings (A)</span><span class="amt">${fmtInr(p.grossEarnings)}</span></div>
    </div>`;
  const deductionsCol =
    `<div class="col">
      <div class="colh">TAXES &amp; DEDUCTIONS</div>
      ${dedRows}
      <div class="line tot"><span>Total Taxes &amp; Deductions (B)</span><span class="amt">${fmtInr(p.totalDeductions)}</span></div>
    </div>`;
  // Always two columns — when there are no deductions the right column is simply
  // left empty (Earnings keeps its half width, not stretched full-page).
  const edHtml = `<div class="ed">${earningsCol}${hasDed ? deductionsCol : ""}</div>`;
  const netLabel = hasDed ? "A - B" : "A";

  const cell = (label: string, value: string) =>
    `<div class="cell"><div class="lbl">${label}</div><div class="val">${value || "&mdash;"}</div></div>`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>Payslip - ${period} - ${name}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#1f2937;background:#fff}
  .sheet{max-width:820px;margin:0 auto;background:#fff;padding:40px 44px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
  .ptitle{font-size:26px;font-weight:400;color:#111827}
  .ptitle b{font-weight:800}
  .company{font-size:12px;color:#6b7280;margin-top:10px;line-height:1.55}
  .company .nm{color:#4b5563;font-weight:500}
  .logo{height:46px}
  .empname{font-size:15px;font-weight:700;color:#111827;margin:22px 0 10px}
  hr{border:none;border-top:1.5px solid #111827;margin:0}
  .thin{border-top:1px solid #e5e7eb}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0}
  .cell{padding:12px 4px 12px 0;border-bottom:1px solid #e5e7eb}
  .lbl{font-size:10.5px;color:#9ca3af;margin-bottom:4px}
  .val{font-size:12.5px;color:#1f2937;font-weight:500}
  .sec{font-size:13px;font-weight:700;color:#111827;margin:26px 0 8px}
  .days{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border-bottom:1px solid #e5e7eb;padding-bottom:14px;padding-top:12px}
  .ed{display:grid;grid-template-columns:1fr 1fr;margin-top:18px}
  .ed .col{padding:0 26px}
  .ed .col.left{border-right:1px solid #e5e7eb;padding-left:0}
  .colh{font-size:13px;font-weight:700;color:#111827;margin-bottom:10px}
  .line{display:flex;justify-content:space-between;padding:6px 0;font-size:12.5px;color:#374151}
  .line.tot{font-weight:700;color:#111827;border-top:1px solid #e5e7eb;margin-top:4px;padding-top:8px}
  .muted{color:#9ca3af}
  .net{background:#f3f4f6;margin-top:26px;padding:16px 20px;border-radius:4px}
  .net .row{display:flex;justify-content:space-between;align-items:center;padding:5px 0}
  .net .k{font-size:13px;color:#374151}
  .net .v{font-size:14px;font-weight:700;color:#111827}
  .note{font-size:11px;color:#4b5563;margin-top:18px}
  .note b{color:#111827}
  .foot{font-size:10.5px;color:#9ca3af;font-style:italic;margin-top:14px}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.sheet{padding:24px}}
</style></head><body><div class="sheet">
  <div class="top">
    <div>
      <div class="ptitle"><b>PAYSLIP</b> ${period}</div>
      <div class="company"><span class="nm">${co.name}</span><br/>${co.address.join("<br/>")}</div>
    </div>
    <img class="logo" src="${logoUrl}" alt="logo" onerror="this.style.display='none'"/>
  </div>

  <div class="empname">${name.toUpperCase()}</div>
  <hr/>
  <div class="grid">
    ${cell("Employee Number", profile?.employeeId)}
    ${cell("Date Joined", profile?.joiningDate ? new Date(profile.joiningDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "")}
    ${cell("Department", profile?.department)}
    ${cell("Designation", profile?.designation)}
    ${cell("Date Of Birth", profile?.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "")}
    ${cell("Location", loc)}
    ${cell("Payment Mode", "Bank Transfer")}
    ${cell("Bank", profile?.bankName)}
    ${cell("Bank IFSC", profile?.bankIfsc)}
    ${cell("Bank Account", profile?.bankAccountNumber)}
    ${cell("Monthly Salary", fmtInrWhole(monthlyBaseSalary(p, structure)))}
    ${cell("PAN Number", profile?.panNumber)}
  </div>

  <div class="sec">SALARY DETAILS</div>
  <hr class="thin"/>
  <div class="days">
    <div><div class="lbl">Actual Payable Days</div><div class="val">${p.presentDays ?? "—"}</div></div>
    <div><div class="lbl">Total Working Days</div><div class="val">${p.workingDays ?? "—"}</div></div>
    <div><div class="lbl">Loss Of Pay Days</div><div class="val">${p.lopDays ?? 0}</div></div>
    <div><div class="lbl">Days Payable</div><div class="val">${days}</div></div>
  </div>

  ${edHtml}

  <div class="net">
    <div class="row"><span class="k">Net Salary Payable ( ${netLabel} )</span><span class="v">${fmtInr(netPayable(p))}</span></div>
    <div class="row"><span class="k">Net Salary in words</span><span class="v">${amountInWords(netPayable(p))}</span></div>
  </div>

  <div class="note"><b>**Note :</b> All amounts displayed in this payslip are in <b>INR</b></div>
  <div class="foot">* This is computer generated statement, does not require signature.</div>
</div></body></html>`;

  const win = window.open("", "_blank", "width=860,height=1000");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 400);
}

export default function MyPayPanel({ userId, initialSub = "my-salary" }: Props) {
  const [subTab, setSubTab] = useState<SubTab>(initialSub);

  // Pay Slips visibility:
  //   • Self-view (no `userId`) — every employee sees their OWN payslips. The
  //     API pins non-admins to their own id and only exposes runs marked "paid",
  //     so this is safe for regular employees.
  //   • Viewing SOMEONE ELSE (`userId` set, HR-side Finances tab) still requires
  //     salary permission — a non-admin can't view another person's payslips.
  const { data: session, status } = useSession();
  const viewer = session?.user as any;
  const canSeePayslips = !userId || viewer?.isDeveloper === true || canViewSalary(viewer);
  useEffect(() => {
    if (status !== "loading" && subTab === "pay-slips" && !canSeePayslips) setSubTab("my-salary");
  }, [status, canSeePayslips, subTab]);
  const [showBreakup, setShowBreakup] = useState(false);
  // Salary Revision drill-down. Collapsed by default — clicking the
  // chevron expands into the regular-salary detail + per-bonus list.
  const [revisionOpen, setRevisionOpen] = useState(false);

  const qs = userId ? `?userId=${userId}` : "";
  const { data: myPayslips = [] } = useSWR<any[]>(`/api/hr/payroll/payslips${qs}`, fetcher);
  // Capture the structure's initial-load state: the payslip breakdown is
  // computed FROM this structure, so rendering a payslip before it arrives
  // shows a wrong (structure-less) breakdown that then snaps to the correct
  // one. PaySlipsView holds the payslip behind a spinner until this resolves.
  const { data: myStructure, isLoading: structureLoading } = useSWR<any>(`/api/hr/payroll/salary-structure${qs}`, fetcher);
  // Bonuses surface inline on the Salary Revision row (+ BONUS = TOTAL)
  // and as itemised rows in the expanded view. Hidden entirely when the
  // user has no recorded bonuses.
  const { data: bonusData } = useSWR<{ items: BonusRow[] }>(`/api/hr/payroll/bonus${qs}`, fetcher);
  const bonuses = bonusData?.items ?? [];
  const totalBonus = bonuses.reduce((s, b) => s + parseFloat(b.amount || "0"), 0);
  const hasBonuses = bonuses.length > 0 && totalBonus > 0;

  const annualCtc = parseFloat(myStructure?.ctc || 0);

  const effectiveFrom = myStructure?.effectiveFrom
    ? new Date(myStructure.effectiveFrom).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    : "—";

  const earningsRows = useMemo(() => {
    if (!myStructure) return [];
    const isIntern = myStructure.salaryType === "intern";
    const basic   = parseFloat(myStructure.basic || 0);
    const hra     = parseFloat(myStructure.hra || 0);
    const da      = parseFloat(myStructure.dearnessAllowance   || 0);
    const conv    = parseFloat(myStructure.conveyanceAllowance || 0);
    const medical = parseFloat(myStructure.medicalAllowance    || 0);
    const special = parseFloat(myStructure.specialAllowance || 0);
    const rows: { label: string; annual: number }[] = [];
    if (isIntern) {
      // Interns are paid a flat stipend; the DB only stores the annual
      // CTC. The breakup modal displays a synthetic Basic / HRA / Special
      // split (50 / 20 / 30) so the surface matches the regular-employee
      // layout — the actual stipend payment is unaffected.
      if (annualCtc > 0) {
        const basicAnnual = Math.round(annualCtc * 0.50);
        const hraAnnual   = Math.round(annualCtc * 0.20);
        const specialAnnual = annualCtc - basicAnnual - hraAnnual;
        rows.push({ label: "Basic Salary",         annual: basicAnnual   });
        rows.push({ label: "House Rent Allowance", annual: hraAnnual     });
        rows.push({ label: "Special Allowance",    annual: specialAnnual });
      }
      return rows;
    }
    if (basic)   rows.push({ label: "Basic Salary",         annual: basic   });
    if (hra)     rows.push({ label: "House Rent Allowance", annual: hra     });
    if (da)      rows.push({ label: "Dearness Allowance",   annual: da      });
    if (conv)    rows.push({ label: "Conveyance Allowance", annual: conv    });
    if (medical) rows.push({ label: "Medical Allowance",    annual: medical });
    if (special) rows.push({ label: "Special Allowance",    annual: special });
    if (rows.length === 0 && annualCtc > 0) {
      rows.push({ label: "Monthly Stipend", annual: annualCtc });
    }
    return rows;
  }, [myStructure, annualCtc]);

  const totalAnnual  = earningsRows.reduce((s, r) => s + r.annual, 0);
  const totalMonthly = totalAnnual / 12;
  // Employee-PF share carved out of CTC by the structure split rule. Surfaced
  // next to Regular Salary so the timeline total ties back to the CTC shown on
  // the Current Compensation card (₹0 for interns / non-PF-eligible).
  const pfAnnual = myStructure?.salaryType === "intern" ? 0 : (parseFloat(myStructure?.pfEmployee || 0) || 0);

  const subTabs: { key: SubTab; label: string }[] = [
    { key: "my-salary",  label: userId ? "Salary" : "My Salary" },
    ...(canSeePayslips ? [{ key: "pay-slips" as SubTab, label: "Pay Slips" }] : []),
    { key: "income-tax", label: "Income Tax" },
  ];

  return (
    <div>
      {/* My Pay sub-tabs */}
      <div className="flex items-center gap-6 bg-white border-b border-slate-200 px-6 -mx-6 mb-5">
        {subTabs.map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className={`relative py-3 text-[13px] font-semibold transition-colors whitespace-nowrap ${
              subTab === t.key ? "text-slate-800" : "text-slate-400 hover:text-slate-600"
            }`}>
            {t.label}
            {subTab === t.key && (
              <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-[#0f4e93] rounded-t" />
            )}
          </button>
        ))}
      </div>

      <div className="space-y-5">
        {/* ══════════════════════  My Salary  ══════════════════════ */}
        {subTab === "my-salary" && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Current compensation</p>
                <p className="mt-2 text-[18px] font-semibold text-slate-800">
                  {myStructure ? `INR ${fmtInrWhole(annualCtc)} / Annum` : "Not assigned"}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-8">
                  <div>
                    <p className="text-[14px] font-semibold text-slate-800">Payroll</p>
                  </div>
                  <div>
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Pay cycle</p>
                    <p className="mt-1 text-[14px] font-medium text-slate-800">Monthly</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
              <h3 className="text-[15px] font-semibold text-slate-800 mb-4">Salary Timeline</h3>

              <div className="mb-5 flex items-start gap-2 rounded-lg bg-amber-50 px-4 py-3 ring-1 ring-inset ring-amber-100">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-[13px] text-amber-900">
                  Your Income and tax liability is being computed as per New Tax Regime.
                </p>
              </div>

              {!myStructure ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-[13px] text-slate-500">No salary structure assigned yet</p>
                  <p className="mt-1 text-[11.5px] text-slate-400">Please ask HR to assign you a salary structure.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                      <TrendingUp className="h-4 w-4" />
                    </span>
                    <p className="text-[14px] font-semibold text-slate-800">Salary Revision</p>
                    <p className="text-[12px] text-slate-400">Effective {effectiveFrom}</p>
                    <span className="inline-flex items-center rounded bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-600 ring-1 ring-inset ring-sky-200">
                      Current
                    </span>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                    {/* Compact row — REGULAR SALARY [+ PF] [+ BONUS] = TOTAL.
                        PF appears only for PF-eligible structures (so the
                        total ties to the CTC card); Bonus only when the user
                        actually has bonuses on record. */}
                    <div className="flex items-center justify-between gap-4 px-5 py-4">
                      <div className="flex items-center gap-6 text-slate-700">
                        <button onClick={() => setRevisionOpen(o => !o)}
                          className="text-slate-400 hover:text-slate-600 transition-colors"
                          title={revisionOpen ? "Hide details" : "Show details"}>
                          {revisionOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        <div>
                          <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Regular salary</p>
                          <p className="mt-1 text-[13.5px] font-semibold text-slate-800">INR {fmtInrWhole(totalAnnual)}</p>
                        </div>
                        {pfAnnual > 0 && (
                          <>
                            <span className="text-slate-400 text-[15px] font-semibold">+</span>
                            <div>
                              <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">PF</p>
                              <p className="mt-1 text-[13.5px] font-semibold text-slate-800">INR {fmtInrWhole(pfAnnual)}</p>
                            </div>
                          </>
                        )}
                        {hasBonuses && (
                          <>
                            <span className="text-slate-400 text-[15px] font-semibold">+</span>
                            <div>
                              <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Bonus</p>
                              <p className="mt-1 text-[13.5px] font-semibold text-slate-800">INR {fmtInrWhole(totalBonus)}</p>
                            </div>
                          </>
                        )}
                        <span className="text-slate-400 text-[15px] font-semibold">=</span>
                        <div>
                          <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Total</p>
                          <p className="mt-1 text-[13.5px] font-semibold text-slate-800">INR {fmtInrWhole(totalAnnual + pfAnnual + totalBonus)}</p>
                        </div>
                      </div>
                      <button onClick={() => setShowBreakup(true)}
                        className="text-[13px] font-semibold text-sky-600 hover:underline">
                        View Salary breakup
                      </button>
                    </div>

                    {/* Expanded detail — regular salary breakdown always; the
                        bonus list appears only when bonuses are recorded. */}
                    {revisionOpen && (
                      <>
                        <div className="bg-slate-100 px-5 py-2 border-t border-slate-200 flex items-center justify-between">
                          <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500">Regular salary</span>
                          <span className="text-[12px] font-medium text-slate-700">INR {fmtInrWhole(totalAnnual)} / Annum</span>
                        </div>
                        <div className="bg-white grid grid-cols-2 gap-y-3 px-5 py-4">
                          <div>
                            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Salary per month</p>
                            <p className="mt-1 text-[13px] font-medium text-slate-800">INR {fmtInrWhole(totalAnnual / 12)}</p>
                          </div>
                          <div>
                            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Effective from</p>
                            <p className="mt-1 text-[13px] font-medium text-slate-800">{effectiveFrom}</p>
                          </div>
                        </div>

                        {pfAnnual > 0 && (
                          <div className="bg-slate-100 px-5 py-2 border-t border-slate-200 flex items-center justify-between">
                            <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500">PF — Employee Contribution</span>
                            <span className="text-[12px] font-medium text-slate-700">INR {fmtInrWhole(pfAnnual)} / Annum</span>
                          </div>
                        )}

                        {hasBonuses && (
                          <>
                            <div className="bg-slate-100 px-5 py-2 border-t border-slate-200 flex items-center justify-between">
                              <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500">Bonus</span>
                              <span className="text-[12px] font-medium text-slate-700">INR {fmtInrWhole(totalBonus)}</span>
                            </div>
                            {bonuses.map(b => (
                              <BonusDetailRow key={b.id} bonus={b} />
                            ))}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ══════════════════════  Pay Slips  ══════════════════════ */}
        {subTab === "pay-slips" && canSeePayslips && (
          <PaySlipsView payslips={myPayslips} structure={myStructure} structureLoading={structureLoading} userId={userId} />
        )}

        {/* ══════════════════════  Income Tax  ══════════════════════ */}
        {subTab === "income-tax" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <h3 className="text-[15px] font-semibold text-slate-800 mb-4">Income Tax Summary</h3>
            {!myStructure ? (
              <p className="text-[13px] text-slate-500">No salary structure assigned yet — nothing to compute.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { label: "Annual CTC",              value: fmtInrWhole(annualCtc) },
                  { label: "TDS / Income Tax (FY)",   value: fmtInrWhole(myStructure.tds) },
                  { label: "Professional Tax (₹/mo)", value: fmtInrWhole(myStructure.professionalTax) },
                  { label: "PF — Employee (FY)",      value: fmtInrWhole(myStructure.pfEmployee) },
                  { label: "PF — Employer (FY)",      value: fmtInrWhole(myStructure.pfEmployer) },
                  { label: "Net Pay (Annual)",        value: fmtInrWhole(annualCtc - parseFloat(myStructure.pfEmployee || 0) - parseFloat(myStructure.tds || 0) - parseFloat(myStructure.professionalTax || 0) * 12) },
                ].map((c) => (
                  <div key={c.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">{c.label}</p>
                    <p className="mt-1.5 text-[16px] font-semibold text-slate-800">INR {c.value}</p>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-5 text-[11.5px] text-slate-400">
              Regime: New Tax Regime. Figures are illustrative — based on the assigned salary structure only.
            </p>
          </div>
        )}
      </div>

      {/* ═══════════════  Salary Breakup Modal  ═══════════════ */}
      {showBreakup && myStructure && (
        <div className="fixed inset-0 z-50 flex bg-black/40 backdrop-blur-sm">
          <div className="flex-1 bg-white flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-[15px] font-semibold text-slate-800">Salary Breakup for INR {fmtInrWhole(totalAnnual + pfAnnual)}</h3>
              <button onClick={() => setShowBreakup(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Earnings</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Monthly</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Annually</th>
                  </tr>
                </thead>
                <tbody>
                  {earningsRows.map((r) => (
                    <tr key={r.label} className="border-b border-slate-100">
                      <td className="px-4 py-3 text-slate-800">{r.label}</td>
                      <td className="px-4 py-3 text-slate-800">INR {fmtInr(r.annual / 12)}</td>
                      <td className="px-4 py-3 text-slate-800">INR {fmtInr(r.annual)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <td className="px-4 py-3 font-semibold text-slate-800">Total Earnings</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">INR {fmtInr(totalMonthly)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">INR {fmtInr(totalAnnual)}</td>
                  </tr>
                  {pfAnnual > 0 && (
                    <>
                      <tr className="border-b border-slate-100">
                        <td className="px-4 py-3 text-slate-800">PF — Employee Contribution</td>
                        <td className="px-4 py-3 text-slate-800">INR {fmtInr(pfAnnual / 12)}</td>
                        <td className="px-4 py-3 text-slate-800">INR {fmtInr(pfAnnual)}</td>
                      </tr>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <td className="px-4 py-3 font-semibold text-slate-800">Total (CTC)</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">INR {fmtInr((totalAnnual + pfAnnual) / 12)}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">INR {fmtInr(totalAnnual + pfAnnual)}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>

              <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3">
                <div className="grid grid-cols-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Net Pay</p>
                  <p className="text-[13px] font-semibold text-slate-800">INR {fmtInr(totalMonthly)}</p>
                  <p className="text-[13px] font-semibold text-slate-800">INR {fmtInr(totalAnnual)}</p>
                </div>
              </div>

              <div className="mt-5 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <div>
                  <p className="text-[12.5px] font-semibold text-slate-800">Note</p>
                  <p className="mt-0.5 text-[12.5px] text-slate-600">
                    NOTE: Net Pay above does not include Taxes or Other deductions (if any).
                  </p>
                </div>
              </div>
            </div>
          </div>

          <aside className="w-[280px] bg-[#f4f7f8] border-l border-slate-200 p-5 overflow-y-auto">
            <h4 className="text-[13.5px] font-semibold text-slate-800">Version History</h4>
            <p className="mt-0.5 text-[11.5px] text-slate-500">View previous versions of salary structures</p>

            <div className="mt-4 rounded-lg bg-sky-50 border border-sky-100 p-3">
              <p className="text-[12.5px] font-semibold text-slate-800">{effectiveFrom}</p>
              <p className="mt-0.5 text-[11.5px] text-slate-500">Original salary structure</p>
              <span className="mt-2 inline-flex items-center rounded bg-sky-100 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-sky-700 ring-1 ring-inset ring-sky-200">
                Current Version
              </span>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Pay Slips — two-pane (year/month rail + inline preview).
// The "structure" prop is the SalaryStructure record for the SAME user as the
// payslips list. The "userId" prop scopes the summary fetch so HR-side
// rendering pulls the viewed employee's profile, not the logged-in HR user's.
// ──────────────────────────────────────────────────────────────────────────────
function PaySlipsView({ payslips, structure, structureLoading, userId }: { payslips: any[]; structure: any; structureLoading?: boolean; userId?: number }) {
  const summaryUrl = userId ? `/api/hr/payroll/summary?userId=${userId}` : "/api/hr/payroll/summary";
  const { data: summary, isLoading: summaryLoading } = useSWR<{ profile: any }>(summaryUrl, fetcher);
  const profile = summary?.profile ?? null;

  // Bonuses (with their bonusType) — itemised onto the payslip earnings.
  const bonusUrl = userId ? `/api/hr/payroll/bonus?userId=${userId}` : "/api/hr/payroll/bonus";
  const { data: bonusData, isLoading: bonusLoading } = useSWR<{ items: BonusRow[] }>(bonusUrl, fetcher);
  const allBonuses = bonusData?.items ?? [];

  // The payslip breakdown is derived from the structure, profile and bonuses.
  // Until all three finish their initial load, a rendered payslip would show
  // stale/structure-less numbers that then snap to the correct values — a
  // confusing flash. Hold the payslip behind a spinner until they're ready.
  const dataLoading = !!structureLoading || summaryLoading || bonusLoading;

  const header = companyHeader(profile?.legalEntity);

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const p of payslips) set.add(p.year);
    const sorted = Array.from(set).sort((a, b) => b - a);
    return sorted.length > 0 ? sorted : [new Date().getFullYear()];
  }, [payslips]);

  const [selectedYear, setSelectedYear] = useState<number>(years[0]);
  useEffect(() => {
    if (!years.includes(selectedYear)) setSelectedYear(years[0]);
  }, [years, selectedYear]);

  const monthsInYear = useMemo(
    () => payslips.filter((p: any) => p.year === selectedYear).sort((a: any, b: any) => b.month - a.month),
    [payslips, selectedYear]
  );

  const [selectedId, setSelectedId] = useState<number | null>(null);
  useEffect(() => {
    if (monthsInYear.length === 0) { setSelectedId(null); return; }
    if (!selectedId || !monthsInYear.find((p: any) => p.id === selectedId)) {
      setSelectedId(monthsInYear[0].id);
    }
  }, [monthsInYear, selectedId]);

  const active = monthsInYear.find((p: any) => p.id === selectedId) || null;
  // Month-effective structure for the selected payslip — the API attaches the
  // structure that applied in the payslip's month (from SalaryStructureHistory
  // when the current one took effect later), so a past month shows the salary
  // that applied THEN. Fall back to the current structure prop if absent.
  const activeStructure = active?.salaryStructure ?? structure;
  const activeBonuses = active ? bonusesForPayslip(active, allBonuses) : [];
  // Stipend-only employees (no PF/TDS/PT/etc.) get no deductions section.
  const activeDeductions = active ? deductionRows(active) : [];
  const hasDeductions = activeDeductions.length > 0;

  const maskedAcct = (v?: string | null) => !v ? "—" : String(v);
  const maskedPan  = (v?: string | null) => v || "—";

  const fullName =
    profile?.firstName || profile?.lastName
      ? [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")
      : profile?.name || "—";

  return (
    <div>
      {/* Header row */}
      <div className="pb-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[18px] font-semibold text-slate-800">Pay Slips</h2>
              <Download className="h-4 w-4 text-slate-400" />
            </div>
            <p className="mt-1 text-[12.5px] text-slate-500">
              Here you can manage all generated payslips for applicable years.
            </p>
          </div>
          {active && !dataLoading ? (
            <button
              onClick={() => downloadPayslip(active, activeStructure, profile, activeBonuses, header)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-sky-300 text-sky-600 hover:bg-sky-50 text-[13px] font-semibold"
            >
              {MONTHS_FULL[active.month]} {active.year} Pay Slip
              <Download className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-5">
        <aside className="col-span-12 md:col-span-3 space-y-4">
          <div className="relative">
            <SelectField
              value={String(selectedYear)}
              onChange={(v) => setSelectedYear(parseInt(v))}
              options={years.map((y) => ({ value: String(y), label: `Year ${y}` }))}
              className="w-full rounded-lg border border-slate-200 bg-white h-10 px-4 text-[13px] font-medium text-slate-800 shadow-sm"
            />
          </div>

          <div className="rounded-lg bg-white overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.04)] border border-slate-200">
            <p className="bg-slate-100 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500">
              Payslips
            </p>
            {monthsInYear.length === 0 ? (
              <p className="px-4 py-6 text-[12.5px] text-slate-400">No payslips for {selectedYear}.</p>
            ) : (
              <ul>
                {monthsInYear.map((p: any) => {
                  const isSel = p.id === selectedId;
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => setSelectedId(p.id)}
                        className={`w-full text-left px-4 py-3 text-[13px] transition-colors ${
                          isSel
                            ? "bg-sky-50 text-sky-700 font-semibold"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {MONTHS_FULL[p.month]} {p.year}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section className="col-span-12 md:col-span-9">
          {active ? (
            dataLoading ? (
              <div className="flex min-h-[280px] items-center justify-center rounded-lg border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.03)]">
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="h-7 w-7 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" />
                  <p className="text-[12.5px] text-slate-500">Loading payslip…</p>
                </div>
              </div>
            ) : (
            <>
              <div className="rounded-t-lg bg-[#3c4656] px-6 py-3 text-white text-[13px] font-medium">
                {`${MONTHS_FULL[active.month]} ${active.year}`}
              </div>
              <div className="bg-[#2a3140] px-6 py-8 rounded-b-lg">
                <div className="mx-auto max-w-3xl rounded bg-white p-10 shadow-xl">
                  <div className="flex items-start justify-between">
                    <div>
                      <h1 className="text-[22px] font-bold text-slate-800 tracking-wide">
                        PAYSLIP <span className="font-normal">{MONTHS_FULL[active.month].toUpperCase()} {active.year}</span>
                      </h1>
                      <p className="mt-3 text-[13px] font-semibold text-slate-700">{header.name}</p>
                      <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
                        {header.address.map((l, i) => <span key={i}>{l}<br /></span>)}
                      </p>
                    </div>
                    <div className="flex h-14 w-14 items-center justify-center rounded-md bg-white ring-1 ring-slate-200 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/logo.png" alt="NB" className="h-11 w-11 object-contain" />
                    </div>
                  </div>

                  <h2 className="mt-8 text-[14px] font-bold text-slate-800 border-b border-slate-200 pb-2">
                    {fullName.toUpperCase()}
                  </h2>

                  <div className="mt-4 grid grid-cols-4 gap-x-6 gap-y-5">
                    <PayslipField label="Employee Number"  value={profile?.employeeId || "—"} />
                    <PayslipField label="Date Joined"      value={formatDate(profile?.joiningDate)} />
                    <PayslipField label="Department"       value={profile?.department || "—"} />
                    <PayslipField label="Designation"      value={profile?.designation || "—"} />

                    <PayslipField label="Date of Birth"    value={formatDate(profile?.dateOfBirth)} />
                    <PayslipField label="Location"         value={profile?.jobLocation || profile?.city || "—"} />
                    <PayslipField label="Payment Mode"     value="Bank Transfer" />
                    <PayslipField label="Bank"             value={profile?.bankName || "—"} />

                    <PayslipField label="Bank IFSC"        value={profile?.bankIfsc || "—"} />
                    <PayslipField label="Bank Account"     value={maskedAcct(profile?.bankAccountNumber)} />
                    <PayslipField label="Monthly Salary"   value={fmtInrWhole(monthlyBaseSalary(active, activeStructure))} />
                    <PayslipField label="PAN Number"       value={maskedPan(profile?.panNumber)} />
                  </div>

                  <h3 className="mt-10 text-[13px] font-bold text-slate-800 border-b border-slate-200 pb-2">SALARY DETAILS</h3>
                  <div className="mt-4 grid grid-cols-4 gap-x-6">
                    <PayslipField label="Actual Payable Days" value={String(active.presentDays ?? "—")} />
                    <PayslipField label="Total Working Days"  value={String(active.workingDays ?? "—")} />
                    <PayslipField label="Loss of Pay Days"    value={String(active.lopDays ?? 0)} />
                    <PayslipField label="Days Payable"        value={String((parseFloat(active.workingDays ?? 0)) - (parseFloat(active.lopDays ?? 0)))} />
                  </div>

                  {/* Earnings | (Taxes & Deductions only when there are any — else the
                      right column stays empty; Earnings keeps its half width). */}
                  <div className="mt-7 grid grid-cols-2">
                    <div className="pr-7 border-r border-slate-200">
                      <p className="text-[13px] font-bold text-slate-800 mb-2.5">EARNINGS</p>
                      {renderEarnings(active, activeStructure, activeBonuses).map((row) => (
                        <div key={row.label} className="flex justify-between py-1.5 text-[12.5px] text-slate-700">
                          <span>{row.label}</span><span className="tabular-nums">{row.value}</span>
                        </div>
                      ))}
                      <div className="flex justify-between border-t border-slate-200 mt-1 pt-2 text-[12.5px] font-bold text-slate-900">
                        <span>Total Earnings (A)</span><span className="tabular-nums">{fmtInr(active.grossEarnings)}</span>
                      </div>
                    </div>
                    {hasDeductions && (
                      <div className="pl-7">
                        <p className="text-[13px] font-bold text-slate-800 mb-2.5">TAXES &amp; DEDUCTIONS</p>
                        {activeDeductions.map((row, i) => (
                          <div key={i} className="flex justify-between py-1.5 text-[12.5px] text-slate-700">
                            <span>{row.label}</span><span className="tabular-nums">{row.value}</span>
                          </div>
                        ))}
                        <div className="flex justify-between border-t border-slate-200 mt-1 pt-2 text-[12.5px] font-bold text-slate-900">
                          <span>Total Taxes &amp; Deductions (B)</span><span className="tabular-nums">{fmtInr(active.totalDeductions)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-7 rounded bg-slate-100 px-5 py-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-slate-700">Net Salary Payable ( {hasDeductions ? "A − B" : "A"} )</span>
                      <span className="text-[14px] font-bold text-slate-900 tabular-nums">{fmtInr(netPayable(active))}</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-[13px] text-slate-700">Net Salary in words</span>
                      <span className="text-[13px] font-semibold text-slate-900">{amountInWords(netPayable(active))}</span>
                    </div>
                  </div>

                  <p className="mt-4 text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-800">**Note :</span> All amounts displayed in this payslip are in <span className="font-semibold text-slate-800">INR</span>
                  </p>
                  <p className="mt-2 text-[10.5px] text-slate-400 italic">
                    * This is computer generated statement, does not require signature.
                  </p>
                </div>
              </div>
            </>
            )
          ) : (
            <div className="flex min-h-[280px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white px-6 py-10 text-center shadow-[0_1px_3px_rgba(15,23,42,0.03)]">
              <div>
                <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-[13px] font-medium text-slate-600">No payslip selected</p>
                <p className="mt-1 text-[12px] text-slate-400">
                  Pick a month from the list on the left to preview the payslip.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function PayslipField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</p>
      <p className="mt-1.5 text-[12.5px] font-medium text-slate-800">{value}</p>
    </div>
  );
}

// One row inside the expanded Salary Revision panel — title (bonus type),
// fixed/percentage marker (always Fixed for now since the data model only
// stores absolute amounts), Paid/Due status, amount, due date, and
// optional note. Mirrors the Keka-style screenshot the user provided.
function BonusDetailRow({ bonus }: { bonus: BonusRow }) {
  const title = (() => {
    if (!bonus.bonusType || bonus.bonusType === "other") return "Bonus";
    const t = bonus.bonusType.replace(/_/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
  })();
  const status = bonus.paymentStatus === "paid_past" ? "Paid" : "Due";
  const due = new Date(bonus.effectiveDate).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });

  return (
    <div className="bg-white px-5 py-4 border-t border-slate-100">
      <div className="grid grid-cols-12 items-start gap-4">
        <p className="col-span-3 text-[13px] font-semibold text-slate-800">{title}</p>
        <div className="col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Type</p>
          <p className="mt-1 text-[12.5px] text-slate-700">Fixed</p>
        </div>
        <div className="col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Status</p>
          <p className="mt-1 text-[12.5px] text-slate-700">{status}</p>
        </div>
        <div className="col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Amount</p>
          <p className="mt-1 text-[12.5px] text-slate-700">INR {new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(parseFloat(bonus.amount || "0"))}</p>
        </div>
        <div className="col-span-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Due</p>
          <p className="mt-1 text-[12.5px] text-slate-700">{due}</p>
        </div>
      </div>
      {bonus.reason && (
        <p className="mt-3 text-[12px] text-slate-600">
          <span className="font-semibold text-slate-800">Note:</span> {bonus.reason}
        </p>
      )}
      {bonus.attachmentName && (
        <a
          href={`/api/hr/payroll/bonus/${bonus.id}/file`}
          className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#3b82f6] hover:text-[#2563eb] hover:underline"
        >
          <Paperclip size={12} />
          {bonus.attachmentName}
        </a>
      )}
    </div>
  );
}

// Friendly labels for adhoc payment types on the payslip. "Reimbursement" /
// "Travel" mirror the Pay Register's "Business Expense Reimbursement" column;
// anything else is shown as its stored type, de-snaked and title-cased.
function adhocLabel(type: string): string {
  const k = (type || "").toLowerCase();
  if (k === "reimbursement") return "Business Expense Reimbursement";
  if (k === "travel")        return "Travel Reimbursement";
  if (!type)                 return "Other";
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderEarnings(p: any, structure: any, bonuses: BonusRow[] = []): { label: string; value: string }[] {
  const gross = parseFloat(p.grossEarnings || 0);
  // The bonus amount actually baked into gross (from payroll). Adhoc payment
  // line items (reimbursements / travel / arrears) are also baked into gross
  // but itemised separately below — so base salary is gross minus both, and
  // Total Earnings always reconciles to gross.
  const bonusInGross = parseFloat(p.bonus || 0);
  const adhocItems: { type: string; amount: number }[] = Array.isArray(p?.adhocPayments) ? p.adhocPayments : [];
  const adhocTotal = adhocItems.reduce((s, a) => s + parseFloat(String(a.amount) || "0"), 0);
  const baseEarnings = Math.max(0, gross - bonusInGross - adhocTotal);
  const rows: { label: string; value: string }[] = [];

  // Per-payslip type wins over the (current) structure type, so a month that
  // was paid as an intern stipend stays a single Stipend line even after the
  // employee is converted to a regular structure.
  // Prorate the monthly components by the paid-days factor so each row reflects
  // the days actually paid this month — matching how payroll scales gross. At
  // full attendance the factor is 1 and the rows equal the full monthly split;
  // with loss of pay they shrink so the breakdown still sums to baseEarnings.
  const wd = parseFloat(p?.workingDays || 0) || 0;
  const lop = parseFloat(p?.lopDays || 0) || 0;
  const lopFactor = wd > 0 ? Math.max(0, Math.min(1, (wd - lop) / wd)) : 1;

  const effType = p?.salaryType ?? structure?.salaryType;
  const isRegular = !!structure && effType !== "intern";

  // Full & Final (exit) payslip: it carries an "ff_settlement" adhoc that lumps
  // the exit-month worked-days salary + leave encashment together. Decompose it
  // EXACTLY like the Exit Statement (exit-settlement-calc.ts) — prorate the
  // salary components by the WORKED days (presentDays, since exit months set
  // presentDays to days worked up to the last working day with lopDays left at
  // 0) and show Leave Encashment on its own line — so the payslip earnings
  // match the F&F letter instead of showing one opaque "Ff Settlement" lump.
  const isFfType = (t: any) => /ff.?settlement|full.?and.?final|f\s*&\s*f/i.test(String(t ?? ""));
  const hasFfSettlement = adhocItems.some((a) => isFfType(a.type));
  const isFnF = isRegular && hasFfSettlement;

  const componentsMonthly = isRegular
    ? (
        (parseFloat(structure.basic               || 0) || 0)
        + (parseFloat(structure.hra               || 0) || 0)
        + (parseFloat(structure.dearnessAllowance || 0) || 0)
        + (parseFloat(structure.conveyanceAllowance || 0) || 0)
        + (parseFloat(structure.medicalAllowance  || 0) || 0)
        + (parseFloat(structure.specialAllowance  || 0) || 0)
        + (parseFloat(structure.pfEmployee        || 0) || 0)
      ) / 12
    : 0;

  let leaveEncashment = 0;

  if (!isRegular) {
    if (hasFfSettlement) {
      // Intern F&F: gross bundles the stipend + advance salary into the
      // ff_settlement lump. Show the stipend (the residual after the advance /
      // other adhocs, which stay itemised below) instead of the opaque lump.
      const adhocExFf = adhocItems.filter((a) => !isFfType(a.type)).reduce((s, a) => s + (parseFloat(String(a.amount)) || 0), 0);
      const stipend = Math.max(0, gross - bonusInGross - adhocExFf);
      if (stipend > 0) rows.push({ label: "Monthly Stipend", value: fmtInr(stipend) });
    } else {
      rows.push({ label: "Monthly Stipend", value: fmtInr(baseEarnings) });
    }
  } else if (isFnF) {
    const worked  = wd > 0 ? Math.max(0, Math.min(1, (parseFloat(p?.presentDays || 0) || 0) / wd)) : lopFactor;
    const basic   = round2((parseFloat(structure.basic               || 0) / 12) * worked);
    const hra     = round2((parseFloat(structure.hra                 || 0) / 12) * worked);
    const da      = round2((parseFloat(structure.dearnessAllowance   || 0) / 12) * worked);
    const conv    = round2((parseFloat(structure.conveyanceAllowance || 0) / 12) * worked);
    const medical = round2((parseFloat(structure.medicalAllowance    || 0) / 12) * worked);
    const regularWorked = componentsMonthly * worked;
    // Special absorbs the rounding residual of the worked salary; Leave
    // Encashment then absorbs the final residual so the rows sum EXACTLY to
    // Total Earnings (A).
    const special = round2(Math.max(0, regularWorked - (basic + hra + da + conv + medical)));
    const adhocExFf = adhocItems.filter((a) => !isFfType(a.type)).reduce((s, a) => s + (parseFloat(String(a.amount)) || 0), 0);
    leaveEncashment = round2(Math.max(0, gross - bonusInGross - adhocExFf - (basic + hra + da + conv + medical) - special));
    // Row order mirrors the Exit Statement letter (letter-render EarningsRows)
    // so the F&F payslip and the F&F letter list earnings identically.
    if (basic)   rows.push({ label: "Basic Salary",         value: fmtInr(basic)   });
    if (hra)     rows.push({ label: "House Rent Allowance", value: fmtInr(hra)     });
    if (medical) rows.push({ label: "Medical Allowance",    value: fmtInr(medical) });
    if (conv)    rows.push({ label: "Conveyance Allowance", value: fmtInr(conv)    });
    if (special) rows.push({ label: "Special Allowance",    value: fmtInr(special) });
    if (da)      rows.push({ label: "Dearness Allowance",   value: fmtInr(da)      });
  } else {
    // Non-exit month: prorate the fixed components by paid days; Special
    // Allowance absorbs whatever balances to baseEarnings. We do NOT infer
    // "Leave Encashment" here — that would mislabel any legitimate surplus in
    // gross (new-joiner joining-month arrears, a structure entered AFTER the
    // first payslip, a mid-cycle revision) as encashment. Leave encashment is
    // itemised only on F&F payslips (the isFnF branch above).
    let basic   = (parseFloat(structure.basic               || 0) / 12) * lopFactor;
    let hra     = (parseFloat(structure.hra                 || 0) / 12) * lopFactor;
    let da      = (parseFloat(structure.dearnessAllowance   || 0) / 12) * lopFactor;
    let conv    = (parseFloat(structure.conveyanceAllowance || 0) / 12) * lopFactor;
    let medical = (parseFloat(structure.medicalAllowance    || 0) / 12) * lopFactor;
    let fixed   = basic + hra + da + conv + medical;
    // If the structure's fixed components exceed what was actually paid (gross
    // set below the structure — new-joiner joining-month proration, a later
    // structure revision, a partial / held month), scale them down proportionally
    // so the rows never overshoot Total Earnings. Otherwise Special absorbs the
    // surplus (gross ≥ fixed).
    if (fixed > baseEarnings && fixed > 0) {
      const scale = baseEarnings / fixed;
      basic *= scale; hra *= scale; da *= scale; conv *= scale; medical *= scale;
    }
    // Round each component to paise, then let Special = baseEarnings − Σ(rounded
    // components). This makes the DISPLAYED rows sum EXACTLY to Total Earnings
    // (A) instead of drifting a paisa from independent per-row rounding.
    basic = round2(basic); hra = round2(hra); da = round2(da); conv = round2(conv); medical = round2(medical);
    let special = round2(baseEarnings - (basic + hra + da + conv + medical));
    // If rounding the scaled components overshot baseEarnings (special < 0), trim
    // the penny off Basic so the rows still sum exactly to Total Earnings (A).
    if (special < 0) { basic = round2(basic + special); special = 0; }
    if (basic)   rows.push({ label: "Basic Salary",         value: fmtInr(basic)   });
    if (hra)     rows.push({ label: "House Rent Allowance", value: fmtInr(hra)     });
    if (da)      rows.push({ label: "Dearness Allowance",   value: fmtInr(da)      });
    if (conv)    rows.push({ label: "Conveyance Allowance", value: fmtInr(conv)    });
    if (medical) rows.push({ label: "Medical Allowance",    value: fmtInr(medical) });
    if (special) rows.push({ label: "Special Allowance",    value: fmtInr(special) });
    if (rows.length === 0) rows.push({ label: "Monthly Stipend", value: fmtInr(baseEarnings) });
  }
  if (leaveEncashment > 0) rows.push({ label: "Leave Encashment", value: fmtInr(leaveEncashment) });

  // Itemise bonuses by their actual bonusType. Only when the month's bonus
  // rows reconcile with the bonus baked into gross — otherwise fall back to a
  // single "Bonus" line so Total Earnings (A) stays equal to gross.
  const sumMonth = bonuses.reduce((s, b) => s + parseFloat(b.amount || "0"), 0);
  if (bonuses.length && Math.abs(sumMonth - bonusInGross) < 0.5) {
    for (const b of bonuses) rows.push({ label: bonusLabel(b), value: fmtInr(b.amount) });
  } else if (bonusInGross > 0) {
    rows.push({ label: "Bonus", value: fmtInr(bonusInGross) });
  }

  // Itemise adhoc payments (reimbursements / travel / arrears / …) by their
  // type so they show as their own earnings line rather than being silently
  // folded into Special Allowance / Stipend.
  for (const a of adhocItems) {
    const amt = parseFloat(String(a.amount) || "0");
    if (amt === 0) continue;
    if (hasFfSettlement && isFfType(a.type)) continue; // decomposed into components/stipend + encashment above
    rows.push({ label: adhocLabel(a.type), value: fmtInr(amt) });
  }
  return rows;
}
