// Exit survey API.
//   GET                  → caller's own status { inWindow, submitted, lastWorkingDay, answers }
//   GET ?userId=<id>     → HR: a user's submitted answers (for the profile tab)
//   POST { answers }     → caller submits their own exit survey
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, resolveUserId, isLeadershipOrHR, serverError } from "@/lib/api-auth";
import { getWindowExitForUser, getExitSurveyForUser, submitExitSurvey } from "@/lib/hr/exit-survey";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const userIdParam = req.nextUrl.searchParams.get("userId");
    if (userIdParam) {
      if (!isLeadershipOrHR(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const uid = Number(userIdParam);
      if (!Number.isInteger(uid) || uid <= 0) return NextResponse.json({ error: "Bad userId" }, { status: 400 });
      return NextResponse.json({ view: await getExitSurveyForUser(uid) });
    }

    const me = await resolveUserId(session);
    if (!me) return NextResponse.json({ error: "No user" }, { status: 400 });
    const e = await getWindowExitForUser(me);
    if (!e) return NextResponse.json({ inWindow: false });
    const view = await getExitSurveyForUser(me);
    return NextResponse.json({
      inWindow: true,
      submitted: e.submitted,
      lastWorkingDay: e.lastWorkingDay,
      answers: view?.answers ?? null,
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/exit-survey");
  }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const me = await resolveUserId(session);
    if (!me) return NextResponse.json({ error: "No user" }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const answers = (body?.answers && typeof body.answers === "object") ? body.answers : {};
    await submitExitSurvey(me, answers);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || "Failed to submit";
    if (/please answer|must be|invalid option|nothing to submit/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return serverError(e, "POST /api/hr/exit-survey");
  }
}
