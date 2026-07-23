// POST /api/hr/probation-reviews/revert  → HR reopens an employee's probation
// (un-confirm / un-end + a new probation end date). HR / leadership only.
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, resolveUserId, isLeadershipOrHR, serverError } from "@/lib/api-auth";
import { revertToProbation } from "@/lib/hr/probation-review";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isLeadershipOrHR(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const me = await resolveUserId(session);
    if (!me) return NextResponse.json({ error: "No user" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const employeeUserId = Number(body?.employeeUserId);
    const newEndDate = String(body?.newEndDate ?? "").trim();
    if (!Number.isInteger(employeeUserId) || employeeUserId <= 0) {
      return NextResponse.json({ error: "employeeUserId required" }, { status: 400 });
    }
    if (!newEndDate) return NextResponse.json({ error: "A new probation end date is required" }, { status: 400 });

    await revertToProbation({ employeeUserId, hrUserId: me, newEndDate });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || "Failed";
    if (/required|invalid|must be in the future|not found/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return serverError(e, "POST /api/hr/probation-reviews/revert");
  }
}
