import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, serverError } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { isManagerReportEligible } from "@/lib/reports/manager-report-format";

export async function GET() {
    const { errorResponse } = await requireAdmin();
    if (errorResponse) return errorResponse;

    try {
        // All active users with their reportAccess flag
        const users = await prisma.$queryRaw`
            SELECT
                u.id,
                u.name,
                u.email,
                u.role,
                u."orgLevel",
                u."reportAccess",
                u."teamCapsule",
                m.id        AS "managerId",
                m.name      AS "managerName"
            FROM "User" u
            LEFT JOIN "User" m ON m.id = u."managerId"
            WHERE u."isActive" = true
            ORDER BY u."orgLevel" ASC, u.name ASC
        ` as any[];

        // Per-user allowed manager IDs from UserReportAccess
        const accessRows = await prisma.$queryRaw`
            SELECT "userId", "managerId" FROM "UserReportAccess"
        ` as { userId: number; managerId: number }[];

        const accessMap: Record<number, number[]> = {};
        for (const row of accessRows) {
            const uid = Number(row.userId);
            if (!accessMap[uid]) accessMap[uid] = [];
            accessMap[uid].push(Number(row.managerId));
        }

        const shaped = (users as any[]).map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
            orgLevel: u.orgLevel,
            reportAccess: u.reportAccess ?? false,
            teamCapsule: u.teamCapsule,
            manager: u.managerId ? { id: u.managerId, name: u.managerName } : null,
            allowedManagerIds: accessMap[Number(u.id)] ?? [],
        }));

        // Managers who may own reports (role/orgLevel), plus legacy reportAccess-only users
        const managers = shaped
            .filter((u) => isManagerReportEligible(u))
            .map((u) => ({ id: u.id, name: u.name }));

        return NextResponse.json({ users: shaped, managers });
    } catch (error) {
        return serverError(error, "GET /api/admin/permissions");
    }
}

export async function PATCH(req: NextRequest) {
    const { errorResponse } = await requireAdmin();
    if (errorResponse) return errorResponse;

    try {
        const body = await req.json();

        // Toggle global reportAccess: { userId, reportAccess }
        if (typeof body.reportAccess === "boolean") {
            const { userId, reportAccess } = body;
            if (typeof userId !== "number") {
                return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
            }
            await prisma.$executeRaw`
                UPDATE "User" SET "reportAccess" = ${reportAccess} WHERE id = ${userId}
            `;
            return NextResponse.json({ id: userId, reportAccess });
        }

        // DEPRECATED: per-user "view manager X's reports" grants. Replaced by
        // per-designation grants (DesignationReportAccess) managed from the
        // Designations screen; the admin UI no longer calls this branch.
        // Kept dormant for one release as a rollback valve — enforcement still
        // unions any existing UserReportAccess rows. Remove in a later cleanup.
        if (typeof body.managerId === "number" && typeof body.grant === "boolean") {
            const { userId, managerId, grant } = body;
            if (typeof userId !== "number") {
                return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
            }
            if (grant) {
                await prisma.$executeRaw`
                    INSERT INTO "UserReportAccess" ("userId", "managerId")
                    VALUES (${userId}, ${managerId})
                    ON CONFLICT ("userId", "managerId") DO NOTHING
                `;
            } else {
                await prisma.$executeRaw`
                    DELETE FROM "UserReportAccess"
                    WHERE "userId" = ${userId} AND "managerId" = ${managerId}
                `;
            }
            return NextResponse.json({ ok: true, userId, managerId, grant });
        }

        return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    } catch (error) {
        return serverError(error, "PATCH /api/admin/permissions");
    }
}
