import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import prisma from "@/lib/prisma";
import { cachedFetch } from "@/lib/cache";
import { getPermissionsByEmail, getScorecardFunctionByEmail, hasDesignationReportGrantsByEmail } from "@/lib/permissions/resolve-permissions";

const useDevLogin = process.env.NEXT_PUBLIC_DEV_LOGIN === "true";
const developerEmails = (process.env.DEVELOPER_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

// The mock account the dev credentials provider signs in as. Dev-mode
// conveniences (auto row creation, admin fallback) apply ONLY to this
// account — any real email logging in on a dev server gets exactly its
// production access, so permission testing locally reflects reality.
// The developer flag itself comes solely from DEVELOPER_EMAILS.
const DEV_LOGIN_EMAIL = "dev@nbmediaproductions.com";

// ── Per-user auth bundle ────────────────────────────────────────────
// Everything the JWT + session callbacks need about a user, fetched in
// as few round-trips as possible and cached briefly. Both `jwt()` AND
// `session()` run on EVERY `getServerSession()` call (JWT strategy), so
// without this each authenticated request paid ~6 DB queries — and a
// single dashboard page fires ~10 parallel API calls. The short TTL
// keeps role / permission / onboarding changes propagating within ~30s
// (preserving the previous "resolved per request" behaviour) while
// collapsing the DB load to ~one fetch per user per 30s, shared across
// both callbacks and all concurrent requests in that window.
const AUTH_BUNDLE_TTL_MS = 30_000;

// Session lifetimes (2026-07-28). Two limits work together:
//   • maxAge          — idle timeout: a session unused for this long dies,
//                       so someone away for a week must sign in again.
//   • ABSOLUTE_MAX    — hard cap: even a daily-active user is forced to
//                       re-authenticate at least this often.
const SESSION_MAX_AGE_SEC  = 7  * 24 * 60 * 60;  // 7 days idle
const ABSOLUTE_MAX_AGE_SEC = 10 * 24 * 60 * 60;  // 10 days absolute

type AuthBundle = {
    dbId: number | null;
    role: string | null;
    orgLevel: string | null;
    clickupUserId: string | null;
    teamCapsule: unknown;
    dbName: string | null;
    department: string | null;
    designation: string | null;
    businessUnit: string | null;
    onboardingPending: boolean;
    permissions: string[];
    scorecardFunction: string | null;
    hasReportGrants: boolean;
    isDeveloper: boolean;
    // True once the account should lose access: deactivated, OR their exit's
    // last working day has passed. Developers / the mock dev account are never
    // revoked (platform accounts). Drives the auto-logout.
    accessRevoked: boolean;
};

const userBundleSelect = {
    id: true,
    clickupUserId: true,
    role: true,
    orgLevel: true,
    teamCapsule: true,
    name: true,
    isActive: true,
    // HR-granted grace period — overrides the exit/inactive lockout while
    // it's still in the future.
    accessExtendedUntil: true,
    // department drives HR-department permissions; businessUnit is the
    // brand membership (NB Media / YT Labs) the sidebar gates tiles on.
    employeeProfile: { select: { department: true, businessUnit: true, designation: true } },
    // Exit record — lastWorkingDay drives the auto-logout once it passes.
    employeeExit: { select: { lastWorkingDay: true } },
    // `as any` for the whole select: the generated Prisma client can lag on
    // the newly-added `accessExtendedUntil` column (Windows DLL lock blocks
    // `prisma generate` on the dev box). Runtime is fine — the migration
    // already added the column.
} as any;

// True when an HR-granted access extension is still valid (today ≤ the granted
// date). Shared by the bundle + the signIn gate so they never disagree.
function extensionActive(accessExtendedUntil: Date | null | undefined): boolean {
    if (!accessExtendedUntil) return false;
    const t = new Date(); t.setUTCHours(0, 0, 0, 0);
    return new Date(accessExtendedUntil).getTime() >= t.getTime();
}

async function loadAuthBundle(email: string): Promise<AuthBundle> {
    const isDev = developerEmails.includes(email.toLowerCase());
    const isMockDevAccount = useDevLogin && email.toLowerCase() === DEV_LOGIN_EMAIL;

    // Identity + profile in one round-trip. Case-insensitive match so a
    // record stored with a stray capital (e.g. "Aditi@…") still resolves to
    // the right user — otherwise they'd log in but load a null role/profile.
    // `any` — the select carries a column (accessExtendedUntil) the generated
    // client can lag on; the cast keeps every downstream field access clean.
    let dbUser: any = await prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: userBundleSelect,
    });

    // Dev credentials login: ensure a DB row exists so APIs get dbId/orgLevel.
    // Scoped to the mock account only — a rowless real email must never get
    // an admin row auto-created (the dev DB is shared with production).
    if (!dbUser && isMockDevAccount) {
        dbUser = await prisma.user.upsert({
            where: { email },
            create: { email, name: "Dev Admin", role: "admin", orgLevel: "ceo" },
            update: {},
            select: userBundleSelect,
        }).catch(() => null);
    }

    // Onboarding flag (recent column, raw so a stale client still works) +
    // designation grants — all independent, so resolve in parallel.
    const [onboardingRows, permissions, scorecardFunction, hasReportGrants] = await Promise.all([
        prisma.$queryRawUnsafe<{ onboardingPending: boolean }[]>(
            `SELECT "onboardingPending" FROM "User" WHERE LOWER(email) = LOWER($1) LIMIT 1`,
            email,
        ).catch(() => [] as { onboardingPending: boolean }[]),
        getPermissionsByEmail(email),
        getScorecardFunctionByEmail(email),
        hasDesignationReportGrantsByEmail(email),
    ]);

    const profile = (dbUser as { employeeProfile?: { department?: string | null; businessUnit?: string | null; designation?: string | null } } | null)?.employeeProfile;

    // Access revocation: deactivated OR last working day already passed.
    // Only when we clearly SEE the row (never on a transient null → don't
    // lock people out on a DB blip). Platform accounts are exempt.
    const du = dbUser as { isActive?: boolean; accessExtendedUntil?: Date | null; employeeExit?: { lastWorkingDay?: Date | null } } | null;
    const todayUtc = new Date(); todayUtc.setUTCHours(0, 0, 0, 0);
    const lwd = du?.employeeExit?.lastWorkingDay ? new Date(du.employeeExit.lastWorkingDay) : null;
    const exitedByDate = lwd ? lwd.getTime() < todayUtc.getTime() : false;
    // An active HR extension is a master override — it lets an exited /
    // deactivated employee keep logging in until the granted date passes.
    const extended = extensionActive(du?.accessExtendedUntil);
    const accessRevoked = !isDev && !isMockDevAccount && !extended && du != null && (du.isActive === false || exitedByDate);

    return {
        dbId: dbUser?.id ?? null,
        role: dbUser?.role ?? (isMockDevAccount ? "admin" : null),
        // Developer emails get full visibility via special_access (NOT CEO —
        // that title stays with the real CEO account).
        orgLevel: isDev ? "special_access" : (dbUser?.orgLevel ?? null),
        clickupUserId: dbUser?.clickupUserId != null ? dbUser.clickupUserId.toString() : null,
        teamCapsule: (dbUser as { teamCapsule?: unknown } | null)?.teamCapsule ?? null,
        dbName: dbUser?.name ?? null,
        department: profile?.department ?? null,
        designation: profile?.designation ?? null,
        businessUnit: profile?.businessUnit ?? null,
        onboardingPending: !!onboardingRows?.[0]?.onboardingPending,
        permissions,
        scorecardFunction,
        hasReportGrants,
        // Developer flag comes ONLY from DEVELOPER_EMAILS — dev-login mode no
        // longer blankets every session as a developer, so the dev server
        // shows each real user their true tabs/permissions. The mock Dev
        // Admin account keeps full access via its role=admin DB row.
        isDeveloper: isDev,
        accessRevoked,
    };
}

/** Cached per-user auth bundle (30s TTL). Key is lowercased email. */
function getAuthBundle(email: string): Promise<AuthBundle> {
    return cachedFetch(`auth:bundle:${email.toLowerCase()}`, () => loadAuthBundle(email), AUTH_BUNDLE_TTL_MS);
}

const googleProvider =
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        })
        : null;

const devCredentialsProvider = CredentialsProvider({
    // ─── Development: instant sign-in, no Google required ───
    name: "Dev Login",
    credentials: {},
    async authorize() {
        // Returns a mock admin user — auto-signed in on /login
        return {
            id: "dev",
            name: "Dev Admin",
            email: DEV_LOGIN_EMAIL,
            image: null,
        };
    },
});

export const authOptions: NextAuthOptions = {
    providers: useDevLogin
        // ─── Development: instant dev admin AND real Google sign-in ───
        // Google is included too (when credentials are set) so developers
        // can sign in with their real account to debug as themselves.
        ? [devCredentialsProvider, ...(googleProvider ? [googleProvider] : [])]
        // ─── Production: Google OAuth only ───
        : [googleProvider!],

    callbacks: {
        async signIn({ user, account }) {
            // In dev, always allow
            if (useDevLogin) return true;
            // Allow developer emails (from env) regardless of domain
            if (user.email && developerEmails.includes(user.email.toLowerCase())) {
                // Save developer to DB
                try {
                    await prisma.user.upsert({
                        where: { email: user.email },
                        create: {
                            email: user.email,
                            name: user.name || "Developer",
                            profilePictureUrl: user.image || null,
                            role: "admin",
                            orgLevel: "special_access",
                        },
                        update: {
                            name: user.name || undefined,
                            profilePictureUrl: user.image || undefined,
                        },
                    });
                } catch (e) {
                    console.error("Failed to upsert developer user:", e);
                }
                return true;
            }
            // Only allow users that already exist in the DB and are active.
            // Match the email CASE-INSENSITIVELY: Google always sends the
            // address in lowercase, but a record created by HR may carry a
            // stray capital (e.g. "Aditi@…"). A case-sensitive match would
            // miss it and wrongly deny access. findFirst + insensitive mode
            // tolerates any stored casing; we then act on the row's id.
            if (!user.email) return false;
            const existingUser = await prisma.user.findFirst({
                where: { email: { equals: user.email, mode: "insensitive" } },
                // `as any` select — stale generated client on accessExtendedUntil.
                select: { id: true, isActive: true, accessExtendedUntil: true, employeeExit: { select: { lastWorkingDay: true } } } as any,
            }) as any;
            if (!existingUser) {
                return false; // User not in DB — must be added via admin first
            }
            // An active HR-granted extension overrides both the deactivated
            // flag and the passed-exit-date block, so an ex-employee with a
            // valid grace window can still sign in.
            const extended = extensionActive(existingUser.accessExtendedUntil);
            if (!extended) {
                if (!existingUser.isActive) return false; // deactivated
                const lwd = existingUser.employeeExit?.lastWorkingDay;
                if (lwd) {
                    const t = new Date(); t.setUTCHours(0, 0, 0, 0);
                    if (new Date(lwd).getTime() < t.getTime()) return false; // exit date passed
                }
            }
            // Update profile picture on login (by id — the stored email may be
            // cased differently than what Google sent).
            try {
                await prisma.user.update({
                    where: { id: existingUser.id },
                    data: {
                        name: user.name || undefined,
                        profilePictureUrl: user.image || undefined,
                    },
                });
            } catch (e) {
                console.error("Failed to update user on login:", e);
            }
            return true;
        },

        async jwt({ token }) {
            // Stamp the absolute login time once (first call, at sign-in) so
            // the 10-day hard cap can be enforced even for an active user.
            if (!(token as any).loginAt) (token as any).loginAt = Math.floor(Date.now() / 1000);
            // Refresh the middleware-critical claims (proxy.ts reads
            // token.orgLevel / token.isDeveloper to gate admin routes) from the
            // 30s-cached bundle — at most one DB fetch per user per 30s rather
            // than one on every request.
            if (token.email) {
                try {
                    const b = await getAuthBundle(token.email);
                    (token as any).dbId = b.dbId;
                    (token as any).role = b.role;
                    (token as any).orgLevel = b.orgLevel;
                    (token as any).isDeveloper = b.isDeveloper;
                    // Auto-logout: dead when access is revoked (deactivated /
                    // exit date passed) OR the absolute 10-day cap is hit. The
                    // middleware + session callback both honour `dead`.
                    const ageSec = Math.floor(Date.now() / 1000) - Number((token as any).loginAt || 0);
                    (token as any).dead = b.accessRevoked || ageSec > ABSOLUTE_MAX_AGE_SEC;
                } catch { /* keep prior token claims on transient DB failure */ }
            }
            return token;
        },

        async session({ session, token }) {
            // Killed session (exited / deactivated / past the 10-day cap) →
            // strip the user so requireAuth + every server read treats it as
            // logged out. The middleware redirects these to /login.
            if ((token as any)?.dead) {
                (session as any).user = null;
                return session;
            }
            const email = session.user?.email;
            if (email) {
                try {
                    const b = await getAuthBundle(email);
                    const u = session.user as any;
                    u.dbId = b.dbId;
                    u.role = b.role;
                    u.orgLevel = b.orgLevel;
                    u.teamCapsule = b.teamCapsule;
                    u.dbName = b.dbName;
                    u.onboardingPending = b.onboardingPending;
                    u.clickupUserId = b.clickupUserId;
                    u.department = b.department;
                    u.designation = b.designation;
                    u.businessUnit = b.businessUnit;
                    // Designation-based permissions for can() (writer/editor/qa/
                    // researcher/manager scorecardFunction + report grants).
                    u.permissions = b.permissions;
                    u.scorecardFunction = b.scorecardFunction;
                    u.hasReportGrants = b.hasReportGrants;
                    u.isDeveloper = b.isDeveloper;
                } catch {
                    // Transient DB failure — only the mock dev account falls
                    // back to admin; real users keep an unprivileged session.
                    if (useDevLogin && email.toLowerCase() === DEV_LOGIN_EMAIL) {
                        (session.user as any).role = "admin";
                    }
                }
            }
            return session;
        },
    },

    // JWT sessions with a 7-day idle timeout. The absolute 10-day cap is
    // enforced separately in the jwt callback (maxAge alone is rolling, so it
    // would never force an active user to re-authenticate).
    session: {
        strategy: "jwt",
        maxAge: SESSION_MAX_AGE_SEC,
    },

    pages: {
        signIn: "/login",
    },

    secret: process.env.NEXTAUTH_SECRET || "dev-secret-change-in-production",
};
