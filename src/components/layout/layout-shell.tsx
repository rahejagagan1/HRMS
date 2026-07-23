"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Sidebar from "./sidebar";
import Header from "./header";

export default function LayoutShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { data: session, status: sessionStatus } = useSession();
    const isLoginPage = pathname === "/login";
    const isOnboardingPage = pathname === "/onboarding";
    // Public careers / job-application routes — no sidebar / no header.
    // These are meant to be embedded on the marketing site and shouldn't
    // expose any dashboard chrome.
    const isPublicJobsPage = pathname.startsWith("/jobs");

    // Mount gate: Next 16.2.x throws "Router action dispatched before
    // initialization" when router.replace() runs during the same
    // commit as initial mount. Waiting one paint guarantees the
    // router reducer has booted, eliminating the console spam without
    // changing the redirect behaviour.
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    // First-login wizard gate. If HR set onboardingPending on this user,
    // every navigation outside /login or /onboarding bounces to /onboarding
    // until they finish it.
    useEffect(() => {
        if (!mounted) return;
        // Hold off until next-auth has actually resolved — running on
        // status='loading' can briefly flip pending undefined → true →
        // false and dispatch an unnecessary redirect.
        if (sessionStatus !== "authenticated") return;
        const pending = (session?.user as any)?.onboardingPending === true;
        if (pending && !isOnboardingPage && !isLoginPage && !isPublicJobsPage) {
            router.replace("/onboarding");
        }
        // `router` is intentionally not in deps — useRouter() returns
        // a stable reference but Next 16 occasionally re-creates it
        // during HMR, which re-fires the effect and re-dispatches the
        // same redirect.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mounted, sessionStatus, session, pathname, isOnboardingPage, isLoginPage, isPublicJobsPage]);

    if (isLoginPage || isPublicJobsPage) {
        return <>{children}</>;
    }

    if (isOnboardingPage) {
        // Onboarding is a full-bleed page — no sidebar / header chrome.
        return <>{children}</>;
    }

    // Routes that already supply their own full-bleed layout / internal
    // padding — leave them edge-to-edge. All other routes get a default
    // 24-px inset so generic content doesn't touch the sidebar border.
    // NOTE: /dashboard/scores is intentionally NOT full-bleed — the audit
    // panel doesn't add its own horizontal padding and was rendering flush
    // against the sidebar, looking unprofessional.
    const FULL_BLEED = ["/dashboard/hr", "/dashboard/reports"];
    const isFullBleed = FULL_BLEED.some((p) => pathname.startsWith(p));
    // Full-bleed routes still get a small left gutter on the content
    // area itself (below the header) so page content doesn't render
    // flush against the sidebar — but the header sits flush, letting
    // the sidebar's NB Media logo visually connect to the welcome banner.
    const contentCls  = isFullBleed ? "flex-1 pl-3 lg:pl-4" : "flex-1 p-6 lg:p-7";

    return (
        <div className="flex min-h-screen bg-[#f4f7fb]">
            {/* Suspense boundary — Sidebar uses useSearchParams() for the
                nested My-Pay flyout active state. Without this wrapper, any
                statically-prerendered page (/cases, /_not-found, etc.) bails
                during build with the missing-suspense CSR error. */}
            <Suspense fallback={null}>
                <Sidebar />
            </Suspense>
            {/* `ml-[92px]` = exact sidebar width — the header butts up
                cleanly against the brand block so they read as one strip. */}
            <main className="ml-[92px] flex min-h-screen min-w-0 flex-1 flex-col overflow-x-clip bg-[#f4f7fb]">
                <Header />
                <div className={contentCls}>
                    {children}
                </div>
                {!pathname.startsWith("/dashboard") ? (
                    <footer className="border-t border-[#dbe4ed] py-4 text-center">
                        <p className="text-[11px] font-medium tracking-wider text-slate-400">
                            <span className="font-semibold text-slate-500">NB Media</span>
                            <span className="mx-2">•</span>
                            <span>© {new Date().getFullYear()} NB Media Productions</span>
                        </p>
                    </footer>
                ) : null}
            </main>
        </div>
    );
}
