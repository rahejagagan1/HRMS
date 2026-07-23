"use client";

import { useEffect } from "react";
import type { DesktopGate } from "@/lib/hr/use-clock-actions";

/**
 * Blocking modal shown when a clock-in OR clock-out attempt is rejected
 * with `code: "desktop_only"`. The mobile guard (server-side at
 * /api/hr/attendance/clock-in and /clock-out) blocks punching from a
 * phone unless the user has an On-Duty request for today. Previously the
 * 403 set an error banner that the clocked-in UI never rendered, so the
 * click appeared to do nothing — this surfaces the reason explicitly.
 *
 * Renders nothing when `gate` is null. Esc key / backdrop / button dismiss.
 */
export default function DesktopGateModal({
    gate,
    onDismiss,
}: {
    gate: DesktopGate | null;
    onDismiss: () => void;
}) {
    useEffect(() => {
        if (!gate) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [gate, onDismiss]);

    if (!gate) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="desktop-gate-title"
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
        >
            <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
                <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-5 text-white">
                    <div className="flex items-start gap-3">
                        <div className="flex-none w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-2xl">
                            💻
                        </div>
                        <div className="flex-1">
                            <h2 id="desktop-gate-title" className="text-lg font-semibold leading-tight">
                                Use a laptop or desktop to punch
                            </h2>
                            <p className="mt-1 text-sm text-white/85">
                                Attendance is locked to Laptop &amp; Desktop on mobile.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-5 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                    {gate.message ||
                        "Clock-in / clock-out is only available on Laptop & Desktop. Mobile is unlocked on dates with an On-Duty request."}
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                        On the road today? Raise an On-Duty request — once it&apos;s submitted (even pending), mobile punching unlocks for that date.
                    </p>
                </div>

                <div className="flex items-center justify-end gap-2 px-6 pb-5">
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 shadow-sm transition"
                    >
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
}
