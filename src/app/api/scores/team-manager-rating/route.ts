import { serverError } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serializeBigInt } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * GET: Fetch team-manager ratings.
 * - Team members see their own submitted ratings.
 * - Managers see aggregated (anonymous) results for their own ratings received.
 * - CEO/special_access see everything.
 */
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const sessionUser = session.user as any;
        const { searchParams } = new URL(request.url);
        const managerId = searchParams.get("managerId");
        const period = searchParams.get("period");
        const mode = searchParams.get("mode"); // "my_submissions" | "received" | "all"

        let dbUserId = sessionUser.dbId;
        if (!dbUserId) {
            const dbUser = await prisma.user.findFirst({
                where: { email: session.user.email },
                select: { id: true },
            });
            dbUserId = dbUser?.id;
        }

        const isDev = process.env.NODE_ENV === "development" && sessionUser.role === "admin";
        const isFullAccess =
            sessionUser.orgLevel === "ceo" ||
            sessionUser.orgLevel === "special_access" ||
            sessionUser.orgLevel === "hod" ||
            sessionUser.isDeveloper ||
            isDev;

        if (mode === "my_submissions" && dbUserId) {
            // Team member viewing their own submissions
            const where: any = { teamMemberId: dbUserId };
            if (period) where.period = period;
            if (managerId) where.managerId = parseInt(managerId);

            const ratings = await prisma.teamManagerRating.findMany({
                where,
                orderBy: { submittedAt: "desc" },
                include: {
                    manager: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
                },
            });
            return NextResponse.json(serializeBigInt(ratings));
        }

        if (mode === "received" && managerId) {
            // Manager or admin viewing aggregate results
            const targetManagerId = parseInt(managerId);
            if (!isFullAccess && dbUserId !== targetManagerId) {
                return NextResponse.json({ error: "You can only view your own received ratings" }, { status: 403 });
            }

            const where: any = { managerId: targetManagerId };
            if (period) where.period = period;

            const ratings = await prisma.teamManagerRating.findMany({
                where,
                select: {
                    ratingsJson: true,
                    overallScore: true,
                    comments: true,
                    submittedAt: true,
                    period: true,
                    // Anonymous: don't include teamMemberId or teamMember relation
                },
            });

            const rawKeys = searchParams.get("teamQuestionKeys");
            const explicitKeys =
                rawKeys && rawKeys.trim().length > 0
                    ? rawKeys
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean)
                    : null;

            /** Star question keys (1–5) only — excludes _opt / _option / _comment and non-numeric junk. */
            function inferStarKeysFromRows(): string[] {
                const set = new Set<string>();
                for (const tr of ratings) {
                    const rj = tr.ratingsJson as Record<string, unknown>;
                    for (const [key, val] of Object.entries(rj)) {
                        if (key.endsWith("_opt") || key.endsWith("_option") || key.endsWith("_comment")) continue;
                        if (typeof val !== "number" || isNaN(val)) continue;
                        if (val < 1 || val > 5) continue;
                        set.add(key);
                    }
                }
                return [...set];
            }

            const aggregateKeys =
                explicitKeys && explicitKeys.length > 0 ? explicitKeys : inferStarKeysFromRows();

            // Per-question: average each key across submissions that have that star
            const keyTotals: Record<string, { sum: number; count: number }> = {};
            for (const tr of ratings) {
                const rj = tr.ratingsJson as Record<string, unknown>;
                for (const key of aggregateKeys) {
                    const val = rj[key];
                    if (typeof val !== "number" || isNaN(val)) continue;
                    if (val < 1 || val > 5) continue;
                    if (!keyTotals[key]) keyTotals[key] = { sum: 0, count: 0 };
                    keyTotals[key].sum += val;
                    keyTotals[key].count += 1;
                }
            }

            const avgRatings: Record<string, number> = {};
            for (const [key, { sum, count }] of Object.entries(keyTotals)) {
                if (count > 0) avgRatings[key] = Math.round((sum / count) * 100) / 100;
            }

            // Team score: for each submission, average of that member's answers across aggregateKeys (answered stars only);
            // then average those per-member means across all submissions.
            const rowAvgs: number[] = [];
            for (const tr of ratings) {
                const rj = tr.ratingsJson as Record<string, unknown>;
                const vals: number[] = [];
                for (const key of aggregateKeys) {
                    const val = rj[key];
                    if (typeof val !== "number" || isNaN(val)) continue;
                    if (val < 1 || val > 5) continue;
                    vals.push(val);
                }
                if (vals.length === 0) continue;
                rowAvgs.push(vals.reduce((a, b) => a + b, 0) / vals.length);
            }

            let expectedDirectReports = 0;
            try {
                const mgr = await prisma.user.findUnique({
                    where: { id: targetManagerId },
                    select: { role: true },
                });
                const reportRoles =
                    mgr?.role === "researcher_manager"
                        ? (["researcher"] as const)
                        : (["writer", "editor"] as const);
                expectedDirectReports = await prisma.user.count({
                    where: {
                        managerId: targetManagerId,
                        isActive: true,
                        role: { in: [...reportRoles] },
                    },
                });
            } catch (e) {
                console.error("[team-manager-rating] expectedDirectReports count failed:", e);
            }

            const submittedCount = ratings.length;
            const teamFeedbackPending =
                expectedDirectReports > 0 && submittedCount < expectedDirectReports;

            /** Final team score only when every expected direct report has submitted (same rule as formula pillar). */
            let teamOverallScore: number | null = null;
            if (!teamFeedbackPending && rowAvgs.length > 0) {
                teamOverallScore =
                    Math.round((rowAvgs.reduce((a, b) => a + b, 0) / rowAvgs.length) * 100) / 100;
            }

            return NextResponse.json({
                totalResponses: submittedCount,
                expectedDirectReports,
                teamFeedbackPending,
                averageRatings: avgRatings,
                teamOverallScore,
                period: period || "all",
            });
        }

        // Default: full access listing
        if (!isFullAccess) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const where: any = {};
        if (managerId) where.managerId = parseInt(managerId);
        if (period) where.period = period;

        const ratings = await prisma.teamManagerRating.findMany({
            where,
            orderBy: { submittedAt: "desc" },
            include: {
                manager: { select: { id: true, name: true } },
                teamMember: { select: { id: true, name: true } },
            },
        });
        return NextResponse.json(serializeBigInt(ratings));
    } catch (error) {
        console.error("Team manager rating GET error:", error);
        return serverError(error, "route");
    }
}

/**
 * POST: Submit a team member's rating of their manager.
 * Any active team member can rate their direct manager.
 */
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const sessionUser = session.user as any;

        let teamMemberId = sessionUser.dbId;
        if (!teamMemberId) {
            const dbUser = await prisma.user.findFirst({
                where: { email: session.user.email },
                select: { id: true, managerId: true },
            });
            teamMemberId = dbUser?.id;
        }

        if (!teamMemberId) {
            return NextResponse.json({ error: "Could not resolve your user ID" }, { status: 400 });
        }

        const body = await request.json();
        const { managerId, period, ratingsJson, overallScore, comments } = body;

        if (!managerId || !period) {
            return NextResponse.json(
                { error: "Missing required fields: managerId, period" },
                { status: 400 }
            );
        }

        // Verify the team member actually reports to this manager
        const teamMember = await prisma.user.findUnique({
            where: { id: teamMemberId },
            select: { managerId: true },
        });

        if (!teamMember || teamMember.managerId !== parseInt(managerId)) {
            return NextResponse.json(
                { error: "You can only rate your direct manager" },
                { status: 403 }
            );
        }

        const rj = (ratingsJson ?? {}) as Record<string, unknown>;
        for (const [key, val] of Object.entries(rj)) {
            if (key.endsWith("_opt") || key.endsWith("_option") || key.endsWith("_comment")) continue;
            if (typeof val === "number" && val >= 1 && val <= 5) {
                const explanation = rj[`${key}_comment`];
                if (typeof explanation !== "string" || explanation.trim().length === 0) {
                    return NextResponse.json(
                        {
                            error:
                                "Each star rating must include an explanation. Please answer: \"Explain in detail what made you to give the above rating?\" for every question.",
                        },
                        { status: 400 }
                    );
                }
            }
        }

        const rating = await prisma.teamManagerRating.upsert({
            where: {
                teamMemberId_managerId_period_periodType: {
                    teamMemberId,
                    managerId: parseInt(managerId),
                    period,
                    periodType: "monthly",
                },
            },
            create: {
                teamMemberId,
                managerId: parseInt(managerId),
                period,
                periodType: "monthly",
                ratingsJson: ratingsJson ?? {},
                overallScore: overallScore || null,
                comments: comments || null,
                isAnonymous: true,
            },
            update: {
                ratingsJson: ratingsJson ?? {},
                overallScore: overallScore || null,
                comments: comments || null,
            },
        });

        return NextResponse.json(serializeBigInt(rating));
    } catch (error: any) {
        console.error("Team manager rating POST error:", error);
        return serverError(error, "route");
    }
}
