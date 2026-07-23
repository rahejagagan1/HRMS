// Single source of truth for the tab-permission system. Every tab the
// HR admin can toggle lives here, plus:
//   • which URL prefix it covers (used by middleware / sidebar)
//   • the default for a brand-new employee (true = on, false = off)
//
// To add a new tab: append a row here — it automatically shows up in the
// permissions UI, the sidebar filter, and the middleware gate.

export type TabKey =
  | "dashboard"
  | "cases"
  | "company"
  | "scores"
  | "youtube"
  | "feedback"
  | "tools"
  | "hr_home"
  | "hr_me"
  | "hr_my_team"
  | "hr_admin"
  | "hr_people"
  | "hr_hiring"
  | "hr_offboard"
  | "reports"
  | "departments"
  | "violations"
  // ── HR feature pages that escaped the original catalog ──────
  // Added as part of the permissions-coverage audit. Each one is a
  // real route under /dashboard/hr/* that wasn't behind a permission
  // gate before, so the Permissions UI couldn't hide them per-user.
  | "hr_engage"
  | "hr_announcements"
  | "hr_org"
  | "hr_expenses"
  | "hr_approvals"
  | "hr_analytics"
  // ── HR Admin sub-tabs (inside /dashboard/hr/admin) ───────────
  // Per-user toggles for the inner panel each section. The parent
  // `hr_admin` toggle still gates the whole HR Dashboard; these keys
  // additionally hide individual sub-tabs from users who have HR
  // Dashboard access but not specific sections.
  | "hr_admin_attendance"
  | "hr_admin_approvals"
  | "hr_admin_regularize_balance"
  | "hr_admin_wfh_balances"
  | "hr_admin_leaves"
  | "hr_admin_holidays"
  | "hr_admin_assets"
  | "hr_admin_leave_types"
  | "hr_admin_leave_policies"
  | "hr_admin_shifts"
  | "hr_admin_departments"
  | "hr_admin_payroll";

export type TabDef = {
  key: TabKey;
  label: string;
  description: string;
  /** URL prefix(es) this tab controls. Middleware uses these to block. */
  pathPrefixes: string[];
  /** Default for a freshly-onboarded employee with no explicit row. */
  defaultForNewUser: boolean;
  /** Optional grouping label so the Permissions UI can nest related
   *  toggles (e.g. all HR Admin sub-tabs under "HR Dashboard sections"). */
  group?: string;
};

// Ordered to match the real sidebar top-to-bottom.
export const TAB_CATALOG: TabDef[] = [
  { key: "dashboard",   label: "Dashboard",     description: "CEO cases/ratings dashboard",        pathPrefixes: ["/dashboard$"],                          defaultForNewUser: false },
  { key: "cases",       label: "Cases",         description: "All cases list + detail",            pathPrefixes: ["/cases"],                               defaultForNewUser: false },
  { key: "company",     label: "Company",       description: "Company health / org metrics",       pathPrefixes: ["/dashboard/company"],                   defaultForNewUser: false },
  { key: "scores",      label: "Scores",        description: "Team scorecards + ratings",          pathPrefixes: ["/dashboard/scores"],                    defaultForNewUser: false },
  { key: "youtube",     label: "YouTube",       description: "YouTube dashboard",                  pathPrefixes: ["/dashboard/youtube"],                   defaultForNewUser: true  },
  { key: "feedback",    label: "Feedback",      description: "Feedback form + (HR) inbox",         pathPrefixes: ["/dashboard/feedback", "/dashboard/feedback_inbox"], defaultForNewUser: true  },
  { key: "tools",       label: "Tools",         description: "General-purpose tools page",         pathPrefixes: ["/dashboard/tools"],                     defaultForNewUser: true  },
  // `admin` is deliberately OFF this catalog — super-admin access is
  // governed by orgLevel/isDeveloper only. Keeping it out of the
  // permissions UI prevents admins from accidentally toggling each
  // other out of the control panel.
  { key: "hr_home",     label: "HR Home",       description: "Personal HR analytics / home",       pathPrefixes: ["/dashboard/hr/home"],              defaultForNewUser: true  },
  { key: "hr_me",       label: "Me",            description: "My Profile, Attendance, Leaves…",    pathPrefixes: ["/dashboard/hr/profile","/dashboard/hr/attendance","/dashboard/hr/leaves","/dashboard/hr/payroll","/dashboard/hr/goals","/dashboard/hr/documents","/dashboard/hr/tickets"],
                                                                                                                                                            defaultForNewUser: true  },
  { key: "hr_my_team",  label: "My Team",       description: "Team overview + inbox (managers)",   pathPrefixes: ["/dashboard/hr/my-team","/dashboard/hr/inbox"], defaultForNewUser: false },
  { key: "hr_admin",    label: "HR Dashboard",  description: "HR-admin: approvals, shifts, etc.",  pathPrefixes: ["/dashboard/hr/admin"], defaultForNewUser: false },
  { key: "hr_people",   label: "People",        description: "Employee directory + onboard",       pathPrefixes: ["/dashboard/hr/people","/dashboard/hr/onboard"], defaultForNewUser: false },
  { key: "hr_hiring",   label: "Hiring",        description: "Job openings + applications inbox",  pathPrefixes: ["/dashboard/hr/hiring"], defaultForNewUser: false },
  { key: "hr_offboard", label: "Offboarding",   description: "Exit workflow + clearance tracking", pathPrefixes: ["/dashboard/hr/offboard"], defaultForNewUser: false },
  { key: "reports",     label: "Reports",       description: "Manager weekly / monthly reports",   pathPrefixes: ["/dashboard/reports"],                   defaultForNewUser: false },
  // Tab key kept as "departments" for backwards-compat with existing
  // UserTabPermission rows; only the user-facing label and URL changed.
  { key: "departments", label: "KPIs",           description: "Per-department KPIs (role-scoped)",  pathPrefixes: ["/dashboard/kpis"],                      defaultForNewUser: true  },
  { key: "violations",  label: "Strike Log", description: "Attendance / policy strikes",     pathPrefixes: ["/dashboard/strikes"],                defaultForNewUser: false },
  // ── HR feature pages added by the coverage audit ─────────────────
  // Community / informational tabs default to ON for new employees;
  // admin / manager-only tabs default OFF and rely on ROLE overrides.
  { key: "hr_engage",        label: "Engage",        description: "Org-wide engagement feed (posts, polls, praise)", pathPrefixes: ["/dashboard/hr/engage"],        defaultForNewUser: true  },
  { key: "hr_announcements", label: "Announcements", description: "Company-wide announcements",                     pathPrefixes: ["/dashboard/hr/announcements"], defaultForNewUser: true  },
  { key: "hr_org",           label: "Org Tree",      description: "Org chart / reporting structure",                pathPrefixes: ["/dashboard/hr/org"],           defaultForNewUser: true  },
  { key: "hr_expenses",      label: "Expenses",      description: "Submit & track expense claims",                  pathPrefixes: ["/dashboard/hr/expenses"],      defaultForNewUser: true  },
  { key: "hr_approvals",     label: "My Approvals",  description: "Manager queue for leave / WFH / regularize",     pathPrefixes: ["/dashboard/hr/approvals"],     defaultForNewUser: false },
  { key: "hr_analytics",     label: "HR Analytics",  description: "Org-wide HR analytics dashboard",                pathPrefixes: ["/dashboard/hr/analytics"],     defaultForNewUser: false },
  // ── HR Dashboard sub-tabs ────────────────────────────────────────
  // Sub-keys that gate the inner panels of /dashboard/hr/admin. They
  // only apply to viewers who already have the parent `hr_admin` tab
  // open, so toggling these for a non-HR user is a no-op.
  { key: "hr_admin_attendance",    label: "Attendance Dashboard", description: "Today's attendance board",        pathPrefixes: ["/dashboard/hr/admin?tab=attendance-dashboard"], defaultForNewUser: false, group: "HR Dashboard sections" },
  { key: "hr_admin_approvals",     label: "Approvals",            description: "Leave / WFH / regularization approvals",      pathPrefixes: ["/dashboard/hr/admin?tab=approvals"],            defaultForNewUser: false, group: "HR Dashboard sections" },
  // Developer-only diagnostic view. The hardcoded gate in
  // src/app/dashboard/hr/admin/page.tsx (checking `user.isDeveloper`)
  // is the real lock — this catalog entry stays here so the URL-prefix
  // matcher knows about the route, but the permission default is `false`
  // and there are no ROLE_TAB_OVERRIDES so the Tab Permissions UI can't
  // accidentally grant it.
  { key: "hr_admin_regularize_balance", label: "Regularization Balance", description: "Developer-only: per-employee monthly regularization quota usage", pathPrefixes: ["/dashboard/hr/admin?tab=regularize-balance"], defaultForNewUser: false, group: "HR Dashboard sections" },
  { key: "hr_admin_wfh_balances",  label: "WFH Balances",         description: "Per-employee WFH monthly quota + remaining",  pathPrefixes: ["/dashboard/hr/admin?tab=wfh-balances"],         defaultForNewUser: false, group: "HR Dashboard sections" },
  { key: "hr_admin_leaves",        label: "Leave Balances",       description: "Per-employee leave balance editor",            pathPrefixes: ["/dashboard/hr/admin?tab=leaves"],               defaultForNewUser: false, group: "HR Dashboard sections" },
  { key: "hr_admin_holidays",      label: "Holidays & Calendar",  description: "Company holiday list",                         pathPrefixes: ["/dashboard/hr/admin?tab=holidays"],             defaultForNewUser: false, group: "HR Dashboard sections" },
  { key: "hr_admin_assets",        label: "Assets",               description: "Company asset register",                       pathPrefixes: ["/dashboard/hr/admin?tab=assets"],               defaultForNewUser: false, group: "HR Dashboard sections" },
  { key: "hr_admin_leave_types",   label: "Leave Types",          description: "Configure leave categories",                   pathPrefixes: ["/dashboard/hr/admin?tab=leave-types"],          defaultForNewUser: false, group: "HR Dashboard sections" },
  { key: "hr_admin_leave_policies",label: "Leave Policies",       description: "Per-policy day allotments + assignments",      pathPrefixes: ["/dashboard/hr/admin?tab=leave-policies"],       defaultForNewUser: false, group: "HR Dashboard sections" },
  { key: "hr_admin_shifts",        label: "Shift Templates",      description: "Define attendance shifts",                     pathPrefixes: ["/dashboard/hr/admin?tab=shifts"],               defaultForNewUser: false, group: "HR Dashboard sections" },
  { key: "hr_admin_departments",   label: "Departments (HR)",     description: "HR Dashboard department breakdown",            pathPrefixes: ["/dashboard/hr/admin?tab=departments"],          defaultForNewUser: false, group: "HR Dashboard sections" },
  { key: "hr_admin_payroll",       label: "Payroll",              description: "Run payroll, lock, mark paid, manage structures", pathPrefixes: ["/dashboard/hr/admin?tab=payroll"],         defaultForNewUser: false, group: "HR Dashboard sections" },
];

export const TAB_CATALOG_BY_KEY: Record<TabKey, TabDef> = Object.fromEntries(
  TAB_CATALOG.map((t) => [t.key, t])
) as Record<TabKey, TabDef>;

/** Default permission map for a newly-onboarded employee.
 *  If `orgLevel` is supplied, returns the role-aware defaults — matches
 *  the access-map in the admin audit:
 *
 *    ceo / special_access → everything on
 *    hod                  → 4 basics + My Team + Scores + Reports
 *    hr_manager           → 4 basics + My Team + HR Dashboard
 *    manager              → 4 basics + Scores + Reports
 *    lead / sub_lead / member → 4 basics only
 *
 *  Without `orgLevel` we fall back to the catalog's static defaults.
 */
export type OrgLevel =
  | "ceo" | "special_access" | "hod" | "hr_manager" | "manager"
  | "lead" | "sub_lead" | "member";

// Role-aware tab defaults — mirrors the sidebar's access logic:
//   isAdmin           = ceo || isDeveloper            → adminOnly items (Cases, Company)
//   isCeo             = ceo || isDeveloper            → ceoOnly items (Dashboard)
//   isHRAdmin         = isAdmin || hr_manager         → HR Admin / People
//   canSeeReports     = isAdmin || manager || hod     → Scores, Reports
//   canSeeViolationLog= isAdmin || special_access || role==='hr_manager' → Violations
// My Team is shown to any HR admin / manager-tier role.
const ROLE_TAB_OVERRIDES: Partial<Record<OrgLevel, Partial<Record<TabKey, boolean>>>> = {
  ceo: {
    dashboard:true, cases:true, company:true, scores:true,
    hr_my_team:true, hr_admin:true, hr_people:true,
    hr_hiring:true, hr_offboard:true,
    reports:true, departments:true, violations:true,
    // All HR Dashboard sub-tabs on by default for full admins.
    hr_admin_attendance:true, hr_admin_approvals:true,
    hr_admin_leaves:true,
    hr_admin_holidays:true, hr_admin_assets:true, hr_admin_leave_types:true,
    hr_admin_leave_policies:true,
    hr_admin_shifts:true, hr_admin_departments:true, hr_admin_payroll:true,
    // Audit-added pages — admins see everything by default.
    hr_engage:true, hr_announcements:true, hr_org:true, hr_expenses:true,
    hr_approvals:true, hr_analytics:true,
  },
  // special_access is the senior-admin role — same visibility as CEO
  // (minus the literal /dashboard CEO-only landing). Sidebar's isAdmin
  // includes them, so the gating layer agrees with these defaults.
  special_access: {
    cases:true, company:true, scores:true,
    hr_my_team:true, hr_admin:true, hr_people:true,
    hr_hiring:true, hr_offboard:true,
    reports:true, departments:true, violations:true,
    hr_admin_attendance:true, hr_admin_approvals:true,
    hr_admin_leaves:true,
    hr_admin_holidays:true, hr_admin_assets:true, hr_admin_leave_types:true,
    hr_admin_leave_policies:true,
    hr_admin_shifts:true, hr_admin_departments:true, hr_admin_payroll:true,
    hr_engage:true, hr_announcements:true, hr_org:true, hr_expenses:true,
    hr_approvals:true, hr_analytics:true,
  },
  hod: {
    hr_my_team: true, scores: true, reports: true,
    // HODs approve their direct reports' leave / WFH / etc.
    hr_approvals: true,
  },
  hr_manager: {
    hr_my_team: true, hr_admin: true, hr_people: true,
    hr_hiring: true, hr_offboard: true,
    // role='hr_manager' → canSeeViolationLog → violations visible.
    violations: true,
    // HR Manager extras — visibility into team performance + org metrics.
    cases: true, scores: true, reports: true, company: true, departments: true,
    // HR Dashboard sub-tabs the curated whitelist (HR_MANAGER_ALLOWED_TABS
    // in src/lib/access.ts) currently allows for HR Manager + HR Member:
    // attendance, approvals (recently granted), leaves, holidays, assets,
    // departments. These orgLevel defaults govern the broader HR-staff
    // tier (orgLevel="hr_manager"). The *actual* HR Manager
    // (role="hr_manager") additionally always sees Leave Types / Leave
    // Policies / Shift Templates / Payroll — see HR_MANAGER_FORCED_TABS
    // below, forced on at resolution time and scoped to the role so the
    // HR tier (and the Payroll salary policy) is unaffected.
    hr_admin_attendance:true, hr_admin_approvals:true, hr_admin_leaves:true,
    hr_admin_holidays:true, hr_admin_assets:true, hr_admin_departments:true,
    // HR-Manager also gets the new HR feature pages.
    hr_engage:true, hr_announcements:true, hr_org:true, hr_expenses:true,
    hr_approvals:true, hr_analytics:true,
  },
  manager: {
    // Line managers approve their direct reports' leave / WFH / regularize
    // (hr_approvals) — so they also need My Team to see those reports'
    // attendance + leave balances. Approving blind would be inconsistent.
    hr_my_team: true,
    scores: true, reports: true,
    hr_approvals: true,
  },
  // leads / sub-leads / production team / members use the base 4-tab defaults.
};

/**
 * HR-admin sub-tabs the *actual* HR Manager (role="hr_manager", NOT the
 * broader orgLevel="hr_manager" HR-staff tier) must always see — they own
 * HR policy configuration. These are exactly the sections the orgLevel
 * defaults leave OFF for the general HR tier:
 *   • Leave Types     (hr_admin_leave_types)
 *   • Leave Policies  (hr_admin_leave_policies)
 *   • Shift Templates (hr_admin_shifts)
 *   • Payroll         (hr_admin_payroll)
 *
 * Forced on at resolution time (see tabPermissionsForUser in
 * ./resolve.ts) so a stale seeded "false" row from before this rule can't
 * hide them. Scoped to the role, never the orgLevel tier — plain HR
 * Members stay out, and for Payroll that preserves the salary-visibility
 * policy (HR Manager / CEO / dev only). The harder gate in the HR Admin
 * page (canViewSalary for Payroll) still applies on top.
 */
export const HR_MANAGER_FORCED_TABS: TabKey[] = [
  "hr_admin_leave_types",
  "hr_admin_leave_policies",
  "hr_admin_shifts",
  "hr_admin_payroll",
];

// ── Permission-derived tab enables (RBAC-only policy 2026-07-14) ─────────
// A user's DESIGNATION permissions flip these tabs ON, on top of the static
// catalog defaults and the legacy orgLevel overrides (which stay as a
// fallback / union — permission rules only ever ADD, never remove). This is
// what makes the sidebar follow the designation: create a new designation,
// grant it MANAGE_HR, and its holders get the HR Dashboard without anyone
// touching orgLevel or per-user tab rows.
export const PERMISSION_TAB_RULES: ReadonlyArray<{ perm: string; tabs: TabKey[] }> = [
  // Full platform tier — everything except the CEO-only landing dashboard
  // and developer diagnostics (mirrors the special_access override above).
  { perm: "SYSTEM_ADMIN", tabs: [
    "cases", "company", "scores", "reports", "departments", "violations",
    "hr_my_team", "hr_admin", "hr_people", "hr_hiring", "hr_offboard",
    "hr_admin_attendance", "hr_admin_approvals", "hr_admin_leaves",
    "hr_admin_holidays", "hr_admin_assets", "hr_admin_leave_types",
    "hr_admin_leave_policies", "hr_admin_shifts", "hr_admin_departments",
    "hr_admin_payroll", "hr_engage", "hr_announcements", "hr_org",
    "hr_expenses", "hr_approvals", "hr_analytics",
  ] },
  // HR tier — mirrors the orgLevel=hr_manager override above.
  { perm: "MANAGE_HR", tabs: [
    "hr_admin", "hr_people", "cases", "company",
    "hr_admin_attendance", "hr_admin_approvals", "hr_admin_leaves",
    "hr_admin_holidays", "hr_admin_assets", "hr_admin_departments",
    "hr_approvals", "hr_analytics",
  ] },
  { perm: "MANAGE_HIRING",         tabs: ["hr_hiring"] },
  { perm: "MANAGE_OFFBOARDING",    tabs: ["hr_offboard"] },
  { perm: "VIEW_REPORTS",          tabs: ["reports", "scores"] },
  { perm: "VIEW_MY_TEAM",          tabs: ["hr_my_team"] },
  { perm: "APPROVE_TEAM_REQUESTS", tabs: ["hr_approvals"] },
  { perm: "APPROVE_ALL_REQUESTS",  tabs: ["hr_approvals"] },
  { perm: "VIEW_VIOLATIONS",       tabs: ["violations"] },
  { perm: "MANAGE_LEAVE_POLICY",   tabs: ["hr_admin_leave_types", "hr_admin_leave_policies", "hr_admin_shifts"] },
  { perm: "MANAGE_PAYROLL",        tabs: ["hr_admin_payroll"] },
  { perm: "MANAGE_KPIS",           tabs: ["departments"] },
  { perm: "ACT_AS_MANAGER",        tabs: ["hr_my_team", "hr_approvals"] },
];

/** Tab enables derived from a permission set — ON-flips only. */
export function tabsFromPermissions(permissions: readonly string[]): Partial<Record<TabKey, boolean>> {
  const set = new Set(permissions);
  const out: Partial<Record<TabKey, boolean>> = {};
  for (const rule of PERMISSION_TAB_RULES) {
    if (!set.has(rule.perm)) continue;
    for (const t of rule.tabs) out[t] = true;
  }
  return out;
}

export function defaultTabPermissions(
  orgLevel?: OrgLevel | string | null,
  permissions?: readonly string[] | null,
): Record<TabKey, boolean> {
  const base = Object.fromEntries(
    TAB_CATALOG.map((t) => [t.key, t.defaultForNewUser])
  ) as Record<TabKey, boolean>;
  const overrides = orgLevel ? ROLE_TAB_OVERRIDES[orgLevel as OrgLevel] : undefined;
  const withRole = overrides ? { ...base, ...overrides } : base;
  // Designation permissions ADD tabs on top of the legacy role defaults —
  // union, so neither provisioning style regresses the other.
  if (!permissions || permissions.length === 0) return withRole;
  return { ...withRole, ...tabsFromPermissions(permissions) };
}

/**
 * Match a URL path to the tab key that controls it. Returns null if the
 * path doesn't belong to any gated tab (e.g. /login, /api/auth/*).
 * Uses longest-prefix-wins so specific paths (e.g. hr/admin) beat broader
 * ones (hr).
 */
export function tabKeyForPath(pathname: string): TabKey | null {
  // Special-case exact /dashboard to "dashboard" tab only — otherwise
  // /dashboard/* would always match.
  if (pathname === "/dashboard") return "dashboard";

  let bestMatch: { key: TabKey; len: number } | null = null;
  for (const t of TAB_CATALOG) {
    for (const prefix of t.pathPrefixes) {
      // Treat "$"-suffixed prefix as exact-match ("/dashboard$" handled above).
      if (prefix.endsWith("$")) continue;
      if (pathname === prefix || pathname.startsWith(prefix + "/")) {
        if (!bestMatch || prefix.length > bestMatch.len) {
          bestMatch = { key: t.key, len: prefix.length };
        }
      }
    }
  }
  return bestMatch?.key ?? null;
}
