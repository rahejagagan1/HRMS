import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";
import { resolveReportTeam, teamFunction } from "@/lib/reports/team-snapshot";

export const dynamic = "force-dynamic";

type Params = Promise<{ managerId: string; month: string }>;
/**
 * GET /api/reports/[managerId]/monthly/[month]/researcher-stats?year=2026
 *
 * Returns approved RTC case count and average rating for every researcher
 * under this manager, for the given month/year.
 */
export async function GET(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;


        const { managerId: managerIdRaw, month: monthRaw } = await params;
        const managerId = parseInt(managerIdRaw);
        const month     = parseInt(monthRaw);          // 0-indexed (Jan=0)
        const year      = parseInt(req.nextUrl.searchParams.get("year") ?? "");

        if (isNaN(managerId) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        // Date range for the month
        const monthStart = new Date(year, month, 1);
        const monthEnd   = new Date(year, month + 1, 0, 23, 59, 59, 999);

        // Fetch all researchers — prefer the locked report's team
        // snapshot so a researcher who later moved managers still shows
        // up under the period when they were on this manager's team.
        const team = await resolveReportTeam(managerId, { kind: "monthly", month, year });
        const researchers = team.filter((m) => teamFunction(m) === "researcher");

        if (researchers.length === 0) {
            return NextResponse.json({ stats: [] });
        }

        const researcherIds = researchers.map(r => r.id);

        // Fetch approved (done) cases for those researchers in this month
        const cases = await prisma.case.findMany({
            where: {
                researcherUserId: { in: researcherIds },
                statusType: "done",
                dateDone:   { gte: monthStart, lte: monthEnd },
            },
            select: {
                researcherUserId: true,
                caseRating:       true,
            },
        });

        // Group by researcher
        const grouped: Record<number, { count: number; ratings: number[] }> = {};
        for (const c of cases) {
            if (!c.researcherUserId) continue;
            if (!grouped[c.researcherUserId]) grouped[c.researcherUserId] = { count: 0, ratings: [] };
            grouped[c.researcherUserId].count++;
            if (c.caseRating !== null) {
                grouped[c.researcherUserId].ratings.push(Number(c.caseRating));
            }
        }

        const stats = researchers.map(r => {
            const g = grouped[r.id];
            const count = g?.count ?? 0;
            const ratings = g?.ratings ?? [];
            const avgRating = ratings.length
                ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)
                : null;
            return {
                userId:    r.id,
                name:      r.name,
                approvedCasesRTC: count,
                avgRating,
            };
        });

        return NextResponse.json({ stats });
    } catch (error) {
        return serverError(error, "route");
    }
}
