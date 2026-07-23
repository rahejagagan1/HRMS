import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";
import { isDeveloperEmail } from "@/lib/hr/notification-policy";
import { userIdsWithPermission } from "@/lib/permissions/resolve-permissions";
import { brandScopeUserWhere } from "@/lib/hr/brand-scope";

export const dynamic = 'force-dynamic';

// Two callers, two needs:
//
//   GET /api/managers            → manager-tier ONLY (default).
//     Used by the Manager Reports sidebar where listing every
//     employee would balloon the menu.
//
//   GET /api/managers?all=true   → every active user (excludes self
//     is the caller's job).
//     Used by the Reporting Manager dropdown on the employee edit
//     form, where HR explicitly wants to assign anyone — not just
//     someone with a manager role — as a person's reporting line.
export async function GET(req: NextRequest) {
    try {
        const { session, errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;
        const viewer = session?.user as any;
        const { searchParams } = new URL(req.url);
        const all = searchParams.get("all") === "true";

        // Developer invisibility. Two layers:
        //
        //   1. Default mode (Manager Reports sidebar) — hide devs only
        //      from non-dev viewers, so dev accounts can still see each
        //      other in their own UI.
        //   2. all=true mode (Reporting Manager picker) — ALWAYS hide
        //      devs, regardless of viewer. Devs aren't anyone's actual
        //      manager; surfacing their names there pollutes HR's
        //      dropdown with accounts that shouldn't be picked.
        const viewerIsDev = isDeveloperEmail(viewer?.email ?? null);
        const devEmails = (process.env.DEVELOPER_EMAILS || "")
            .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        const hideDev =
            all ? devEmails :
            (!viewerIsDev && devEmails.length > 0 ? devEmails : []);

        // Designation-driven report fillers: anyone whose designation has a
        // report template assigned (DesignationReportTemplate) is a report owner
        // too — even if their legacy role/orgLevel isn't manager-tier. This is
        // how reports follow the DESIGNATION, not the role (RBAC migration). We
        // resolve the user ids via raw SQL because the generated client may not
        // know `designationId`/the template table yet (Windows DLL lock blocks
        // regen); `id` is always known so the `{ id: { in } }` filter is safe.
        let templateOwnerIds: number[] = [];
        try {
            const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
                `SELECT DISTINCT u."id"
                   FROM "User" u
                   JOIN "DesignationReportTemplate" drt ON drt."designationId" = u."designationId"
                  WHERE u."isActive" = true`
            );
            templateOwnerIds = rows.map((r) => Number(r.id));
        } catch { /* table absent pre-migration → no designation-template owners */ }

        // RBAC-designation-driven (policy 2026-07-14): ACT_AS_MANAGER marks
        // a designation as a manager-picker target / report owner — mirrors
        // src/lib/access.ts:isPickableAsManager. The legacy role/orgLevel
        // clauses stay as a fallback for users without designations.
        const actAsManagerIds = await userIdsWithPermission("ACT_AS_MANAGER");
        const managerWhere: any = {
            OR: [
                ...(actAsManagerIds.length ? [{ id: { in: actAsManagerIds } }] : []),
                { orgLevel: { in: ["hod", "manager"] } },
                { role: { in: [
                    "manager",
                    "production_manager",
                    "researcher_manager",
                    "hr_manager",
                ] } },
                ...(templateOwnerIds.length ? [{ id: { in: templateOwnerIds } }] : []),
            ],
        };

        const users = await prisma.user.findMany({
            where: {
                isActive: true,
                // The default flavour filters to manager-tier roles.
                // When `?all=true` we drop the role/orgLevel gate so
                // every active user is returned — used by the Edit
                // Profile form's Reporting Manager dropdown.
                // AND-composed with the org-wide brand isolation rule
                // (2026-07-15): non-VIEW_ALL_BRANDS callers only see
                // their own brand's people in every picker.
                AND: [
                    all ? {} : managerWhere,
                    brandScopeUserWhere(viewer),
                ],
                ...(hideDev.length > 0 ? { NOT: { email: { in: hideDev } } } : {}),
            },
            orderBy: { name: "asc" },
            select: {
                id: true,
                name: true,
                orgLevel: true,
                role: true,
            },
        });

        return NextResponse.json(users);
    } catch (error) {
        return serverError(error, "route");
    }
}
