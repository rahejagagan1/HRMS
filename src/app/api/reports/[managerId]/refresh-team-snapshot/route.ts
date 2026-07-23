// Admin-only "Refresh team snapshot" — overwrites the frozen
// teamSnapshot on a locked report with the CURRENT team membership.
//
// Intended workflow for backfilling historical reports:
//   1. HR temporarily reverts User.managerId values to match what the
//      team WAS during the report period (e.g. set Suraj back from B
//      to A so March's roster is right again).
//   2. Hit this endpoint for the report — it snapshots the team as
//      it currently is into the report row. Now the snapshot reflects
//      the historical truth, persisted forever.
//   3. HR puts User.managerId values back to today's truth.
//
// Without this endpoint, that recovery would require unlocking and
// re-saving the report, which would also touch every other field.
// Single-purpose action so it can't accidentally mutate report content.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { writeSnapshot, liveTeam } from "@/lib/reports/team-snapshot";

export const dynamic = "force-dynamic";

type Params = Promise<{ managerId: string }>;

// Mirrors hasProtectedRole in src/lib/permissions/resolve.ts — the top
// admin tier. Only these users can rewrite a frozen snapshot.
function canRefreshSnapshot(session: any): boolean {
  const u = session?.user;
  if (!u) return false;
  return (
    u.orgLevel === "ceo" ||
    u.orgLevel === "special_access" ||
    u.role === "admin" ||
    u.isDeveloper === true
  );
}

// POST /api/reports/[managerId]/refresh-team-snapshot
// Body: { period: "monthly" | "weekly", month: number, year: number, week?: number }
export async function POST(req: NextRequest, { params }: { params: Params }) {
  try {
    const { session, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    if (!canRefreshSnapshot(session)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { managerId: managerIdRaw } = await params;
    const managerId = parseInt(managerIdRaw);
    if (isNaN(managerId)) {
      return NextResponse.json({ error: "Invalid managerId" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const periodKind = body?.period;
    const month = Number(body?.month);
    const year  = Number(body?.year);
    const week  = body?.week !== undefined ? Number(body.week) : null;

    if (periodKind !== "monthly" && periodKind !== "weekly") {
      return NextResponse.json({ error: 'period must be "monthly" or "weekly"' }, { status: 400 });
    }
    if (!Number.isFinite(month) || !Number.isFinite(year)) {
      return NextResponse.json({ error: "month and year are required" }, { status: 400 });
    }
    if (periodKind === "weekly" && (!Number.isFinite(week) || week === null)) {
      return NextResponse.json({ error: "week is required for weekly period" }, { status: 400 });
    }

    // Confirm the target report exists — we don't auto-create rows from
    // this endpoint, only refresh existing snapshots.
    let exists: { id: number } | null = null;
    if (periodKind === "monthly") {
      exists = await prisma.monthlyReport.findUnique({
        where: { managerId_month_year: { managerId, month, year } },
        select: { id: true },
      });
    } else {
      exists = await prisma.weeklyReport.findUnique({
        where: { managerId_week_month_year: { managerId, week: week as number, month, year } },
        select: { id: true },
      });
    }
    if (!exists) {
      return NextResponse.json({ error: "Report not found for that period" }, { status: 404 });
    }

    const roster = await liveTeam(managerId);
    await writeSnapshot(
      managerId,
      periodKind === "monthly"
        ? { kind: "monthly", month, year }
        : { kind: "weekly", week: week as number, month, year },
      roster,
    );

    return NextResponse.json({ ok: true, team: roster });
  } catch (error) {
    return serverError(error, "reports/refresh-team-snapshot POST");
  }
}
