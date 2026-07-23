// Shared types + helpers for the brand-scoped HR Dashboard sub-routes.
//
// Every HR admin panel carries an internal `companyTab` state of the
// same shape (CompanyBrand) — "NB Media" | "YT Labs" | "all" — driven
// by a per-panel pill toggle. The dashboard hub page now also reads a
// `?brand=` query param (set by the new sidebar flyout under HR
// Dashboard) and seeds each panel's initial brand from it, so the
// founder can land directly on YT Labs HR or NB Media HR.
//
// The brand split is UI-only — every endpoint still returns org-wide
// data and the client filters by `businessUnit`. No data is moved.

export type CompanyBrand = "NB Media" | "YT Labs" | "all";

/** URL slug ↔ CompanyBrand. Slugs are kebab-case to match the rest of
 *  the app's URL conventions (e.g. "nb-media", "yt-labs"). */
export function brandFromSlug(slug: string | null | undefined): CompanyBrand | null {
  if (!slug) return null;
  switch (slug.toLowerCase()) {
    case "nb":
    case "nb-media": return "NB Media";
    case "yt":
    case "yt-labs": return "YT Labs";
    case "all":      return "all";
    default:         return null;
  }
}

/** Inverse — emit the kebab-case slug for a brand. Used to build the
 *  href in the sidebar flyout. */
export function slugForBrand(brand: CompanyBrand): string {
  switch (brand) {
    case "NB Media": return "nb-media";
    case "YT Labs":  return "yt-labs";
    case "all":      return "all";
  }
}

/** Bucket a user's `businessUnit` into a concrete brand. Empty / legacy /
 *  unknown values fall into NB Media (the parent brand) — same convention the
 *  Company tab and auto-LOP use. */
export function brandOf(businessUnit: string | null | undefined): "NB Media" | "YT Labs" {
  return businessUnit === "YT Labs" ? "YT Labs" : "NB Media";
}

/** True when a user with `businessUnit` belongs in the given brand scope.
 *  A null / "all" scope matches everyone (super-admin view); a specific brand
 *  matches only that brand. Used by the brand-scoped Permissions pages so the
 *  filter stays consistent (UI-only — the API still returns org-wide rows). */
export function inBrandScope(businessUnit: string | null | undefined, scope: CompanyBrand | null | undefined): boolean {
  if (!scope || scope === "all") return true;
  return brandOf(businessUnit) === scope;
}
