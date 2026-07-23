import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/attendance/wfh/balance?month=YYYY-MM
 *
 * Returns the WFH usage for the current user against the 2-per-month
 * cap. Counts pending + partially_approved + approved requests
 * (rejected / cancelled don't use up a slot), matching the quota gate
 * in ../route.ts. Defaults to the current calendar month when no
 * `month` query param is supplied.
 *
 *   { month: "2026-04", limit: 2, used: 1, remaining: 1 }
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const { searchParams } = new URL(req.url);
    const monthParam = searchParams.get("month");
    const now = new Date();
    let year:  number;
    let month: number; // 0-indexed for Date.UTC

    const parsed = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? { y: parseInt(monthParam.slice(0, 4), 10), m: parseInt(monthParam.slice(5, 7), 10) - 1 }
      : null;
    if (parsed) { year = parsed.y; month = parsed.m; }
    else        { year = now.getUTCFullYear(); month = now.getUTCMonth(); }

    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd   = new Date(Date.UTC(year, month + 1, 0));

    const used = await prisma.wFHRequest.count({
      where: {
        userId: myId,
        status: { in: ["pending", "partially_approved", "approved"] },
        date:   { gte: monthStart, lte: monthEnd },
      },
    });

    const limit = 2;
    return NextResponse.json({
      month: `${year}-${String(month + 1).padStart(2, "0")}`,
      limit,
      used,
      remaining: Math.max(0, limit - used),
    });
  } catch (e) { return serverError(e, "GET /api/hr/attendance/wfh/balance"); }
}
