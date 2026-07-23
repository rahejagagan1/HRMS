import { serverError } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';
import { serializeBigInt } from "@/lib/utils";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const roleType = searchParams.get("roleType") || "writer";
        const limit = parseInt(searchParams.get("limit") || "10");
        const month = searchParams.get("month");

        const where: any = { roleType, user: { isActive: true } };
        if (month) {
            const d = new Date(month);
            where.month = new Date(d.getFullYear(), d.getMonth(), 1);
        }

        const leaderboard = await prisma.monthlyRating.findMany({
            where,
            orderBy: { overallRating: "desc" },
            take: limit,
            include: {
                user: {
                    select: { id: true, name: true, profilePictureUrl: true, role: true, teamCapsule: true },
                },
            },
        });

        return NextResponse.json(serializeBigInt(leaderboard));
    } catch (error) {
        return serverError(error, "route");
    }
}
