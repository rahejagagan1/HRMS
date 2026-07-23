import { requireAuth, serverError } from "@/lib/api-auth";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';
import { serializeBigInt } from "@/lib/utils";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ capsuleId: string }> }
) {
    const { errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;


        const { capsuleId: capsuleIdRaw } = await params;
    try {
        const capsuleId = parseInt(capsuleIdRaw);
        if (isNaN(capsuleId)) {
            return NextResponse.json({ error: "Invalid capsule ID" }, { status: 400 });
        }

        const capsule = await prisma.capsule.findUnique({
            where: { id: capsuleId },
            include: {
                productionLists: {
                    include: {
                        cases: {
                            include: {
                                writer: { select: { id: true, name: true, role: true } },
                                editor: { select: { id: true, name: true, role: true } },
                                youtubeStats: { select: { viewCount: true, likeCount: true } },
                            },
                            orderBy: { dateCreated: "desc" },
                        },
                    },
                },
            },
        });

        if (!capsule) {
            return NextResponse.json({ error: "Capsule not found" }, { status: 404 });
        }

        const allCases = capsule.productionLists.flatMap((l) => l.cases);

        // Gather team members
        const memberIds = new Set<number>();
        allCases.forEach((c) => {
            if (c.writerUserId) memberIds.add(c.writerUserId);
            if (c.editorUserId) memberIds.add(c.editorUserId);
            if (c.assigneeUserId) memberIds.add(c.assigneeUserId);
        });

        const members = await prisma.user.findMany({
            where: { id: { in: Array.from(memberIds) } },
            include: {
                monthlyRatings: { orderBy: { month: "desc" }, take: 1 },
            },
        });

        const activeCases = allCases.filter((c) => c.statusType !== "closed");
        const publishedCases = allCases.filter((c) => c.youtubeStats);

        return NextResponse.json(
            serializeBigInt({
                capsule: { id: capsule.id, name: capsule.name, shortName: capsule.shortName },
                kpis: {
                    totalCases: allCases.length,
                    activeCases: activeCases.length,
                    publishedThisMonth: publishedCases.length,
                },
                members,
                cases: allCases,
            })
        );
    } catch (error) {
        return serverError(error, "route");
    }
}
