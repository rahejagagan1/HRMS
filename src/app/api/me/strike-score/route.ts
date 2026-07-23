import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { computeStrikeScore, STRIKE_LIMIT } from "@/lib/hr/strike-score";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/strike-score
 *
 * The logged-in employee's own strike score — the sum of every strike's
 * level (L0=0, L1=1, L2=2, L3=3), plus the raw count and a per-tier
 * breakdown. Self-only: a user can never read anyone else's score here
 * (HR sees everyone via the Strike Log). Safe to render on any
 * employee-facing surface.
 *
 * Response: { score, count, byTier: { L0, L1, L2, L3 } }
 */
export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const myId = await resolveUserId(session);
    if (!myId) {
      return NextResponse.json({ score: 0, count: 0, limit: STRIKE_LIMIT, remaining: STRIKE_LIMIT, byTier: { L0: 0, L1: 0, L2: 0, L3: 0 } });
    }
    // Only ACTIVE (non-closed) strikes count toward the visible score, so
    // once HR closes a strike it stops adding to the number — and when the
    // last one is closed the score drops to 0 and the card hides itself.
    // "closed" is an original enum value (safe on a stale client); this
    // still includes open / in_progress / paused. severity is the
    // low/medium/high/critical enum — also safe.
    const strikes = await prisma.violation.findMany({
      where: { userId: myId, status: { not: "closed" } },
      select: { severity: true },
    });
    return NextResponse.json(computeStrikeScore(strikes));
  } catch (e) {
    return serverError(e, "GET /api/me/strike-score");
  }
}
