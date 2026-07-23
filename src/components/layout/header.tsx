"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { UserCircle } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import HeaderSearch from "@/components/layout/header-search";

// Light mode only — enforce on mount (and clean up any stale dark-mode pref).
function useEnforceLightMode() {
    useEffect(() => {
        document.documentElement.classList.remove("dark");
        try { localStorage.removeItem("theme"); } catch { /* noop */ }
    }, []);
}

export default function Header({ title }: { title?: string }) {
    useEnforceLightMode();
    const { data: session } = useSession();
    const [showMenu, setShowMenu] = useState(false);
    const menuRef  = useRef<HTMLDivElement>(null);
    const btnRef   = useRef<HTMLButtonElement>(null);

    // Close menu on outside click (button + portalled menu both count as "inside").
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            const t = e.target as Node;
            if (btnRef.current?.contains(t))  return;
            if (menuRef.current?.contains(t)) return;
            setShowMenu(false);
        };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    const user = session?.user;
    const initials = user?.name
        ? user.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
        : "?";

    return (
        <header
            className="sticky top-0 z-30 h-[68px] border-b border-[#cdd6e2] flex items-center justify-between px-6 shadow-[0_1px_3px_rgba(15,23,42,0.08)]"
            style={{ background: "linear-gradient(180deg, #eceff3 0%, #e5eaf0 100%)" }}
        >

            <div className="relative z-10 flex items-center gap-3 min-w-0">
                {user?.image ? (
                    <img
                        src={user.image}
                        alt={user.name || "Profile"}
                        className="w-9 h-9 rounded-full object-cover ring-1 ring-[#cfd9e4]"
                        referrerPolicy="no-referrer"
                    />
                ) : (
                    <div className="w-9 h-9 rounded-full bg-[#0f6ecd] flex items-center justify-center text-white text-xs font-semibold ring-1 ring-[#cfd9e4]">
                        {initials}
                    </div>
                )}
                <div className="leading-tight min-w-0">
                    <h2 className="text-[15px] font-semibold text-[#1d2b38] truncate">
                        {user?.name ? `Welcome ${user.name}!` : (title || "Welcome!")}
                    </h2>
                    {user?.email && (
                        <p className="text-[11px] text-[#7a8da1] leading-none mt-1 truncate">{user.email}</p>
                    )}
                </div>
            </div>

            <div className="relative z-10 flex items-center gap-2.5">
                {/* Live case search (debounced + portalled dropdown) */}
                <HeaderSearch />

                {/* Notifications */}
                <NotificationBell />

                {/* Profile Avatar + Dropdown */}
                <div className="relative" ref={menuRef}>
                    <button
                        ref={btnRef}
                        onClick={() => setShowMenu(!showMenu)}
                        className="flex items-center gap-2 rounded-full hover:bg-[#dde4ec] transition-colors p-0.5"
                    >
                        {user?.image ? (
                            <img
                                src={user.image}
                                alt={user.name || "Profile"}
                                className="w-8 h-8 rounded-full object-cover border border-[#cfd9e4]"
                                referrerPolicy="no-referrer"
                            />
                        ) : (
                            <div className="w-8 h-8 rounded-full bg-[#0f6ecd] flex items-center justify-center text-white text-[11px] font-medium">
                                {initials}
                            </div>
                        )}
                    </button>

                    {/* Dropdown Menu — portalled to <body> so it escapes the header's
                        overflow:hidden (needed for the gradient wash) and always sits on top. */}
                    {showMenu && typeof document !== "undefined" && createPortal(
                        (() => {
                            const r = btnRef.current?.getBoundingClientRect();
                            const top   = (r?.bottom ?? 0) + 8;
                            const right = Math.max(8, (typeof window !== "undefined" ? window.innerWidth : 0) - (r?.right ?? 0));
                            return (
                                <div
                                    ref={menuRef as any}
                                    style={{ position: "fixed", top, right, zIndex: 9999 }}
                                    className="w-64 rounded-2xl bg-white dark:bg-[#1a1a35] border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden"
                                >
                            {/* User info */}
                            <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10">
                                <div className="flex items-center gap-3">
                                    {user?.image ? (
                                        <img
                                            src={user.image}
                                            alt=""
                                            className="w-10 h-10 rounded-xl object-cover"
                                            referrerPolicy="no-referrer"
                                        />
                                    ) : (
                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-sm font-bold">
                                            {initials}
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                            {user?.name || "User"}
                                        </p>
                                        <p className="text-xs text-slate-500 truncate">
                                            {user?.email || ""}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* My Profile */}
                            <Link
                                href="/dashboard/hr/profile"
                                onClick={() => setShowMenu(false)}
                                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors border-b border-slate-100 dark:border-white/[0.06]"
                            >
                                <UserCircle className="w-4 h-4 text-[#008CFF]" strokeWidth={1.75} />
                                My Profile
                            </Link>

                            {/* Sign out */}
                            <button
                                onClick={() => signOut({ callbackUrl: "/login" })}
                                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                </svg>
                                Sign Out
                            </button>
                                </div>
                            );
                        })(),
                        document.body
                    )}
                </div>
            </div>
        </header>
    );
}
