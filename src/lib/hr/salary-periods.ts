// Mid-month salary proration — the SINGLE source of truth for "what rate(s)
// applied to an employee during a given payroll month".
//
// Background: SalaryStructure holds ONE (current) structure per employee.
// SalaryStructureHistory holds superseded ones with an [effectiveFrom,
// effectiveTo) window. When a revision's effectiveFrom lands mid-month, the
// days before it must be paid at the prior rate and the days on/after at the
// new rate. This module resolves those day-ranges and returns a BLENDED monthly
// figure + component breakdown.
//
// ADDITIVE + backwards-compatible: an employee with no history row covering the
// earlier part of the month falls back to the CURRENT structure for every day,
// so their numbers are byte-identical to the old single-structure behaviour.
// The split only activates when a history row actually covers earlier days.

import prisma from "@/lib/prisma";

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

// A structure snapshot (fields we need for pay math), plus its effective window.
type Struct = {
  salaryType: string;
  ctc: number;
  basic: number; hra: number; da: number; conv: number; medical: number; special: number;
  pfEmployee: number; pfEligible: boolean;
  effFrom: number;              // ms
  effTo: number;                // ms, Infinity for the current structure
};

export type SalaryComponents = {
  basic: number; hra: number; medical: number; conv: number; da: number; special: number; stipend: number;
};

export type MonthSalary = {
  hasSplit: boolean;                 // true when >1 rate period touched the month
  blendedMonthlyEarnings: number;    // Σ (period monthly earnings × periodDays / daysInMonth), pre-LOP
  components: SalaryComponents;      // Σ (period monthly components × periodDays / daysInMonth), pre-LOP
  periods: { startDay: number; endDay: number; days: number; salaryType: string; monthly: number }[];
};

// Monthly earnings for one structure — interns earn a flat stipend (= CTC/12),
// regular employees earn the sum of their stored components /12 (PF included,
// mirroring payroll/generate).
function monthlyEarningsOf(s: Struct): number {
  if (s.salaryType === "intern") return s.ctc / 12;
  return (s.basic + s.hra + s.da + s.conv + s.medical + s.special + s.pfEmployee) / 12;
}

// Monthly component breakdown for one structure. Interns → everything in
// `stipend`; regular → the stored components /12 (special absorbs PF so the row
// sums to monthly earnings, matching frozenMonthlyComponents).
function componentsOf(s: Struct): SalaryComponents {
  if (s.salaryType === "intern") {
    return { basic: 0, hra: 0, medical: 0, conv: 0, da: 0, special: 0, stipend: s.ctc / 12 };
  }
  return {
    basic: s.basic / 12,
    hra: s.hra / 12,
    medical: s.medical / 12,
    conv: s.conv / 12,
    da: s.da / 12,
    special: s.special / 12 + s.pfEmployee / 12,   // special absorbs employee PF
    stipend: 0,
  };
}

/** Pick the salary-structure snapshot that was EFFECTIVE for a payroll month —
 *  the current structure if it was already in force, else the
 *  SalaryStructureHistory row whose [effectiveFrom, effectiveTo) window covers
 *  the month. Used so a past payslip's breakdown + Monthly Salary reflect the
 *  salary that applied THAT month, not a later revision. Representative day =
 *  the LAST day of the month (so a revision effective next month doesn't leak
 *  into this one). Pure — pass already-fetched records; returns one of them. */
export function pickStructureForMonth<T extends { effectiveFrom: Date | string; effectiveTo?: Date | string | null }>(
  current: T | null,
  history: T[],
  year: number,
  month0: number,
): T | null {
  if (!current) return null;
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const t = Date.UTC(year, month0, daysInMonth); // last day of the payroll month
  const ms = (v: Date | string) => new Date(v).getTime();
  let best: T | null = null;
  let bestFrom = -Infinity;
  if (ms(current.effectiveFrom) <= t) { best = current; bestFrom = ms(current.effectiveFrom); }
  for (const h of history) {
    const from = ms(h.effectiveFrom);
    const to = h.effectiveTo ? ms(h.effectiveTo) : Infinity;
    if (from <= t && t < to && from > bestFrom) { best = h; bestFrom = from; }
  }
  return best ?? current;
}

/** Resolve an employee's salary for a payroll month, splitting at any mid-month
 *  effective date. Returns blended monthly earnings + component breakdown
 *  (both PRE-LOP — the caller applies its own LOP factor). */
export async function getMonthSalary(userId: number, year: number, month0: number): Promise<MonthSalary | null> {
  const current = await prisma.salaryStructure.findUnique({ where: { userId } });
  if (!current) return null;

  const history = await prisma.salaryStructureHistory.findMany({ where: { userId } });

  const toStruct = (r: {
    salaryType: string; ctc: unknown; basic: unknown; hra: unknown; dearnessAllowance: unknown;
    conveyanceAllowance: unknown; medicalAllowance: unknown; specialAllowance: unknown;
    pfEmployee: unknown; pfEligible: boolean; effectiveFrom: Date;
  }, effTo: number): Struct => ({
    salaryType: r.salaryType,
    ctc: num(r.ctc), basic: num(r.basic), hra: num(r.hra), da: num(r.dearnessAllowance),
    conv: num(r.conveyanceAllowance), medical: num(r.medicalAllowance), special: num(r.specialAllowance),
    pfEmployee: num(r.pfEmployee), pfEligible: r.pfEligible,
    effFrom: new Date(r.effectiveFrom).getTime(), effTo,
  });

  const structs: Struct[] = [
    toStruct(current, Infinity),
    ...history.map(h => toStruct(h, new Date(h.effectiveTo).getTime())),
  ].sort((a, b) => a.effFrom - b.effFrom);

  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

  // Structure active on a given day: the latest effFrom that is ≤ the day AND
  // whose effTo is > the day. If none covers (e.g. day precedes all history),
  // fall back to `current` — this is what preserves old behaviour when an
  // employee has no history for the earlier part of the month.
  const activeOn = (day: number): Struct => {
    const t = Date.UTC(year, month0, day);
    let best: Struct | null = null;
    for (const s of structs) {
      if (s.effFrom <= t && t < s.effTo) {
        if (!best || s.effFrom > best.effFrom) best = s;
      }
    }
    return best ?? structs[structs.length - 1];   // fallback = latest (current)
  };

  // Group consecutive days that share the same structure into periods.
  const periods: MonthSalary["periods"] = [];
  let runStart = 1;
  let runStruct = activeOn(1);
  const blendedComp: SalaryComponents = { basic: 0, hra: 0, medical: 0, conv: 0, da: 0, special: 0, stipend: 0 };
  let blendedMonthly = 0;

  const flush = (endDay: number, s: Struct) => {
    const days = endDay - runStart + 1;
    const w = days / daysInMonth;
    const c = componentsOf(s);
    blendedComp.basic += c.basic * w; blendedComp.hra += c.hra * w; blendedComp.medical += c.medical * w;
    blendedComp.conv += c.conv * w; blendedComp.da += c.da * w; blendedComp.special += c.special * w;
    blendedComp.stipend += c.stipend * w;
    blendedMonthly += monthlyEarningsOf(s) * w;
    periods.push({ startDay: runStart, endDay, days, salaryType: s.salaryType, monthly: monthlyEarningsOf(s) });
  };

  for (let d = 2; d <= daysInMonth; d++) {
    const s = activeOn(d);
    if (s !== runStruct) { flush(d - 1, runStruct); runStart = d; runStruct = s; }
  }
  flush(daysInMonth, runStruct);

  return {
    hasSplit: periods.length > 1,
    blendedMonthlyEarnings: blendedMonthly,
    components: blendedComp,
    periods,
  };
}
