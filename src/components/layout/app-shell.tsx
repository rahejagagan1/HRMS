"use client";

import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import Sidebar from "./sidebar";
import Header from "./header";

const PUBLIC_PATHS = ["/login"];

export default function AppShell({ children }: { children: React.ReactNode }) {
    const { status } = useSession();
    const pathname = usePathname();

    const isPublicPage = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

    // On public pages (login), render children without shell
    if (isPublicPage) {
        return <>{children}</>;
    }

    // While session is loading on authenticated pages, show a loading state
    if (status === "loading") {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-3 border-violet-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm text-slate-500">Loading...</p>
                </div>
            </div>
        );
    }

    // Authenticated: show full layout
    const isHRPage = pathname.startsWith("/dashboard/hr");

    return (
        <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 ml-20 min-w-0 bg-[#eef2f6]">
                <Header />
                <div className={isHRPage ? "" : "p-6"}>
                    {children}
                </div>
            </main>
        </div>
    );
}
