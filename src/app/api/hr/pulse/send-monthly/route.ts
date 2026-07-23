// HR-triggered: POST /api/hr/pulse/send-monthly
//
// Fires the Monthly Survey fanout. Unlike the Weekly Pulse cron,
// this endpoint is invoked by HR clicking a button — they decide
// when to send (typically last working day of the month). Returns
// the fanout result (recipient count, sends, failures).

import { NextResponse } from "next/server";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { fanoutMonthlySurvey } from "@/lib/hr/pulse-monthly-announcement";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function POST() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await fanoutMonthlySurvey();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return serverError(e, "POST /api/hr/pulse/send-monthly");
  }
}
