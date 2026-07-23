// POST /api/hr/probation-reviews/:id  → HR approves or rejects a manager's
// recommendation. Approve applies the action (extend / confirm + letter / end).
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, resolveUserId, isLeadershipOrHR, serverError } from "@/lib/api-auth";
import { decideProbationReview } from "@/lib/hr/probation-review";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // confirmation-letter PDF needs the Node runtime

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
    // Never default a destructive action — require an explicit, valid decision.
    if (body?.decision !== "approve" && body?.decision !== "reject") {
      return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 });
    }
    const decision = body.decision as "approve" | "reject";

    await decideProbationReview({
      reviewId,
      hrUserId: me,
      decision,
      hrNote: body?.hrNote ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || "Failed";
    if (/already decided|not found/i.test(msg)) return NextResponse.json({ error: msg }, { status: 400 });
    return serverError(e, "POST /api/hr/probation-reviews/[id]");
  }
}
