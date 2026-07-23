// GET /api/hr/pip-reviews/count → number of the caller's reports on a plan
// that's ending and still needs their action. Drives the sidebar badge.
import { NextResponse } from "next/server";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { pendingManagerPipCount } from "@/lib/hr/performance-plan-review";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const me = await resolveUserId(session);
    if (!me) return NextResponse.json({ count: 0 });
    return NextResponse.json({ count: await pendingManagerPipCount(me) });
  } catch (e) {
    return serverError(e, "GET /api/hr/pip-reviews/count");
  }
}
