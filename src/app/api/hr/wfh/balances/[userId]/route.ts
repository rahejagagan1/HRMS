// PATCH /api/hr/wfh/balances/:userId?monthKey=YYYY-Mxx
//
// HR-admin override of a single employee's WFH CREDITED allowance
// for one month. Use cases:
//   • Grant an exception (e.g. Manpreet on notice → +3 extra)
//   • Correct a mistake (cron credited wrong amount)
//
// `used` is NO LONGER editable — it's computed live + half-day-weighted
// from the employee's actual WFH requests (see computeWfhUsed). Only
// `credited` (the allowance) can be overridden here.
//
// Body: { credited: number }   (0-31)
// Optional `monthKey` query param (defaults to current month).
//
// Returns the updated balance row + the editor's name for the
// audit display.
//
// Auth: HR-admin only. Brand-scoped — a YT Labs HR Manager can't
// edit an NB Media employee even if they know the userId.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { getMonthKey } from "@/lib/hr/pulse-week";
import { getBrandScope } from "@/lib/hr/brand-scope";
import { getWfhPolicy, quotaForBrand, computeWfhUsed } from "@/lib/hr/wfh-balance";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { userId: userIdRaw } = await params;
    const userId = parseInt(userIdRaw, 10);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "Bad userId" }, { status: 400 });
    }

    const url = new URL(req.url);
    const monthKey = url.searchParams.get("monthKey") || getMonthKey();
    if (!/^\d{4}-M(0[1-9]|1[0-2])$/.test(monthKey)) {
      return NextResponse.json({ error: "Bad monthKey" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const credited = body?.credited;
    const hasCredited = credited !== undefined && credited !== null;
    // `used` is computed live now — silently ignore any used in the body
    // (older clients may still send it) rather than persisting it.
    if (!hasCredited) {
      return NextResponse.json(
        { error: "Provide credited. (used is auto-computed from WFH requests and can't be set manually.)" },
        { status: 400 },
      );
    }
    if (!Number.isInteger(credited) || credited < 0 || credited > 31) {
      return NextResponse.json({ error: "credited must be an integer 0-31" }, { status: 400 });
    }

    // Brand scope check — fetch the subject's brand and bounce
    // when the caller can't see it.
    const subject = await prisma.$queryRawUnsafe<Array<{ id: number; businessUnit: string | null }>>(
      `SELECT u.id, ep."businessUnit"
         FROM "User" u
         LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
        WHERE u.id = $1
        LIMIT 1`,
      userId,
    );
    if (!subject[0]) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const subjectBrand = subject[0].businessUnit;

    const scope = getBrandScope(session!.user);
    if (!scope.allBrands && scope.brand !== subjectBrand) {
      return NextResponse.json({ error: "Forbidden — outside your brand scope" }, { status: 403 });
    }

    const callerId = await resolveUserId(session);

    // Compute the FINAL credited + used values in JS, then do a
    // straightforward upsert with EXCLUDED references. Avoids the
    // dynamic-SET parameter-numbering trap.
    const policy = await getWfhPolicy();
    const defaultCredited = quotaForBrand(policy, subjectBrand);

    const existingRows = await prisma.$queryRawUnsafe<Array<{ credited: number; used: number }>>(
      `SELECT credited, used FROM "WfhBalance"
        WHERE "userId" = $1 AND "monthKey" = $2 LIMIT 1`,
      userId, monthKey,
    );
    const existing = existingRows[0];

    const finalCredited = credited;
    // The `used` column is now vestigial (display uses the live
    // computed value). Preserve whatever's there to keep the NOT NULL
    // column valid; never derive display from it.
    const finalUsed = existing?.used ?? 0;

    const rows = await prisma.$queryRawUnsafe<Array<any>>(
      `INSERT INTO "WfhBalance" ("userId", "monthKey", "credited", "used", "updatedById", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT ("userId", "monthKey")
       DO UPDATE SET credited      = EXCLUDED.credited,
                     used          = EXCLUDED.used,
                     "updatedById" = EXCLUDED."updatedById",
                     "updatedAt"   = NOW()
       RETURNING id, "userId", "monthKey", credited, used,
                 "updatedById", "updatedAt"`,
      userId, monthKey, finalCredited, finalUsed, callerId ?? null,
    );
    const updated = rows[0];

    // Optional: who is the editor?
    let updatedByName: string | null = null;
    if (updated?.updatedById) {
      const u = await prisma.$queryRawUnsafe<any[]>(
        `SELECT name FROM "User" WHERE id = $1 LIMIT 1`,
        updated.updatedById,
      );
      updatedByName = u[0]?.name ?? null;
    }

    // Return the LIVE half-day-weighted used for this month (not the
    // vestigial stored column) so the panel reflects reality on save.
    const [yy, mm] = monthKey.split("-M").map(Number);
    const liveUsed = await computeWfhUsed(userId, new Date(Date.UTC(yy, mm - 1, 15)));

    return NextResponse.json({
      userId: updated.userId,
      monthKey: updated.monthKey,
      credited: updated.credited,
      used: liveUsed,
      remaining: Math.max(0, updated.credited - liveUsed),
      updatedAt: updated.updatedAt,
      updatedByName,
    });
  } catch (e) {
    return serverError(e, "PATCH /api/hr/wfh/balances/[userId]");
  }
}
