// Baseline leave entitlements from a user's assigned LeavePolicy.
//
// "Apply policy" (hr/admin/leave-policies/[id]/apply) is seed-only: it creates
// missing LeaveBalance rows with totalDays = entry.daysPerYear and never
// touches existing rows. But the accrual engine (lib/leave-accrual) pre-creates
// rows as ZEROS (totalDays=0, stamped to the current month) the moment any
// page read triggers accrual for a new joiner — which happens before HR ever
// presses Apply. Seed-only then skips every row, and the joiner is stranded
// with 0 everywhere: no FL/LWP lump sums, and the first monthly CL/SL credit
// a month away.
//
// This helper is the order-independent version: for every entry of the user's
// active policy it ensures a LeaveBalance row for the year, seeding it with
// lump sum + the joining month's accrual credit (leave starts from the month
// of joining — HR rule, 2026-07-14) and stamping lastAccrualMonth so the
// accrual engine can't double-credit the month. Zero-total rows LIFT to the
// same figure — auto-LOP can write LWP usage before onboarding completes
// (seen in prod: joiners absent in week 1), and a policy-entry row with
// totalDays=0 is never a legitimate HR-managed state when the policy grants
// days. Rows with a non-zero total are HR-managed and never touched.
//
// Called from the onboarding-completion route so every new joiner starts with
// their policy's entitlements without HR having to re-run Apply. Note: CL for
// a joiner still on probation gets clamped back to 0 by the conversion rule
// (lib/hr/conversion-leave) on the next accrual pass — that withholding is a
// separate, deliberate org rule this helper doesn't fight.

import prisma from "@/lib/prisma";
import { istTodayDateOnly } from "@/lib/ist-date";
import { ymKey } from "@/lib/leave-accrual";

export async function ensurePolicyBaselineForUser(
  userId: number,
  year?: number,
): Promise<{ created: number; lifted: number }> {
  const y = year ?? istTodayDateOnly().getUTCFullYear();
  const currentYm = ymKey(new Date());

  const entries = await prisma.$queryRawUnsafe<
    Array<{ leaveTypeId: number; daysPerYear: unknown; monthlyAccrual: unknown }>
  >(
    `SELECT lpe."leaveTypeId", lpe."daysPerYear", lpe."monthlyAccrual"
       FROM "User" u
       JOIN "LeavePolicy"      lp  ON lp.id = u."leavePolicyId" AND lp."isActive" = true
       JOIN "LeavePolicyEntry" lpe ON lpe."policyId" = lp.id
       JOIN "LeaveType"        lt  ON lt.id = lpe."leaveTypeId" AND lt."isActive" = true
      WHERE u.id = $1`,
    userId,
  );

  let created = 0;
  let lifted = 0;
  for (const e of entries) {
    const lump = Number(e.daysPerYear);
    const perMonth = Number(e.monthlyAccrual);
    if (!Number.isFinite(lump) || !Number.isFinite(perMonth)) continue;
    // Lump sum + the joining month's accrual, stamped so the engine's pass
    // for this month is a no-op (months-between = 0) instead of a double.
    const baseline = lump + perMonth;

    const existing = await prisma.leaveBalance.findUnique({
      where: { userId_leaveTypeId_year: { userId, leaveTypeId: e.leaveTypeId, year: y } },
      select: { id: true, totalDays: true },
    });

    if (!existing) {
      await prisma.leaveBalance.create({
        data: {
          userId, leaveTypeId: e.leaveTypeId, year: y,
          totalDays: baseline, usedDays: 0, pendingDays: 0,
          lastAccrualMonth: perMonth > 0 ? currentYm : null,
        },
      });
      created += 1;
    } else if (baseline > 0 && Number(existing.totalDays) === 0) {
      // Zero row pre-created by the accrual engine (or stamped without
      // credit) — lift to the full baseline and (re)stamp the month.
      await prisma.leaveBalance.update({
        where: { id: existing.id },
        data: {
          totalDays: baseline,
          ...(perMonth > 0 ? { lastAccrualMonth: currentYm } : {}),
        },
      });
      lifted += 1;
    }
  }
  return { created, lifted };
}
