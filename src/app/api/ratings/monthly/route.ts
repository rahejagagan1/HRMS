import { serverError } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';
import { serializeBigInt } from "@/lib/utils";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get("userId");
        const month = searchParams.get("month");
        const roleType = searchParams.get("roleType");

        const where: any = {};
        if (userId) {
            where.userId = parseInt(userId);
        } else {
            // List views hide rows for users who have left the company.
            // A direct lookup by userId still returns their historic data.
            where.user = { isActive: true };
        }
        if (roleType) where.roleType = roleType;
        if (month) {
            const d = new Date(month);
            where.month = new Date(d.getFullYear(), d.getMonth(), 1);
        }

        const ratings = await prisma.monthlyRating.findMany({
            where,
            orderBy: [{ month: "desc" }, { overallRating: "desc" }],
            include: {
                user: { select: { id: true, name: true, profilePictureUrl: true, role: true } },
            },
        });

        return NextResponse.json(serializeBigInt(ratings));
    } catch (error) {
        return serverError(error, "route");
    }
}
