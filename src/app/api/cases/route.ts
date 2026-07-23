import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";

export const dynamic = 'force-dynamic';
import { serializeBigInt } from "@/lib/utils";

export async function GET(request: NextRequest) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get("page") || "1");
        const limit = parseInt(searchParams.get("limit") || "50");
        const status = searchParams.get("status");
        const channel = searchParams.get("channel");
        const capsule = searchParams.get("capsule");
        const userId = searchParams.get("userId");
        const search = searchParams.get("search");

        const where: any = {};

        if (status) where.status = status;
        if (channel) where.channel = channel;
        if (capsule) {
            where.productionListId = parseInt(capsule);
        }
        if (userId) {
            const uid = parseInt(userId);
            where.OR = [
                { writerUserId: uid },
                { editorUserId: uid },
                { researcherUserId: uid },
                { assigneeUserId: uid },
                { assignees: { some: { userId: uid } } },
                { subtasks: { some: { assignees: { some: { userId: uid } } } } },
            ];
        }
        if (search) {
            where.name = { contains: search, mode: "insensitive" };
        }

        const [cases, total] = await Promise.all([
            prisma.case.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                // Flagged cases (level-3 subtasks in ClickUp) float to the top so
                // they're easy to spot and clean up; everything else by recency.
                orderBy: [{ hasDeepSubtasks: "desc" }, { dateCreated: "desc" }],
                include: {
                    writer: { select: { id: true, name: true } },
                    editor: { select: { id: true, name: true } },
                    youtubeStats: { select: { viewCount: true, likeCount: true } },
                    productionList: {
                        select: { name: true, capsule: { select: { id: true, shortName: true } } },
                    },
                },
            }),
            prisma.case.count({ where }),
        ]);

        return NextResponse.json(
            serializeBigInt({
                cases,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                },
            })
        );
    } catch (error) {
        return serverError(error, "route");
    }
}
