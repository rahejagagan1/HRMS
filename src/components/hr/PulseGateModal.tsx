"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { PulseGate } from "@/lib/hr/use-clock-actions";

/**
 * Blocking modal shown when a clock-out attempt is rejected with
 * `reason: "pulse_required"`. The Friday Weekly Pulse gate (server-side
 * at /api/hr/attendance/clock-out) returns this from 10:30 IST onwards
 * for any employee who hasn't submitted PulseResponses for the current
 * week. The modal funnels the user straight into the pulse form so
 * they can finish and re-click clock-out.
 *
 * Renders nothing when `gate` is null. Esc key dismisses.
 */
export default function PulseGateModal({
    gate,
    onDismiss,
}: {
    gate: PulseGate | null;
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
            aria-labelledby="pulse-gate-title"
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
        >
            <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
                <div className="bg-gradient-to-r from-sky-500 to-indigo-500 px-6 py-5 text-white">
                    <div className="flex items-start gap-3">
                        <div className="flex-none w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-2xl">
                            📋
                        </div>
                        <div className="flex-1">
                            <h2 id="pulse-gate-title" className="text-lg font-semibold leading-tight">
                                One quick thing before you clock out
                            </h2>
                            <p className="mt-1 text-sm text-white/85">
                                Friday Weekly Pulse — takes under a minute.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-5 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                    {gate.message ||
                        "You haven't filled this week's Pulse yet. Please answer it so we can wrap up your day."}
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                        Your answers stay anonymous in aggregated reports — HR sees the numbers, not who said what.
                    </p>
                </div>

                <div className="flex items-center justify-end gap-2 px-6 pb-5">
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="px-3.5 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    >
                        Not now
                    </button>
                    <Link
                        href={gate.pulseUrl}
                        onClick={onDismiss}
                        className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-sky-500 hover:bg-sky-600 shadow-sm transition"
                    >
                        Take Pulse Now →
                    </Link>
                </div>
            </div>
        </div>
    );
}
