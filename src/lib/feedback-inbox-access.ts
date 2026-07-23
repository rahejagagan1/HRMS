import { can, hasResolvedPermissions } from "./permissions/can";

/** Who may open the anonymous feedback inbox (UI + GET /api/feedback). */
export function canViewFeedbackInbox(
    user: { orgLevel?: string; role?: string; isDeveloper?: boolean; permissions?: string[] } | null | undefined
): boolean {
    if (!user) return false;
    if (hasResolvedPermissions(user)) return can(user, "VIEW_FEEDBACK_INBOX");
    // Legacy fallback for bare objects during the migration.
    if (user.isDeveloper) return true;
    if (user.orgLevel === "ceo") return true;
    if (user.orgLevel === "special_access") return true;
    return user.orgLevel === "hr_manager" || user.role === "hr_manager";
}
