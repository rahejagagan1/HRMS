// Canonical HR filter taxonomy. The dropdowns in Employee Directory and
// Organization Tree always list these options, even when no user has a value
// for that dimension yet — so the UI matches Keka. If a user's data happens to
// contain a value outside this list, it's merged in at render time.
import { USER_ROLE_OPTIONS, getUserRoleLabel } from "@/lib/user-role-options";
import { DEPARTMENTS } from "@/lib/departments";

export const UNASSIGNED = "__unassigned__";

export const ENTITY_VALUES = ["NB"] as const;
export const ENTITY_LABEL: Record<string, string> = {
  NB: "NB Media",
};

// Department taxonomy. Single source of truth lives in
// `src/lib/departments.ts` so the values stored by onboarding / Edit
// Profile match the values the People / Org-tree / Approvals filters
// look for. (Previously this was a divergent NB_-prefixed list — filters
// never matched stored values.)
export const DEFAULT_DEPARTMENTS = DEPARTMENTS;

// Default Location options — physical cities (jobLocation) only.
// Work mode (office/remote/hybrid) is intentionally excluded so the
// dropdown stays a clean "city" picker.
export const DEFAULT_LOCATIONS = ["Mohali"] as const;

// Derive the entity bucket for a user from teamCapsule first, department second.
// Returns "NB" | "YT" | "" (empty means the user has no classifiable data).
export function deriveEntity(u: any): string {
  const tc   = String(u?.teamCapsule ?? "").trim();
  const dept = String(u?.employeeProfile?.department ?? "").trim();
  const src  = (tc || dept).toUpperCase();
  if (src.startsWith("NB")) return "NB";
  return "";
}

export function deriveDepartment(u: any): string {
  return String(u?.employeeProfile?.department ?? "").trim();
}

// "Location" = physical city (jobLocation only). workLocation
// (office/remote/hybrid) is the work MODE — intentionally NOT mixed
// in here so the dropdown stays a clean list of cities.
export function deriveLocation(u: any): string {
  return String(u?.employeeProfile?.jobLocation ?? "").trim();
}

export function deriveRole(u: any): string {
  return String(u?.role ?? "").trim();
}

// Business Unit / Cost Center / Legal Entity were previously aliased to
// deriveEntity, which collapsed everything to "NB". They're independent
// columns on EmployeeProfile, so derive each one straight from its source.
export function deriveBusinessUnit(u: any): string {
  return String(u?.employeeProfile?.businessUnit ?? "").trim();
}
export function deriveCostCenter(u: any): string {
  return String(u?.employeeProfile?.costCenter ?? "").trim();
}
export function deriveLegalEntity(u: any): string {
  return String(u?.employeeProfile?.legalEntity ?? "").trim();
}

// ── Option builders ─────────────────────────────────────────────────────────
// Each builds the list shown in the dropdown. Structure:
//   [Unassigned?]  [default taxonomy...]  [extra values found in data...]
export type FilterOption = { value: string; label: string };

function mergeOptions(
  defaults: readonly string[],
  discovered: string[],
  labelOf: (v: string) => string = (v) => v,
): FilterOption[] {
  const seen = new Set<string>();
  const out: FilterOption[] = [];
  for (const v of defaults)   { if (!seen.has(v)) { out.push({ value: v, label: labelOf(v) }); seen.add(v); } }
  for (const v of discovered) { if (!seen.has(v)) { out.push({ value: v, label: labelOf(v) }); seen.add(v); } }
  return out;
}

// ── Filter option builders — DISCOVERED ONLY ────────────────────────────
// These power filter dropdowns (Employee Directory, Approvals, etc.) so
// every option is guaranteed to match at least one row. Static taxonomy
// constants (DEPARTMENTS, USER_ROLE_OPTIONS, DEFAULT_LOCATIONS) are still
// the source of truth for *form* dropdowns (Edit Profile, onboarding) —
// HR has to be able to PICK every option there, even when no one's in
// that bucket yet. Listing the same defaults in a *filter* dropdown just
// surfaces zero-result options that confuse the user (e.g. "manager" in
// Role had no matches because everyone is hr_manager / production_manager).
export function entityOptions(users: any[]): FilterOption[] {
  const discovered = new Set<string>();
  users.forEach((u) => { const v = deriveEntity(u); if (v) discovered.add(v); });
  return Array.from(discovered).sort().map((v) => ({ value: v, label: ENTITY_LABEL[v] ?? v }));
}

export function departmentOptions(users: any[]): FilterOption[] {
  const discovered = new Set<string>();
  users.forEach((u) => { const v = deriveDepartment(u); if (v) discovered.add(v); });
  return Array.from(discovered).sort().map((v) => ({ value: v, label: v }));
}

export function locationOptions(users: any[]): FilterOption[] {
  // Only emit jobLocation values (cities). workLocation modes are
  // intentionally omitted so the dropdown isn't a city/mode mishmash.
  const discovered = new Set<string>();
  users.forEach((u) => {
    const v = String(u?.employeeProfile?.jobLocation ?? "").trim();
    if (v) discovered.add(v);
  });
  return Array.from(discovered).sort().map((v) => ({ value: v, label: v }));
}

export function roleOptions(users: any[]): FilterOption[] {
  const discovered = new Set<string>();
  users.forEach((u) => { const v = deriveRole(u); if (v) discovered.add(v); });
  return Array.from(discovered).sort().map((v) => ({ value: v, label: getUserRoleLabel(v) }));
}

// Independent option builders for the three "entity-ish" filters. Each
// starts with the canonical NB Media + YT Labs values so both brands
// are always selectable — even before the first YT Labs employee is
// onboarded — and then unions any extra values discovered in the data
// (for legacy / custom rows). Same shape as departmentOptions /
// roleOptions otherwise.
export function businessUnitOptions(users: any[]): FilterOption[] {
  const discovered = new Set<string>(["NB Media", "YT Labs"]);
  users.forEach((u) => { const v = deriveBusinessUnit(u); if (v) discovered.add(v); });
  return Array.from(discovered).sort().map((v) => ({ value: v, label: v }));
}
export function costCenterOptions(users: any[]): FilterOption[] {
  const discovered = new Set<string>(["NB Media", "YT Labs"]);
  users.forEach((u) => { const v = deriveCostCenter(u); if (v) discovered.add(v); });
  return Array.from(discovered).sort().map((v) => ({ value: v, label: v }));
}
export function legalEntityOptions(users: any[]): FilterOption[] {
  const discovered = new Set<string>(["NB Media Productions", "YT Labs"]);
  users.forEach((u) => { const v = deriveLegalEntity(u); if (v) discovered.add(v); });
  return Array.from(discovered).sort().map((v) => ({ value: v, label: v }));
}
