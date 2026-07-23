"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { ExitSurveyGate } from "@/lib/hr/use-clock-actions";

/**
 * Blocking modal shown when a clock-out is rejected with
 * `reason: "exit_survey_required"` — i.e. a leaving employee (filed exit,
 * last working day within the window) hasn't submitted their Exit Survey.
 * Funnels them straight into the form so they can finish and clock out.
 *
 * Renders nothing when `gate` is null. Esc dismisses (they still can't
 * clock out until it's submitted — the server re-blocks).
 */
export default function ExitSurveyGateModal({
  gate,
  onDismiss,
}: {
  gate: ExitSurveyGate | null;
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
      aria-labelledby="exit-gate-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
        <div className="bg-gradient-to-r from-rose-500 to-orange-500 px-6 py-5 text-white">
          <div className="flex items-start gap-3">
            <div className="flex-none flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-2xl">📝</div>
            <div className="flex-1">
              <h2 id="exit-gate-title" className="text-lg font-semibold leading-tight">One last step before you go</h2>
              <p className="mt-1 text-sm text-white/85">Please complete your Exit Survey.</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
          {gate.message || "You're set to leave soon. Please fill your Exit Survey before clocking out."}
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Your honest feedback goes to HR and helps us improve. It only takes a few minutes.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 pb-5">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Not now
          </button>
          <Link
            href={gate.exitSurveyUrl}
            onClick={onDismiss}
            className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-600"
          >
            Fill Exit Survey →
          </Link>
        </div>
      </div>
    </div>
  );
}
