// ─────────────────────────────────────────────────────────────────────────
// DESIGNATION SEED — the initial set of designations and the exact permissions
// each one holds. These mirror today's (orgLevel, role) access 1:1 so the
// cutover changes nothing. After migration the HR Manager edits these freely
// in the admin UI.
//
// Every grant below traces to a gate in the audit. Where the legacy code had
// drift (e.g. holidays excluded special_access, exits sub-routes disagreed),
// we canonicalize to the clearly-intended behavior and note it inline.
// ─────────────────────────────────────────────────────────────────────────

import { Permission } from "./catalog";

export type DesignationSeed = {
  key: string;
  label: string;
  /** Rating track for the scorecard engine; null = not rated by a production formula. */
  scorecardFunction: "writer" | "editor" | "qa" | "researcher" | "manager" | null;
  sortOrder: number;
  permissions: Permission[];
};

// Baseline every authenticated employee gets (YouTube dashboard is open to all today).
const BASELINE: Permission[] = ["VIEW_YOUTUBE_DASHBOARD"];

// Manager-tier permissions, shared by the generic Manager + the production /
// researcher manager designations (same access; different scorecard track / role).
const MANAGER_PERMS: Permission[] = ["VIEW_REPORTS", "RATE_TEAM", "APPROVE_TEAM_REQUESTS", "VIEW_MY_TEAM", "ACT_AS_MANAGER", ...BASELINE];

// Senior-admin tier (special_access). Full admin EXCEPT: salary, delete-users,
// cron management, restricted/back-dated leave, and cross-brand bypass (all CEO/dev-only).
// Canonicalized: grants MANAGE_HOLIDAYS / MANAGE_HIRING / MANAGE_OFFBOARDING that
// some legacy gates omitted for special_access (drift #3/#4) — they are full admins everywhere else.
const SPECIAL_ACCESS_PERMS: Permission[] = [
  "SYSTEM_ADMIN", "MANAGE_USERS", "MANAGE_TAB_PERMISSIONS",
  "MANAGE_INTEGRATIONS", "RUN_SYNC", "MANAGE_EMAIL_SETTINGS",
  "SEE_ALL_DATA",
  "MANAGE_HR", "VIEW_MY_TEAM", "APPROVE_TEAM_REQUESTS", "APPROVE_ALL_REQUESTS", "ACT_ON_BEHALF",
  "MANAGE_LEAVE_POLICY", "MANAGE_HOLIDAYS", "MANAGE_ASSETS",
  "MANAGE_HIRING", "MANAGE_OFFBOARDING", "VIEW_FEEDBACK_INBOX",
  "VIEW_REPORTS", "RATE_TEAM", "MANAGE_RATINGS_CONFIG", "VIEW_SCORES_AUDIT",
  "MANAGE_KPIS", "VIEW_VIOLATIONS", "MANAGE_VIOLATIONS", "DELETE_VIOLATIONS",
  ...BASELINE,
];

// CEO = special_access + the CEO/dev-only extras.
const CEO_PERMS: Permission[] = [
  ...SPECIAL_ACCESS_PERMS,
  "DELETE_USERS", "MANAGE_CRONS", "APPLY_RESTRICTED_LEAVE", "BACKDATE_REQUESTS",
  "BYPASS_BRAND_RESTRICTION", "VIEW_SALARY", "MANAGE_PAYROLL",
];

// The actual HR Manager (legacy role="hr_manager"). Owns HR policy + salary.
// Carries VIEW_ALL_BRANDS — the NB Media HR Manager oversees both brands
// (formerly the per-user CROSS_BRAND_HR_USER_IDS env allowlist). The custom
// YT Labs HR Manager designation deliberately does NOT hold it: YT Labs HR
// stays scoped to its own brand.
const HR_MANAGER_PERMS: Permission[] = [
  "MANAGE_HR", "MANAGE_USERS", "MANAGE_TAB_PERMISSIONS", "SEE_ALL_DATA", "VIEW_ALL_BRANDS", "VIEW_MY_TEAM",
  "APPROVE_TEAM_REQUESTS", "APPROVE_ALL_REQUESTS", "ACT_ON_BEHALF",
  "MANAGE_LEAVE_POLICY", "MANAGE_HOLIDAYS", "MANAGE_ASSETS",
  "APPLY_RESTRICTED_LEAVE", "BACKDATE_REQUESTS",
  "MANAGE_HIRING", "MANAGE_OFFBOARDING", "VIEW_FEEDBACK_INBOX",
  "VIEW_REPORTS", "MANAGE_KPIS",
  "VIEW_VIOLATIONS", "MANAGE_VIOLATIONS",
  "VIEW_SALARY", "MANAGE_PAYROLL",
  // HR-confidential tier (employee documents / exit badges / engage
  // moderation) — the whole HR team holds it; special_access does not.
  "HR_CONFIDENTIAL",
  // The actual HR Manager is a report owner / manager-picker target and the
  // brand's primary HR contact for doc-compliance attributions.
  "ACT_AS_MANAGER", "HR_PRIMARY_CONTACT",
  ...BASELINE,
];

// Broad HR staff (legacy orgLevel="hr_manager" WITHOUT role="hr_manager").
// Deliberately NO salary, NO leave-policy config, NO reports, NO tab-perms,
// NO KPIs, NO restricted leave — this is what keeps the salary policy intact.
const HR_STAFF_PERMS: Permission[] = [
  "MANAGE_HR", "MANAGE_USERS", "SEE_ALL_DATA", "VIEW_MY_TEAM",
  "APPROVE_TEAM_REQUESTS", "APPROVE_ALL_REQUESTS", "ACT_ON_BEHALF",
  "MANAGE_HOLIDAYS", "MANAGE_ASSETS", "BACKDATE_REQUESTS",
  "MANAGE_HIRING", "MANAGE_OFFBOARDING", "VIEW_FEEDBACK_INBOX",
  "VIEW_VIOLATIONS", "MANAGE_VIOLATIONS",
  // HR-confidential tier — every HR team member (incl. staff like
  // Vanshika) views employee documents / exit badges per HR policy.
  "HR_CONFIDENTIAL",
  ...BASELINE,
];

export const DESIGNATION_SEED: DesignationSeed[] = [
  { key: "ceo",            label: "CEO",             scorecardFunction: null,        sortOrder: 0,  permissions: CEO_PERMS },
  { key: "special_access", label: "Special Access",  scorecardFunction: null,        sortOrder: 1,  permissions: SPECIAL_ACCESS_PERMS },
  { key: "hod",            label: "Head of Dept",    scorecardFunction: "manager",   sortOrder: 2,  permissions: ["SEE_ALL_DATA", "VIEW_REPORTS", "RATE_TEAM", "APPROVE_TEAM_REQUESTS", "VIEW_MY_TEAM", "ACT_AS_MANAGER", ...BASELINE] },
  { key: "hr_manager",     label: "HR Manager",      scorecardFunction: null,        sortOrder: 3,  permissions: HR_MANAGER_PERMS },
  { key: "hr_staff",       label: "HR Staff",        scorecardFunction: null,        sortOrder: 4,  permissions: HR_STAFF_PERMS },
  { key: "manager",            label: "Manager",            scorecardFunction: "manager", sortOrder: 5,  permissions: MANAGER_PERMS },
  { key: "production_manager", label: "Production Manager", scorecardFunction: "manager", sortOrder: 5,  permissions: MANAGER_PERMS },
  { key: "researcher_manager", label: "Researcher Manager", scorecardFunction: "manager", sortOrder: 5,  permissions: MANAGER_PERMS },
  { key: "lead",           label: "Lead",            scorecardFunction: null,        sortOrder: 6,  permissions: ["RATE_TEAM", "APPROVE_TEAM_REQUESTS", ...BASELINE] },
  { key: "sub_lead",       label: "Sub Lead",        scorecardFunction: null,        sortOrder: 7,  permissions: ["RATE_TEAM", "APPROVE_TEAM_REQUESTS", ...BASELINE] },
  // ── Content / production functions: baseline access, scorecard track set ──
  { key: "editor",         label: "Video Editor",    scorecardFunction: "editor",    sortOrder: 8,  permissions: [...BASELINE] },
  { key: "writer",         label: "Script Writer",   scorecardFunction: "writer",    sortOrder: 9,  permissions: [...BASELINE] },
  { key: "qa",             label: "QA",              scorecardFunction: "qa",        sortOrder: 10, permissions: [...BASELINE] },
  { key: "researcher",     label: "Researcher",      scorecardFunction: "researcher",sortOrder: 11, permissions: [...BASELINE] },
  { key: "graphic_designer", label: "Graphic Designer", scorecardFunction: null,     sortOrder: 12, permissions: [...BASELINE] },
  { key: "gc",             label: "GC",              scorecardFunction: null,        sortOrder: 13, permissions: [...BASELINE] },
  { key: "vo_artist",      label: "VO Artist",       scorecardFunction: null,        sortOrder: 14, permissions: [...BASELINE] },
  { key: "publisher",      label: "Publisher",       scorecardFunction: null,        sortOrder: 15, permissions: [...BASELINE] },
  // ── IT Security tier ──
  // Owns the company asset register but otherwise has no HR access.
  // Distinct from HR tiers (which all carry MANAGE_HR + MANAGE_ASSETS):
  // the sidebar surfaces the Assets tab to anyone with MANAGE_ASSETS
  // *and not* MANAGE_HR — i.e. exactly this tier. HR tiers continue to
  // reach Assets through the HR Dashboard sub-panel.
  // Intern gets the same MANAGE_ASSETS today; HR can later edit the
  // designation to view-only via the RBAC UI without a code change.
  { key: "it_security",        label: "IT Security",        scorecardFunction: null, sortOrder: 16, permissions: ["MANAGE_ASSETS", ...BASELINE] },
  { key: "it_security_intern", label: "IT Security Intern", scorecardFunction: null, sortOrder: 17, permissions: ["MANAGE_ASSETS", ...BASELINE] },
  { key: "member",         label: "Member",          scorecardFunction: null,        sortOrder: 18, permissions: [...BASELINE] },
];

/**
 * Map a legacy (orgLevel, role) pair to a designation key. Used by the backfill
 * to assign every existing user a designation that reproduces their access.
 *
 * Priority: access tier (orgLevel) wins for leadership/HR; the HR Manager is
 * identified by role; otherwise the production role picks the function-only
 * designation. Anything unrecognized falls to "member" — the backfill logs
 * these so HR can review rather than silently mis-assigning access.
 *
 * Note: developers (DEVELOPER_EMAILS) keep their env-driven blanket override in
 * `can()` regardless of which designation the backfill assigns them.
 */
export function legacyDesignationKey(
  orgLevel?: string | null,
  role?: string | null
): string {
  if (orgLevel === "ceo") return "ceo";
  if (orgLevel === "special_access" || role === "admin") return "special_access";
  if (orgLevel === "hod") return "hod";
  if (role === "hr_manager") return "hr_manager";          // the actual HR Manager
  if (orgLevel === "hr_manager") return "hr_staff";        // broad HR tier
  if (role === "production_manager") return "production_manager";
  if (role === "researcher_manager") return "researcher_manager";
  if (orgLevel === "manager" || role === "manager") return "manager";
  if (orgLevel === "lead") return "lead";
  if (orgLevel === "sub_lead") return "sub_lead";
  if (role === "editor") return "editor";
  if (role === "writer") return "writer";
  if (role === "qa") return "qa";
  if (role === "researcher") return "researcher";
  if (role === "graphic_designer") return "graphic_designer";
  if (role === "gc") return "gc";
  if (role === "vo_artist") return "vo_artist";
  if (role === "publisher") return "publisher";
  return "member";
}

/**
 * Reverse map: the legacy (orgLevel, role) a designation should write while the
 * app still reads those columns for access (UI-merge compatibility shim). For
 * the built-in designations this reproduces the exact tier that drives current
 * access. Custom designations created in the UI fall back to member/member —
 * their real access comes from `can()` once the full gate migration lands.
 */
export function legacyFromDesignationKey(key: string): { orgLevel: string; role: string } {
  switch (key) {
    case "ceo":                return { orgLevel: "ceo",            role: "admin" };
    case "special_access":     return { orgLevel: "special_access", role: "admin" };
    case "hod":                return { orgLevel: "hod",            role: "manager" };
    case "hr_manager":         return { orgLevel: "hr_manager",     role: "hr_manager" };
    case "hr_staff":           return { orgLevel: "hr_manager",     role: "member" };
    case "manager":            return { orgLevel: "manager",        role: "manager" };
    case "production_manager": return { orgLevel: "manager",        role: "production_manager" };
    case "researcher_manager": return { orgLevel: "manager",        role: "researcher_manager" };
    case "lead":               return { orgLevel: "lead",           role: "lead" };
    case "sub_lead":           return { orgLevel: "sub_lead",        role: "sub_lead" };
    case "editor":             return { orgLevel: "member",          role: "editor" };
    case "writer":             return { orgLevel: "member",          role: "writer" };
    case "qa":                 return { orgLevel: "member",          role: "qa" };
    case "researcher":         return { orgLevel: "member",          role: "researcher" };
    case "graphic_designer":   return { orgLevel: "member",          role: "graphic_designer" };
    case "gc":                 return { orgLevel: "member",          role: "gc" };
    case "vo_artist":          return { orgLevel: "member",          role: "vo_artist" };
    case "publisher":          return { orgLevel: "member",          role: "publisher" };
    default:                   return { orgLevel: "member",          role: "member" };
  }
}
