import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

// RBAC-designation-driven (policy 2026-07-14): the shared canSeeReports
// resolves VIEW_REPORTS from the caller's designation (plus report grants),
// falling back to the legacy admin/manager/HoD tier for sessions without
// resolved permissions. Replaced a local orgLevel/role-only copy.
import { canSeeReports } from "@/lib/access";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
];

export async function GET(_req: NextRequest) {
    try {
        const { session, errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;
        if (!canSeeReports(session!.user)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        // Raw SQL so we can include `reportTemplate` (the generated Prisma client
        // doesn't know that column yet — see report-store.ts). Used to carry
        // &template= on the viewUrl so the detail page renders the right form.
        const [weeklyReports, monthlyReports] = await Promise.all([
            prisma.$queryRawUnsafe<any[]>(
                `SELECT w."id", w."managerId", w."week", w."month", w."year", w."reportTemplate",
                        w."isLocked", w."submittedAt", u."name" AS "managerName"
                 FROM "WeeklyReport" w JOIN "User" u ON u."id" = w."managerId"
                 ORDER BY w."year" DESC, w."month" DESC, w."week" DESC`
            ),
            prisma.$queryRawUnsafe<any[]>(
                `SELECT m."id", m."managerId", m."month", m."year", m."reportTemplate",
                        m."isLocked", m."submittedAt", u."name" AS "managerName"
                 FROM "MonthlyReport" m JOIN "User" u ON u."id" = m."managerId"
                 ORDER BY m."year" DESC, m."month" DESC`
            ),
        ]);

        const tq = (t: string | null) => (t ? `&template=${t}` : "");
        const formattedWeekly = weeklyReports.map(r => ({
            id:          Number(r.id),
            managerId:   Number(r.managerId),
            managerName: r.managerName,
            week:        Number(r.week),
            month:       Number(r.month),
            year:        Number(r.year),
            isMonthly:   false,
            period:      `${MONTH_NAMES[Number(r.month)]} ${r.year} — Week ${r.week}`,
            // Year is required so the report page loads the right year's data;
            // template so the right form template renders.
            viewUrl:     `/dashboard/reports/${r.managerId}/weekly/${r.week}?month=${r.month}&year=${r.year}${tq(r.reportTemplate)}`,
            isLocked:    r.isLocked,
            submittedAt: r.submittedAt,
        }));

        const formattedMonthly = monthlyReports.map(r => ({
            id:          Number(r.id),
            managerId:   Number(r.managerId),
            managerName: r.managerName,
            week:        0,
            month:       Number(r.month),
            year:        Number(r.year),
            isMonthly:   true,
            period:      `${MONTH_NAMES[Number(r.month)]} ${r.year} — Monthly Report`,
            viewUrl:     `/dashboard/reports/${r.managerId}/monthly/${r.month}?year=${r.year}${tq(r.reportTemplate)}`,
            isLocked:    r.isLocked,
            submittedAt: r.submittedAt,
        }));

        // Merge and sort by date descending
        const all = [...formattedWeekly, ...formattedMonthly].sort((a, b) =>
            b.year - a.year || b.month - a.month || b.week - a.week
        );

        return NextResponse.json(all);
    } catch (error) {
        return serverError(error, "admin/reports GET");
    }
}
