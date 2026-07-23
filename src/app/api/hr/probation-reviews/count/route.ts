// GET /api/hr/probation-reviews/count → number of the caller's reports whose
// probation is ending and still need their action. Drives the sidebar badge.
import { NextResponse } from "next/server";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { pendingManagerReviewCount } from "@/lib/hr/probation-review";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const me = await resolveUserId(session);
    if (!me) return NextResponse.json({ count: 0 });
    return NextResponse.json({ count: await pendingManagerReviewCount(me) });
  } catch (e) {
    return serverError(e, "GET /api/hr/probation-reviews/count");
  }
}
