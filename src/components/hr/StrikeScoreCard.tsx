"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { HelpCircle } from "lucide-react";

type ScorePayload = {
    score: number;
    count: number;
    limit: number;
    remaining: number;
    byTier: { L0: number; L1: number; L2: number; L3: number };
};

// Warning copy per strike level (1 / 2 / 3). Surfaced in the "?" tooltip so
// the card face stays clean. Edit freely to match HR policy wording.
const LEVEL_WARNING: Record<number, string> = {
    1: "First warning — 1 strike. Please correct the issue to avoid it escalating.",
    2: "Second warning — 2 strikes. One more may lead to a formal disciplinary review.",
    3: "Final warning — strike limit reached. This may trigger disciplinary action.",
};

/**
 * Employee-facing "Strikes" card — clean single-row layout (title + "?"
 * help + "X of 3" pill), mirroring the channel-strikes reference design.
 * Shows the logged-in user's OWN strike score out of the limit; the
 * per-level warning lives in the "?" tooltip. Self-only via
 * /api/me/strike-score. Sits at the top of the home dashboard's left
 * column (above Quick Access).
 */
export default function StrikeScoreCard() {
    const { data, error } = useSWR<ScorePayload>(
        "/api/me/strike-score",
        fetcher,
        { refreshInterval: 300_000 },
    );

    // Fail quiet: if the endpoint errors, don't clutter the dashboard.
    if (error) return null;

    const limit = data?.limit ?? 3;
    const score = data?.score ?? 0;

    // Hidden by default: the section only appears once the employee has an
    // active (non-closed) strike score. A score of 0 — no strikes, only
    // L0 strikes, or every strike closed — renders nothing, so the card
    // disappears again automatically when strikes are resolved. `!data`
    // covers the initial load so there's no empty flash.
    if (!data || score === 0) return null;

    // Pill tint: pink → red as strikes accrue toward the limit.
    const pill = score >= limit
        ? "bg-rose-100 text-rose-700"
        : "bg-rose-50 text-rose-600";

    // "?" tooltip: what strikes are + the warning for the current level.
    const tooltip = [
        `Your score is the sum of your strikes' levels (L1=1, L2=2, L3=3). At ${limit}, disciplinary action may follow.`,
        score >= 1 ? `\n${LEVEL_WARNING[Math.min(score, limit)]}` : "",
    ].filter(Boolean).join("\n");

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_12px_-2px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between">
                <h3 className="text-[15px] font-bold text-slate-900">Strikes</h3>
                <span className="text-slate-400 hover:text-slate-600 cursor-help" title={tooltip} aria-label="About strikes">
                    <HelpCircle size={16} />
                </span>
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-3">
                <span className="text-[13px] text-slate-600">Active strikes</span>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold tabular-nums ${pill}`}>
                    {score} of {limit}
                </span>
            </div>
        </div>
    );
}
