import prisma from "@/lib/prisma";
import { getPermissionsForUserId } from "./permissions/resolve-permissions";

export type OrgLevel = "ceo" | "special_access" | "hod" | "manager" | "hr_manager" | "lead" | "sub_lead" | "member";

/**
 * Returns the list of user IDs the given user is allowed to see.
 * Returns `null` if the user can see everyone (no filter needed).
 * Returns empty array for members (zero access).
 */
export async function getVisibleUserIds(
    userId: number,
    orgLevel: OrgLevel
): Promise<number[] | null> {
    // CEO and Special Access can see everything
    if (orgLevel === "ceo" || orgLevel === "special_access") {
        return null;
    }

    // HOD can see all managers + their teams
    if (orgLevel === "hod") {
        const allUsers = await prisma.user.findMany({
            where: { isActive: true },
            select: { id: true },
        });
        return allUsers.map((u: { id: number }) => u.id);
    }

    // HR Manager: can see all users (full visibility for HR purposes)
    if (orgLevel === "hr_manager") {
        const allUsers = await prisma.user.findMany({
            where: { isActive: true },
            select: { id: true },
        });
        return allUsers.map((u: { id: number }) => u.id);
    }

    // Designation may grant org-wide visibility (RBAC). Checked here for tiers
    // not already all-access above, so a custom designation with SEE_ALL_DATA
    // also sees everyone. The orgLevel checks above still cover the legacy top
    // tiers (and dev-forced special_access).
    try {
        const perms = await getPermissionsForUserId(userId);
        if (perms.includes("SEE_ALL_DATA")) return null;
    } catch { /* RBAC tables missing → ignore */ }

    // Manager / Lead / Sub-lead: see self + all descendants in the hierarchy.
    // The tree is defined by User.managerId — each level can see everyone below them.
    //   manager → sees lead + sub_lead + production team under them
    //   lead    → sees sub_lead + production team under them
    //   sub_lead → sees their direct production team only
    if (orgLevel === "manager" || orgLevel === "lead" || orgLevel === "sub_lead") {
        // Fetch all active users with their managerId to build the tree in memory
        const allUsers = await prisma.user.findMany({
            where: { isActive: true },
            select: { id: true, managerId: true },
        });

        // Recursively collect all descendants
        const collectDescendants = (parentId: number, visited: Set<number>): number[] => {
            const directReports = allUsers.filter(u => u.managerId === parentId && !visited.has(u.id));
            const ids: number[] = [];
            for (const report of directReports) {
                visited.add(report.id);
                ids.push(report.id);
                ids.push(...collectDescendants(report.id, visited));
            }
            return ids;
        };

        const visited = new Set<number>([userId]);
        const descendantIds = collectDescendants(userId, visited);
        return [userId, ...descendantIds];
    }

    // Member — zero access (legacy "production_team" users were
    // migrated to member; same effective visibility scope).
    return [];
}

/**
 * Builds a Prisma `where` clause that filters cases based on visible user IDs.
 * If visibleIds is null, returns {} (no filter).
 * If visibleIds is empty, returns impossible filter (no results).
 */
export function buildCaseVisibilityFilter(visibleIds: number[] | null): any {
    if (visibleIds === null) return {};
    if (visibleIds.length === 0) return { id: -1 }; // zero access — no cases

    return {
        OR: [
            { writerUserId: { in: visibleIds } },
            { editorUserId: { in: visibleIds } },
            { researcherUserId: { in: visibleIds } },
            { assigneeUserId: { in: visibleIds } },
            { assignees: { some: { userId: { in: visibleIds } } } },
        ],
    };
}
