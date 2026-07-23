// GET /api/hr/exits/[id]/settlement/pending-salary
//
// Auto-computes the salary still owed to an exiting employee for the days they
// actually worked in the unpaid (exit) month — up to their last working day.
// Used by the F&F wizard to auto-fill the "Salary changes" line so HR doesn't
// hand-calculate it. The line stays editable.
//
// Method = the same proration the payslip uses (see payroll/generate):
//   paidDays  = (day-of-month of LWD)  −  LOP within [1 .. LWD]
//   lopFactor = paidDays / daysInMonth          (weekends are paid, like payroll)
//   pendingNet = fullMonthlyNet × lopFactor      (net = gross − PF − PT − TDS − ₹200)
// Capping the period at the LWD makes the days after it simply unpaid, which is
// exactly the partial-month payslip the employee would have received.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";
import { computeExitPendingSalary } from "@/lib/hr/exit-pending-salary";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const exitId = parseInt((await params).id);
    if (!Number.isFinite(exitId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const result = await computeExitPendingSalary(exitId);
    if (!result) return NextResponse.json({ error: "Exit not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (e) {
    return serverError(e, "GET /api/hr/exits/[id]/settlement/pending-salary");
  }
}
