import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireAdmin, resolveUserId, serverError, isHRAdmin } from "@/lib/api-auth";
import { accrueLeavesForUser, ymKey } from "@/lib/leave-accrual";
import { istTodayDateOnly } from "@/lib/ist-date";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const { searchParams } = new URL(req.url);
    // HR-admin tier (ceo / dev / special_access / role=admin / hr_manager) can
    // read any employee's leave balance via ?userId= — matches the leaves-list
    // API and powers the read-only Leave view on the employee profile. Leave
    // balances are not salary, so this uses the broad HR-admin gate (not the
    // narrower canViewSalary tier).
    const isAdmin = isHRAdmin(self);
    const userIdParam = searchParams.get("userId");
    const requestedUserId = Number(userIdParam);
    // Admins may target another employee via ?userId=; a missing or malformed
    // param (and any non-admin caller) falls back to the caller's own id.
    const userId = isAdmin && userIdParam && Number.isFinite(requestedUserId) ? requestedUserId : myId;
    const year = parseInt(searchParams.get("year") || String(istTodayDateOnly().getUTCFullYear()));

    // Interns don't accrue or use Casual Leave — per HR policy, the
    // Intern Leave Plan has no CL entry. We strip CL out of both the
    // self-heal pass below and the returned list so the UI never
    // surfaces it for them (widget, leaves page, apply-leave dropdown).
    const profile = await prisma.employeeProfile.findUnique({
      where: { userId }, select: { employmentType: true },
    });
    const isIntern = profile?.employmentType === "intern";
    const HIDDEN_CODES_FOR_INTERNS = ["CL"];

    // Self-heal: ensure the user has a LeaveBalance row for every active
    // LeaveType in the requested year. Every type defaults to 0 days —
    // Sick Leave fills via monthly accrual; everything else is HR-managed
    // through the admin matrix.
    const allTypes = await prisma.leaveType.findMany({
      where: { isActive: true }, select: { id: true, code: true, daysPerYear: true },
    });
    const types = isIntern
      ? allTypes.filter((t) => !HIDDEN_CODES_FOR_INTERNS.includes(t.code))
      : allTypes;
    const existing = await prisma.leaveBalance.findMany({
      where: { userId, year }, select: { leaveTypeId: true },
    });
    const existingTypeIds = new Set(existing.map((b) => b.leaveTypeId));
    const missing = types.filter((t) => !existingTypeIds.has(t.id));
    if (missing.length > 0) {
      const currentYm = ymKey(new Date());
      // Use createMany for typed columns, then patch lastAccrualMonth via raw
      // SQL so we don't depend on a freshly-generated Prisma client.
      await prisma.leaveBalance.createMany({
        data: missing.map((t) => ({
          userId,
          leaveTypeId: t.id,
          year,
          totalDays:   0,
          usedDays:    0,
          pendingDays: 0,
        })),
        skipDuplicates: true,
      });
      await prisma.$executeRawUnsafe(
        `UPDATE "LeaveBalance" SET "lastAccrualMonth" = $1
           WHERE "userId" = $2 AND year = $3 AND "lastAccrualMonth" IS NULL`,
        currentYm, userId, year,
      );
    }

    // Lazy monthly accrual: bumps Sick Leave by 1 day for every full month
    // since the last accrual stamp. Idempotent — same-month re-reads do
    // nothing.
    try { await accrueLeavesForUser(userId); } catch (e) { /* swallow — read should still succeed */ }

    const balances = await prisma.leaveBalance.findMany({
      where: { userId, year }, include: { leaveType: true },
    });
    // Drop any historical CL row for interns — they may have a leftover
    // from a prior policy that we don't want surfacing in the UI now.
    const filtered = isIntern
      ? balances.filter((b) => !HIDDEN_CODES_FOR_INTERNS.includes(b.leaveType?.code ?? ""))
      : balances;
    return NextResponse.json(filtered);
  } catch (e) { return serverError(e, "GET /api/hr/leaves/balance"); }
}

export async function POST(req: NextRequest) {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;
  try {
    const { userId, year } = await req.json();
    const types = await prisma.leaveType.findMany({ where: { isActive: true } });
    const results = await Promise.all(
      types.map((lt) =>
        prisma.leaveBalance.upsert({
          where: { userId_leaveTypeId_year: { userId, leaveTypeId: lt.id, year } },
          create: { userId, leaveTypeId: lt.id, year, totalDays: lt.daysPerYear, usedDays: 0, pendingDays: 0 },
          update: {},
        })
      )
    );
    return NextResponse.json(results);
  } catch (e) { return serverError(e, "POST /api/hr/leaves/balance"); }
}
