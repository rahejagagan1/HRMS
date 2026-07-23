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


        const { week: weekRaw } = await params;
        const week  = parseInt(weekRaw);
        const month = parseInt(req.nextUrl.searchParams.get("month") ?? "");
        const year  = parseInt(req.nextUrl.searchParams.get("year")  ?? "");

        if (isNaN(week) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const period = getWeeklyReportPeriod(year, month, week);
        if (!period) {
            return NextResponse.json({ error: "Invalid week for this month" }, { status: 400 });
        }
        const { weekStart, weekEnd } = period;

        // Find all "Thumbnail" subtasks completed within this week
        const subtasks = await prisma.subtask.findMany({
            where: {
                name: { contains: "Thumbnail", mode: "insensitive" },
                dateDone: { gte: weekStart, lte: weekEnd },
            },
            select: {
                assignee: { select: { id: true, name: true } },
                dateDone: true,
            },
        });

        // Group count by assignee name
        const countByPerson = new Map<string, number>();
        for (const s of subtasks) {
            const name = s.assignee?.name;
            if (!name) continue;
            countByPerson.set(name, (countByPerson.get(name) ?? 0) + 1);
        }

        const thumbnailData = Array.from(countByPerson.entries()).map(([person, count]) => ({
            person,
            thumbnailsDone: String(count),
        }));

        return NextResponse.json({ thumbnailData });
    } catch (error) {
        return serverError(error, "andrew-thumbnail-cases");
    }
}
