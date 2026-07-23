import { NextResponse } from "next/server";
import { requireAuth, serverError } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Returns the list of manager IDs the current session user has explicit view access to. */
export async function GET() {
    try {
        const { session, errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const dbId = (session?.user as any)?.dbId;
        if (!dbId) return NextResponse.json({ allowedManagerIds: [] });

        // Legacy per-user grants…
        const rows = await prisma.$queryRaw`
            SELECT "managerId" FROM "UserReportAccess"
            WHERE "userId" = ${Number(dbId)}
        ` as { managerId: number }[];

        // …unioned with per-owner grants on the user's designation.
        let designationRows: { managerId: number }[] = [];
        try {
            designationRows = await prisma.$queryRaw`
                SELECT dra."managerId" FROM "DesignationReportAccess" dra
                JOIN "User" u ON u."designationId" = dra."designationId"
                WHERE u."id" = ${Number(dbId)}
            ` as { managerId: number }[];
        } catch { /* table absent pre-migration */ }

        // …and the templates the user's designation fills/views, plus every
        // owner who actually has a report of one of those templates (so the
        // existing allowedManagerIds.includes() filters keep working unchanged).
        let allowedTemplates: string[] = [];
        let templateOwnerRows: { managerId: number }[] = [];
        try {
            const tRows = await prisma.$queryRaw`
                SELECT drt."template" FROM "DesignationReportTemplate" drt
                JOIN "User" u ON u."designationId" = drt."designationId"
                WHERE u."id" = ${Number(dbId)}
            ` as { template: string }[];
            allowedTemplates = [...new Set(tRows.map(r => r.template))];
            if (allowedTemplates.length) {
                templateOwnerRows = await prisma.$queryRaw`
                    SELECT DISTINCT "managerId" FROM (
                        SELECT "managerId", "reportTemplate" FROM "WeeklyReport"  WHERE "reportTemplate" IS NOT NULL
                        UNION
                        SELECT "managerId", "reportTemplate" FROM "MonthlyReport" WHERE "reportTemplate" IS NOT NULL
                    ) r
                    WHERE r."reportTemplate" = ANY(${allowedTemplates}::text[])
                ` as { managerId: number }[];
            }
        } catch { /* table absent pre-migration */ }

        const allowedManagerIds = [
            ...new Set([...rows, ...designationRows, ...templateOwnerRows].map(r => Number(r.managerId))),
        ];
        return NextResponse.json({ allowedManagerIds, allowedTemplates });
    } catch (error) {
        return serverError(error, "GET /api/user/report-access");
    }
}
