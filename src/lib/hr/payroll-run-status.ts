// Per-brand payroll-run lifecycle.
//
// A PayrollRun is ONE row per (month, year) shared by both brands. Payslips
// are per-employee and stepStates is a per-brand JSON slice; the lock/pay
// lifecycle is likewise per-brand, stored in PayrollRun.brandStatus:
//
//   { "NB Media": { status, lockedAt, lockedBy, paidAt, paidBy },
//     "YT Labs":  { ... } }
//
// Without this, locking one brand's payroll would lock the other's too
// (they shared the single top-level `status` column). When a brand has no
// slice yet — runs created before the split, or a brand that has never been
// generated — we fall back to the run's legacy top-level columns.
//
// This module is client-safe (no prisma / server-only imports) so both API
// routes and the Run Payroll page can share one source of truth.

import { normaliseBrandParam } from "@/lib/hr/brand-scope";

export type BrandRunStatus = {
  status: string;
  lockedAt: string | null;
  lockedBy: number | null;
  paidAt: string | null;
  paidBy: number | null;
};

type RunLike = {
  status?: string | null;
  lockedAt?: string | Date | null;
  lockedBy?: number | null;
  paidAt?: string | Date | null;
  paidBy?: number | null;
  brandStatus?: Record<string, any> | null;
} | null | undefined;

const iso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

/** Resolve the effective lifecycle status for one brand on a shared run.
 *  Prefers the brand's slice in `brandStatus`; falls back to the run's
 *  legacy top-level columns when the slice is missing. A null/blank brand
 *  always resolves to the legacy columns (the whole-run baseline). */
export function readBrandStatus(run: RunLike, brandRaw: string | null | undefined): BrandRunStatus {
  const brand = normaliseBrandParam(brandRaw);
  const slice = brand ? (run?.brandStatus as Record<string, any> | null | undefined)?.[brand] : null;
  if (slice && typeof slice === "object" && typeof slice.status === "string") {
    return {
      status: slice.status,
      lockedAt: iso(slice.lockedAt),
      lockedBy: slice.lockedBy ?? null,
      paidAt: iso(slice.paidAt),
      paidBy: slice.paidBy ?? null,
    };
  }
  return {
    status: run?.status ?? "draft",
    lockedAt: iso(run?.lockedAt),
    lockedBy: run?.lockedBy ?? null,
    paidAt: iso(run?.paidAt),
    paidBy: run?.paidBy ?? null,
  };
}

export const PAYROLL_BRANDS = ["NB Media", "YT Labs"] as const;

/** Snapshot BOTH brands' current effective status into an explicit
 *  brandStatus map. Any brand missing a slice inherits the run's legacy
 *  top-level status (the pre-split shared baseline) as its own frozen slice.
 *
 *  Callers writing a per-brand action use this as the base so that, once
 *  either brand is acted on, neither brand ever falls back to the mutable
 *  legacy column again — locking one brand can never move the other. */
export function materializeBrandStatus(run: RunLike): Record<string, BrandRunStatus> {
  const out: Record<string, BrandRunStatus> = {};
  for (const b of PAYROLL_BRANDS) out[b] = readBrandStatus(run, b);
  return out;
}

/** The brand an employee's payslip belongs to. Mirrors brandOf() used in the
 *  payroll engine: YT Labs is exact, everything else (incl. null/legacy) is
 *  NB Media — so no employee is silently unscoped. */
export function brandOfBusinessUnit(businessUnit: string | null | undefined): "NB Media" | "YT Labs" {
  return businessUnit === "YT Labs" ? "YT Labs" : "NB Media";
}
