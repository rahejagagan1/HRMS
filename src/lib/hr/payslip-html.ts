// Server-side payslip HTML — mirrors the in-app payslip (MyPayPanel's
// downloadPayslip) so the emailed PDF matches what the employee sees on
// screen. Kept as a separate, self-contained builder because the client
// component reads its logo from `window` while the server inlines it from
// disk (node:fs), so the two can't share a module. Visual source of truth:
// src/components/hr/my-finances/MyPayPanel.tsx — keep them in sync.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const N = (x: any) => parseFloat(String(x ?? 0)) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmtInr(n: any) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(N(n));
}
function fmtInrWhole(n: any) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(N(n));
}

// Indian-English amount-in-words for the net pay line.
export function amountInWords(amount: number): string {
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

const COMPANY_HEADERS: Record<string, { name: string; address: string[] }> = {
  "NB Media Productions": {
    name: "YT MONEY PRODUCTIONS PRIVATE LIMITED",
    address: ["1ST FLOOR, 209,", "NB MEDIA, MODEL TOWN MAIN ROAD,", "BATHINDA PUNJAB 151001"],
  },
  "YT Labs": {
    name: "YT MONEY PRODUCTIONS PRIVATE LIMITED",
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
    const monthly = (N(structure.basic) + N(structure.hra) + N(structure.dearnessAllowance)
      + N(structure.conveyanceAllowance) + N(structure.medicalAllowance)
      + N(structure.specialAllowance) + N(structure.pfEmployee)) / 12;
    if (monthly > 0) return Math.round(monthly);
  }
  const gross = N(p?.grossEarnings);
  const bonus = N(p?.bonus);
  const adhoc = (Array.isArray(p?.adhocPayments) ? p.adhocPayments : [])
    .reduce((s: number, a: any) => s + N(a.amount), 0);
  const wd = N(p?.workingDays);
  const lop = N(p?.lopDays);
  const lopFactor = wd > 0 ? Math.max(0, (wd - lop) / wd) : 1;
  const base = Math.max(0, gross - bonus - adhoc);
  if (base > 0 && lopFactor > 0) return Math.round(base / lopFactor);
  return Math.round(N(structure?.ctc) / 12);
}

type BonusRow = { bonusType: string | null; amount: any; effectiveDate: string | Date };
function bonusesForPayslip(p: any, all: BonusRow[]): BonusRow[] {
  return (all || []).filter((b) => {
    const d = new Date(b.effectiveDate);
    return !Number.isNaN(d.getTime()) && d.getUTCFullYear() === p.year && d.getUTCMonth() === p.month;
  });
}
function bonusLabel(b: BonusRow): string {
  return (b.bonusType && String(b.bonusType).trim()) ? String(b.bonusType).trim() : "Bonus";
}

// Friendly labels for adhoc payment types. Mirrors MyPayPanel.adhocLabel.
function adhocLabel(type: string): string {
  const k = (type || "").toLowerCase();
  if (k === "reimbursement") return "Business Expense Reimbursement";
  if (k === "travel")        return "Travel Reimbursement";
  if (!type)                 return "Other";
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
  return hasFf ? N(p?.grossEarnings) - N(p?.totalDeductions) : N(p?.netPay);
}

function deductionRows(p: any): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (N(p.pfEmployee) > 0)      rows.push({ label: "Provident Fund (Employee)", value: fmtInr(p.pfEmployee) });
  if (N(p.tds) > 0)             rows.push({ label: "TDS / Income Tax", value: fmtInr(p.tds) });
  if (N(p.professionalTax) > 0) rows.push({ label: "Professional Tax", value: fmtInr(p.professionalTax) });
  if (N(p.additionalTax) > 0)   rows.push({ label: "Professional Tax", value: fmtInr(p.additionalTax) });
  // Residual — ESI / LWF / adhoc recoveries (e.g. salary-advance recovery) are
  // baked into totalDeductions but aren't stored as their own payslip fields.
  // Surface them so the deductions column sums to Total (B).
  const itemised = N(p.pfEmployee) + N(p.tds) + N(p.professionalTax) + N(p.additionalTax);
  const other = N(p.totalDeductions) - itemised;
  if (other >= 0.5) rows.push({ label: "Other Deductions", value: fmtInr(other) });
  return rows;
}

function renderEarnings(p: any, structure: any, bonuses: BonusRow[] = []): { label: string; value: string }[] {
  const gross = N(p.grossEarnings);
  const bonusInGross = N(p.bonus);
  const adhocItems: { type: string; amount: any }[] = Array.isArray(p?.adhocPayments) ? p.adhocPayments : [];
  const adhocTotal = adhocItems.reduce((s, a) => s + N(a.amount), 0);
  const baseEarnings = Math.max(0, gross - bonusInGross - adhocTotal);
  const rows: { label: string; value: string }[] = [];

  // Prorate the monthly components by the paid-days factor so each row reflects
  // the days actually paid this month — matching how payroll scales gross. At
  // full attendance the factor is 1 and the rows equal the full monthly split;
  // with loss of pay they shrink so the breakdown still sums to baseEarnings.
  const wd = N(p?.workingDays);
  const lop = N(p?.lopDays);
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
    ? (N(structure.basic) + N(structure.hra) + N(structure.dearnessAllowance)
       + N(structure.conveyanceAllowance) + N(structure.medicalAllowance)
       + N(structure.specialAllowance) + N(structure.pfEmployee)) / 12
    : 0;

  let leaveEncashment = 0;

  if (!isRegular) {
    if (hasFfSettlement) {
      // Intern F&F: gross bundles the stipend + advance salary into the
      // ff_settlement lump. Show the stipend (the residual after the advance /
      // other adhocs, which stay itemised below) instead of the opaque lump.
      const adhocExFf = adhocItems.filter((a) => !isFfType(a.type)).reduce((s, a) => s + N(a.amount), 0);
      const stipend = Math.max(0, gross - bonusInGross - adhocExFf);
      if (stipend > 0) rows.push({ label: "Monthly Stipend", value: fmtInr(stipend) });
    } else {
      rows.push({ label: "Monthly Stipend", value: fmtInr(baseEarnings) });
    }
  } else if (isFnF) {
    const worked  = wd > 0 ? Math.max(0, Math.min(1, N(p.presentDays) / wd)) : lopFactor;
    const basic   = round2((N(structure.basic) / 12) * worked);
    const hra     = round2((N(structure.hra) / 12) * worked);
    const da      = round2((N(structure.dearnessAllowance) / 12) * worked);
    const conv    = round2((N(structure.conveyanceAllowance) / 12) * worked);
    const medical = round2((N(structure.medicalAllowance) / 12) * worked);
    const regularWorked = componentsMonthly * worked;
    // Special absorbs the rounding residual of the worked salary; Leave
    // Encashment then absorbs the final residual so the rows sum EXACTLY to
    // Total Earnings (A).
    const special = round2(Math.max(0, regularWorked - (basic + hra + da + conv + medical)));
    const adhocExFf = adhocItems.filter((a) => !isFfType(a.type)).reduce((s, a) => s + N(a.amount), 0);
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
    let basic   = (N(structure.basic) / 12) * lopFactor;
    let hra     = (N(structure.hra) / 12) * lopFactor;
    let da      = (N(structure.dearnessAllowance) / 12) * lopFactor;
    let conv    = (N(structure.conveyanceAllowance) / 12) * lopFactor;
    let medical = (N(structure.medicalAllowance) / 12) * lopFactor;
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

  const sumMonth = bonuses.reduce((s, b) => s + N(b.amount), 0);
  if (bonuses.length && Math.abs(sumMonth - bonusInGross) < 0.5) {
    for (const b of bonuses) rows.push({ label: bonusLabel(b), value: fmtInr(b.amount) });
  } else if (bonusInGross > 0) {
    rows.push({ label: "Bonus", value: fmtInr(bonusInGross) });
  }

  for (const a of adhocItems) {
    const amt = N(a.amount);
    if (amt === 0) continue;
    if (hasFfSettlement && isFfType(a.type)) continue; // decomposed into components/stipend + encashment above
    rows.push({ label: adhocLabel(a.type), value: fmtInr(amt) });
  }
  return rows;
}

// Inline the logo as a data URI so the PDF doesn't depend on a fetchable URL.
let logoDataUri: string | null | undefined;
function getLogoDataUri(): string {
  if (logoDataUri === undefined) {
    try {
      const p = resolve(process.cwd(), "public", "logo.png");
      logoDataUri = existsSync(p) ? `data:image/png;base64,${readFileSync(p).toString("base64")}` : null;
    } catch { logoDataUri = null; }
  }
  return logoDataUri || "";
}

const dmy = (d?: any) => d
  ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
  : "";

export function buildPayslipHtml(p: any, structure: any, profile?: any, bonuses: BonusRow[] = []): string {
  const co = companyHeader(profile?.legalEntity);
  const period = `${MONTHS_FULL[p.month].toUpperCase()} ${p.year}`;
  const name = (profile?.firstName || profile?.lastName)
    ? [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")
    : (p.user?.name || "—");
  const loc = profile?.jobLocation || profile?.city || "—";
  const days = (N(p.workingDays) - N(p.lopDays));
  const logoUrl = getLogoDataUri();

  const earnRows = renderEarnings(p, structure, bonusesForPayslip(p, bonuses))
    .map((r) => `<div class="line"><span>${r.label}</span><span class="amt">${r.value}</span></div>`).join("");

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
  const edHtml = `<div class="ed">${earningsCol}${hasDed ? deductionsCol : ""}</div>`;
  const netLabel = hasDed ? "A - B" : "A";

  const cell = (label: string, value: any) =>
    `<div class="cell"><div class="lbl">${label}</div><div class="val">${value || "&mdash;"}</div></div>`;

  return `<!DOCTYPE html>
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
  .net{background:#f3f4f6;margin-top:26px;padding:16px 20px;border-radius:4px}
  .net .row{display:flex;justify-content:space-between;align-items:center;padding:5px 0}
  .net .k{font-size:13px;color:#374151}
  .net .v{font-size:14px;font-weight:700;color:#111827}
  .note{font-size:11px;color:#4b5563;margin-top:18px}
  .note b{color:#111827}
  .foot{font-size:10.5px;color:#9ca3af;font-style:italic;margin-top:14px}
  @page{size:A4;margin:0}
</style></head><body><div class="sheet">
  <div class="top">
    <div>
      <div class="ptitle"><b>PAYSLIP</b> ${period}</div>
      <div class="company"><span class="nm">${co.name}</span><br/>${co.address.join("<br/>")}</div>
    </div>
    ${logoUrl ? `<img class="logo" src="${logoUrl}" alt="logo"/>` : ""}
  </div>

  <div class="empname">${name.toUpperCase()}</div>
  <hr/>
  <div class="grid">
    ${cell("Employee Number", profile?.employeeId)}
    ${cell("Date Joined", dmy(profile?.joiningDate))}
    ${cell("Department", profile?.department)}
    ${cell("Designation", profile?.designation)}
    ${cell("Date Of Birth", dmy(profile?.dateOfBirth))}
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
}
