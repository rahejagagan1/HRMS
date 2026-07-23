/**
 * Who may open /dashboard/youtube and read quarter metrics from the DB.
 *
 * Two gates, brand first:
 *  1. The YouTube dashboard is NB Media-only content — anyone whose
 *     `businessUnit` is "YT Labs" is excluded, including the YT Labs CEO
 *     (Kunal). Developers in NB Media (or with no brand set) keep access
 *     since they're cross-brand infra.
 *  2. Within the allowed brands, access is gated by the
 *     VIEW_YOUTUBE_DASHBOARD permission (designation-driven), with a legacy
 *     "any authenticated user" fallback for objects/tokens that don't carry
 *     a resolved permissions array.
 * Sync/cron stays admin/developer.
 */
import { can, hasResolvedPermissions } from "./permissions/can";

export type YoutubeDashUserLike = {
    isDeveloper?: boolean;
    role?: string | null;
    orgLevel?: string | null;
    permissions?: string[] | null;
    email?: string | null;
    businessUnit?: string | null;
};

export function userCanAccessYoutubeDashboard(user: YoutubeDashUserLike | null | undefined): boolean {
    if (user == null) return false;
    // Brand gate FIRST — YT Labs is excluded unconditionally (incl. the YT
    // Labs CEO and any developer tagged onto that brand) so an orgLevel /
    // isDeveloper bypass can't re-grant access.
    if (user.businessUnit === "YT Labs") return false;
    // Then the designation permission gate, with a legacy fallback for bare
    // objects that don't carry a resolved permissions array.
    if (hasResolvedPermissions(user)) return can(user, "VIEW_YOUTUBE_DASHBOARD");
    return true; // legacy: any authenticated user (NB Media / null-brand)
}

/** JWT / middleware — tokens don't carry permissions, so this stays
 *  authentication-only; the session-based checks above do the real gating. */
export function tokenCanAccessYoutubeDashboard(token: { email?: string | null } | null): boolean {
    return token != null;
}

export function userCanAccessYoutubeDeveloperAnalytics(user: YoutubeDashUserLike | null | undefined): boolean {
    return user?.isDeveloper === true;
}
