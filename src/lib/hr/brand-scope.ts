// Brand-scope helper for HR endpoints that join to EmployeeProfile.
//
// Most HR admin endpoints have the shape:
//   SELECT ... FROM "User" u
//   LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
//   WHERE ...
// and need to filter to the caller's businessUnit unless the caller
// is allowlisted (developers + VIEW_ALL_BRANDS permission holders —
// granted via the RBAC designation UI; see canViewAllBrands).
//
// Usage:
//   const scope = getBrandScope(session?.user);
//   const where = scope.allBrands
//     ? "WHERE u.\"isActive\" = true"
//     : `WHERE u."isActive" = true AND ep."businessUnit" = $${nextParam}`;
//   const params = scope.allBrands ? [] : [scope.brand];

import { canViewAllBrands } from "@/lib/access";
import { can, hasResolvedPermissions } from "@/lib/permissions/can";

export type BrandScope =
  | { allBrands: true;  brand: null; reason: "developer" | "allowlisted" }
  | { allBrands: false; brand: string; reason: "own_brand" }
  | { allBrands: false; brand: null;   reason: "no_brand"  };  // fail-closed

export function getBrandScope(user: any): BrandScope {
  if (!user) return { allBrands: false, brand: null, reason: "no_brand" };
  if (user.isDeveloper === true) {
    return { allBrands: true, brand: null, reason: "developer" };
  }
  if (canViewAllBrands(user)) {
    return { allBrands: true, brand: null, reason: "allowlisted" };
  }
  // Brand-less platform admins (e.g. the mock dev-login account): a user
  // whose designation carries SYSTEM_ADMIN but who has no businessUnit is
  // a platform account, not an employee — treat as all-brands rather than
  // fail-closed. Real CEOs / admins carry a businessUnit and stay scoped.
  if (!user.businessUnit && hasResolvedPermissions(user) && can(user, "SYSTEM_ADMIN")) {
    return { allBrands: true, brand: null, reason: "allowlisted" };
  }
  const bu = user.businessUnit;
  if (bu === "NB Media" || bu === "YT Labs") {
    return { allBrands: false, brand: bu, reason: "own_brand" };
  }
  // Caller has no businessUnit set on their profile and isn't an
  // allowlisted cross-brand viewer. Don't fail open — return a
  // sentinel the caller can detect and respond with [] / 403.
  return { allBrands: false, brand: null, reason: "no_brand" };
}

/** Normalise a `?brand=` query value to a canonical brand name, or null
 *  if it doesn't name a known brand. Accepts the full names the payroll
 *  UI sends ("NB Media" / "YT Labs") as well as the slug forms used
 *  elsewhere ("nb-media" / "yt-labs" / "nb" / "yt"). */
export function normaliseBrandParam(raw: string | null | undefined): "NB Media" | "YT Labs" | null {
  const v = (raw || "").trim().toLowerCase();
  if (v === "yt labs" || v === "yt-labs" || v === "yt")  return "YT Labs";
  if (v === "nb media" || v === "nb-media" || v === "nb") return "NB Media";
  return null;
}

/**
 * Brand scope for endpoints that expose a brand toggle (e.g. the Run
 * Payroll steps). Starts from the caller's own scope, then lets an
 * all-brands caller (developer / cross-brand allowlist) NARROW the view
 * to a single brand chosen in the UI via `?brand=`.
 *
 * A single-brand caller can never widen or switch brands: a mismatching
 * `?brand=` is ignored and their own brand is kept (fail-closed). This
 * keeps the toggle purely a convenience for the founder / cross-brand HR
 * while preserving hard isolation for everyone else.
 */
export function resolveBrandScope(user: any, requestedRaw: string | null | undefined): BrandScope {
  const base = getBrandScope(user);
  const requested = normaliseBrandParam(requestedRaw);
  // Only all-brands callers can be narrowed. Single-brand / no_brand
  // callers keep their own (already-safe) scope regardless of the param.
  if (!base.allBrands || !requested) return base;
  return { allBrands: false, brand: requested, reason: "own_brand" };
}

/**
 * Prisma where-fragment limiting USER rows to the caller's brand unless
 * they're an all-brands viewer (developer / VIEW_ALL_BRANDS holder /
 * brand-less SYSTEM_ADMIN). This is the org-wide isolation rule
 * (2026-07-15): without "See all brands", every list on the site shows
 * only the caller's own brand. NULL businessUnit buckets under NB Media
 * (parent-brand default, same convention as the rest of the app).
 *
 * Use directly on `prisma.user` queries; for request tables that relate
 * to User, nest it: `{ user: brandScopeUserWhere(viewer) }`.
 */
export function brandScopeUserWhere(user: any): Record<string, any> {
  const scope = getBrandScope(user);
  if (scope.allBrands) return {};
  const brand = scope.brand ?? "NB Media";
  if (brand === "YT Labs") return { employeeProfile: { businessUnit: "YT Labs" } };
  return {
    OR: [
      { employeeProfile: { businessUnit: "NB Media" } },
      { employeeProfile: { businessUnit: null } },
      { employeeProfile: null },
    ],
  };
}

/**
 * Raw-SQL twin of {@link brandScopeUserWhere} for queries that join "User"
 * directly (alias `u` by default). Returns "" for all-brands viewers, else
 * an ` AND …` fragment. Brand values come from a fixed two-value enum, so
 * the literal interpolation is injection-safe.
 */
export function brandScopeSqlClause(user: any, userAlias = "u"): string {
  const scope = getBrandScope(user);
  if (scope.allBrands) return "";
  const brand = scope.brand ?? "NB Media";
  if (brand === "YT Labs") {
    return ` AND EXISTS (SELECT 1 FROM "EmployeeProfile" _bsep WHERE _bsep."userId" = ${userAlias}."id" AND _bsep."businessUnit" = 'YT Labs')`;
  }
  // NB Media bucket = everyone who is NOT explicitly YT Labs (covers null
  // businessUnit and missing profile rows — parent-brand default).
  return ` AND NOT EXISTS (SELECT 1 FROM "EmployeeProfile" _bsep WHERE _bsep."userId" = ${userAlias}."id" AND _bsep."businessUnit" = 'YT Labs')`;
}

/** Convenience: builds a SQL fragment + param array for the
 *  `ep."businessUnit"` filter. Caller decides where to splice it
 *  into their WHERE clause. Returns null if the caller is in the
 *  "no_brand" fail-closed bucket — caller should return [] / 403
 *  at that point instead of running the query. */
export function brandWhereClause(
  user: any,
  paramIndex: number,
): { clause: string; params: any[] } | null {
  const scope = getBrandScope(user);
  if (scope.allBrands) return { clause: "", params: [] };
  if (scope.brand) return {
    clause: `ep."businessUnit" = $${paramIndex}`,
    params: [scope.brand],
  };
  // no_brand → fail closed
  return null;
}
