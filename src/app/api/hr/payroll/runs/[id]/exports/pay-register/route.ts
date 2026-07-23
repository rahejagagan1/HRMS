// Keka PayRegister_YT Money Productions Pvt. Ltd ({Entity})_{Mon-YYYY}.xlsx
//
// Master pay register — the Keka columns plus two breakdown columns,
// "Advance Salary" and "Leave Encashment", INSERTED right after Gross(A)
// (positions 27–28) per HR's request. They split an exited employee's F&F out
// of Gross(A). This shifts PF Employee onward by two positions vs Keka's
// source, so downstream parsers keyed on the old positions for columns 27+
// must be updated. The "Aganist" typo (now column 35) is intentional and
// preserved (matches Keka's source).

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";
import {
  loadExportRows, frozenMonthlyComponents, monYearDash, monShort, HEADERS_PAY_REGISTER,
  brandParam, filterRowsByBrand, COMPANY_BY_BRAND,
} from "@/lib/payroll-exports";
import { readBrandStatus } from "@/lib/hr/payroll-run-status";

export const dynamic = "force-dynamic";

const NB_MEDIA_COMPANY = "YT Money Productions Pvt. Ltd (NB Media)";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    const runId = parseInt(id);
    if (!Number.isFinite(runId)) return NextResponse.json({ error: "Bad runId" }, { status: 400 });

    const { run, rows } = await loadExportRows(runId);
    const runStatus = readBrandStatus(run, brandParam(req)).status;
    if (runStatus !== "locked" && runStatus !== "paid") {
      return NextResponse.json({ error: `Lock the run first — currently '${runStatus}'` }, { status: 409 });
    }

    // PayRegister includes EVERY processed payslip — including on-hold
    // ones — so the register documents the complete cycle, not just
    // what got paid out. Bookkeeping needs to see the whole picture.
    // Brand split: ?brand=NB Media|YT Labs exports only that brand's
    // employees under that brand's legal entity; no brand => all (legacy).
    const brand = brandParam(req);
    const all = filterRowsByBrand(rows, brand);
    if (brand && all.length === 0) {
      return NextResponse.json({ error: `No ${brand} employees in this payroll run.` }, { status: 422 });
    }
    const company = brand ? COMPANY_BY_BRAND[brand] : NB_MEDIA_COMPANY;

    const monLabel = monShort(run.month);
    const sheetName = `${monLabel} ${run.year}`;
    const monthCell = `${monLabel} - ${run.year}`;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(sheetName);

    HEADERS_PAY_REGISTER.forEach((h, i) => {
      const cell = ws.getCell(1, i + 1);
      cell.value = h;
      cell.font = { bold: true };
    });

    all.forEach((r, idx) => {
      const row = idx + 2;
      // Salary components for the cycle. SalaryStructure stores annual
      // amounts; divide by 12 and apply the LOP factor so the columns
      // already match what each employee actually earned this month.
      const workingDays = r.workingDays || 30;

      // Salary breakdown anchored to the LOCKED payslip — components are
      // scaled to the salary actually paid this cycle so a post-lock
      // structure edit (e.g. a later raise) can't leak into this file.
      // See frozenMonthlyComponents in payroll-exports.ts.
      const { basic, hra, medical, conv, da, special, stipend } = frozenMonthlyComponents(r);

      // Per Q2 from spec — every EmployeeBonus row (any bonusType) goes
      // into the "Referral Bonus" column for now. Sub-types are kept on
      // the bonus table for future split.
      const referralBonus = r.bonus;
      const businessExpense = (r.adhocPayByType["Reimbursement"] ?? 0)
                            + (r.adhocPayByType["Travel"] ?? 0);

      // Headline money columns come straight from the frozen payslip so the
      // register reconciles exactly with the pre-payroll check + Batch
      // Payment. PF Employee is the contribution (column B); everything else
      // withheld (PT + addTax + TDS + ESI + LWF + adhoc) rolls into Total
      // Deductions (column C) as (totalDeductions − PF).
      const grossA = r.grossEarnings;
      const pfEmployee = r.pfEmployee;
      const totalContribB = pfEmployee; // ESI not yet wired
      const profTax = r.professionalTax;   // additionalTax is folded into professionalTax in loadExportRows
      const totalDeductionC = Math.max(0, r.totalDeductions - r.pfEmployee);
      const netPay = r.netPay;
      // D / E / F kept at zero — the cash-advance + settlement flows
      // aren't wired to AdhocLineItem yet; revisit when those go live.
      const cashAdvance = 0;
      const settlement = 0;
      const totalReimb = 0;
      const totalNet = netPay + cashAdvance + settlement + totalReimb;

      // F&F breakdown for exited employees, split into its two parts:
      //   • Advance Salary — from the "Advance Salary" adhoc.
      //   • Leave Encashment — computed in loadExportRows exactly as
      //     payroll/generate does (carry-over days × (basic+DA)/12/30).
      // Both are already inside Gross(A), so these are breakdown columns (not
      // extra money), like Referral Bonus / Business Expense. 0 for non-exits.
      const advanceSalary   = r.adhocPayByType["Advance Salary"] ?? 0;
      const leaveEncashment = r.leaveEncashment;
      // Gross(A1) is the regular gross ONLY — advance (A2) and leave
      // encashment (A3) are shown as separate additive columns, so pull them
      // out of A1. Net Pay = A1 + A2 + A3 − B − C keeps the same value as the
      // old A − B − C because A1 + A2 + A3 == the full grossEarnings.
      const grossA1 = grossA - advanceSalary - leaveEncashment;

      const statusLabel = r.status === "on_hold" ? "OnHold" : "ExecutedAsSalary";
      const payableUnits = `${r.presentDays}/${workingDays} Days`;

      ws.getCell(row, 1).value  = r.employeeId ?? "";
      ws.getCell(row, 2).value  = r.name;
      ws.getCell(row, 3).value  = r.designation ?? "";
      // Keka's existing export emits the raw JS Date toString here. We
      // match that literally so downstream parsers don't break.
      ws.getCell(row, 4).value  = r.joiningDate ? r.joiningDate.toString() : "";
      ws.getCell(row, 5).value  = r.department ?? "";
      ws.getCell(row, 6).value  = capitalize(r.employmentType ?? "Permanent");
      ws.getCell(row, 7).value  = monthCell;
      ws.getCell(row, 8).value  = "Regular";
      ws.getCell(row, 9).value  = statusLabel;
      ws.getCell(row, 10).value = statusLabel;
      ws.getCell(row, 11).value = r.presentDays;
      ws.getCell(row, 12).value = workingDays;
      ws.getCell(row, 13).value = r.lopDays;
      ws.getCell(row, 14).value = r.presentDays;
      ws.getCell(row, 15).value = payableUnits;
      ws.getCell(row, 16).value = `${(r.ctcAnnual / 12).toFixed(2)} / MONTH`;
      ws.getCell(row, 17).value = round2(basic);
      ws.getCell(row, 18).value = round2(hra);
      ws.getCell(row, 19).value = round2(medical);
      ws.getCell(row, 20).value = round2(conv);
      ws.getCell(row, 21).value = round2(special);
      ws.getCell(row, 22).value = round2(da);
      ws.getCell(row, 23).value = round2(stipend);
      ws.getCell(row, 24).value = round2(referralBonus);
      ws.getCell(row, 25).value = round2(businessExpense);
      ws.getCell(row, 26).value = round2(grossA1);
      ws.getCell(row, 27).value = round2(advanceSalary);
      ws.getCell(row, 28).value = round2(leaveEncashment);
      ws.getCell(row, 29).value = round2(pfEmployee);
      ws.getCell(row, 30).value = round2(totalContribB);
      ws.getCell(row, 31).value = round2(profTax);
      ws.getCell(row, 32).value = round2(totalDeductionC);
      ws.getCell(row, 33).value = round2(netPay);
      ws.getCell(row, 34).value = round2(cashAdvance);
      ws.getCell(row, 35).value = round2(settlement);
      ws.getCell(row, 36).value = round2(totalReimb);
      ws.getCell(row, 37).value = round2(totalNet);
    });

    // Column widths roughly matching the Keka source — wide for names /
    // titles / departments, narrow for numeric columns.
    [12, 28, 22, 32, 28, 12, 14, 12, 18, 18,
     14, 12, 14, 14, 16, 22, 12, 12, 14, 16,
     16, 14, 12, 14, 22, 12, 16, 16, 14, 18,
     14, 16, 14, 14, 18, 18, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    const buf = await wb.xlsx.writeBuffer();
    const filename = `NbStudio PayRegister_${company}_${monYearDash(run.month, run.year)}.xlsx`;
    return new NextResponse(buf as any, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) { return serverError(e, "GET /api/hr/payroll/runs/[id]/exports/pay-register"); }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).toLowerCase();
}
