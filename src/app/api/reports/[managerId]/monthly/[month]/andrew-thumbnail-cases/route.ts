import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
type Params = Promise<{ managerId: string; month: string }>;
export async function GET(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;


        const { month: monthRaw } = await params;
        const month = parseInt(monthRaw);
        const year  = parseInt(req.nextUrl.searchParams.get("year") ?? "");
        if (isNaN(month) || isNaN(year)) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

        const monthStart = new Date(year, month, 1, 0, 0, 0);
        const monthEnd   = new Date(year, month + 1, 0, 23, 59, 59);

        const subtasks = await prisma.subtask.findMany({
            where: {
                name: { contains: "Thumbnail", mode: "insensitive" },
                dateDone: { gte: monthStart, lte: monthEnd },
            },
            select: { assignee: { select: { id: true, name: true } } },
        });

        const countByPerson = new Map<string, number>();
        for (const s of subtasks) {
            const name = s.assignee?.name;
            if (!name) continue;
            countByPerson.set(name, (countByPerson.get(name) ?? 0) + 1);
        }

        return NextResponse.json({
            thumbnailData: Array.from(countByPerson.entries()).map(([person, count]) => ({
                person, thumbnailsDone: String(count),
            })),
        });
    } catch (e) { return serverError(e, "monthly-andrew-thumbnail-cases"); }
}
