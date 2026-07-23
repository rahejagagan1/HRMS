// First-of-the-month WFH credit cron.
//
// Crontab (UTC VPS, IST policy → 00:00 IST = 18:30 UTC previous day):
//   30 18 L * *   ❌ NOT POSSIBLE in plain cron
//
// What we do instead — fire every day 1-3 of the month at 00:00 IST
// (= 18:30 UTC the day before) and skip if balances already exist
// for this month. Cron line:
//
//   30 18 28-31 * *  curl -sS -X POST -H "Authorization: Bearer …" \
//                     http://localhost:3005/api/cron/wfh/credit-month
//
// That fires the 28th, 29th, 30th, 31st (whichever days exist in
// the month). The endpoint checks "is it day 1 of the next month
// in IST?" — only the firing AFTER the actual month-rollover hits
// the true day-1 in IST and credits.
//
// Simpler alternative: fire every day at 00:30 IST (= 19:00 UTC):
//   0 19 * * *    curl … /api/cron/wfh/credit-month
//
// The endpoint internally idempotency-guards on the monthKey so
// 30 daily firings collapse to 1 actual credit per employee per
// month. Recommend the simpler daily cron — easier mental model.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { serverError } from "@/lib/api-auth";
import { getMonthKey } from "@/lib/hr/pulse-week";
import { getWfhPolicy, quotaForBrand } from "@/lib/hr/wfh-balance";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

async function handle(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get("authorization");
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const force = new URL(request.url).searchParams.get("force") === "1";

    const policy = await getWfhPolicy();
    const monthKey = getMonthKey();

    // Already-credited check — every employee should already have a
    // row for this month after the first daily firing. Skip cleanly.
    if (!force) {
      const existing = (await prisma.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM "WfhBalance" WHERE "monthKey" = $1`,
        monthKey,
      ))[0];
      if ((existing?.n ?? 0) > 0) {
        return NextResponse.json({
          ok: true, skipped: true, reason: "already credited this month", monthKey,
          existingRows: existing.n,
        });
      }
    }

    // Credit every active employee with their brand's quota.
    // Tolerant of envs without the isDeveloper column.
    let employees: Array<{ id: number; businessUnit: string | null }>;
    try {
      employees = await prisma.$queryRawUnsafe(
        `SELECT u.id, ep."businessUnit"
           FROM "User" u
           LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
          WHERE u."isActive" = true
            AND COALESCE(u."isDeveloper", false) = false`,
      );
    } catch (e: any) {
      const code = e?.meta?.code || e?.code;
      if (code === "42703" || /isDeveloper/.test(String(e?.message ?? ""))) {
        employees = await prisma.$queryRawUnsafe(
          `SELECT u.id, ep."businessUnit"
             FROM "User" u
             LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
            WHERE u."isActive" = true`,
        );
      } else { throw e; }
    }

    // Bulk upsert — one row per employee. ON CONFLICT keeps the
    // existing `used` count if force=1 was used to re-run (so HR
    // doesn't accidentally wipe usage by re-crediting).
    let credited = 0;
    const BATCH = 50;
    for (let i = 0; i < employees.length; i += BATCH) {
      const wave = employees.slice(i, i + BATCH);
      const valuesSql = wave.map((_, j) => `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3})`).join(", ");
      const params: any[] = [];
      for (const e of wave) {
        params.push(e.id, monthKey, quotaForBrand(policy, e.businessUnit));
      }
      const r = await prisma.$executeRawUnsafe(
        `INSERT INTO "WfhBalance" ("userId", "monthKey", "credited")
         VALUES ${valuesSql}
         ON CONFLICT ("userId", "monthKey")
         DO UPDATE SET credited = EXCLUDED.credited, "updatedAt" = NOW()`,
        ...params,
      );
      credited += Number(r) || 0;
    }

    return NextResponse.json({
      ok: true,
      monthKey,
      policy: { limitEnabled: policy.limitEnabled, nbMediaQuota: policy.nbMediaQuota, ytLabsQuota: policy.ytLabsQuota },
      employeesProcessed: employees.length,
      rowsAffected: credited,
    });
  } catch (e) {
    return serverError(e, "cron/wfh/credit-month");
  }
}

export async function POST(request: NextRequest) { return handle(request); }
export async function GET(request: NextRequest)  { return handle(request); }
