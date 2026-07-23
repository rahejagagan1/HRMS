import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Public-facing routes that bypass the Google-restricted login wall.
// /jobs and its child routes (/jobs/[slug], /jobs/apply) are the
// candidate-facing careers + application flow that needs to be
// reachable without an @nbmediaproductions.com / @ytipro.com login.
// /api/jobs/* powers those pages (form-fields, openings, [id],
// parse-resume, apply) so applicants can submit without a session.
// /api/public/* is reserved by convention for read-only, published-
// data-only endpoints (the JD PDF streamer, the public openings
// list). NEVER add an endpoint that touches User / Attendance /
// payroll / candidate-PII tables here — anything under /api/public
// is world-readable.
const PUBLIC_PATHS = [
    "/login",
    "/api/auth",
    "/api/health",
    "/jobs",
    "/api/jobs",
    "/api/public",
    // Deploy-check has its own DEPLOY_CHECK_TOKEN gate (constant-
    // time compare + generic 404 on mismatch), so it bypasses the
    // session-redirect — otherwise the middleware would redirect
    // unauthenticated curls to /login before the token check could
    // run. Safe to keep public because the route returns only a
    // single boolean marker and refuses requests without the token.
    "/api/__deploy-check",
    // Cron entry points authenticate with Authorization: Bearer
    // CRON_SECRET inside the route handler. We have to whitelist
    // them here OR the middleware redirects the unauthenticated
    // curl to /login before the token check can run (same problem
    // /api/__deploy-check has). Path-prefix match — covers all
    // /api/cron/<job> children.
    "/api/cron",
    // Hardware webhooks (Hikvision biometric terminal etc.) — the device
    // isn't a logged-in user, so the session redirect would bounce its POST
    // to /login. The route handler does its own auth (shared secret,
    // constant-time compare, fail-closed in production).
    "/api/devices",
];

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Allow public paths. Match either the exact path or the path as a
    // prefix with a "/" boundary so /api/jobs whitelists /api/jobs and
    // /api/jobs/openings but NOT a hypothetical /api/jobs-admin.
    if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
        return NextResponse.next();
    }

    // Allow static assets and Next.js internals
    if (
        pathname.startsWith("/_next") ||
        pathname.startsWith("/favicon") ||
        pathname.includes(".")
    ) {
        return NextResponse.next();
    }

    // Check auth token
    const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET,
    });

    if (!token) {
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("callbackUrl", pathname);
        return NextResponse.redirect(loginUrl);
    }

    // Admin-only route protection
    const ADMIN_PATHS = ["/admin", "/dashboard/scores/admin", "/dashboard/scores/config"];
    if (ADMIN_PATHS.some((p) => pathname.startsWith(p))) {
        const orgLevel = (token as any).orgLevel;
        const isDeveloper = (token as any).isDeveloper;
        const isAdmin = orgLevel === "ceo" || orgLevel === "special_access" || isDeveloper === true;

        if (!isAdmin) {
            return NextResponse.redirect(new URL("/dashboard", request.url));
        }
    }

    // HR module is now generally available — every authenticated user can hit
    // /dashboard/hr/* and /api/hr/*. Page- and endpoint-level ACLs (e.g.
    // requireAdmin in /api/hr/admin/* and isHRAdmin gates inside admin pages)
    // still keep manager-only views off-limits to regular employees.
    // (Previously this was developer-only behind a rollout flag.)

    // YouTube dashboard: any authenticated user (see youtube-dashboard-access)

    return NextResponse.next();
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
