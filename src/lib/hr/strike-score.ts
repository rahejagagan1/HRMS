// Strike scoring — the numeric weight behind each L0–L3 severity badge.
//
// The Strike Log shows severities as L0–L3 (see SEVERITY_CONFIG in
// src/app/dashboard/strikes/page.tsx); the DB stores them as the
// ViolationSeverity enum low/medium/high/critical. This module is the
// single source of truth for the NUMBER each level is worth, so an
// employee's total "strike score" (sum of their strikes' levels) is
// computed the same way everywhere (API + any UI).
//
//   L0 (low)      → 0
//   L1 (medium)   → 1
//   L2 (high)     → 2
//   L3 (critical) → 3
//
// A total is just the sum of these across all of a user's strikes.

export type StrikeSeverity = "low" | "medium" | "high" | "critical";

/** Points each severity contributes to an employee's total strike score. */
export const SEVERITY_WEIGHT: Record<StrikeSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** The L0–L3 label for a severity (matches the badges in the Strike Log). */
export const SEVERITY_TIER_LABEL: Record<StrikeSeverity, string> = {
  low: "L0",
  medium: "L1",
  high: "L2",
  critical: "L3",
};

/** Weight for one severity value; unknown/legacy values score 0. */
export function severityWeight(severity: string | null | undefined): number {
  if (!severity) return 0;
  return SEVERITY_WEIGHT[severity as StrikeSeverity] ?? 0;
}

/**
 * The strike ceiling shown to employees — the score is displayed "out of
 * this" (e.g. 2 / 3). One central knob so the UI meter and any policy
 * threshold stay in lockstep.
 */
export const STRIKE_LIMIT = 3;

export type StrikeScore = {
  /** Sum of every strike's level (L0=0 … L3=3). */
  score: number;
  /** How many strikes the employee has, regardless of level. */
  count: number;
  /** The ceiling the score is shown against (STRIKE_LIMIT). */
  limit: number;
  /** Headroom before the limit — max(0, limit - score). */
  remaining: number;
  /** Per-tier counts, keyed by the L0–L3 label. */
  byTier: Record<"L0" | "L1" | "L2" | "L3", number>;
};

/**
 * Roll a list of strikes into the employee's score.
 *
 * WEIGHTED by level: each strike adds its level's points — L0=0, L1=1,
 * L2=2, L3=3 — and they sum. So an L1 + an L2 strike = 1 + 2 = 3 ("3 of 3").
 * `byTier` keeps the per-level counts for the tooltip/breakdown.
 */
export function computeStrikeScore(
  strikes: Array<{ severity: string | null | undefined }>,
): StrikeScore {
  const byTier = { L0: 0, L1: 0, L2: 0, L3: 0 };
  let score = 0;
  for (const s of strikes) {
    const sev = (s.severity ?? "low") as StrikeSeverity;
    score += severityWeight(sev); // L0=0, L1=1, L2=2, L3=3
    const tier = SEVERITY_TIER_LABEL[sev];
    if (tier && tier in byTier) byTier[tier as keyof typeof byTier] += 1;
  }
  return {
    score,
    count: strikes.length,
    limit: STRIKE_LIMIT,
    remaining: Math.max(0, STRIKE_LIMIT - score),
    byTier,
  };
}
