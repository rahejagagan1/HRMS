// Employee-facing: GET /api/hr/pulse/this-week
//
// Returns:
//   weekKey       — ISO week string (e.g. "2026-W23"), used as the
//                   submission key
//   activeWeek    — 1, 2, 3, or 4 — which seed week is active
//   theme         — friendly label for the week ("Mood & Wellbeing")
//   questions     — array of this week's active questions
//   hasSubmitted  — true if THIS user already submitted for this week
//   submittedAt   — when (if hasSubmitted)
//
// Auth required; no role gate — every employee can answer their own
// pulse.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { getActiveWeekNumber, getWeekKey } from "@/lib/hr/pulse-week";

export const dynamic = "force-dynamic";

const WEEK_THEMES: Record<number, string> = {
  1: "Mood & Wellbeing",
  2: "Manager & Team",
  3: "Workload & Resources",
  4: "Growth & Engagement",
};

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const userId = await resolveUserId(session);
    if (!userId) return NextResponse.json({ error: "Session user missing" }, { status: 401 });

    const weekKey = getWeekKey();
    const activeWeek = getActiveWeekNumber();

    // Look up the caller's brand. Strict brand separation —
    // each employee receives ONLY their brand's questions; no
    // shared/fallback layer. Employees without a businessUnit
    // set on their profile (dev accounts, sandbox users) see
    // an empty list.
    const profile = await prisma.employeeProfile.findUnique({
      where: { userId },
      select: { businessUnit: true },
    });
    const callerBrand = profile?.businessUnit ?? null;

    const questions = callerBrand
      ? await prisma.$queryRawUnsafe<any[]>(
          `SELECT id, "order", text, type, emojis
             FROM "PulseQuestion"
            WHERE "surveyType" = 'weekly' AND week = $1 AND "isActive" = true
              AND brand = $2
            ORDER BY "order" ASC`,
          activeWeek, callerBrand,
        )
      : [];

    // Existence check — any row for (userId, weekKey) means submitted.
    const submission = (await prisma.$queryRawUnsafe<any[]>(
      `SELECT MIN("submittedAt") AS "submittedAt"
         FROM "PulseResponse"
        WHERE "userId" = $1 AND "weekKey" = $2`,
      userId, weekKey,
    ))[0];
    const hasSubmitted = submission?.submittedAt != null;

    return NextResponse.json({
      weekKey,
      activeWeek,
      theme: WEEK_THEMES[activeWeek] ?? `Week ${activeWeek}`,
      questions,
      hasSubmitted,
      submittedAt: hasSubmitted ? submission.submittedAt : null,
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/pulse/this-week");
  }
}
