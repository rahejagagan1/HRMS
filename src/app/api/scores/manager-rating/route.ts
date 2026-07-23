import { serverError } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serializeBigInt } from "@/lib/utils";

export const dynamic = "force-dynamic";

// GET: Fetch manager ratings (submitted by the logged-in manager)
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const sessionUser = session.user as any;
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get("userId");
        const period = searchParams.get("period");

        const where: any = {};

        // CEO/special_access/hod/developer: see all ratings
        // manager/lead/sub_lead: see ratings for users in their subtree
        // others: denied
        const isDev = process.env.NODE_ENV === "development" && sessionUser.role === "admin";
        const isFullAccess =
            sessionUser.orgLevel === "ceo" ||
            sessionUser.orgLevel === "special_access" ||
            sessionUser.orgLevel === "hod" ||
            sessionUser.isDeveloper ||
            isDev;

        if (!isFullAccess) {
            const isHierarchyRole = ["manager", "lead", "sub_lead"].includes(sessionUser.orgLevel);
            if (!isHierarchyRole) {
                return NextResponse.json({ error: "Access denied" }, { status: 403 });
            }

            let mgrId = sessionUser.dbId;
            if (!mgrId && session.user?.email) {
                const dbUser = await prisma.user.findFirst({
                    where: { email: session.user.email },
                    select: { id: true },
                });
                mgrId = dbUser?.id;
            }

            if (mgrId) {
                // Get all user IDs visible to this person (full subtree)
                const { getVisibleUserIds } = await import("@/lib/access-control");
                const visibleIds = await getVisibleUserIds(mgrId, sessionUser.orgLevel);
                // Show ratings where the rated user is in their subtree
                if (visibleIds !== null) {
                    where.userId = { in: visibleIds };
                }
            }
        }

        if (userId) {
            where.userId = parseInt(userId);
        } else {
            // List views hide rows for users who have left the company.
            // Direct lookup by userId still returns their historic ratings.
            where.user = { isActive: true };
        }
        if (period) where.period = period;

        const ratings = await prisma.managerRating.findMany({
            where,
            orderBy: { submittedAt: "desc" },
            include: {
                user: {
                    select: { id: true, name: true, role: true, profilePictureUrl: true },
                },
                manager: {
                    select: { id: true, name: true },
                },
            },
        });

        // Merge isDraft from raw SQL (Prisma client may not have the new column yet)
        if (ratings.length > 0) {
            try {
                const ids = ratings.map((r) => r.id);
                const drafts = await prisma.$queryRaw<{ id: number; isDraft: boolean }[]>(
                    Prisma.sql`SELECT id, "isDraft" FROM "ManagerRating" WHERE id IN (${Prisma.join(ids)})`
                );
                const draftMap = Object.fromEntries(drafts.map((d) => [d.id, d.isDraft]));
                const enriched = ratings.map((r) => ({ ...r, isDraft: draftMap[r.id] ?? false }));
                return NextResponse.json(serializeBigInt(enriched));
            } catch {
                // If isDraft fetch fails, return ratings without it
                return NextResponse.json(serializeBigInt(ratings));
            }
        }

        return NextResponse.json(serializeBigInt(ratings));
    } catch (error) {
        console.error("Manager rating GET error:", error);
        return serverError(error, "route");
    }
}

// POST: Submit a manager rating for a team member
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const sessionUser = session.user as any;

        // Must be manager / lead / sub_lead (or above) to submit ratings
        const isDev = process.env.NODE_ENV === "development" && sessionUser.role === "admin";
        if (
            !["ceo", "special_access", "hod", "manager", "lead", "sub_lead"].includes(sessionUser.orgLevel) &&
            !sessionUser.isDeveloper &&
            !isDev
        ) {
            return NextResponse.json(
                { error: "Only managers, leads, and sub-leads can submit team ratings" },
                { status: 403 }
            );
        }

        const body = await request.json();
        const { userId, period, periodType, ratingsJson, overallScore, comments, isDraft } = body;

        // Resolve manager's DB ID (may be undefined in dev mode)
        let managerId = sessionUser.dbId;
        if (!managerId && session.user?.email) {
            const dbUser = await prisma.user.findFirst({
                where: { email: session.user.email },
                select: { id: true },
            });
            managerId = dbUser?.id;
        }
        // Dev fallback: use the target user's actual manager, or first manager in DB
        if (!managerId && isDev) {
            const targetUser = await prisma.user.findUnique({
                where: { id: parseInt(userId) },
                select: { managerId: true },
            });
            managerId = targetUser?.managerId;
            if (!managerId) {
                // Last resort: find any user with manager orgLevel
                const anyManager = await prisma.user.findFirst({
                    where: { orgLevel: "manager" },
                    select: { id: true },
                });
                managerId = anyManager?.id;
            }
        }
        if (!managerId) {
            return NextResponse.json(
                { error: "Could not resolve manager ID" },
                { status: 400 }
            );
        }

        if (!userId || !period || !periodType) {
            return NextResponse.json(
                { error: "Missing required fields: userId, period, periodType" },
                { status: 400 }
            );
        }

        // Verify the target user is a direct report of this manager/lead
        // (managers can rate their direct team members and leads who report directly to them;
        //  sub-leads are visible but not ratable by this manager)
        const isFullAccessPost =
            sessionUser.orgLevel === "ceo" ||
            sessionUser.orgLevel === "special_access" ||
            sessionUser.orgLevel === "hod" ||
            sessionUser.isDeveloper ||
            isDev;

        if (!isFullAccessPost) {
            const targetUser = await prisma.user.findUnique({
                where: { id: parseInt(userId) },
                select: { managerId: true },
            });
            if (!targetUser || targetUser.managerId !== managerId) {
                return NextResponse.json(
                    { error: "You can only rate your direct team members and leads" },
                    { status: 403 }
                );
            }
        }

        // Upsert manager rating (without isDraft — set via raw SQL below for client compatibility)
        const rating = await prisma.managerRating.upsert({
            where: {
                managerId_userId_period_periodType: {
                    managerId: managerId,
                    userId: parseInt(userId),
                    period,
                    periodType,
                },
            },
            create: {
                managerId: managerId,
                userId: parseInt(userId),
                period,
                periodType,
                ratingsJson: ratingsJson ?? {},
                overallScore: overallScore || null,
                comments: comments || null,
            },
            update: {
                ratingsJson: ratingsJson ?? {},
                overallScore: overallScore || null,
                comments: comments || null,
            },
            include: {
                user: {
                    select: { id: true, name: true, role: true, profilePictureUrl: true },
                },
            },
        });

        // Set isDraft flag via raw SQL (Prisma client may not have the new column yet)
        try {
            await prisma.$executeRaw(
                Prisma.sql`UPDATE "ManagerRating" SET "isDraft" = ${!!isDraft} WHERE id = ${rating.id}`
            );
        } catch (e) {
            console.error("[ManagerRating] isDraft update failed:", e);
        }

        // Skip calculation for drafts — just save and return
        if (isDraft) {
            return NextResponse.json(serializeBigInt({ ...rating, calculationTriggered: false, isDraft: true }));
        }

        // After saving, trigger calculation for this user's role
        const targetUser = await prisma.user.findUnique({
            where: { id: parseInt(userId) },
            select: { role: true },
        });

        let calculationResult: any = null;
        try {
            const role = targetUser?.role || "writer";
            const [yearStr, monthStr] = period.split("-");
            const targetMonth = new Date(Date.UTC(parseInt(yearStr), parseInt(monthStr) - 1, 1));

            let roleType: string;
            if (role === "editor") roleType = "editor";
            else if (role === "production_manager") roleType = "production_manager";
            else if (role === "hr_manager") roleType = "hr_manager";
            else if (role === "researcher_manager") roleType = "researcher_manager";
            else roleType = "writer";

            // Use the unified config-driven calculator (auto-seeds default template if needed)
            const { calculateAllRatings } = await import("@/lib/ratings/unified-calculator");
            calculationResult = await calculateAllRatings(roleType, targetMonth);
        } catch (calcErr: any) {
            console.error("[ManagerRating] Auto-calculation after submit failed:", calcErr);
        }

        return NextResponse.json(serializeBigInt({ ...rating, calculationTriggered: !!calculationResult }));
    } catch (error: any) {
        console.error("Manager rating POST error:", error);
        return serverError(error, "route");
    }
}
