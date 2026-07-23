import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { getWeeklyReportPeriod } from "@/lib/reports/weekly-period";

export const dynamic = "force-dynamic";

type Params = Promise<{ managerId: string; week: string }>;
export async function GET(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;


        const { managerId: managerIdRaw, week: weekRaw } = await params;
        const managerId = parseInt(managerIdRaw);
        const week      = parseInt(weekRaw);
        const month     = parseInt(req.nextUrl.searchParams.get("month") ?? "");
        const year      = parseInt(req.nextUrl.searchParams.get("year")  ?? "");

        if (isNaN(managerId) || isNaN(week) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const period = getWeeklyReportPeriod(year, month, week);
        if (!period) {
            return NextResponse.json({ error: "Invalid week for this month" }, { status: 400 });
        }
        const { weekStart, weekEnd } = period;

        // Fetch cases where scriptQaStartDate falls within this week
        const cases = await prisma.case.findMany({
            where: {
                scriptQaStartDate: {
                    gte: weekStart,
                    lte: weekEnd,
                },
            },
            include: {
                writer: { select: { id: true, name: true } },
                productionList: {
                    select: {
                        name: true,
                        capsule: { select: { shortName: true, name: true } },
                    },
                },
            },
            orderBy: { scriptQaStartDate: "asc" },
        });

        const na = "N/A";
        // Strip leading "01. " / "02. " style prefixes from production list names
        const cleanName = (s: string | null | undefined) =>
            s ? s.replace(/^\d+\.\s*/, "").trim() : null;

        const andrewCases = cases.map((c) => ({
            caseName:
                c.name || na,
            caseStatus:
                c.status || "",
            capsuleName:
                cleanName(c.productionList?.capsule?.shortName) ||
                cleanName(c.productionList?.capsule?.name) ||
                cleanName(c.productionList?.name) ||
                na,
            caseRating:
                c.caseRating !== null && c.caseRating !== undefined ? String(c.caseRating) : na,
            caseType:
                c.caseType || "Normal",
            writerName:
                c.writer?.name || na,
            writerQualityScore:
                c.writerQualityScore !== null && c.writerQualityScore !== undefined
                    ? String(c.writerQualityScore)
                    : na,
            scriptQualityRating:
                c.scriptQualityRating !== null && c.scriptQualityRating !== undefined
                    ? String(c.scriptQualityRating)
                    : na,
            qaScriptStartDate:
                c.scriptQaStartDate
                    ? c.scriptQaStartDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                    : na,
        }));

        return NextResponse.json({ andrewCases });
    } catch (error) {
        return serverError(error, "andrew-cases");
    }
}
