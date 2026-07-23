import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { istTodayDateOnly } from "@/lib/ist-date";

export const dynamic = "force-dynamic";
type Params = Promise<{ id: string }>;

// POST /api/hr/admin/leave-policies/[id]/apply?year=Y
//
// For every active user assigned to this policy, upserts a LeaveBalance
// row for the (user × leaveType × year) with totalDays = entry.daysPerYear.
// Preserves usedDays / pendingDays on existing rows. Returns counts so
// the UI can confirm what happened.
export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user as any)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id: idRaw } = await params;
    const policyId = parseInt(idRaw);
    if (isNaN(policyId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const year = parseInt(
      req.nextUrl.searchParams.get("year") || String(istTodayDateOnly().getUTCFullYear()),
    );
    if (isNaN(year)) return NextResponse.json({ error: "Invalid year" }, { status: 400 });

    const policy = await prisma.leavePolicy.findUnique({
      where: { id: policyId },
      include: { entries: true, users: { where: { isActive: true }, select: { id: true } } },
    });
    if (!policy) return NextResponse.json({ error: "Policy not found" }, { status: 404 });

    const users   = policy.users;
    const entries = policy.entries;
    if (users.length === 0) {
      return NextResponse.json({ ok: true, usersTouched: 0, rowsCreated: 0, rowsSkipped: 0 });
    }

    // "Seed-only" mode: for each (user × policy_entry) ensure a LeaveBalance
    // row exists. If it does NOT exist, create it with totalDays = policy
    // daysPerYear (the row needs to exist for monthly accrual to write into).
    // If it ALREADY exists, leave totalDays alone — HR manages balances
    // manually via the Leave Balances matrix, and re-runs of Apply must
    // never wipe their values. Non-policy types are never touched.
    let rowsCreated = 0;
    let rowsSkipped = 0;
    for (const u of users) {
      for (const e of entries) {
        const existing = await prisma.leaveBalance.findUnique({
          where: { userId_leaveTypeId_year: { userId: u.id, leaveTypeId: e.leaveTypeId, year } },
          select: { id: true },
        });
        if (existing) { rowsSkipped += 1; continue; }
        await prisma.leaveBalance.create({
          data: {
            userId:      u.id,
            leaveTypeId: e.leaveTypeId,
            year,
            totalDays:   e.daysPerYear,
            usedDays:    0,
            pendingDays: 0,
          },
        });
        rowsCreated += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      usersTouched: users.length,
      rowsCreated,
      rowsSkipped,
    });
  } catch (e) { return serverError(e, "POST /api/hr/admin/leave-policies/[id]/apply"); }
}
