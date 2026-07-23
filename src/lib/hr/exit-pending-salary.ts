// Shared exit-month pending-salary math — the SINGLE source of truth for the
// salary still owed to an exiting employee for the days they actually worked
// in the unpaid (exit) month, up to their last working day.
//
// Extracted from the /api/hr/exits/[id]/settlement/pending-salary route so it
// can also feed the F&F "final amount" endpoint (which pre-fills the Settle
// F&F modal). Both callers get identical WorkingDays / LOP numbers.
//
// Method = the same proration the payslip uses (see payroll/generate):
//   paidDays  = (day-of-month of LWD)  −  LOP within [1 .. LWD]
//   lopFactor = paidDays / daysInMonth          (weekends are paid, like payroll)
//   pendingNet = fullMonthlyNet × lopFactor      (net = gross − PF − PT − TDS − ₹200)

import prisma from "@/lib/prisma";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

export type ExitPendingSalary = {
  amount: number;
  paidDays: number;
  daysInMonth?: number;
  monthLabel?: string;
  alreadyPaid?: boolean;
  label?: string;
  reason?: string;
  breakdown?: { gross: number; deductions: number; lopInPeriod: number; salaryType: string };
};

/** Computes the exit-month pending salary for an EmployeeExit id.
 *  Returns null when the exit doesn't exist. The returned object is the exact
 *  JSON body the pending-salary route serves. */
export async function computeExitPendingSalary(exitId: number): Promise<ExitPendingSalary | null> {
  const exit = await prisma.employeeExit.findUnique({
    where: { id: exitId },
    select: { userId: true, lastWorkingDay: true },
  });
  if (!exit) return null;

  const structure = await prisma.salaryStructure.findUnique({ where: { userId: exit.userId } });
  if (!structure) {
    return { amount: 0, paidDays: 0, reason: "No salary structure on file." };
  }

  const lwd = exit.lastWorkingDay; // @db.Date → midnight UTC
  const year = lwd.getUTCFullYear();
  const month = lwd.getUTCMonth();          // 0-based
  const lwdDay = lwd.getUTCDate();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const firstDay = new Date(Date.UTC(year, month, 1));
  const monthLabel = `${MONTHS[month]} ${year}`;

  // Does a payslip already exist for the exit month? If so, nothing is PENDING
  // (the amount is 0 — HR settles any over/under-payment manually), but we
  // STILL compute the real worked-days / LOP below so the Exit Statement can
  // display them for an already-paid exited employee.
  const existingPayslip = await prisma.payslip.findFirst({
    where: { userId: exit.userId, month, year },
    select: { id: true },
  });

  // LOP within the WORKED window [1st .. LWD] only. (Days after the LWD are
  // unpaid by virtue of the proration base being the full month, not LOP.)
  const [absent, lop, half, halfLop] = await Promise.all([
    prisma.attendance.count({ where: { userId: exit.userId, date: { gte: firstDay, lte: lwd }, status: "absent" } }),
    prisma.attendance.count({ where: { userId: exit.userId, date: { gte: firstDay, lte: lwd }, status: "lop" } }),
    prisma.attendance.count({ where: { userId: exit.userId, date: { gte: firstDay, lte: lwd }, status: "half_day" } }),
    prisma.attendance.count({ where: { userId: exit.userId, date: { gte: firstDay, lte: lwd }, status: "half_day_lop" } }),
  ]);

  // Unpaid (LWP) leave weekdays within the worked window — same as payroll.
  const unpaidLeaves = await prisma.leaveApplication.findMany({
    where: { userId: exit.userId, status: "approved", fromDate: { lte: lwd }, toDate: { gte: firstDay }, leaveType: { isPaid: false } },
    select: { fromDate: true, toDate: true },
  });
  let unpaidLeaveDays = 0;
  for (const lv of unpaidLeaves) {
    const start = lv.fromDate > firstDay ? lv.fromDate : firstDay;
    const end = lv.toDate < lwd ? lv.toDate : lwd;
    const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const stop = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
    while (cur.getTime() <= stop.getTime()) {
      const dow = cur.getUTCDay();
      if (dow !== 0 && dow !== 6) unpaidLeaveDays += 1;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  const lopInPeriod = absent + lop + (half + halfLop) * 0.5 + unpaidLeaveDays;
  const paidDays = Math.max(0, lwdDay - lopInPeriod);
  const lopFactor = daysInMonth > 0 ? paidDays / daysInMonth : 0;

  // Already paid: nothing pending, but return the REAL worked-days / LOP so the
  // Exit Statement fills Working Days / Loss of Pay for the exited employee.
  if (existingPayslip) {
    return {
      amount: 0,
      paidDays: Number(paidDays.toFixed(1)),
      daysInMonth,
      monthLabel,
      alreadyPaid: true,
      label: `Salary for ${monthLabel} (already paid in payroll)`,
      breakdown: { gross: 0, deductions: 0, lopInPeriod: Number(lopInPeriod.toFixed(1)), salaryType: structure.salaryType },
    };
  }

  // Full-month figures (all CTC components stored ANNUAL → /12). PF (Emp) is a
  // CTC component that flows back out as a deduction, so it's in earnings.
  const monthlyEarnings =
    (num(structure.basic) + num(structure.hra) + num(structure.dearnessAllowance) +
     num(structure.conveyanceAllowance) + num(structure.medicalAllowance) +
     num(structure.specialAllowance) + num(structure.pfEmployee)) / 12;
  const pfMonthly = num(structure.pfEmployee) / 12;
  const tdsMonthly = num(structure.tds) / 12;
  const ptMonthly = num(structure.professionalTax);
  const addlMonthly = structure.salaryType === "intern" ? 0 : 200;
  const fullMonthlyNet = monthlyEarnings - pfMonthly - tdsMonthly - ptMonthly - addlMonthly;

  const grossPending = Math.round(monthlyEarnings * lopFactor);
  const netPending = Math.max(0, Math.round(fullMonthlyNet * lopFactor));

  const dd = (n: number) => String(n).padStart(2, "0");
  const periodLabel = `${dd(1)}–${dd(lwdDay)} ${MONTHS[month]} ${year}`;

  return {
    amount: netPending,                 // net take-home for the worked days
    paidDays: Number(paidDays.toFixed(1)),
    daysInMonth,
    monthLabel,
    alreadyPaid: false,
    label: `Salary for ${periodLabel} (${Number(paidDays.toFixed(1))}/${daysInMonth} days)`,
    breakdown: {
      gross: grossPending,
      deductions: Math.max(0, grossPending - netPending),
      lopInPeriod: Number(lopInPeriod.toFixed(1)),
      salaryType: structure.salaryType,
    },
  };
}
