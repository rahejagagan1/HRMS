// Canonical CTC → salary-component split for a REGULAR employee.
//
// Single source of truth shared by BOTH the onboarding API (/api/users) and the
// HR salary form (components/hr/SalaryStructurePanel). Previously each had its
// own copy and they drifted: the API computed the split off the MONTHLY figure
// (ctc/12) and silently dropped Dearness / Conveyance / Medical on save, so
// employees onboarded through the API got components stored at 1/12 scale with
// three heads left at 0 (e.g. HRM161 Harman Singh). Keeping the math here — and
// importing it in both places — makes that class of drift impossible.
//
// ALL amounts returned are ANNUAL. The payslip divides by 12 at display time.

export const MEDICAL_ALLOWANCE_ANNUAL = 15000;   // ₹15,000 / yr = ₹1,250 / month
export const PF_EMPLOYEE_ANNUAL_FIXED = 21600;   // ₹21,600 / yr = ₹1,800 / month (12% × ₹15k cap)
export const PF_EMPLOYER_ANNUAL_FIXED = 21600;   // matched employer contribution (not part of CTC)

/**
 * Split an annual CTC into the company's fixed component structure:
 *   Basic 50%, HRA 20%, DA 10%, Conveyance 7.5%, Medical fixed,
 *   PF(Employee) fixed when eligible, Special = CTC − (sum of the above).
 *
 * Special floors at 0: for a low CTC the fixed portions can exceed it, in which
 * case Special is clamped rather than stored negative or blocking the save.
 */
export function regularSplit(annualCtc: number, pfEligible: boolean) {
  const basic   = Math.round(annualCtc * 0.50);
  const hra     = Math.round(annualCtc * 0.20);
  const da      = Math.round(annualCtc * 0.10);
  const conv    = Math.round(annualCtc * 0.075);
  const medical = MEDICAL_ALLOWANCE_ANNUAL;
  const pfEmp   = pfEligible ? PF_EMPLOYEE_ANNUAL_FIXED : 0;
  const pfEmpr  = pfEligible ? PF_EMPLOYER_ANNUAL_FIXED : 0;
  const special = Math.max(0, annualCtc - (basic + hra + da + conv + medical + pfEmp));
  return { basic, hra, da, conv, medical, pfEmp, pfEmpr, special };
}
