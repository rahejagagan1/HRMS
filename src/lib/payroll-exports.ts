// Shared loader + helpers for the 4 post-lock payroll exports:
//   1. BatchPayment_Monthly_Statement  (per-bank transfer file)
//   2. PT Monthly Statement            (Professional Tax filing)
//   3. EmployerECR                     (EPFO Electronic Challan-cum-Return)
//   4. Keka PayRegister                (master pay register with components)
//
// Each format mirrors the customer's existing Keka exports byte-for-byte
// (same headers, casing, column order, even the "Aganist" typo). Don't
// add columns, don't reformat dates, don't insert totals rows that aren't
// in the source — the bank / EPFO / accountants downstream parse these by
// position and will reject anything different.

import prisma from "@/lib/prisma";
import { decryptPII } from "@/lib/pii-crypto";
import { getMonthSalary, type SalaryComponents } from "@/lib/hr/salary-periods";

// Standard EPFO statutory ceilings — used to compute EPF/EPS wages.
export const EPF_CEILING = 15_000;       // monthly basic+DA cap for EPF
export const EDLI_CEILING = 15_000;      // EDLI wages always at ceiling

// Map a 0-indexed month to short / "Mon-YYYY" / "Mon YYYY" strings.
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"] as const;
export function monShort(month0: number): string { return MONTH_SHORT[month0]; }
export function monYearDash(month0: number, year: number): string { return `${MONTH_SHORT[month0]}-${year}`; }
export function monYearSpace(month0: number, year: number): string { return `${MONTH_SHORT[month0]} ${year}`; }
export function monYearUnderscore(month0: number, year: number): string { return `${MONTH_SHORT[month0]}_${year}`; }

// Strict number coerce (Prisma returns Decimal as a string-like).
export function num(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

// Each row carries everything any of the 4 files might need so we only
// load it once per export. Bank / IFSC / UAN come back already decrypted.
export type ExportRow = {
  userId: number;
  name: string;
  employeeId: string | null;
  department: string | null;
  designation: string | null;
  employmentType: string | null;
  joiningDate: Date | null;
  // Brand / entity — used to split the exports per brand (NB Media vs YT Labs).
  businessUnit: string | null;
  legalEntity: string | null;
  // Bank
  bankName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  // PF
  uanNumber: string | null;
  pfEligible: boolean;
  // Salary structure (annual amounts; divide by 12 for monthly)
  salaryType: string;
  ctcAnnual: number;
  basicAnnual: number;
  hraAnnual: number;
  daAnnual: number;
  conveyanceAnnual: number;
  medicalAnnual: number;
  specialAnnual: number;
  pfEmployeeAnnual: number;
  // Payslip (this cycle)
  payslipId: number;
  workingDays: number;
  presentDays: number;
  lopDays: number;
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  bonus: number;
  pfEmployee: number;
  professionalTax: number;
  additionalTax: number;
  tds: number;
  status: string;
  // Leave encashment paid this cycle — non-zero only for employees whose F&F
  // month is this run month. Computed the same way payroll/generate does:
  // (basicAnnual + daAnnual)/12/30 × carry-over days. Baked into grossEarnings
  // but NOT stored as an adhoc, so the exports recompute it here.
  leaveEncashment: number;
  // Blended MONTHLY (pre-LOP) component breakdown when this employee had a
  // mid-month salary revision this cycle — old-rate days + new-rate days summed
  // per component (intern days land in `stipend`). null when there's no split,
  // in which case the breakdown is derived from the current structure as before.
  splitComponents: SalaryComponents | null;
  // Adhoc line items for this cycle, summed by kind+typeLabel
  adhocPayByType: Record<string, number>;
  adhocDedByType: Record<string, number>;
};

// Single source-of-truth loader for the 4 export endpoints. Pulls
// everything in 2 queries (payslips + adhoc) and decrypts PII inline.
// Throws if the run is missing.
export async function loadExportRows(runId: number): Promise<{
  run: { id: number; month: number; year: number; status: string; brandStatus: Record<string, any> | null };
  rows: ExportRow[];
}> {
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: { id: true, month: true, year: true, status: true, brandStatus: true },
  });
  if (!run) throw new Error(`PayrollRun ${runId} not found`);

  // Hydrate the payslip with user + profile + structure. EmployeeProfile
  // fields are encrypted on disk; we decrypt on the way out.
  const payslips = await prisma.payslip.findMany({
    where: { payrollRunId: runId },
    include: {
      user: { select: { id: true, name: true } },
      salaryStructure: true,
    },
  });

  // Pull EmployeeProfile in a second query (Prisma include from Payslip
  // doesn't reach through to it) and key by userId for the merge below.
  const userIds = payslips.map(p => p.userId);
  const profiles = await prisma.employeeProfile.findMany({
    where: { userId: { in: userIds } },
    select: {
      userId: true,
      employeeId: true,
      department: true,
      designation: true,
      employmentType: true,
      joiningDate: true,
      bankName: true,
      bankAccountNumber: true,
      bankIfsc: true,
      uanNumber: true,
      businessUnit: true,
      legalEntity: true,
    },
  });
  const profileByUserId = new Map(profiles.map(p => [p.userId, p]));

  // AdhocLineItem rows for the cycle — used by PayRegister to populate
  // Referral Bonus / Business Expense Reimbursement / etc. Bucket by
  // userId then by the line's free-text `type` so the per-column lookup
  // is a hash lookup.
  const adhocRows = await prisma.$queryRawUnsafe<{
    userId: number; kind: string; type: string | null; amount: string;
  }[]>(
    `SELECT "userId", kind, type, SUM(amount)::text AS amount
       FROM "AdhocLineItem"
      WHERE month = $1 AND year = $2
      GROUP BY "userId", kind, type`,
    run.month, run.year,
  );
  const payByUser  = new Map<number, Record<string, number>>();
  const dedByUser  = new Map<number, Record<string, number>>();
  for (const a of adhocRows) {
    const target = a.kind === "deduction" ? dedByUser : payByUser;
    const bucket = target.get(a.userId) ?? {};
    bucket[a.type || "Other"] = (bucket[a.type || "Other"] ?? 0) + num(a.amount);
    target.set(a.userId, bucket);
  }

  // Leave encashment inputs — mirrors payroll/generate. An employee's F&F is
  // "this month" when their last working day falls inside the run month; only
  // then is unused Carry Over Leave encashed. Kept OUT of adhoc so the base
  // breakdown and the exports agree with the payslip's inline computation.
  const firstDay = new Date(Date.UTC(run.year, run.month, 1));
  const lastDay  = new Date(Date.UTC(run.year, run.month + 1, 0));
  const exitRows = await prisma.$queryRawUnsafe<{ userId: number; lastWorkingDay: Date }[]>(
    `SELECT "userId", "lastWorkingDay" FROM "EmployeeExit"
      WHERE "lastWorkingDay" IS NOT NULL AND "userId" = ANY($1::int[])`,
    userIds,
  );
  const lwdByUser = new Map<number, Date>(exitRows.map(r => [r.userId, new Date(r.lastWorkingDay)]));
  const carryByUser = new Map<number, number>();
  try {
    const carryType = await prisma.leaveType.findFirst({
      where: { name: { contains: "Carry Over", mode: "insensitive" } },
      select: { id: true },
    });
    if (carryType && userIds.length) {
      const balances = await prisma.leaveBalance.findMany({
        where: { leaveTypeId: carryType.id, userId: { in: userIds } },
        select: { userId: true, totalDays: true, usedDays: true, pendingDays: true },
      });
      for (const b of balances) {
        const days = Math.max(0, num(b.totalDays) - num(b.usedDays) - num(b.pendingDays));
        if (days > 0) carryByUser.set(b.userId, (carryByUser.get(b.userId) ?? 0) + days);
      }
    }
  } catch { /* no carry-over leave type — no encashment */ }

  // Mid-month salary splits — only for employees with a superseded structure.
  // Their component breakdown blends the old-rate and new-rate days (see
  // lib/hr/salary-periods); everyone else derives components as before.
  const splitByUser = new Map<number, SalaryComponents>();
  try {
    const histUserIds = new Set(
      (await prisma.salaryStructureHistory.findMany({
        where: { userId: { in: userIds } }, select: { userId: true },
      })).map(h => h.userId),
    );
    for (const uid of histUserIds) {
      const ms = await getMonthSalary(uid, run.year, run.month);
      if (ms?.hasSplit) splitByUser.set(uid, ms.components);
    }
  } catch { /* history table absent (pre-migration) — no splits */ }

  const rows: ExportRow[] = payslips.map(p => {
    const prof = profileByUserId.get(p.userId);
    const s = p.salaryStructure;
    return {
      userId: p.userId,
      name: p.user.name,
      employeeId: prof?.employeeId ?? null,
      department: prof?.department ?? null,
      designation: prof?.designation ?? null,
      employmentType: prof?.employmentType ?? null,
      joiningDate: prof?.joiningDate ?? null,
      businessUnit: prof?.businessUnit ?? null,
      legalEntity: prof?.legalEntity ?? null,
      bankName: prof?.bankName ?? null,
      // Bank account / IFSC / UAN are encrypted at rest. Decrypt for the
      // file — finance / banks / EPFO need the cleartext values.
      bankAccountNumber: prof?.bankAccountNumber ? decryptPII(prof.bankAccountNumber) : null,
      bankIfsc: prof?.bankIfsc ? decryptPII(prof.bankIfsc) : null,
      uanNumber: prof?.uanNumber ? decryptPII(prof.uanNumber) : null,
      pfEligible: s.pfEligible,
      // Per-payslip snapshot wins over the (mutable) structure type.
      salaryType: (p as any).salaryType ?? s.salaryType,
      ctcAnnual: num(s.ctc),
      basicAnnual: num(s.basic),
      hraAnnual: num(s.hra),
      daAnnual: num(s.dearnessAllowance),
      conveyanceAnnual: num(s.conveyanceAllowance),
      medicalAnnual: num(s.medicalAllowance),
      specialAnnual: num(s.specialAllowance),
      pfEmployeeAnnual: num(s.pfEmployee),
      payslipId: p.id,
      workingDays: num(p.workingDays),
      presentDays: num(p.presentDays),
      lopDays: num(p.lopDays),
      grossEarnings: num(p.grossEarnings),
      totalDeductions: num(p.totalDeductions),
      netPay: num(p.netPay),
      bonus: num(p.bonus),
      pfEmployee: num(p.pfEmployee),
      // Professional Tax = the structure's PT PLUS the flat monthly PT the
      // engine stores as `additionalTax` (₹200 for non-interns, ₹0 for
      // interns). Folded here so EVERY export sheet reports the true PT via
      // `professionalTax` alone; `additionalTax` is now always 0 (kept only
      // for shape/back-compat). Without this the PT Statement filed ₹0.
      professionalTax: num(p.professionalTax) + num((p as any).additionalTax),
      additionalTax: 0,
      tds: num(p.tds),
      status: p.status,
      leaveEncashment: (() => {
        const lwd = lwdByUser.get(p.userId);
        const isFnFMonth = !!lwd && lwd.getTime() >= firstDay.getTime() && lwd.getTime() <= lastDay.getTime();
        const carryDays = isFnFMonth ? (carryByUser.get(p.userId) ?? 0) : 0;
        return carryDays > 0 ? ((num(s.basic) + num(s.dearnessAllowance)) / 12 / 30) * carryDays : 0;
      })(),
      splitComponents: splitByUser.get(p.userId) ?? null,
      adhocPayByType: payByUser.get(p.userId) ?? {},
      adhocDedByType: dedByUser.get(p.userId) ?? {},
    };
  });

  return { run: { ...run, brandStatus: (run.brandStatus as Record<string, any> | null) ?? null }, rows };
}

// ── Frozen-anchored monthly salary breakdown ─────────────────────────────
// Once a run is LOCKED, the payslip's stored gross / net / PF are the source
// of truth. SalaryStructure can still be edited afterwards (e.g. a later
// raise effective next month), and reading it live would leak those new
// figures into a locked month's exports. So we use the CURRENT structure
// only for the *ratio* between components and scale it so the breakdown sums
// to the salary actually paid this cycle (frozen gross − bonus − adhoc pay).
// scale == 1 (byte-identical output) for anyone whose structure was not
// touched after the run was generated.
export function frozenMonthlyComponents(r: ExportRow) {
  const wd = r.workingDays || 30;
  const lopFactor = wd > 0 ? Math.max(0, (wd - r.lopDays) / wd) : 1;

  // Mid-month revision: use the blended per-component split directly (it already
  // sums to the base gross for the cycle), applying only the LOP factor. This
  // shows, e.g., an intern→regular employee's regular days in the salary columns
  // and their intern days in Stipend.
  if (r.splitComponents) {
    const c = r.splitComponents;
    return {
      lopFactor,
      basic: c.basic * lopFactor, hra: c.hra * lopFactor, medical: c.medical * lopFactor,
      conv: c.conv * lopFactor, da: c.da * lopFactor, special: c.special * lopFactor,
      stipend: c.stipend * lopFactor,
    };
  }

  const m = (annual: number) => (annual / 12) * lopFactor;
  const isIntern = r.salaryType === "intern";

  let basic   = isIntern ? 0 : m(r.basicAnnual);
  let hra     = isIntern ? 0 : m(r.hraAnnual);
  let medical = isIntern ? 0 : m(r.medicalAnnual);
  let conv    = isIntern ? 0 : m(r.conveyanceAnnual);
  let da      = isIntern ? 0 : m(r.daAnnual);
  // Special Allowance absorbs the employee PF so gross includes it.
  let special = isIntern ? 0 : m(r.specialAnnual) + m(r.pfEmployeeAnnual);

  const computedSalary = basic + hra + medical + conv + da + special;
  // adhocPay EXCLUDES the legacy "ff_settlement" lump — payroll/generate does
  // not add it to gross (the component breakdown IS the F&F), so counting it
  // here would wrongly shrink the base. Advance Salary / Reimbursement / etc.
  // stay, as they're genuine gross additions shown in their own columns.
  const adhocPay = Object.entries(r.adhocPayByType)
    .reduce((s, [type, v]) => (type === "ff_settlement" ? s : s + v), 0);
  // Leave encashment is also a gross addition with its own column, so subtract
  // it too — otherwise the base components inflate to absorb it.
  const targetSalary = Math.max(0, r.grossEarnings - r.bonus - adhocPay - r.leaveEncashment);
  const scale = computedSalary > 1 ? targetSalary / computedSalary : 1;
  if (Math.abs(scale - 1) > 1e-9) {
    basic *= scale; hra *= scale; medical *= scale; conv *= scale; da *= scale; special *= scale;
  }
  // Interns: the whole monthly salary is a stipend (basic / HRA stay zero).
  // Exclude bonus + adhoc payments + leave encashment so they remain their own
  // columns and the breakdown still sums to the frozen gross.
  const stipend = isIntern ? Math.max(0, r.grossEarnings - r.bonus - adhocPay - r.leaveEncashment) : 0;
  return { lopFactor, basic, hra, medical, conv, da, special, stipend };
}

// Excel sheet names cap at 31 chars; truncate without ellipsis since the
// cap is hard. Banks like "kotak mahindra bank limited" (27 chars) fit
// but a long name could go over.
export function safeSheetName(name: string): string {
  // Excel worksheet names can't contain \ / ? * : [ ] and are capped at 31
  // chars. Strip the invalid chars (Keka names occasionally carry a slash)
  // and collapse whitespace so ExcelJS.addWorksheet never throws.
  const cleaned = name.replace(/[\\/?*:[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31).trim();
  return cleaned || "Sheet";
}

// ── Brand split ───────────────────────────────────────────────────────
// Each brand's payroll exports as a separate file with its own legal
// entity. brandOf mirrors the app convention: YT Labs is exact, NB Media
// is everything else (incl. null / legacy) so nobody is silently dropped.
export type PayrollBrand = "NB Media" | "YT Labs";

export function brandOf(businessUnit: string | null | undefined): PayrollBrand {
  return businessUnit === "YT Labs" ? "YT Labs" : "NB Media";
}

// Legal entity / company name printed on each brand's exports.
// NB Media keeps its existing Keka label verbatim (bookkeepers reconcile
// against it). Replace the YT Labs value with its exact registered name.
export const COMPANY_BY_BRAND: Record<PayrollBrand, string> = {
  "NB Media": "YT Money Productions Pvt. Ltd (NB Media)",
  "YT Labs":  "YT Money Productions Pvt. Ltd (YT Labs)",
};

// Short slug used in non-Keka filenames so a YT Labs file never overwrites
// the NB Media one when both are downloaded for the same month.
export const BRAND_SLUG: Record<PayrollBrand, string> = {
  "NB Media": "NB-Media",
  "YT Labs":  "YT-Labs",
};

// Parse + validate the ?brand= query param. null => no filter (all employees,
// the legacy behaviour) so existing links keep working.
export function brandParam(req: Request): PayrollBrand | null {
  const b = new URL(req.url).searchParams.get("brand");
  return b === "NB Media" || b === "YT Labs" ? b : null;
}

export function filterRowsByBrand(rows: ExportRow[], brand: PayrollBrand | null): ExportRow[] {
  return brand ? rows.filter(r => brandOf(r.businessUnit) === brand) : rows;
}

// "Aganist" typo deliberately preserved — Keka's existing exports use
// this misspelling and downstream systems may grep for it.
export const HEADERS_PAY_REGISTER = [
  "Employee Number", "Employee Name", "Job Title", "Date Of Joining",
  "Department", "Worker Type", "Payroll Month", "Payroll Type",
  "Status", "Status Description",
  "Actual Payable days", "Working days", "Loss of Pay Days",
  "Days Payable", "Payable Units", "Remuneration Amount",
  "Basic", "HRA", "Medical Allowance", "Conveyance Allowance",
  "Special Allowance", "Dearness Allowance",
  "Stipend", "Referral Bonus", "Business Expense Reimbursement",
  "Gross(A1)",
  // Advance Salary (A2) + Leave Encashment (A3) are split out AFTER Gross so
  // the three earning buckets are additive: A1 is the regular gross (base +
  // bonus + reimbursement) and NO LONGER includes advance / leave encashment;
  // A2 and A3 carry those. Net Pay = A1 + A2 + A3 − B − C. NOTE: this shifts
  // "PF Employee" onward by two positions vs Keka's source, so downstream
  // parsers keyed on the original column positions for columns 27+ must be
  // updated.
  "Advance Salary(A2)", "Leave Encashment(A3)",
  "PF Employee", "Total Contributions(B)",
  "Professional Tax", "Total Deductions(C)", "Net Pay(A1+A2+A3-B-C)",
  "Cash Advance(D)", "Settlement Aganist Advance(E)",
  "Total Reimbursements(F)", "Total Net Pay(A1+A2+A3-B-C+D+E+F)",
];
