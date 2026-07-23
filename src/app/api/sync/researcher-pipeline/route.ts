import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getResearcherPipelineCounts } from "@/lib/clickup/researcher-pipeline";
import { serializeBigInt } from "@/lib/utils";

export const dynamic = "force-dynamic";

function hasAccess(session: any): boolean {
    const user = session?.user as any;
    const isDev = process.env.NODE_ENV === "development" && user?.role === "admin";
    return (
        user?.isDeveloper === true ||
        user?.orgLevel === "ceo" ||
        user?.orgLevel === "special_access" ||
        isDev
    );
}

/**
 * POST /api/sync/researcher-pipeline?month=2026-03
 *
 * Fetches RTC + FOIA + FOIA Pitched list metrics from ClickUp for the given month
 * and upserts into ResearcherPipelineSnapshot (one row per month, no duplicates).
 *
 * If no month is provided, defaults to current month.
 */
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        let monthParam = searchParams.get("month");

        // Default to current month
        if (!monthParam) {
            const now = new Date();
            monthParam = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
        }

        const [year, mon] = monthParam.split("-").map(Number);
        if (!year || !mon || mon < 1 || mon > 12) {
            return NextResponse.json({ error: "Invalid month format. Use YYYY-MM" }, { status: 400 });
        }

        const monthDate = new Date(Date.UTC(year, mon - 1, 1));

        // Fetch live from ClickUp
        const result = await getResearcherPipelineCounts(monthParam);

        // Upsert — one row per month, always update to latest
        const snapshot = await prisma.researcherPipelineSnapshot.upsert({
            where: { month: monthDate },
            create: {
                month: monthDate,
                rtcCount: result.rtc,
                foiaCount: result.foia,
                totalCount: result.total,
                rtcCaseRatingAvg: result.rtcCaseRatingAvg,
                foiaCaseRatingAvg: result.foiaCaseRatingAvg,
                foiaPitchedCount: result.foiaPitched,
                foiaPitchedCaseRatingAvg: result.foiaPitchedCaseRatingAvg,
                caseRatingAvgCombined: result.caseRatingAvgCombined,
                rtcListName: result.rtcListName,
                foiaListName: result.foiaListName,
                foiaPitchedListName: result.foiaPitchedListName,
                syncError: result.error || null,
                syncedAt: new Date(),
            },
            update: {
                rtcCount: result.rtc,
                foiaCount: result.foia,
                totalCount: result.total,
                rtcCaseRatingAvg: result.rtcCaseRatingAvg,
                foiaCaseRatingAvg: result.foiaCaseRatingAvg,
                foiaPitchedCount: result.foiaPitched,
                foiaPitchedCaseRatingAvg: result.foiaPitchedCaseRatingAvg,
                caseRatingAvgCombined: result.caseRatingAvgCombined,
                rtcListName: result.rtcListName,
                foiaListName: result.foiaListName,
                foiaPitchedListName: result.foiaPitchedListName,
                syncError: result.error || null,
                syncedAt: new Date(),
            },
        });

        return NextResponse.json(serializeBigInt({
            success: true,
            month: monthParam,
            snapshot,
            clickupResult: result,
        }));
    } catch (error: any) {
        console.error("[sync/researcher-pipeline] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * GET /api/sync/researcher-pipeline?month=2026-03
 *
 * Returns the stored snapshot for the given month (no ClickUp call).
 */
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const monthParam = searchParams.get("month");

        if (!monthParam) {
            // Return all snapshots
            const all = await prisma.researcherPipelineSnapshot.findMany({
                orderBy: { month: "desc" },
            });
            return NextResponse.json(serializeBigInt(all));
        }

        const [year, mon] = monthParam.split("-").map(Number);
        if (!year || !mon || mon < 1 || mon > 12) {
            return NextResponse.json({ error: "Invalid month format. Use YYYY-MM" }, { status: 400 });
        }

        const monthDate = new Date(Date.UTC(year, mon - 1, 1));
        const snapshot = await prisma.researcherPipelineSnapshot.findUnique({
            where: { month: monthDate },
        });

        if (!snapshot) {
            return NextResponse.json({ error: "No snapshot found for this month. Run a sync first." }, { status: 404 });
        }

        return NextResponse.json(serializeBigInt(snapshot));
    } catch (error: any) {
        console.error("[sync/researcher-pipeline GET] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
