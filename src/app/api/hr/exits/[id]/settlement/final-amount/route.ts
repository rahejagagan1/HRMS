// GET /api/hr/exits/[id]/settlement/final-amount
//
// Returns the exiting employee's F&F PAYOUT = LEAVE ENCASHMENT (+ gratuity)
// ONLY. Base salary for worked days, advance, and PF/PT are paid via the
// employee's regular payslip (the payroll engine includes mid-month exits and
// prorates to the last working day), so the F&F adhoc must cover only the
// leave encashment — otherwise the worked-days salary is paid twice. Pre-fills
// the "Settle F&F" modal's Settlement Amount. `fullSettlementNet` (the total
// across payslip + F&F) is also returned for reference / the Exit Statement.
//
// Mirrors the gathering in templates/[key]/page.tsx (employee pick auto-fill):
//   AnnualPackage       ← SalaryStructure.ctc
//   EnablePf            ← SalaryStructure.pfEligible (forced off for interns)
//   WorkingDays         ← exit-month pending-salary paidDays (blank if already paid)
//   LeaveEncashmentDays ← Carry Over Leave balance (total − used − pending)
//   AdvanceSalaryAmount ← sum of AdhocLineItem rows with type='Advance Salary'
//   ProfessionalTax     ← ₹200 flat for non-interns, ₹0 for interns (the NB
//                         Media standard the Exit Statement prints)
// then feeds computeExitSettlement() — the single source of truth for the net.
// The result equals the Exit Statement's "Net Salary Payable (A − B)", which
// deducts BOTH Provident Fund and Professional Tax.
//
// HR-admin (salary-view) only.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";
import { computeExitSettlement } from "@/lib/hr/exit-settlement-calc";
import { computeExitPendingSalary } from "@/lib/hr/exit-pending-salary";

export const dynamic = "force-dynamic";

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const exitId = parseInt((await params).id);
    if (!Number.isFinite(exitId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const exit = await prisma.employeeExit.findUnique({
      where: { id: exitId },
      select: { userId: true },
    });
    if (!exit) return NextResponse.json({ error: "Exit not found" }, { status: 404 });

    const structure = await prisma.salaryStructure.findUnique({
      where: { userId: exit.userId },
      select: { ctc: true, pfEligible: true, salaryType: true },
    });
    if (!structure) {
      return NextResponse.json({ net: 0, reason: "No salary structure on file." });
    }
    const isIntern = structure.salaryType === "intern";

    // Carry Over Leave → Leave Encashment Days. Match by leave-type name
    // (same /carry over/i test the template editor uses); take the latest year.
    const balances = await prisma.leaveBalance.findMany({
      where: { userId: exit.userId },
      select: { year: true, totalDays: true, usedDays: true, pendingDays: true, leaveType: { select: { name: true } } },
      orderBy: { year: "desc" },
    });
    const carry = balances.find((b) => /carry\s*over/i.test(String(b.leaveType?.name ?? "")));
    const carryDays = carry
      ? Math.max(0, num(carry.totalDays) - num(carry.usedDays) - num(carry.pendingDays))
      : undefined;

    // Advance Salary already paid in payroll (adhoc) → added to F&F earnings.
    const asRows = await prisma.$queryRawUnsafe<Array<{ amount: string }>>(
      `SELECT amount::text AS amount FROM "AdhocLineItem" WHERE "userId" = $1 AND type = 'Advance Salary'`,
      exit.userId,
    );
    let advAmount = 0;
    for (const r of asRows) advAmount += parseFloat(r.amount) || 0;

    // Working days for the exit month (blank when already paid — matches the
    // template editor, where blank WorkingDays => full-month proration).
    const pending = await computeExitPendingSalary(exitId);
    const workingDays = pending && !pending.alreadyPaid && Number(pending.paidDays) > 0
      ? String(pending.paidDays)
      : "";

    // Professional Tax: ₹200 flat for non-interns (₹0 for interns) — the NB
    // Media standard shown on the Exit Statement. Deducting it (in addition to
    // PF) makes this net equal the statement's "Net Salary Payable (A − B)".
    const professionalTax = isIntern ? "0" : "200";

    const settlement = computeExitSettlement({
      AnnualPackage:       structure.ctc != null ? String(structure.ctc) : "",
      WorkingDays:         workingDays,
      LeaveEncashmentDays: carryDays != null ? String(carryDays) : "",
      AdvanceSalaryAmount: advAmount > 0 ? String(advAmount) : "",
      EnablePf:            isIntern ? "false" : (structure.pfEligible ? "true" : "false"),
      ProfessionalTax:     professionalTax,
    });

    // F&F PAYOUT = LEAVE ENCASHMENT ONLY. Base salary (worked days), advance,
    // and PF/PT all flow through the exiting employee's regular payslip now, so
    // the F&F adhoc must NOT re-include them (that was the double-pay). `net` is
    // therefore the leave-encashment amount; `fullSettlementNet` is retained for
    // reference (the total across payslip + F&F, i.e. the Exit Statement's net).
    return NextResponse.json({
      net: settlement.LeaveEncashmentAmount,
      leaveEncashment: settlement.LeaveEncashmentAmount,
      fullSettlementNet: settlement.net,
      breakdown: settlement,
      inputs: {
        annualPackage: structure.ctc != null ? Number(structure.ctc) : 0,
        workingDays: workingDays || null,
        leaveEncashmentDays: carryDays ?? null,
        advanceSalaryAmount: advAmount,
        enablePf: !isIntern && structure.pfEligible === true,
        professionalTax: Number(professionalTax),
      },
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/exits/[id]/settlement/final-amount");
  }
}
