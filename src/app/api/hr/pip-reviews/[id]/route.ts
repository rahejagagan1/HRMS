// POST /api/hr/pip-reviews/:id → HR approves or rejects a manager's PIP
// recommendation. Approve applies the action (extend / pass / end).
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, resolveUserId, isLeadershipOrHR, serverError } from "@/lib/api-auth";
import { decidePipReview } from "@/lib/hr/performance-plan-review";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isLeadershipOrHR(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id } = await params;
    const reviewId = Number(id);
    if (!Number.isInteger(reviewId) || reviewId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const me = await resolveUserId(session);
    if (!me) return NextResponse.json({ error: "No user" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    if (body?.decision !== "approve" && body?.decision !== "reject") {
      return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 });
    }

    await decidePipReview({
      reviewId,
      hrUserId: me,
      decision: body.decision as "approve" | "reject",
      hrNote: body?.hrNote ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || "Failed";
    if (/already decided|not found/i.test(msg)) return NextResponse.json({ error: msg }, { status: 400 });
    return serverError(e, "POST /api/hr/pip-reviews/[id]");
  }
}
