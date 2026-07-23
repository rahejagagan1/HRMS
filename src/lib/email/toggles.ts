// Email automation toggles.
//
// Every outbound-mail call goes through one of three places:
//   1. dispatchEmails() in src/lib/notifications.ts      (8 NotificationType emails)
//   2. sendViolationInProgressReminders() in src/lib/hr/violation-reminders.ts
//   3. missed-attendance email job in src/lib/hr/missed-attendance-emails.ts
//
// We gate all three on this single SyncConfig row (`email_toggles`) so a
// developer / admin can flip any of the 10 email kinds on/off from
// the Admin → Emails Automation panel without redeploying.
//
// TWO-LAYER GATING:
//
//   • GLOBAL — `{ [emailKey]: boolean }` — kills the email for everyone
//              when off. Existing semantics, unchanged.
//   • PER-ROLE — `perRole: { [role]: { [emailKey]: boolean } }` — when
//              global is ON, lets HR carve out exceptions per role:
//              "stop emailing the CEO about leave, keep emailing HR".
//              Both gates must agree for the email to send to a given
//              recipient.
//
// `email_toggles.value` shape:
//   {
//     [emailKey]: boolean,                          // global per-kind
//     perRole: {
//       [role]: { [emailKey]: boolean },            // per-role override
//     },
//   }
// Missing keys at any level = enabled (default ON) for backward compat.

import prisma from "@/lib/prisma";

/** All controllable email kinds. */
export type EmailKey =
  // NotificationType-driven (notifyUsers → dispatchEmails)
  | "regularization"
  | "wfh"
  | "on_duty"
  | "leave"
  | "comp_off"
  | "feedback"
  | "report"
  | "job_application"
  // Cron-job-driven
  | "violation_reminders"
  | "missed_attendance"
  | "probation_reminders"
  | "pip_reminders"
  | "exit_survey_reminders"
  | "missing_doc_compliance"
  // Recipient-list controls (don't gate a specific email kind — they
  // gate whether a class of recipient is added to ANY admin-broadcast
  // recipient lookup).
  | "dev_emails";

/** Roles that can be toggled per-email-kind. A single User may match
 *  multiple roles (CEO who's also admin); the dispatch filter uses
 *  "ANY matching role has the toggle ON" semantics so a CEO doesn't
 *  lose CEO emails just because admin was disabled. */
export type EmailRole = "ceo" | "hr_manager" | "special_access" | "admin";

export const EMAIL_ROLE_CATALOG: Array<{
  key:         EmailRole;
  label:       string;
  description: string;
}> = [
  { key: "ceo",            label: "CEO",            description: "Users with orgLevel = 'ceo'. Receives org-wide broadcasts + direct-report-specific notifications (leave, reports, etc.)." },
  { key: "hr_manager",     label: "HR Manager",     description: "Users with orgLevel = 'hr_manager' OR role = 'hr_manager'. Primary recipient for approvals, hiring, and request fan-outs." },
  { key: "special_access", label: "Special Access", description: "Users with orgLevel = 'special_access'. Same fan-out treatment as HR Manager — used for HR-team members who don't carry the hr_manager role itself." },
  { key: "admin",          label: "Admin",          description: "Users with role = 'admin'. Cross-cutting role usually held by developers / owners — receives feedback, job applications, exit notifications." },
];

export const EMAIL_TOGGLE_CATALOG: Array<{
  key: EmailKey;
  label: string;
  description: string;
  group: "Requests" | "Reports & Feedback" | "Recruiting" | "Cron jobs" | "Recipients";
}> = [
  { key: "regularization",      group: "Requests",            label: "Regularization",        description: "Attendance regularization requests + approval decisions." },
  { key: "wfh",                 group: "Requests",            label: "WFH",                   description: "Work-from-home requests + approval decisions." },
  { key: "on_duty",             group: "Requests",            label: "On-duty",               description: "On-duty / client-meeting requests + approval decisions." },
  { key: "leave",               group: "Requests",            label: "Leave",                 description: "Casual / sick / earned leave requests + approval decisions." },
  { key: "comp_off",            group: "Requests",            label: "Comp-off",              description: "Comp-off credit requests + approval decisions." },
  { key: "feedback",            group: "Reports & Feedback",  label: "Dashboard feedback",    description: "Dashboard feedback submissions to admins." },
  { key: "report",              group: "Reports & Feedback",  label: "Monthly / weekly reports", description: "Manager-submitted weekly / monthly report notifications." },
  { key: "job_application",     group: "Recruiting",          label: "Job applications",      description: "Inbound job-application notifications to HR + CEO." },
  { key: "violation_reminders", group: "Cron jobs",           label: "Violation reminders",   description: "Daily reminder for violations in-progress for 15+ days." },
  { key: "missed_attendance",   group: "Cron jobs",           label: "Missed attendance",     description: "Daily nudge to employees who didn't clock in." },
  { key: "probation_reminders", group: "Cron jobs",           label: "Probation ending",      description: "Heads-up email 14, 7, and 1 day before a new hire's probation ends. Goes to HR + the employee's reporting manager. Includes one-click extension links." },
  { key: "pip_reminders",       group: "Cron jobs",           label: "PIP review ending",     description: "Heads-up email 7 days before a Performance Improvement Plan's review date. Goes to HR + the employee's reporting manager, who reviews it in My Team → PIP Reviews." },
  { key: "exit_survey_reminders", group: "Cron jobs",         label: "Exit survey reminder",  description: "Emails a leaving employee their Exit Survey link ~2 days before their last working day (the in-app bell notification always fires; this toggles just the email). Required before they clock out on their final day; HR sees responses on the profile → Exit Survey tab." },
  { key: "missing_doc_compliance", group: "Cron jobs",        label: "Missing compliance docs", description: "Daily compliance sweep: warns employees whose PAN / Aadhaar / Education details are missing (after 7-day post-joining grace). Two days later, auto-creates a Violation and emails the employee + HR Manager + reporting manager. Toggle off to pause both the warning and the escalation." },
  { key: "dev_emails",          group: "Recipients",          label: "Notify developers",     description: "When ON, accounts listed in DEVELOPER_EMAILS env get copied on every admin-broadcast email (leave / WFH / on-duty / comp-off / regularize / feedback / job applications / reports / cron jobs). When OFF, developer accounts are silently dropped from every recipient list while still appearing in the system as users." },
];

const SYNC_KEY = "email_toggles";

export type EmailToggles = Record<EmailKey, boolean>;
/** Per-role overlay. Each key in PerRoleToggles[role] mirrors EmailKey
 *  semantics: missing = ON (default). */
export type PerRoleToggles = Record<EmailRole, Partial<EmailToggles>>;

/** Last-changed metadata per toggle. Stored alongside the toggle map
 *  inside the same SyncConfig row so the Admin UI can render a
 *  "Last changed by X · DATE" badge without a separate audit query.
 *  History keys:
 *    • "<emailKey>"            → global toggle
 *    • "<emailKey>:<role>"     → per-role override
 *  Missing keys = never changed since the toggle landed (default ON). */
export type ToggleHistoryEntry = { by: string; byId: number | null; at: string };
export type ToggleHistory = Record<string, ToggleHistoryEntry>;

export interface EmailToggleState {
  global:  EmailToggles;
  perRole: PerRoleToggles;
  history: ToggleHistory;
}

function defaultGlobal(): EmailToggles {
  const out = {} as EmailToggles;
  for (const t of EMAIL_TOGGLE_CATALOG) out[t.key] = true;
  return out;
}

function defaultPerRole(): PerRoleToggles {
  const out = {} as PerRoleToggles;
  for (const r of EMAIL_ROLE_CATALOG) {
    out[r.key] = {} as Partial<EmailToggles>;
    for (const t of EMAIL_TOGGLE_CATALOG) out[r.key][t.key] = true;
  }
  return out;
}

function defaultState(): EmailToggleState {
  return { global: defaultGlobal(), perRole: defaultPerRole(), history: {} };
}

/** Read the full toggle state, filling defaults for missing keys. */
export async function getEmailToggleState(): Promise<EmailToggleState> {
  const out = defaultState();
  try {
    const row = await prisma.syncConfig.findUnique({ where: { key: SYNC_KEY } });
    const raw = (row?.value ?? {}) as Record<string, unknown>;
    for (const t of EMAIL_TOGGLE_CATALOG) {
      if (typeof raw[t.key] === "boolean") out.global[t.key] = raw[t.key] as boolean;
    }
    const rawPerRole = (raw.perRole ?? {}) as Record<string, Record<string, unknown>>;
    for (const r of EMAIL_ROLE_CATALOG) {
      const rawRoleMap = rawPerRole[r.key] ?? {};
      for (const t of EMAIL_TOGGLE_CATALOG) {
        if (typeof rawRoleMap[t.key] === "boolean") {
          out.perRole[r.key][t.key] = rawRoleMap[t.key] as boolean;
        }
      }
    }
    // History is freeform — keep any entry whose shape matches.
    const rawHistory = (raw._history ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(rawHistory)) {
      if (!v || typeof v !== "object") continue;
      const entry = v as Record<string, unknown>;
      const by = typeof entry.by === "string" ? entry.by : null;
      const at = typeof entry.at === "string" ? entry.at : null;
      if (!by || !at) continue;
      out.history[k] = {
        by,
        byId: typeof entry.byId === "number" ? entry.byId : null,
        at,
      };
    }
  } catch { /* table missing pre-migrate → defaults */ }
  return out;
}

/** Legacy shape — kept for any caller that doesn't need per-role.
 *  Returns just the global map. */
export async function getEmailToggles(): Promise<EmailToggles> {
  return (await getEmailToggleState()).global;
}

/** Patch the toggle state. Both `global` and `perRole` are optional;
 *  whichever is supplied is merged into the stored value. When `actor`
 *  is supplied, every CHANGED key (vs the prior value) gets its
 *  history entry stamped — global keys land under `"<key>"`, per-role
 *  keys under `"<key>:<role>"`. Returns the updated full state. */
export async function saveEmailToggleState(
  patch: { global?: Partial<EmailToggles>; perRole?: Partial<Record<EmailRole, Partial<EmailToggles>>> },
  actor?: { name: string; id: number | null },
): Promise<EmailToggleState> {
  const current = await getEmailToggleState();
  const now = new Date().toISOString();
  const stamp = (k: string) => {
    if (!actor) return;
    current.history[k] = { by: actor.name, byId: actor.id, at: now };
  };
  if (patch.global) {
    for (const t of EMAIL_TOGGLE_CATALOG) {
      if (typeof patch.global[t.key] === "boolean") {
        const next = patch.global[t.key]!;
        if (current.global[t.key] !== next) stamp(t.key);
        current.global[t.key] = next;
      }
    }
  }
  if (patch.perRole) {
    for (const r of EMAIL_ROLE_CATALOG) {
      const roleMap = patch.perRole[r.key];
      if (!roleMap) continue;
      for (const t of EMAIL_TOGGLE_CATALOG) {
        if (typeof roleMap[t.key] === "boolean") {
          const next = roleMap[t.key]!;
          const prev = current.perRole[r.key][t.key];
          // Both undefined/true count as ON; only stamp on a real flip.
          const prevOn = prev !== false;
          const nextOn = next !== false;
          if (prevOn !== nextOn) stamp(`${t.key}:${r.key}`);
          current.perRole[r.key][t.key] = next;
        }
      }
    }
  }
  // Serialised shape: global keys + nested perRole + history map —
  // matches the reader's expected layout, no schema migration needed.
  const payload: Record<string, unknown> = {
    ...current.global,
    perRole: current.perRole,
    _history: current.history,
  };
  await prisma.syncConfig.upsert({
    where:  { key: SYNC_KEY },
    create: { key: SYNC_KEY, value: payload as object },
    update: { value: payload as object },
  });
  return current;
}

/** Legacy save helper — accepts a flat global-only patch. */
export async function saveEmailToggles(toggles: Partial<EmailToggles>): Promise<EmailToggles> {
  const state = await saveEmailToggleState({ global: toggles });
  return state.global;
}

/** True when emails of this kind should actually be sent (global gate
 *  only — call isEmailEnabledForRoles for the per-recipient filter). */
export async function isEmailEnabled(kind: EmailKey): Promise<boolean> {
  const all = await getEmailToggles();
  return all[kind] !== false;
}

/** Given a user's orgLevel + role, return every role key that applies.
 *  A user may match multiple roles (e.g. HR Manager with role=admin);
 *  the dispatch filter uses an OR over them so they keep receiving
 *  emails any one of their roles is allowed to receive.
 *
 *  CEO is the lone exception — when orgLevel === "ceo" we return
 *  ONLY ["ceo"], even if the CEO/owner account also carries
 *  role="admin". Otherwise the Admin panel toggle could override the
 *  CEO panel: HR turns Nikit's WFH OFF in the CEO panel but if Admin
 *  WFH is ON, the OR-gate let him through anyway. The per-role CEO
 *  panel needs to be the sole gate for CEO recipients. */
export function rolesForUser(u: { orgLevel?: string | null; role?: string | null }): EmailRole[] {
  const org = (u.orgLevel || "").toLowerCase();
  if (org === "ceo") return ["ceo"];
  const out = new Set<EmailRole>();
  const r = (u.role || "").toLowerCase();
  if (org === "hr_manager" || r === "hr_manager")     out.add("hr_manager");
  if (org === "special_access")                       out.add("special_access");
  if (r === "admin")                                  out.add("admin");
  return [...out];
}

/** Pure gate evaluator — exposed for testing. Same rule the async
 *  isEmailEnabledForRoles uses, but operates on an explicit state
 *  object so tests can permute scenarios without DB writes.
 *
 *  Returns TRUE when the recipient should get the email:
 *    • global[kind] === false              → false (kill switch)
 *    • roles.length === 0                  → true (not a tracked role)
 *    • ANY role.perRole[r][kind] !== false → true (OR-semantics)
 *    • all roles explicitly false          → false
 */
export function evaluateRoleGate(
  state: EmailToggleState,
  kind:  EmailKey,
  roles: EmailRole[],
): boolean {
  if (state.global[kind] === false) return false;
  if (roles.length === 0) return true;
  for (const r of roles) {
    if (state.perRole[r]?.[kind] !== false) return true;
  }
  return false;
}

/** True when the given email kind should reach a recipient with this
 *  role set, taking BOTH gates into account. OR-semantics over roles:
 *  the email goes through if ANY of the user's roles has the per-role
 *  toggle ON. A user with no recognised role (e.g. plain `member`)
 *  bypasses the per-role gate entirely — they're not the target
 *  audience of this filter. */
export async function isEmailEnabledForRoles(
  kind: EmailKey,
  roles: EmailRole[],
): Promise<boolean> {
  return evaluateRoleGate(await getEmailToggleState(), kind, roles);
}

/** Pure recipient gate — the rule emailsForUserIdsFiltered applies
 *  per row. Exposed here so tests can permute exemption + role
 *  combinations without DB writes.
 *
 *  Three-tier resolution:
 *    1. Global kill switch — `global[kind] === false`     → false (everyone dropped, exemption does NOT override)
 *    2. Direct-manager exemption — `exemptIds.has(id)`    → true  (per-role filter bypassed)
 *    3. Per-role gate                                       → evaluateRoleGate
 *
 *  The exemption overrides the role gate, NOT the global kill. HR
 *  can still flip an email off entirely; the exemption only saves
 *  direct managers from per-role carve-outs. */
export function shouldIncludeRecipient(
  recipient: { id: number; orgLevel?: string | null; role?: string | null },
  kind:      EmailKey,
  state:     EmailToggleState,
  exemptIds: ReadonlySet<number> = new Set(),
): boolean {
  if (state.global[kind] === false) return false;
  if (exemptIds.has(recipient.id)) return true;
  return evaluateRoleGate(state, kind, rolesForUser(recipient));
}

/**
 * Recipient-list helper — call inside any prisma.user.findMany({ where: { OR: [...] } })
 * that wants to include developer accounts as email recipients. Returns:
 *   • [{ email: { in: [...] } }]   when the `dev_emails` toggle is ON
 *   • []                            when the toggle is OFF (devs silently dropped)
 *   • []                            when DEVELOPER_EMAILS env is empty (nothing to add)
 *
 * Usage:
 *   const stakeholders = await prisma.user.findMany({
 *     where: {
 *       isActive: true,
 *       OR: [
 *         { orgLevel: { in: ["ceo", "special_access"] } },
 *         { role: "hr_manager" },
 *         ...(await devEmailRecipientsClause()),
 *       ],
 *     },
 *   });
 */
export async function devEmailRecipientsClause(): Promise<Array<{ email: { in: string[] } }>> {
  if (!(await isEmailEnabled("dev_emails"))) return [];
  const devEmails = (process.env.DEVELOPER_EMAILS || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (devEmails.length === 0) return [];
  return [{ email: { in: devEmails } }];
}
