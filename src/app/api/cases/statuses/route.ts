// Returns every distinct case status currently present in the DB.
// Drives the "Status" filter on /dashboard/cases — pulls from data
// instead of a hardcoded list so new statuses syncing in from ClickUp
// show up automatically without a code change.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// Title-case helper. ClickUp emits lowercase strings ("script qa") —
// we render a nicer label without changing the stored value (the filter
// still matches on the raw value).
function toLabel(value: string): string {
  return value
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export async function GET() {
  try {
    const { errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    // Distinct statuses + a count so we can sort by popularity (most
    // common first → keeps frequently-used statuses near the top).
    const rows = await prisma.$queryRawUnsafe<Array<{ status: string; n: bigint }>>(
      `SELECT "status", COUNT(*)::bigint AS n
         FROM "Case"
        WHERE "status" IS NOT NULL AND "status" <> ''
        GROUP BY "status"
        ORDER BY n DESC, "status" ASC`,
    );

    const statuses = rows.map((r) => ({
      value: r.status,
      label: toLabel(r.status),
      count: Number(r.n),
    }));

    return NextResponse.json({ statuses });
  } catch (error) {
    return serverError(error, "cases/statuses GET");
  }
}
