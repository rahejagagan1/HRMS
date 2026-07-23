// First-Monday-of-the-month 10:30 IST cron entry-point for the
// Monthly Survey fanout.
//
// External cron (systemd timer / crontab on the VPS) hits this
// endpoint with:
//   Authorization: Bearer $CRON_SECRET
//
// Recommended crontab — first Monday at 10:30 IST (05:00 UTC if
// VPS is UTC; 10:30 if VPS is IST):
//   0 5 1-7 * 1  curl -sS -X POST -H "Authorization: Bearer …" \
//                 http://localhost:3005/api/cron/pulse/send-monthly
//
// ⚠ DO NOT REMOVE the isFirstMondayOfMonth() guard below.
//
// Vixie / Debian / RHEL / Alpine cron — every mainstream Linux
// cron daemon — OR's day-of-month and day-of-week when BOTH are
// restricted (the man page is explicit: "If both fields are
// restricted (aren't *), the command will be run when either
// field matches"). So `0 5 1-7 * 1` actually fires:
//
//   • Every day 1-7 of the month at 05:00 UTC  (~7 fires/month)
//   • PLUS every Monday at 05:00 UTC            (~4 fires/month)
//   ───────────────────────────────────────────────────────────
//   → ~10-11 firings/month at the cron-daemon level
//
// The isFirstMondayOfMonth() check inside this route is what
// reduces those 10 firings to a single actual fanout per month.
// It is LOAD-BEARING, not a belt-and-suspenders. Removing it
// would cause the monthly survey to fanout ~10× per month —
// inboxes will be flooded.
//
// Pass `?force=1` to skip the date check — useful for HR to
// resend off-schedule (e.g. when the first Monday is a holiday).

import { NextRequest, NextResponse } from "next/server";
import { serverError } from "@/lib/api-auth";
import { fanoutMonthlySurvey } from "@/lib/hr/pulse-monthly-announcement";
import { isFirstMondayOfMonth } from "@/lib/hr/pulse-week";

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
    if (!force && !isFirstMondayOfMonth()) {
      return NextResponse.json({
        ok: true, skipped: true, reason: "Not the first Monday of the month in IST",
      });
    }

    const result = await fanoutMonthlySurvey();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return serverError(e, "cron/pulse/send-monthly");
  }
}

export async function POST(request: NextRequest) { return handle(request); }
export async function GET(request: NextRequest)  { return handle(request); }
