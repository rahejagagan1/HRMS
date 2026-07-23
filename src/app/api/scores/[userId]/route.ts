import { serverError } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getVisibleUserIds } from "@/lib/access-control";
import { serializeBigInt } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ userId: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { userId } = await params;
        const targetUserId = parseInt(userId);
        const sessionUser = session.user as any;

        // Access control: check if the logged-in user can view this user's scores
        // In dev mode (no dbId), grant full access
        if (sessionUser.dbId && sessionUser.orgLevel) {
            const visibleIds = await getVisibleUserIds(
                sessionUser.dbId,
                sessionUser.orgLevel
            );
            if (visibleIds !== null && !visibleIds.includes(targetUserId)) {
                return NextResponse.json({ error: "Access denied" }, { status: 403 });
            }
        }

        const { searchParams } = new URL(request.url);
        const month = searchParams.get("month");

        // Build month filter
        const monthFilter: any = {};
        if (month) {
            const [year, mon] = month.split("-").map(Number);
            monthFilter.month = new Date(Date.UTC(year, mon - 1, 1));
        }

        // Get user info
        const user = await prisma.user.findUnique({
            where: { id: targetUserId },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                orgLevel: true,
                profilePictureUrl: true,
                teamCapsule: true,
                managerId: true,
                manager: { select: { id: true, name: true } },
            },
        });

        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        // Get ALL monthly ratings (needed for historical chart)
        const monthlyRatings = await prisma.monthlyRating.findMany({
            where: { userId: targetUserId },
            orderBy: { month: "desc" },
            take: 24,
            include: {
                editLogs: {
                    include: {
                        editor: { select: { id: true, name: true } },
                    },
                    orderBy: { editedAt: "desc" },
                },
            },
        });

        // Get manager ratings received
        const managerRatings = await prisma.managerRating.findMany({
            where: { userId: targetUserId },
            orderBy: { submittedAt: "desc" },
            take: 12,
            include: {
                manager: { select: { id: true, name: true } },
            },
        });

        // Get scorecard config for this user/role
        const scorecardConfig = await prisma.scorecardConfig.findFirst({
            where: {
                OR: [
                    { userId: targetUserId },
                    { roleType: user.role, userId: null },
                ],
                isActive: true,
            },
            orderBy: { userId: "desc" }, // User-specific config takes priority
        });

        // Get available months for this user. Prisma's `distinct: ["month"]`
        // dedupes by raw Date (with time); we dedupe again on YYYY-MM so the
        // month picker never sees duplicate keys.
        const monthRows = await prisma.monthlyRating.findMany({
            where: { userId: targetUserId },
            select: { month: true },
            distinct: ["month"],
            orderBy: { month: "desc" },
        });
        const availableMonths = Array.from(new Set(
            monthRows.map((m) => {
                const d = new Date(m.month);
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            })
        ));

        return NextResponse.json(
            serializeBigInt({
                user,
                monthlyRatings,
                managerRatings,
                scorecardConfig,
                availableMonths,
            })
        );
    } catch (error) {
        console.error("Scores API error:", error);
        return serverError(error, "route");
    }
}
