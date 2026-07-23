// GET /api/hr/wfh/balance
//
// Returns the caller's current month WFH usage:
//   { credited, used, remaining, monthKey, brand, limitEnabled }
//
// Used by the WFH request form to render the "X of Y used this
// month" badge BEFORE the employee submits.
//
// Auth: any logged-in employee — they only ever see their own
// numbers. HR Manager can pass ?userId=N to peek at another
// employee's balance (used by the people page).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { getBalance } from "@/lib/hr/wfh-balance";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const callerId = await resolveUserId(session);
    if (!callerId) return NextResponse.json({ error: "Session user missing" }, { status: 401 });

    const url = new URL(req.url);
    const requestedRaw = url.searchParams.get("userId");
    let targetId = callerId;
    if (requestedRaw) {
      const n = parseInt(requestedRaw, 10);
      if (!Number.isInteger(n) || n <= 0) {
        return NextResponse.json({ error: "Bad userId" }, { status: 400 });
      }
      // Anyone can read their own; HR-admin can read anyone's.
      if (n !== callerId && !isHRAdmin(session!.user)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      targetId = n;
    }

    const profile = await prisma.employeeProfile.findUnique({
      where: { userId: targetId },
      select: { businessUnit: true },
    });
    const balance = await getBalance(targetId, profile?.businessUnit ?? null);

    return NextResponse.json({
      userId: targetId,
      brand: profile?.businessUnit ?? null,
      monthKey: balance.monthKey,
      credited: balance.credited,
      used: balance.used,
      remaining: balance.remaining,
      limitEnabled: balance.policy.limitEnabled,
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/wfh/balance");
  }
}
