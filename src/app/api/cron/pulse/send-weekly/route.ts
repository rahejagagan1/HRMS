// Friday 10:30 IST cron entry-point for the Weekly Pulse fanout.
//
// External cron (systemd timer / crontab on the VPS) hits this endpoint
// with:
//   Authorization: Bearer $CRON_SECRET
//
// We do an explicit "is it Friday?" check inside so an accidental
// every-day cron entry doesn't spam the team. The check uses IST so
// it lines up with the office calendar regardless of where the cron
// container thinks it lives.
//
// Manual fire (for HR to send today's pulse off-schedule, e.g. on
// reschedule from Tuesday): pass `?force=1` and the day-of-week check
// is skipped. Auth still required.

import { NextRequest, NextResponse } from "next/server";
import { serverError } from "@/lib/api-auth";
import { fanoutWeeklyPulse } from "@/lib/hr/pulse-announcement";
import { isPulseDay } from "@/lib/hr/pulse-week";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

async function handle(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get("authorization");
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const force = new URL(request.url).searchParams.get("force") === "1";
    if (!force && !isPulseDay()) {
      // Not Friday in IST. Don't spam — return ok with skipped: true
      // so the cron logs a clean no-op instead of an error.
      return NextResponse.json({ ok: true, skipped: true, reason: "Not Friday in IST" });
    }

    const result = await fanoutWeeklyPulse();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return serverError(e, "cron/pulse/send-weekly");
  }
}

export async function POST(request: NextRequest) { return handle(request); }
export async function GET(request: NextRequest)  { return handle(request); }
