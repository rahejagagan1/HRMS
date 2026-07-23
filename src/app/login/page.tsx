"use client";

import Image from "next/image";
import { signIn } from "next-auth/react";

const useDevLogin = process.env.NEXT_PUBLIC_DEV_LOGIN === "true";

export default function LoginPage() {
    return (
        <div className="fixed inset-0 flex items-center justify-center bg-[#f5f5f7] dark:bg-[#080816]">
            {/* Background glow effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-60 dark:opacity-100" style={{ background: 'rgba(139,92,246,0.12)', filter: 'blur(120px)' }} />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full opacity-60 dark:opacity-100" style={{ background: 'rgba(217,70,239,0.10)', filter: 'blur(120px)' }} />
            </div>

            <div className="relative z-10 w-full max-w-sm mx-4">
                <div className="rounded-3xl p-10 shadow-2xl bg-white dark:bg-[rgba(18,18,42,0.95)] border border-black/10 dark:border-white/[0.08] backdrop-blur-xl">
                    {/* Logo */}
                    <div className="text-center mb-8">
                        <div className="mx-auto mb-5 inline-flex items-center justify-center rounded-2xl px-6 py-3 shadow-lg bg-white border border-black/10">
                            <div className="relative h-12 w-[min(100%,220px)] min-w-[120px]">
                                <Image
                                    src="/logo.png"
                                    alt="NB Media Productions"
                                    fill
                                    priority
                                    className="object-contain object-center"
                                    sizes="220px"
                                />
                            </div>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Production Management Dashboard</p>
                    </div>

                    {/* Dev bypass */}
                    {useDevLogin ? (
                        <div className="space-y-3">
                            <div className="px-4 py-2 rounded-xl text-center mb-4 bg-amber-500/10 border border-amber-500/20">
                                <p className="text-xs font-medium text-amber-500">🛠 Development Mode</p>
                                <p className="text-[11px] mt-0.5 text-amber-400/70">Sign in as dev admin or with your Google account</p>
                            </div>
                            <button
                                onClick={() => signIn("credentials", { callbackUrl: "/dashboard" })}
                                className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-2xl text-sm font-medium transition-all shadow-lg text-white"
                                style={{ background: 'linear-gradient(to right, #7c3aed, #a21caf)' }}
                            >
                                Enter as Dev Admin →
                            </button>
                            <div className="flex items-center gap-3 py-1">
                                <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
                                <span className="text-[11px] text-slate-400">or</span>
                                <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
                            </div>
                            <button
                                onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
                                className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-2xl text-sm font-medium transition-all shadow-md bg-white hover:bg-slate-50 text-slate-800 border border-black/10"
                            >
                                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                </svg>
                                Sign in with Google
                            </button>
                        </div>
                    ) : (
                        <>
                            <button
                                onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
                                className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-2xl text-sm font-medium transition-all shadow-md bg-white hover:bg-slate-50 text-slate-800 border border-black/10"
                            >
                                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                </svg>
                                Sign in with Google
                            </button>
                            <p className="text-center text-[11px] mt-5 text-slate-400">
                                Restricted to @nbmediaproductions.com and @ytlpro.com accounts
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
