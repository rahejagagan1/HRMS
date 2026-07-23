import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isHRAdmin, serverError } from "@/lib/api-auth";
import { accrueLeavesForEveryone, ymKey } from "@/lib/leave-accrual";
import { istTodayDateOnly } from "@/lib/ist-date";
import { getBrandScope } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/admin/leave-balances?year=2026
 *
 * HR-admin only. Returns one row per (active employee × leave type) for
 * the given year. Missing rows are returned as zeros so the UI can render
 * a complete matrix even before the first leave is filed.
 *
 * Shape:
 *   {
 *     year, leaveTypes: [{ id, name, code, daysPerYear }],
 *     employees: [{
 *       id, name, email, profilePictureUrl,
 *       balances: { [leaveTypeId]: { id?, total, used, pending } }
 *     }]
 *   }
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const self = session!.user as any;
  if (!isHRAdmin(self)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year") || istTodayDateOnly().getUTCFullYear());

    // Idempotent monthly accrual — guarantees the matrix reflects this
    // month's +1 Sick Leave for everyone before we read.
    try { await accrueLeavesForEveryone(); } catch (e) { /* swallow */ }

    // Brand-scope: NB Media HR Manager sees only NB Media users.
    const scope = getBrandScope(self);
    if (!scope.allBrands && !scope.brand) {
      return NextResponse.json({ year, leaveTypes: [], employees: [] });
    }
    const [users, leaveTypes, balances] = await Promise.all([
      prisma.user.findMany({
        where: {
          isActive: true,
          ...(scope.allBrands ? {} : { employeeProfile: { businessUnit: scope.brand! } }),
        },
        select: {
          id: true, name: true, email: true, profilePictureUrl: true,
          // Multi-brand: lets the admin Leave Balances grid split rows
          // into NB Media vs YT Labs tabs.
          employeeProfile: { select: { businessUnit: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.leaveType.findMany({
        where: { isActive: true },
        // Include `applicable` so the matrix UI can hide the policy-reset
        // button + apply-defaults pass for balance-only types like
        // Carry Over Leave.
        select: { id: true, name: true, code: true, daysPerYear: true, applicable: true },
        orderBy: { name: "asc" },
      }),
      prisma.leaveBalance.findMany({
        where: { year },
        select: {
          id: true, userId: true, leaveTypeId: true,
          totalDays: true, usedDays: true, pendingDays: true,
        },
      }),
    ]);

    // Index balances by `${userId}:${leaveTypeId}` for O(1) lookup.
    const idx = new Map<string, any>();
    for (const b of balances) idx.set(`${b.userId}:${b.leaveTypeId}`, b);

    const employees = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      profilePictureUrl: u.profilePictureUrl,
      businessUnit: (u as any).employeeProfile?.businessUnit ?? null,
      balances: leaveTypes.reduce<Record<number, any>>((acc, lt) => {
        const b = idx.get(`${u.id}:${lt.id}`);
        acc[lt.id] = b
          ? {
              id:      b.id,
              total:   Number(b.totalDays),
              used:    Number(b.usedDays),
              pending: Number(b.pendingDays),
            }
          : { id: null, total: 0, used: 0, pending: 0 };
        return acc;
      }, {}),
    }));

    return NextResponse.json({ year, leaveTypes, employees });
  } catch (e) { return serverError(e, "GET /api/hr/admin/leave-balances"); }
}

/**
 * PUT /api/hr/admin/leave-balances
 *
 * HR-admin only. Upserts a single (userId, leaveTypeId, year) balance row.
 * Any of `totalDays`, `usedDays`, `pendingDays` can be updated; missing
 * fields are left untouched on existing rows (and default to 0 on insert).
 *
 * Body:
 *   { userId, leaveTypeId, year, totalDays?, usedDays?, pendingDays? }
 */
export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const self = session!.user as any;
  if (!isHRAdmin(self)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const userId      = Number(body?.userId);
    const leaveTypeId = Number(body?.leaveTypeId);
    const year        = Number(body?.year || istTodayDateOnly().getUTCFullYear());
    if (!Number.isInteger(userId) || !Number.isInteger(leaveTypeId)) {
      return NextResponse.json({ error: "userId and leaveTypeId required" }, { status: 400 });
    }

    const numOrUndef = (v: any) => {
      if (v === undefined || v === null || v === "") return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const totalDays   = numOrUndef(body?.totalDays);
    const usedDays    = numOrUndef(body?.usedDays);
    const pendingDays = numOrUndef(body?.pendingDays);

    const updateData: any = {};
    if (totalDays   !== undefined) updateData.totalDays   = totalDays;
    if (usedDays    !== undefined) updateData.usedDays    = usedDays;
    if (pendingDays !== undefined) updateData.pendingDays = pendingDays;

    const row = await prisma.leaveBalance.upsert({
      where: { userId_leaveTypeId_year: { userId, leaveTypeId, year } },
      create: {
        userId, leaveTypeId, year,
        totalDays:   totalDays   ?? 0,
        usedDays:    usedDays    ?? 0,
        pendingDays: pendingDays ?? 0,
      },
      update: updateData,
    });

    // Initialise the accrual marker on freshly-created (or any legacy
    // null-stamped) row so monthly accrual never skips an HR-edited balance.
    // A null marker makes monthsBetween() === 0, which would otherwise leave
    // the row permanently invisible to accrual. We stamp the current month —
    // no retroactive credit, first accrual lands next month, matching the
    // seeding rule in accrueLeavesForUser. Only touches rows where the marker
    // is still null, so an existing stamp is never overwritten. Raw SQL keeps
    // this independent of the generated Prisma client's column awareness.
    await prisma.$executeRawUnsafe(
      `UPDATE "LeaveBalance" SET "lastAccrualMonth" = $1
         WHERE id = $2 AND "lastAccrualMonth" IS NULL`,
      ymKey(new Date()), row.id,
    );

    return NextResponse.json({
      id: row.id,
      total:   Number(row.totalDays),
      used:    Number(row.usedDays),
      pending: Number(row.pendingDays),
    });
  } catch (e) { return serverError(e, "PUT /api/hr/admin/leave-balances"); }
}
