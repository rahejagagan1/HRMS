import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { can, hasResolvedPermissions } from "@/lib/permissions/can";

/**
 * Safely handles API errors — logs the real message server-side,
 * returns a generic message to the client so internals are never exposed.
 */
export function serverError(error: unknown, context: string): NextResponse {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[API Error] ${context}:`, message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/**
 * Checks auth and returns the session, or a 401 response.
 * Always ensures session.user.dbId is populated via DB fallback lookup.
 * Usage:
 *   const { session, errorResponse } = await requireAuth();
 *   if (errorResponse) return errorResponse;
 *   // session is guaranteed to exist here, with dbId set
 */
export async function requireAuth() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return {
            session: null,
            errorResponse: NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            ),
        };
    }
    // Ensure dbId is always populated — JWT may not carry it if session callback threw
    const user = session.user as any;
    if (!user.dbId) {
        try {
            const dbUser = await prisma.user.findUnique({
                where: { email: session.user.email },
                select: { id: true, role: true, orgLevel: true },
            });
            if (dbUser) {
                user.dbId = dbUser.id;
                if (!user.role) user.role = dbUser.role;
                if (!user.orgLevel) user.orgLevel = dbUser.orgLevel;
            }
        } catch {
            // DB lookup failed — proceed without dbId; individual routes will handle missing userId
        }
    }
    return { session, errorResponse: null };
}

/**
 * Predicate version of HR-admin gate. Mirrors the client-side
 * isHRAdmin helper in src/lib/access.ts and the requireHRAdmin
 * wrapper below. Use this when an API route already has a session
 * in hand and just needs a true/false check (e.g. inside an
 * authorisation branch). Keeping a single source of truth here
 * stops the access-gate drift that crept in across ~25 routes
 * before this rollup — special_access / role=admin used to be
 * missed in inline checks.
 *
 * Allowed:
 *   • orgLevel === "ceo"
 *   • isDeveloper === true
 *   • orgLevel === "special_access"
 *   • role     === "admin"
 *   • orgLevel === "hr_manager"       (HR Manager + "normal HR")
 */
export function isHRAdmin(user: any): boolean {
    // Permission-based once the session carries permissions; legacy fallback
    // for bare DB objects (no permissions field) during the migration.
    if (hasResolvedPermissions(user)) return can(user, "MANAGE_HR");
    return (
        user?.orgLevel === "ceo" ||
        user?.isDeveloper === true ||
        user?.orgLevel === "special_access" ||
        user?.role === "admin" ||
        user?.orgLevel === "hr_manager"
    );
}

/**
 * Tighter than isHRAdmin — CEO, developers, and the HR team
 * (orgLevel=hr_manager) only. Excludes special_access and
 * role=admin even though they pass isHRAdmin elsewhere.
 *
 * Server-side mirror of `isLeadershipOrHR` in src/lib/access.ts.
 * Use for endpoints whose access should match the client gate
 * (engage post create / edit / delete, employee documents, etc.).
 */
export function isLeadershipOrHR(user: any): boolean {
    // CEOs and developers pass on their own tier; the HR team is
    // designation-driven via HR_CONFIDENTIAL (RBAC-only policy 2026-07-14).
    // Legacy orgLevel fallback only for bare objects without permissions.
    if (user?.orgLevel === "ceo" || user?.isDeveloper === true) return true;
    if (hasResolvedPermissions(user)) return can(user, "HR_CONFIDENTIAL");
    return user?.orgLevel === "hr_manager";
}

/**
 * The one developer who is trusted with salary data. Other developers
 * (e.g. anyone else listed in DEVELOPER_EMAILS) pass `isDeveloper` for
 * every other dev-only surface but NOT for compensation. Update here if
 * the org's primary developer changes.
 */
export const SALARY_DEV_EMAIL = "rahejagagan1@gmail.com";

/** True when this user is the salary-trusted developer. */
export function isSalaryDeveloper(user: any): boolean {
    return (
        user?.isDeveloper === true &&
        typeof user?.email === "string" &&
        user.email.toLowerCase() === SALARY_DEV_EMAIL
    );
}

/**
 * Narrower gate dedicated to salary / payroll data. Per explicit policy
 * (2026-05-25), only HR Manager, CEO, and the salary-trusted developer
 * (gagan — see SALARY_DEV_EMAIL above) may see or edit salary, payslips,
 * and payroll runs. `special_access`, `role=admin`, and OTHER developers
 * are deliberately excluded — they still pass `isHRAdmin` / `isDeveloper`
 * for unrelated surfaces but are NOT trusted with compensation data.
 *
 * Use this in every salary / payroll route and component instead of
 * isHRAdmin or isDeveloper. The split keeps the broader HR-admin /
 * developer tiers intact for unrelated features while locking pay
 * data down to the three people who actually own it.
 *
 * Allowed:
 *   • orgLevel === "ceo"
 *   • orgLevel === "hr_manager"
 *   • email     === SALARY_DEV_EMAIL  (AND isDeveloper === true)
 */
export function canViewSalary(user: any): boolean {
    if (hasResolvedPermissions(user)) return can(user, "VIEW_SALARY");
    return (
        user?.orgLevel === "ceo" ||
        user?.orgLevel === "hr_manager" ||
        isSalaryDeveloper(user)
    );
}

/**
 * Checks auth and requires HR admin access. Mirrors the client-side
 * `isHRAdmin` helper in src/lib/access.ts so the server and the UI agree
 * on who can hit HR admin endpoints (onboarding, employee CRUD, etc.).
 */
export async function requireHRAdmin() {
    const { session, errorResponse } = await requireAuth();
    if (errorResponse) return { session: null, errorResponse };

    if (!isHRAdmin(session!.user)) {
        return {
            session: null,
            errorResponse: NextResponse.json(
                { error: "Forbidden" },
                { status: 403 }
            ),
        };
    }

    return { session, errorResponse: null };
}

/**
 * Checks auth and requires admin access (CEO or developer).
 */
export async function requireAdmin() {
    const { session, errorResponse } = await requireAuth();
    if (errorResponse) return { session: null, errorResponse };

    const user = session!.user as any;
    const isAdmin = hasResolvedPermissions(user)
        ? can(user, "SYSTEM_ADMIN")
        : (user.orgLevel === "ceo" ||
           user.orgLevel === "special_access" ||
           user.isDeveloper === true);

    if (!isAdmin) {
        return {
            session: null,
            errorResponse: NextResponse.json(
                { error: "Forbidden" },
                { status: 403 }
            ),
        };
    }

    return { session, errorResponse: null };
}

/**
 * Resolves the numeric DB user ID from the session.
 * Falls back to a DB lookup by email if `dbId` is not present.
 */
export async function resolveUserId(session: any): Promise<number | null> {
    const user = session?.user as any;
    if (user?.dbId) return user.dbId;
    if (user?.email) {
        try {
            const found = await prisma.user.findUnique({ where: { email: user.email }, select: { id: true } });
            return found?.id ?? null;
        } catch {
            return null;
        }
    }
    return null;
}

