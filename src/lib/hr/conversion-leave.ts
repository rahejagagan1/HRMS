// Intern / probation → regular conversion: Casual Leave crediting rule.
//
// The org rule (not expressible in flat monthly accrual):
//   • CL eligibility begins the month an employee's internship OR probation
//     COMPLETES — NOT at joining, and not while still on probation.
//   • The COMPLETION MONTH is credited a full CL if the completion date is on
//     or before the 15th, else HALF (0.5). Every month AFTER accrues 1 as usual.
//   • While an employee is still serving probation/internship, CL is WITHHELD
//     (0) — the flat accrual engine would otherwise credit it from joining.
//   • Interns sit on the "Intern Leave Plan" (SL only, no CL). Once actually
//     made regular they must also move onto the regular policy.
//
// Because the amount owed is a pure function of the completion date and the
// current month, this module OWNS the CL balance for any regular employee whose
// internship/probation completes in the CURRENT accrual year. On every accrual
// pass it (re)computes the earned figure and writes it, stamping
// lastAccrualMonth = current month so the flat accrual engine
// (lib/leave-accrual) adds nothing on top (no double-count). It is therefore
// fully idempotent — running it repeatedly converges on the same number.
//
// Scope / safety:
//   • Only `salaryType === "regular"` employees are touched. Real interns
//     (salaryType "intern") keep the Intern Leave Plan and their SL-only plan.
//   • Only CURRENT-YEAR completions are owned here. Prior-year completions are
//     tenured staff — the flat accrual engine already credits them a full year,
//     so we leave those rows alone.
//   • The written total is floored at usedDays + pendingDays so a correction can
//     never drop someone below leave they've already taken or requested.
//   • Only CL is touched; SL and every other leave type stay with flat accrual.
//
// Runs from accrueLeavesForUser (so every accrual — monthly cron or the lazy
// on-page-read trigger — self-heals) and can be invoked directly on the
// probation-confirm / intern-end action.

import prisma from "@/lib/prisma";

const REGULAR_POLICY_NAME = "Standard Policy";
const INTERN_POLICY_NAME  = "Intern Leave Plan";
const CASUAL_LEAVE_CODE   = "CL";

const ym = (y: number, m1: number) => `${y}-${String(m1).padStart(2, "0")}`;
// Inclusive month steps from `fromYm` (exclusive) to `toYm` (inclusive).
function monthsBetween(fromYm: string, toYm: string): number {
  const [fy, fm] = fromYm.split("-").map((s) => parseInt(s, 10));
  const [ty, tm] = toYm.split("-").map((s) => parseInt(s, 10));
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}

export type ConversionResult = {
  changed: boolean;
  movedToRegular?: boolean;
  clTotal?: number;         // CL total the rule settled on, if written
  earned?: number;          // rule figure before the used/pending floor
  completionDate?: string;  // YYYY-MM-DD
  onProbation?: boolean;    // completion still in the future → CL withheld
  reason?: string;
};

// Cache the (usually static) policy + leave-type ids for the process lifetime.
let idCache: { internPolicyId: number; regularPolicyId: number; clTypeId: number } | null = null;
async function resolveIds() {
  if (idCache) return idCache;
  const [intern, regular, cl] = await Promise.all([
    prisma.leavePolicy.findFirst({ where: { name: INTERN_POLICY_NAME }, select: { id: true } }),
    prisma.leavePolicy.findFirst({ where: { name: REGULAR_POLICY_NAME }, select: { id: true } }),
    prisma.leaveType.findFirst({ where: { code: CASUAL_LEAVE_CODE }, select: { id: true } }),
  ]);
  if (!intern || !regular || !cl) return null; // policies/type not seeded — no-op
  idCache = { internPolicyId: intern.id, regularPolicyId: regular.id, clTypeId: cl.id };
  return idCache;
}

/**
 * How much CL a regular employee has EARNED so far this year under the
 * completion-month rule. Returns null when the rule does not own this row
 * (prior-year / tenured completion — leave it to flat accrual).
 *
 *   • completion still in the future  → 0   (still on probation → withhold)
 *   • completion earlier this year    → full (≤15th) or half (>15th) for the
 *                                        completion month, + 1 per month since
 *   • completion in a prior year      → null (tenured; flat accrual owns it)
 */
export function earnedClForYear(
  completion: Date,
  year: number,
  currentYm: string,
  today: Date,
): number | null {
  if (completion.getTime() > today.getTime()) return 0; // on probation → withhold
  const cy = completion.getUTCFullYear();
  const cm = completion.getUTCMonth() + 1; // 1-based
  const cd = completion.getUTCDate();
  if (cy < year) return null;   // tenured — flat accrual owns the full year
  if (cy > year) return 0;      // completes later this... future year → nothing yet
  const firstMonth = cd <= 15 ? 1 : 0.5;
  return firstMonth + monthsBetween(ym(cy, cm), currentYm);
}

/**
 * Reconcile one employee's intern/probation → regular CL crediting.
 *
 * Acts on any `salaryType === "regular"` employee whose internship/probation
 * completes in the CURRENT accrual year, owning their CL balance = the earned
 * figure above (floored at used+pending). Interns still on the Intern Leave
 * Plan are additionally moved onto the regular policy. Idempotent: recomputing
 * and rewriting the same number each pass converges, never double-credits.
 *
 * `year` / `currentYm` are passed in so this shares the exact clock the accrual
 * engine stamps, preventing drift.
 */
export async function reconcileConversionLeaveForUser(
  userId: number,
  currentYm: string,
  year: number,
): Promise<ConversionResult> {
  const ids = await resolveIds();
  if (!ids) return { changed: false, reason: "policies/CL type not configured" };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      leavePolicyId: true,
      salaryStructure: { select: { salaryType: true } },
      employeeProfile: { select: { internshipEndDate: true, probationEndDate: true } },
    },
  });
  if (!user) return { changed: false };

  // CRUCIAL: the rule governs REGULAR employees only. A real intern
  // (salaryType "intern") — even one whose internshipEndDate has passed — is
  // NOT yet converted; HR may still be deciding / may extend. They stay on the
  // Intern Leave Plan (SL only, no CL) untouched.
  if (user.salaryStructure?.salaryType !== "regular") {
    return { changed: false, reason: "not a regular employee — rule does not apply" };
  }

  const prof = user.employeeProfile;
  // Completion = internship end (intern path) or, failing that, probation end.
  const completion = prof?.internshipEndDate ?? prof?.probationEndDate ?? null;
  if (!completion) return { changed: false, reason: "no completion date — flat accrual owns CL" };

  const compDate = new Date(completion);
  const today = new Date();
  const earned = earnedClForYear(compDate, year, currentYm, today);
  // null = prior-year / tenured completion → not owned here; flat accrual credits
  // the full year as usual. Leave the row alone.
  if (earned === null) return { changed: false, reason: "tenured (prior-year completion) — flat accrual owns CL" };

  const onProbation = compDate.getTime() > today.getTime();
  const needsPolicyMove = user.leavePolicyId === ids.internPolicyId;

  const result = await prisma.$transaction(async (tx) => {
    // 1) An intern actually made regular but still parked on the Intern Leave
    //    Plan → move to the regular policy so CL (and SL) accrue normally.
    if (needsPolicyMove) {
      await tx.user.update({ where: { id: userId }, data: { leavePolicyId: ids.regularPolicyId } });
    }

    // 2) Own the CL balance for the year. totalDays = earned, but never below
    //    what's already used/pending (a correction can't strand taken leave).
    //    lastAccrualMonth = currentYm so the flat accrual pass that runs right
    //    after this in accrueLeavesForUser adds nothing on top.
    const existing = await tx.leaveBalance.findUnique({
      where: { userId_leaveTypeId_year: { userId, leaveTypeId: ids.clTypeId, year } },
      select: { id: true, totalDays: true, usedDays: true, pendingDays: true, lastAccrualMonth: true },
    });
    const used = Number(existing?.usedDays ?? 0);
    const pending = Number(existing?.pendingDays ?? 0);
    const newTotal = Math.max(earned, used + pending);

    if (existing) {
      // Skip a needless write if the row is already settled where the rule wants.
      if (Number(existing.totalDays) === newTotal && existing.lastAccrualMonth === currentYm) {
        return { wrote: false, newTotal };
      }
      await tx.leaveBalance.update({
        where: { id: existing.id },
        data: { totalDays: newTotal, lastAccrualMonth: currentYm },
      });
    } else {
      await tx.leaveBalance.create({
        data: { userId, leaveTypeId: ids.clTypeId, year, totalDays: newTotal, usedDays: 0, pendingDays: 0, lastAccrualMonth: currentYm },
      });
    }
    return { wrote: true, newTotal };
  });

  return {
    changed: needsPolicyMove || result.wrote,
    movedToRegular: needsPolicyMove,
    clTotal: result.newTotal,
    earned,
    completionDate: compDate.toISOString().slice(0, 10),
    onProbation,
    reason: onProbation
      ? "on probation — CL withheld until completion month"
      : `CL owned by completion rule → ${result.newTotal}`,
  };
}

/** Reconcile every active employee — a one-time backfill / periodic sweep so
 *  no regular employee's CL drifts from the completion-month rule. */
export async function reconcileAllConversionLeaves(currentYm: string, year: number): Promise<{ fixed: number; details: ConversionResult[] }> {
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
  const details: ConversionResult[] = [];
  for (const u of users) {
    const r = await reconcileConversionLeaveForUser(u.id, currentYm, year);
    if (r.changed) details.push({ ...r, ...( { userId: u.id } as any) });
  }
  return { fixed: details.length, details };
}
