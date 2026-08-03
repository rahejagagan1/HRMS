// Pure Exit Statement settlement math — the SINGLE source of truth for the
// "Provisional Full & Final Settlement" figures. Shared by:
//   • the letter renderer (resolveExitSettlement in letter-render.ts, server)
//   • the template editor's F&F auto-fill (templates/[key]/page.tsx, client)
// so the F&F letter's amount always equals the Exit Statement's Net Payable.
//
// No I/O — just arithmetic on the letter's custom fields. Keep this in lock-
// step with the Exit Statement template's fields.

export type ExitSettlementFields = Record<string, string | number | null | undefined>;

// Strips currency formatting → number (0 when blank/NaN).
function num(v: unknown): number {
  const x = Number(String(v ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(x) ? x : 0;
}
// Undefined when blank (so a manual override of "" falls back to the computed
// value), else the parsed number.
function numOrUndef(v: unknown): number | undefined {
  const raw = String(v ?? "").trim();
  if (!raw) return undefined;
  const x = Number(raw.replace(/[^\d.\-]/g, ""));
  return Number.isFinite(x) ? x : undefined;
}

export type ExitSettlementResult = {
  Basic: number; HRA: number; DearnessAllowance: number; ConveyanceAllowance: number;
  MedicalAllowance: number; SpecialAllowance: number; ProvidentFund: number;
  LeaveEncashmentAmount: number; BonusAmount: number; AdvanceSalaryAmount: number;
  totalEarnings: number; totalDeductions: number; net: number;
};

export function computeExitSettlement(cf: ExitSettlementFields): ExitSettlementResult {
  const annual      = num(cf.AnnualPackage);
  // WorkingDays: BLANK → full month (legacy letters keep rendering as
  // before), but an EXPLICIT 0 → zero days worked in the F&F month, so every
  // prorated component (Basic/HRA/DA/Conv/Medical/Special/PF) collapses to 0
  // and the statement pays only the non-prorated lines (Leave Encashment,
  // Bonus, Advance Salary). Without this, a 0 fell into the blank fallback
  // and printed a FULL month's salary for someone who worked zero days.
  const wdEntered   = numOrUndef(cf.WorkingDays);
  const workingDays = Math.max(0, wdEntered ?? 0);
  const enablePf    = String(cf.EnablePf ?? "false") === "true";
  const monthly     = annual > 0 ? annual / 12 : 0;
  // Pro-ration denominator = the real number of days in the F&F (exit) month
  // (28/29/30/31), matching how the payslip engine prorates (paidDays /
  // daysInMonth). DaysInMonth is auto-filled from the employee's exit month;
  // when absent/invalid we fall back to the legacy 30-day convention so old
  // letters re-render unchanged.
  const dimRaw      = num(cf.DaysInMonth);
  const daysInMonth = dimRaw >= 28 && dimRaw <= 31 ? dimRaw : 30;
  const proRata     = wdEntered === undefined ? 1 : workingDays / daysInMonth; // blank = full month

  // Full-month monetary values per the offer-letter 50/20/10/7.5 split.
  const mBasic = monthly * 0.50;
  const mHRA   = monthly * 0.20;
  const mDA    = monthly * 0.10;
  const mConv  = monthly * 0.075;
  const mMed   = 1250;
  const mPF    = enablePf ? 1800 : 0;
  // PF is a DEDUCTION only — it must NOT reduce the earnings side. If PF were
  // included in mFixed the Special Allowance would shrink by PF, quietly
  // removing PF from gross earnings; PF then getting deducted again would
  // subtract it twice and understate the net. So Special fills the gross
  // WITHOUT PF, keeping total earnings = full gross and PF deducted exactly once.
  const mFixed = mBasic + mHRA + mDA + mConv + mMed;
  // Precise (not rounded) so total earnings = monthly exactly, and the exit
  // statement ties to the paise with the actual payslip (which prorates the
  // stored structure components without rounding). Rounding Special here made
  // the statement ~₹0.50 short of the paid payslip.
  const mSpecial = Math.max(0, monthly - mFixed);

  const calc = {
    Basic:               mBasic   * proRata,
    HRA:                 mHRA     * proRata,
    DearnessAllowance:   mDA      * proRata,
    ConveyanceAllowance: mConv    * proRata,
    MedicalAllowance:    mMed     * proRata,
    ProvidentFund:       mPF      * proRata,
    SpecialAllowance:    mSpecial * proRata,
  };

  // Leave encashment: (Basic + DA) / daysInMonth × days — full-month Basic +
  // DA, NOT pro-rated by WorkingDays. Same per-day denominator as payroll
  // generate's encashment ((basic+da)/12/daysInMonth), so statement == payslip.
  const leDays = num(cf.LeaveEncashmentDays);
  const dailyBasicDa = (mBasic + mDA) / daysInMonth;
  const calcLE = leDays > 0 ? dailyBasicDa * leDays : 0;

  const final = {
    Basic:                 numOrUndef(cf.Basic)                 ?? calc.Basic,
    HRA:                   numOrUndef(cf.HRA)                   ?? calc.HRA,
    MedicalAllowance:      numOrUndef(cf.MedicalAllowance)      ?? calc.MedicalAllowance,
    ConveyanceAllowance:   numOrUndef(cf.ConveyanceAllowance)   ?? calc.ConveyanceAllowance,
    SpecialAllowance:      numOrUndef(cf.SpecialAllowance)      ?? calc.SpecialAllowance,
    DearnessAllowance:     numOrUndef(cf.DearnessAllowance)     ?? calc.DearnessAllowance,
    ProvidentFund:         numOrUndef(cf.ProvidentFund)         ?? calc.ProvidentFund,
    LeaveEncashmentAmount: numOrUndef(cf.LeaveEncashmentAmount) ?? calcLE,
  };

  // Advance Salary already booked for the employee in payroll (adhoc). Added
  // to earnings as-is (the actual rupees paid) — the amount is authoritative
  // from the adhoc entries, not recomputed here.
  const advanceSalary = num(cf.AdvanceSalaryAmount);

  // Bonus payable with the F&F — rupee amount taken as-is (auto-filled from
  // the employee's due bonuses effective in the exit month; HR-editable).
  // Mirrors the payslip, where the engine adds due_future bonuses to gross.
  const bonusAmount = num(cf.BonusAmount);

  const totalEarnings = final.Basic + final.HRA + final.MedicalAllowance +
                        final.ConveyanceAllowance + final.SpecialAllowance +
                        final.DearnessAllowance + final.LeaveEncashmentAmount +
                        bonusAmount + advanceSalary;
  // Interns are paid a flat stipend — no statutory deductions (PT / PF).
  const isIntern = String(cf.SalaryType ?? "").toLowerCase() === "intern";
  const totalDeductions = isIntern ? 0 : (num(cf.ProfessionalTax) + final.ProvidentFund);
  const net = totalEarnings - totalDeductions;

  return { ...final, BonusAmount: bonusAmount, AdvanceSalaryAmount: advanceSalary, totalEarnings, totalDeductions, net };
}
