import { requireAuth, serverError } from "@/lib/api-auth";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';
import { serializeBigInt } from "@/lib/utils";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;


        const { id: idRaw } = await params;
    try {
        const id = parseInt(idRaw);
        if (isNaN(id)) {
            return NextResponse.json({ error: "Invalid case ID" }, { status: 400 });
        }

        const caseData = await prisma.case.findUnique({
            where: { id },
            include: {
                writer: { select: { id: true, name: true, profilePictureUrl: true, role: true } },
                editor: { select: { id: true, name: true, profilePictureUrl: true, role: true } },
                researcher: { select: { id: true, name: true, profilePictureUrl: true, role: true } },
                assignee: { select: { id: true, name: true, profilePictureUrl: true, role: true } },
                assignees: {
                    include: { user: { select: { id: true, name: true, profilePictureUrl: true, role: true } } },
                },
                allEditors: {
                    include: { user: { select: { id: true, name: true, profilePictureUrl: true, role: true } } },
                },
                allWriters: {
                    include: { user: { select: { id: true, name: true, profilePictureUrl: true, role: true } } },
                },
                subtasks: {
                    orderBy: { orderIndex: "asc" },
                    select: {
                        id: true, name: true, status: true, statusType: true,
                        startDate: true, dueDate: true, dateDone: true, orderIndex: true,
                        assignee: { select: { id: true, name: true, profilePictureUrl: true } },
                        assignees: {
                            include: { user: { select: { id: true, name: true, profilePictureUrl: true } } },
                        },
                    },
                },
                youtubeStats: {
                    select: {
                        viewCount: true, likeCount: true, commentCount: true, last30DaysViews: true,
                        youtubeVideoId: true, videoUrl: true, videoTitle: true, publishedAt: true,
                    },
                },
                productionList: {
                    select: { id: true, name: true, capsule: { select: { id: true, shortName: true, name: true } } },
                },
            },
        });

        if (!caseData) {
            return NextResponse.json({ error: "Case not found" }, { status: 404 });
        }

        return NextResponse.json(serializeBigInt(caseData));
    } catch (error) {
        return serverError(error, "route");
    }
}
