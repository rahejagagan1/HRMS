// ─────────────────────────────────────────────────────────────────────────
// PERMISSION CATALOG — single source of truth for the designation-based RBAC.
//
// Every capability that is gated today by an `orgLevel` / `role` / `isDeveloper`
// check lives here as a named Permission. The catalog is defined in CODE (the
// keys must exist as literals so `can(user, "X")` is type-safe) and SEEDED into
// the DB so the HR-Manager admin UI can list + describe them. The *grants*
// (which designation holds which permission) are DB rows, editable in the UI.
//
// Derived from a full audit of libs + every API route + every page/component.
// When you add a new gated capability: add the Permission here, seed it, and
// gate with `can(user, "NEW_PERM")`. Never re-introduce a raw orgLevel/role
// check — route everything through `can()`.
// ─────────────────────────────────────────────────────────────────────────

export type PermissionCategory =
  | "system"
  | "visibility"
  | "hr"
  | "finance"
  | "performance"
  | "content";

export type Permission =
  // ── system / platform ──
  | "SYSTEM_ADMIN"
  | "MANAGE_USERS"
  | "DELETE_USERS"
  | "MANAGE_TAB_PERMISSIONS"
  | "EDIT_PROTECTED_PERMISSIONS"
  | "MANAGE_CRONS"
  | "MANAGE_INTEGRATIONS"
  | "RUN_SYNC"
  | "MANAGE_EMAIL_SETTINGS"
  // ── visibility ──
  | "SEE_ALL_DATA"
  | "VIEW_ALL_BRANDS"
  // ── hr operations ──
  | "MANAGE_HR"
  | "VIEW_MY_TEAM"
  | "EDIT_EMPLOYEE_PROFILES"
  | "APPROVE_TEAM_REQUESTS"
  | "APPROVE_ALL_REQUESTS"
  | "ACT_ON_BEHALF"
  | "MANAGE_LEAVE_POLICY"
  | "MANAGE_HOLIDAYS"
  | "MANAGE_ASSETS"
  | "APPLY_RESTRICTED_LEAVE"
  | "BACKDATE_REQUESTS"
  | "MANAGE_HIRING"
  | "MANAGE_OFFBOARDING"
  | "VIEW_FEEDBACK_INBOX"
  | "HR_CONFIDENTIAL"
  | "HR_PRIMARY_CONTACT"
  | "ACT_AS_MANAGER"
  | "BYPASS_BRAND_RESTRICTION"
  // ── finance (all sensitive) ──
  | "VIEW_SALARY"
  | "MANAGE_PAYROLL"
  | "VIEW_ALL_SALARY_STRUCTURES"
  // ── performance / reporting ──
  | "VIEW_REPORTS"
  | "RATE_TEAM"
  | "MANAGE_RATINGS_CONFIG"
  | "VIEW_SCORES_AUDIT"
  | "MANAGE_KPIS"
  | "VIEW_VIOLATIONS"
  | "MANAGE_VIOLATIONS"
  | "DELETE_VIOLATIONS"
  // ── content / tools / developer ──
  | "VIEW_YOUTUBE_DASHBOARD"
  | "VIEW_YOUTUBE_DEV_ANALYTICS"
  | "VIEW_REGULARIZATION_BALANCE"
  | "VIEW_MAIN_DASHBOARD";

export type PermissionDef = {
  key: Permission;
  label: string;
  description: string;
  category: PermissionCategory;
  /** Sensitive = grants wide data access, PII, or system power. The HR-Manager
   *  UI surfaces a warning before granting these; never auto-include in a clone. */
  sensitive?: boolean;
  /** The legacy gate(s) this replaces — kept for traceability during migration. */
  replaces: string;
};

// Ordered by category, then importance — the admin UI renders in this order.
export const PERMISSION_CATALOG: PermissionDef[] = [
  // ── system / platform ───────────────────────────────────────────────────
  { key: "SYSTEM_ADMIN", category: "system", sensitive: true,
    label: "System administrator",
    description: "Full platform control — admin pages, all data, every screen.",
    replaces: "requireAdmin() / isAdmin() / proxy admin-path" },
  { key: "MANAGE_USERS", category: "system", sensitive: true,
    label: "Create & edit users",
    description: "Add users, edit role/designation/manager, activate/deactivate.",
    replaces: "admin/users PATCH, users POST, admin/permissions, employees POST" },
  { key: "DELETE_USERS", category: "system", sensitive: true,
    label: "Delete users",
    description: "Permanently delete user accounts.",
    replaces: "users DELETE (ceo/dev only today)" },
  { key: "MANAGE_TAB_PERMISSIONS", category: "system", sensitive: true,
    label: "Edit tab permissions",
    description: "Toggle which sidebar tabs each user can see.",
    replaces: "hr/admin/permissions + tab-permissions API (isFullHRAdmin)" },
  { key: "EDIT_PROTECTED_PERMISSIONS", category: "system", sensitive: true,
    label: "Edit protected users' permissions",
    description: "Override tab permissions for CEO/special-access/dev accounts.",
    replaces: "tab-permissions PUT on protected users (developer only)" },
  { key: "MANAGE_CRONS", category: "system", sensitive: true,
    label: "Manage cron jobs & sync config",
    description: "Configure and trigger scheduled jobs and ClickUp list selection.",
    replaces: "admin/cron-jobs/* (ceo/dev)" },
  { key: "MANAGE_INTEGRATIONS", category: "system", sensitive: true,
    label: "Manage ClickUp / YouTube settings",
    description: "Configure workspace/channel integrations and stored stats.",
    replaces: "admin/workspaces, admin/yt-settings, admin/yt-views (currently UNGATED)" },
  { key: "RUN_SYNC", category: "system", sensitive: true,
    label: "Trigger manual data syncs",
    description: "Kick off ClickUp/YouTube/ratings/users sync jobs by hand.",
    replaces: "sync/* + admin/reports/sync-all (currently UNGATED)" },
  { key: "MANAGE_EMAIL_SETTINGS", category: "system",
    label: "Email toggles & test email",
    description: "Turn outbound email categories on/off and send test mail.",
    replaces: "admin/email-toggles, admin/email-test" },

  // ── visibility ───────────────────────────────────────────────────────────
  { key: "SEE_ALL_DATA", category: "visibility", sensitive: true,
    label: "See all employees' data",
    description: "Bypass the reporting-tree scope — view every employee's cases, attendance, reports. (Managers see their own subtree automatically without this.)",
    replaces: "getVisibleUserIds → null / all-active" },
  { key: "VIEW_ALL_BRANDS", category: "visibility", sensitive: true,
    label: "See all brands",
    description: "Cross-brand visibility — view both NB Media and YT Labs employees on brand-scoped HR surfaces instead of only your own brand.",
    replaces: "CROSS_BRAND_HR_USER_IDS env allowlist (canViewAllBrands)" },

  // ── hr operations ─────────────────────────────────────────────────────────
  { key: "MANAGE_HR", category: "hr",
    label: "HR dashboard & employee admin",
    description: "Edit employee records, attendance dashboard, leave balances, documents, options, notification policy.",
    replaces: "isHRAdmin (broad HR-admin tier)" },
  { key: "VIEW_MY_TEAM", category: "hr",
    label: "My Team",
    description: "See the team overview + inbox for direct reports (managers/leads).",
    replaces: "hr_my_team tab (manager/hod/HR tiers)" },
  { key: "EDIT_EMPLOYEE_PROFILES", category: "hr",
    label: "Edit employee profiles",
    description: "Open the Edit Profile tab on any employee and change their details (name, job, contact).",
    replaces: "people/[id] Edit Profile tab (was HR-admin only)" },
  { key: "APPROVE_TEAM_REQUESTS", category: "hr",
    label: "Approve own team's requests (L1)",
    description: "First-level approval of direct reports' leave / WFH / regularization / OD / expenses.",
    replaces: "L1 approver = direct manager" },
  { key: "APPROVE_ALL_REQUESTS", category: "hr",
    label: "Final approval of any request (L2)",
    description: "Final/second-level approval of anyone's leave/WFH/regularization requests.",
    replaces: "isFinalApprover" },
  { key: "ACT_ON_BEHALF", category: "hr",
    label: "Apply requests on behalf of others",
    description: "Submit leave/WFH/regularization/OD for another employee.",
    replaces: "on-behalf flags in leave/wfh/regularize/on-duty" },
  { key: "MANAGE_LEAVE_POLICY", category: "hr",
    label: "Leave types, policies & shifts",
    description: "Configure leave categories, per-policy allotments, and shift templates.",
    replaces: "hr_admin leave-types/leave-policies/shifts + HR_MANAGER_FORCED_TABS" },
  { key: "MANAGE_HOLIDAYS", category: "hr",
    label: "Holiday calendar",
    description: "Create/edit/delete company holidays.",
    replaces: "hr/admin/holidays" },
  { key: "MANAGE_ASSETS", category: "hr",
    label: "Asset register",
    description: "Add and edit company assets.",
    replaces: "AssetsPanel + assets API" },
  { key: "APPLY_RESTRICTED_LEAVE", category: "hr",
    label: "Apply admin-only leave types",
    description: "Apply restricted leave types (e.g. Carry Over) on anyone's behalf.",
    replaces: "canApplyRestrictedLeave" },
  { key: "BACKDATE_REQUESTS", category: "hr",
    label: "Submit past-dated requests",
    description: "Pick a past date when submitting leave/attendance requests.",
    replaces: "canBackDateLeave (note: also granted by HR department membership)" },
  { key: "MANAGE_HIRING", category: "hr",
    label: "Hiring console",
    description: "Manage job openings, candidates, interviews, offers, templates.",
    replaces: "isHRAdmin (hiring/*) + canManageHiring (jobs/*)" },
  { key: "MANAGE_OFFBOARDING", category: "hr",
    label: "Offboarding / exits",
    description: "Run the exit workflow, clearance, and full-and-final settlement.",
    replaces: "exits/* canManage" },
  { key: "VIEW_FEEDBACK_INBOX", category: "hr",
    label: "Anonymous feedback inbox",
    description: "Read submitted anonymous feedback.",
    replaces: "canViewFeedbackInbox" },
  { key: "HR_CONFIDENTIAL", category: "hr", sensitive: true,
    label: "HR-confidential tier",
    description: "The HR team's confidential tier: view other employees' documents (PAN/Aadhaar), see exit/notice-period status, moderate Engage posts. Deliberately NOT part of special_access / role=admin; CEOs and developers pass these gates through their own tier, not this permission.",
    replaces: "isLeadershipOrHR / canViewExitBadge (orgLevel=hr_manager)" },
  { key: "HR_PRIMARY_CONTACT", category: "hr",
    label: "Brand HR primary contact",
    description: "The brand's primary HR Manager: doc-compliance violations and brand-routed HR attributions are reported by/attributed to this person. Hold on exactly one designation per brand.",
    replaces: "role=hr_manager brand-routing lookups (doc-compliance)" },
  { key: "ACT_AS_MANAGER", category: "hr",
    label: "Assignable as manager",
    description: "Appears in the Reporting Manager picker and the Manager Reports sidebar as a report owner. Developers never appear regardless of this permission.",
    replaces: "isPickableAsManager (orgLevel manager/hod, role *_manager/hr_manager)" },
  { key: "BYPASS_BRAND_RESTRICTION", category: "hr", sensitive: true,
    label: "Action requests across business units",
    description: "Approve/act on requests from a different brand/business unit.",
    replaces: "cross-brand-guard super-admin bypass" },

  // ── finance (all sensitive) ───────────────────────────────────────────────
  { key: "VIEW_SALARY", category: "finance", sensitive: true,
    label: "View salary & payslips",
    description: "See compensation, the Finances tab, payslips, and salary structures.",
    replaces: "canViewSalary" },
  { key: "MANAGE_PAYROLL", category: "finance", sensitive: true,
    label: "Run payroll",
    description: "Generate payslips, lock runs, mark paid, manage bonuses/adhoc/tax.",
    replaces: "payroll/* (canViewSalary today)" },
  { key: "VIEW_ALL_SALARY_STRUCTURES", category: "finance", sensitive: true,
    label: "Org-wide compensation table",
    description: "View the entire organisation's salary structures at once.",
    replaces: "salary-structures (isSalaryDeveloper today)" },

  // ── performance / reporting ───────────────────────────────────────────────
  { key: "VIEW_REPORTS", category: "performance",
    label: "Manager reports",
    description: "View weekly/monthly manager reports and the reports hub.",
    replaces: "canSeeReports + UserReportAccess grants" },
  { key: "RATE_TEAM", category: "performance",
    label: "Rate team members",
    description: "Submit manager→team performance ratings.",
    replaces: "scores manager-rating POST" },
  { key: "MANAGE_RATINGS_CONFIG", category: "performance", sensitive: true,
    label: "Rating formula configuration",
    description: "Edit rating formula templates, baselines, and config.",
    replaces: "ratings/config + formula-template/*" },
  { key: "VIEW_SCORES_AUDIT", category: "performance", sensitive: true,
    label: "Scores audit panel",
    description: "View and override calculated scores.",
    replaces: "scores/admin" },
  { key: "MANAGE_KPIS", category: "performance",
    label: "Manage KPI documents",
    description: "Upload and manage per-department KPI documents.",
    replaces: "kpis/documents + kpis/manage (isFullHRAdmin)" },
  { key: "VIEW_VIOLATIONS", category: "performance",
    label: "Violation log",
    description: "View the attendance/policy violation log.",
    replaces: "violations GET + sidebar canSeeViolationLog" },
  { key: "MANAGE_VIOLATIONS", category: "performance",
    label: "Create / edit violations",
    description: "Record and update violations.",
    replaces: "violations POST/PATCH" },
  { key: "DELETE_VIOLATIONS", category: "performance",
    label: "Delete violations",
    description: "Remove violation records.",
    replaces: "violations DELETE (excludes hr_manager today)" },

  // ── content / tools / developer ───────────────────────────────────────────
  { key: "VIEW_YOUTUBE_DASHBOARD", category: "content",
    label: "YouTube dashboard",
    description: "View the YouTube performance dashboard.",
    replaces: "userCanAccessYoutubeDashboard (any auth today)" },
  { key: "VIEW_YOUTUBE_DEV_ANALYTICS", category: "content", sensitive: true,
    label: "YouTube developer analytics",
    description: "View raw developer-level YouTube analytics.",
    replaces: "userCanAccessYoutubeDeveloperAnalytics (dev)" },
  { key: "VIEW_REGULARIZATION_BALANCE", category: "content", sensitive: true,
    label: "Regularization quota diagnostics",
    description: "Developer diagnostic of per-employee regularization quota usage.",
    replaces: "hr_admin regularize-balance tab (dev)" },
  { key: "VIEW_MAIN_DASHBOARD", category: "content",
    label: "Executive landing dashboard",
    description: "Access the CEO landing dashboard at /dashboard.",
    replaces: "dashboard/page redirect (isDeveloper today)" },
];

export const PERMISSION_BY_KEY: Record<Permission, PermissionDef> =
  Object.fromEntries(PERMISSION_CATALOG.map((p) => [p.key, p])) as Record<
    Permission,
    PermissionDef
  >;

export const ALL_PERMISSIONS: Permission[] = PERMISSION_CATALOG.map((p) => p.key);

export const SENSITIVE_PERMISSIONS: Set<Permission> = new Set(
  PERMISSION_CATALOG.filter((p) => p.sensitive).map((p) => p.key)
);

/** The single salary-trusted developer. Lives here (not access.ts) so can.ts
 *  can import it without a circular dependency once access.ts imports can(). */
export const SALARY_DEV_EMAIL = "rahejagagan1@gmail.com";

/** Salary-class permissions. The env `isDeveloper` blanket override does NOT
 *  grant these — they keep the salary-visibility policy (the trusted salary
 *  developer, plus whatever designation grants them). See `can()`. */
export const SALARY_PERMISSIONS: Set<Permission> = new Set<Permission>([
  "VIEW_SALARY",
  "MANAGE_PAYROLL",
  "VIEW_ALL_SALARY_STRUCTURES",
]);

/** Permissions that remain developer-only regardless of designation grants —
 *  the env-driven `isDeveloper` override is the only intended holder. The
 *  designation UI may display them, but the seed never grants them to a
 *  non-developer designation. */
export const DEVELOPER_ONLY_PERMISSIONS: Set<Permission> = new Set<Permission>([
  "EDIT_PROTECTED_PERMISSIONS",
  "VIEW_ALL_SALARY_STRUCTURES",
  "VIEW_REGULARIZATION_BALANCE",
  "VIEW_YOUTUBE_DEV_ANALYTICS",
]);
