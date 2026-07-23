import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, isHRAdmin, serverError } from "@/lib/api-auth";
import { istMonthRange, istTodayDateOnly } from "@/lib/ist-date";
import { isRegularizationUnlimited } from "@/app/api/hr/policy/regularization-unlimited/route";

export const dynamic = "force-dynamic";

// Matches the constant in ../route.ts. Keep them in sync.
const REGULARIZATION_MONTHLY_QUOTA = 2;

/**
 * GET /api/hr/attendance/regularize/balance?date=YYYY-MM-DD
 *
 * Returns the caller's regularization quota usage for the IST month that
 * contains the given date (defaults to today's IST month).
 *
 * Response: { used, limit, remaining, month: "April 2026", start, end }
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date");
    const ref = dateParam ? new Date(dateParam) : istTodayDateOnly();
    const { start, end } = istMonthRange(ref);

    const [used, orgUnlimited] = await Promise.all([
      prisma.attendanceRegularization.count({
        where: {
          userId: myId,
          date: { gte: start, lte: end },
          status: { in: ["pending", "partially_approved", "approved"] },
        },
      }),
      isRegularizationUnlimited(),
    ]);
    // HR-team self-applies are uncapped (2026-07-15, matches the POST gate):
    // report unlimited so the modal doesn't disable the submit button at 2/2.
    const unlimited = orgUnlimited || isHRAdmin(session!.user);

    return NextResponse.json({
      used,
      limit: unlimited ? null : REGULARIZATION_MONTHLY_QUOTA,
      remaining: unlimited ? null : Math.max(0, REGULARIZATION_MONTHLY_QUOTA - used),
      unlimited,
      month: start.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      start: start.toISOString(),
      end:   end.toISOString(),
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/attendance/regularize/balance");
  }
}
