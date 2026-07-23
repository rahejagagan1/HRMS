// HR-admin: GET /api/hr/pulse/cycles?surveyType=…&brand=…
//
// Lists the cycles (weeks for weekly, months for monthly) that have at
// least one response from the selected brand's employees — newest first —
// so the Responses view can offer a "past weeks" picker. The current
// cycle is always included (even with 0 responses) so HR can see the
// live one. Anonymity-safe: returns only the cycle key + a respondent
// COUNT, never any per-person data.
//
// Response: { current, cycles: [{ key, label, responded, isCurrent }] }

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { getCycleKey, prettyWeek, prettyMonth } from "@/lib/hr/pulse-week";

export const dynamic = "force-dynamic";

function normalizeBrand(raw: string | null | undefined): "NB Media" | "YT Labs" {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "yt_labs" || s === "ytlabs" || s === "yt labs") return "YT Labs";
  return "NB Media";
}

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const surveyType: "weekly" | "monthly" =
      url.searchParams.get("surveyType") === "monthly" ? "monthly" : "weekly";
    const brand = normalizeBrand(url.searchParams.get("brand"));
    // weekKey holds either "YYYY-Www" (weekly) or "YYYY-Mmm" (monthly) —
    // the prefix letter scopes by survey type without joining questions.
    const like = surveyType === "monthly" ? "%-M%" : "%-W%";

    // Distinct cycles with a respondent count, brand-scoped via
    // EmployeeProfile.businessUnit (same scoping the /responses route uses).
    let rows: Array<{ key: string; responded: number }> = [];
    try {
      rows = await prisma.$queryRawUnsafe<Array<{ key: string; responded: number }>>(
        `SELECT r."weekKey" AS key, count(DISTINCT r."userId")::int AS responded
           FROM "PulseResponse" r
           JOIN "User" u ON u.id = r."userId"
           LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
          WHERE ep."businessUnit" = $1 AND r."weekKey" LIKE $2
          GROUP BY r."weekKey"
          ORDER BY r."weekKey" DESC`,
        brand, like,
      );
    } catch (e) {
      console.warn("[pulse/cycles] query failed:", e);
    }

    const current = getCycleKey(surveyType);
    if (!rows.some((r) => r.key === current)) {
      rows.unshift({ key: current, responded: 0 }); // always offer the live cycle
    }

    const label = (k: string) => (surveyType === "monthly" ? prettyMonth(k) : prettyWeek(k));
    return NextResponse.json({
      current,
      cycles: rows.map((r) => ({
        key: r.key,
        label: label(r.key),
        responded: Number(r.responded) || 0,
        isCurrent: r.key === current,
      })),
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/pulse/cycles");
  }
}
