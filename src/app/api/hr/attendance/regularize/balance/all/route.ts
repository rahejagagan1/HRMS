import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { istMonthRange, istTodayDateOnly, istDateOnlyFrom } from "@/lib/ist-date";
import { isRegularizationUnlimited } from "@/app/api/hr/policy/regularization-unlimited/route";

export const dynamic = "force-dynamic";

// Mirrors REGULARIZATION_MONTHLY_QUOTA in ../../route.ts.
const REGULARIZATION_MONTHLY_QUOTA = 2;

/**
 * GET /api/hr/attendance/regularize/balance/all?date=YYYY-MM-DD
 *
 * Developer-only. Returns every active employee's regularization quota
 * usage for the IST month containing `date` (defaults to today's IST
 * month). Active = pending, partially_approved and approved requests
 * count, matching the quota gate in ../../route.ts and the per-user
 * balance endpoint at ../route.ts.
 *
 * The view is deliberately gated to `isDeveloper === true` only — not
 * even CEO / HR Manager. It's a debugging/operational view, not part
 * of the day-to-day HR admin surface.
 *
 * Shape:
 *   {
 *     month, start, end, unlimited, limit,
 *     employees: [{
 *       userId, name, email, profilePictureUrl,
 *       role, orgLevel, used, limit, remaining
 *     }]
 *   }
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const self = session!.user as any;
  if (self?.isDeveloper !== true) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date");
    const ref = dateParam ? istDateOnlyFrom(new Date(dateParam)) : istTodayDateOnly();
    const { start, end } = istMonthRange(ref);

    const [users, counts, unlimited] = await Promise.all([
      prisma.user.findMany({
        where: {
          isActive: true,
          // Hide exited employees whose isActive flag was never flipped —
          // same past-last-working-day test as the master-sheet "active" filter.
          NOT: { employeeExit: { lastWorkingDay: { lt: istTodayDateOnly() } } },
        },
        select: {
          id: true, name: true, email: true,
          profilePictureUrl: true, role: true, orgLevel: true,
          // Multi-brand: needed by the HR-admin Regularization Balance
          // panel so it can split rows into NB Media vs YT Labs tabs.
          employeeProfile: { select: { businessUnit: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.attendanceRegularization.groupBy({
        by: ["userId"],
        where: {
          date: { gte: start, lte: end },
          status: { in: ["pending", "partially_approved", "approved"] },
        },
        _count: { _all: true },
      }),
      isRegularizationUnlimited(),
    ]);

    const usedById = new Map<number, number>(
      counts.map((c) => [c.userId, c._count._all])
    );

    const employees = users.map((u) => {
      const used = usedById.get(u.id) ?? 0;
      return {
        userId: u.id,
        name: u.name,
        email: u.email,
        profilePictureUrl: u.profilePictureUrl,
        role: u.role,
        orgLevel: u.orgLevel,
        businessUnit: (u as any).employeeProfile?.businessUnit ?? null,
        used,
        limit: unlimited ? null : REGULARIZATION_MONTHLY_QUOTA,
        remaining: unlimited ? null : Math.max(0, REGULARIZATION_MONTHLY_QUOTA - used),
      };
    });

    return NextResponse.json({
      month: start.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      start: start.toISOString(),
      end:   end.toISOString(),
      unlimited,
      limit: unlimited ? null : REGULARIZATION_MONTHLY_QUOTA,
      employees,
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/attendance/regularize/balance/all");
  }
}
