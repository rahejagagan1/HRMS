// WFH quota / balance helpers. Centralises the policy lookup, the
// per-employee remaining-days computation, and the credit/decrement
// primitives so the cron + the request POST + the employee form
// all agree on the math.

import prisma from "@/lib/prisma";
import { getMonthKey } from "@/lib/hr/pulse-week";
import { istMonthRange } from "@/lib/ist-date";

/** Half-day WFH counts as 0.5; a full day as 1. Half-days are encoded
 *  as a reason prefix ([First Half] / [Second Half] / [Half Day]) — the
 *  same marker the attendance board reads. SINGLE source of truth for
 *  the day-weight, shared by the apply cap, the employee badge, and the
 *  HR balances panel so they can never disagree. */
export const WFH_HALF_DAY_RE = /\[(?:First Half|Second Half|Half Day)\]/i;
export function wfhDayWeight(reason: string | null | undefined): number {
  return WFH_HALF_DAY_RE.test(reason ?? "") ? 0.5 : 1;
}

/** Live, half-day-weighted WFH usage for ONE user in the month of `now`.
 *  Counts the in-flight set (pending + partially_approved + approved) —
 *  the same rows the apply cap counts — so "used" shown anywhere always
 *  matches what actually blocks a new request. Replaces the old stored
 *  WfhBalance.used integer counter (couldn't hold 0.5; never auto-updated). */
export async function computeWfhUsed(userId: number, now: Date = new Date()): Promise<number> {
  const { start, end } = istMonthRange(now);
  const rows = await prisma.wFHRequest.findMany({
    where: {
      userId,
      status: { in: ["pending", "partially_approved", "approved"] },
      date:   { gte: start, lte: end },
    },
    select: { reason: true },
  });
  return rows.reduce((sum, r) => sum + wfhDayWeight(r.reason), 0);
}

export type WfhPolicy = {
  limitEnabled: boolean;
  nbMediaQuota: number;
  ytLabsQuota:  number;
  updatedAt:    Date | null;
  updatedByName: string | null;
};

/** Fetches the singleton policy row + the updater's name. Returns
 *  the seeded defaults if the table is empty for any reason. */
export async function getWfhPolicy(): Promise<WfhPolicy> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT p."limitEnabled", p."nbMediaQuota", p."ytLabsQuota",
              p."updatedAt", u.name AS "updatedByName"
         FROM "WfhPolicy" p
         LEFT JOIN "User" u ON u.id = p."updatedById"
        WHERE p.id = 1
        LIMIT 1`,
    );
    if (rows[0]) return {
      limitEnabled:  !!rows[0].limitEnabled,
      nbMediaQuota:  Number(rows[0].nbMediaQuota) || 2,
      ytLabsQuota:   Number(rows[0].ytLabsQuota)  || 3,
      updatedAt:     rows[0].updatedAt ?? null,
      updatedByName: rows[0].updatedByName ?? null,
    };
  } catch {
    /* table may not exist yet */
  }
  return { limitEnabled: true, nbMediaQuota: 2, ytLabsQuota: 3, updatedAt: null, updatedByName: null };
}

/** Quota for one brand looked up from policy. Falls back to the
 *  hardcoded defaults when an unknown brand sneaks in. */
export function quotaForBrand(policy: WfhPolicy, brand: string | null | undefined): number {
  if (brand === "YT Labs") return policy.ytLabsQuota;
  if (brand === "NB Media") return policy.nbMediaQuota;
  return policy.nbMediaQuota;   // default fallback
}

/** Read this user's WfhBalance row for the current month. Returns
 *  the seeded defaults (0 used, brand-specific credited) if no row
 *  exists yet — covers the gap between "user joined mid-month" and
 *  "next cron credits them". */
export async function getBalance(userId: number, brand: string | null, now: Date = new Date()): Promise<{
  credited: number;
  used: number;
  remaining: number;
  monthKey: string;
  policy: WfhPolicy;
}> {
  const policy = await getWfhPolicy();
  const monthKey = getMonthKey(now);
  // CREDITED (the allowance) is still HR-overridable via the stored
  // WfhBalance row; falls back to the brand policy quota when there's
  // no override.
  let credited = quotaForBrand(policy, brand);
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ credited: number }>>(
      `SELECT credited FROM "WfhBalance"
        WHERE "userId" = $1 AND "monthKey" = $2 LIMIT 1`,
      userId, monthKey,
    );
    if (rows[0]?.credited != null) credited = Number(rows[0].credited);
  } catch {
    /* table missing — fall back to policy quota */
  }
  // USED is now ALWAYS computed live + half-day-weighted from the actual
  // WFH requests — never the stored integer counter (which couldn't hold
  // 0.5 and was never auto-incremented). One source of truth with the cap.
  const used = await computeWfhUsed(userId, now);
  return { credited, used, remaining: Math.max(0, credited - used), monthKey, policy };
}

/** Increment a user's `used` count by N (default 1). Creates the
 *  row if missing — so an approval before the cron-credits-month
 *  still tracks correctly. Returns the new balance. */
export async function incrementUsed(
  userId: number,
  brand: string | null,
  n: number = 1,
  now: Date = new Date(),
): Promise<{ credited: number; used: number; remaining: number }> {
  const policy = await getWfhPolicy();
  const monthKey = getMonthKey(now);
  const credited = quotaForBrand(policy, brand);
  // Upsert: insert with credited+n, on conflict bump used.
  const rows = await prisma.$queryRawUnsafe<Array<{ credited: number; used: number }>>(
    `INSERT INTO "WfhBalance" ("userId", "monthKey", credited, used, "updatedAt")
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT ("userId", "monthKey")
     DO UPDATE SET used = "WfhBalance".used + EXCLUDED.used,
                   "updatedAt" = NOW()
     RETURNING credited, used`,
    userId, monthKey, credited, n,
  );
  const used = Number(rows[0]?.used ?? n);
  const cred = Number(rows[0]?.credited ?? credited);
  return { credited: cred, used, remaining: Math.max(0, cred - used) };
}

/** Decrement a user's `used` count (e.g. when an approved WFH
 *  request is later rejected / cancelled). Won't go below zero. */
export async function decrementUsed(
  userId: number,
  n: number = 1,
  now: Date = new Date(),
): Promise<void> {
  const monthKey = getMonthKey(now);
  await prisma.$executeRawUnsafe(
    `UPDATE "WfhBalance"
        SET used = GREATEST(0, used - $3), "updatedAt" = NOW()
      WHERE "userId" = $1 AND "monthKey" = $2`,
    userId, monthKey, n,
  );
}
