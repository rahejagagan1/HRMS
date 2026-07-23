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
};

const userBundleSelect = {
    id: true,
    clickupUserId: true,
    role: true,
    orgLevel: true,
    teamCapsule: true,
    name: true,
    // department drives HR-department permissions; businessUnit is the
    // brand membership (NB Media / YT Labs) the sidebar gates tiles on.
    employeeProfile: { select: { department: true, businessUnit: true, designation: true } },
} as const;

async function loadAuthBundle(email: string): Promise<AuthBundle> {
    const isDev = developerEmails.includes(email.toLowerCase());
    const isMockDevAccount = useDevLogin && email.toLowerCase() === DEV_LOGIN_EMAIL;

    // Identity + profile in one round-trip. Case-insensitive match so a
    // record stored with a stray capital (e.g. "Aditi@…") still resolves to
    // the right user — otherwise they'd log in but load a null role/profile.
    let dbUser = await prisma.user.findFirst({
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
                select: { id: true, isActive: true },
            });
            if (!existingUser) {
                return false; // User not in DB — must be added via admin first
            }
            if (!existingUser.isActive) {
                return false; // User was deactivated — block login
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
                } catch { /* keep prior token claims on transient DB failure */ }
            }
            return token;
        },

        async session({ session }) {
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

    pages: {
        signIn: "/login",
    },

    secret: process.env.NEXTAUTH_SECRET || "dev-secret-change-in-production",
};
