import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

// Accepts either the base client or a transaction client so callers can run the
// refund inside their existing transaction.
type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Reverse the Leave-Without-Pay "used" balance that the auto-LOP job charged
 * for `dateOnly`, when a day that was a LOP later gets covered — e.g. HR
 * approves a regularization, leave, etc. for that date.
 *
 * Call this BEFORE flipping the attendance row to its covered status
 * (present / on_leave) so the pre-change LOP status is still readable.
 *
 *   • status "lop"          → refund 1.0 day of LWP "used"
 *   • status "half_day_lop" → refund 0.5 day
 *   • anything else         → no-op (returns 0)
 *
 * Idempotent: once the row is no longer a LOP it refunds nothing, so repeated
 * or racing approvals can't over-refund. `usedDays` floors at 0.
 *
 * Mirrors auto-lop.ts which adds the LWP usage in the first place. Tracking
 * only — payroll deducts LOP from the attendance status, not this balance, so
 * there is no double effect.
 */
export async function refundLopLwp(db: Db, userId: number, dateOnly: Date): Promise<number> {
  const ex = await db.attendance.findUnique({
    where: { userId_date: { userId, date: dateOnly } },
    select: { status: true },
  });
  const amount = ex?.status === "lop" ? 1 : ex?.status === "half_day_lop" ? 0.5 : 0;
  if (amount === 0) return 0;

  const lwp = await db.leaveType.findUnique({ where: { code: "LWP" }, select: { id: true } });
  if (!lwp) return 0;

  const year = dateOnly.getUTCFullYear();
  const bal = await db.leaveBalance.findUnique({
    where: { userId_leaveTypeId_year: { userId, leaveTypeId: lwp.id, year } },
    select: { usedDays: true },
  });
  if (!bal) return 0;

  const newUsed = Math.max(0, parseFloat(bal.usedDays.toString()) - amount);
  await db.leaveBalance.update({
    where: { userId_leaveTypeId_year: { userId, leaveTypeId: lwp.id, year } },
    data: { usedDays: newUsed },
  });
  return amount;
}
