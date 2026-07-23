// Employee-facing: GET /api/hr/pulse/this-month
//
// Mirror of /api/hr/pulse/this-week but for the MONTHLY engagement
// survey. Returns:
//   monthKey      — "<year>-M<month>" (e.g. "2026-M06"), the
//                   submission key (stored in PulseResponse.weekKey)
//   monthLabel    — friendly month label ("June 2026")
//   questions     — array of active monthly questions for the
//                   caller's brand (strict brand separation)
//   hasSubmitted  — true if THIS user already submitted this month
//   submittedAt   — when (if hasSubmitted)
//
// Auth required; no role gate — every employee answers their own
// survey. Unlike the weekly pulse, the monthly survey does NOT
// block clock-out.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { getMonthKey, prettyMonth } from "@/lib/hr/pulse-week";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const userId = await resolveUserId(session);
    if (!userId) return NextResponse.json({ error: "Session user missing" }, { status: 401 });

    const monthKey = getMonthKey();

    // Strict brand separation — the caller only sees their brand's
    // monthly questions. Employees without a businessUnit (dev /
    // sandbox accounts) get an empty list.
    const profile = await prisma.employeeProfile.findUnique({
      where: { userId },
      select: { businessUnit: true },
    });
    const callerBrand = profile?.businessUnit ?? null;

    const questions = callerBrand
      ? await prisma.$queryRawUnsafe<any[]>(
          `SELECT id, "order", text, type, emojis
             FROM "PulseQuestion"
            WHERE "surveyType" = 'monthly' AND "isActive" = true
              AND brand = $1
            ORDER BY "order" ASC`,
          callerBrand,
        )
      : [];

    // Existence check — any PulseResponse row for (userId, monthKey)
    // means the user already submitted this month. monthKey is stored
    // in the weekKey column (the cycleKey for monthly cycles).
    const submission = (await prisma.$queryRawUnsafe<any[]>(
      `SELECT MIN("submittedAt") AS "submittedAt"
         FROM "PulseResponse"
        WHERE "userId" = $1 AND "weekKey" = $2`,
      userId, monthKey,
    ))[0];
    const hasSubmitted = submission?.submittedAt != null;

    return NextResponse.json({
      monthKey,
      monthLabel: prettyMonth(monthKey),
      questions,
      hasSubmitted,
      submittedAt: hasSubmitted ? submission.submittedAt : null,
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/pulse/this-month");
  }
}
