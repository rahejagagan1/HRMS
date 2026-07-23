import prisma from "@/lib/prisma";
import { sendEmail, emailsForUserIds, emailsForUserIdsFiltered } from "@/lib/email/sender";
import { isEmailEnabled, devEmailRecipientsClause } from "@/lib/email/toggles";
import { userIdsWithPermission } from "@/lib/permissions/resolve-permissions";
import {
  leaveRequestEmail, wfhRequestEmail, onDutyRequestEmail,
  regularizationRequestEmail, compOffRequestEmail, decisionEmail,
  feedbackEmail, reportSubmittedEmail, jobApplicationEmail,
  type EmailContent,
} from "@/lib/email/templates";

// Brand bucket for email routing: YT Labs is strict; everything else (incl.
// null businessUnit / missing profile) falls into the NB Media parent brand —
// matches brandCeoIdForEmployee + the probation/PIP/manager-change emails, so an
// employee's notifications only reach HR/CEO of their own brand.
export const brandBucket = (bu?: string | null): "NB Media" | "YT Labs" =>
  bu === "YT Labs" ? "YT Labs" : "NB Media";

export type NotificationType =
  | "regularization"
  | "wfh"
  | "on_duty"
  | "leave"
  | "comp_off"
  | "feedback"
  | "report"
  | "job_application";

/**
 * Map a notification's type + title/body into an EmailContent. Returns
 * null when the notification doesn't have a corresponding email template
 * (or when we can't decode the title format).
 *
 * Title format conventions (from the existing notify*() callers):
 *   "<actor name> requested regularization"
 *   "<actor name> requested WFH"
 *   "<actor name> requested on-duty"
 *   "<actor name> applied for leave"
 *   "<actor name> requested comp-off"
 *   "Your regularization was approved" / "rejected"
 *   etc.
 */
/**
 * Optional structured payload that lets callers feed real values into the
 * outbound email instead of relying on title/body parsing. When omitted,
 * buildEmailFor() falls back to the legacy title-regex behaviour.
 */
export type EmailData = {
  applicantName?: string;
  // Leave-specific
  leaveType?:    string;
  fromDate?:     string | Date;
  toDate?:       string | Date;
  totalDays?:    number | string;
  isHalfDay?:    boolean;
  // Single-day requests
  date?:         string | Date;
  // On-duty
  location?:     string;
  // OD time window (e.g. "10:00" / "14:00") — surfaced as a "Time" row
  // in the email when both ends are set.
  fromTime?:     string;
  toTime?:       string;
  // Comp-off
  workedDate?:   string | Date;
  creditDays?:   number | string;
  // Approval context
  approverName?: string;
  stageLabel?:   string;     // e.g. "Manager approved" / "CEO approved"
  approvalNote?: string;
  /** L1 approver name + note — surfaced on the L2/final email so the
   *  finaliser's row sits alongside the manager's row. */
  l1ApproverName?: string;
  l1ApprovalNote?: string;
  reason?:       string;     // override the body-as-reason fallback
};

function buildEmailFor(
  type: NotificationType,
  title: string,
  body?: string,
  emailData?: EmailData,
): EmailContent | null {
  // ── Anonymous feedback (sent to CEO / HR / admins / devs) ─────────
  // The submitter is never disclosed. Title carries the category, body
  // carries the verbatim message.
  if (type === "feedback") {
    const cat = /category:\s*([^\n]+)/i.exec(body || "")?.[1]?.trim() || "anything_else";
    const msg = (body || "").replace(/^category:[^\n]*\n+/i, "").trim();
    return feedbackEmail({ category: cat, message: msg });
  }

  // ── New job application (sent to hiring stakeholders) ───────────
  // Body has kv lines we parse out — keeps the template clean and the
  // dispatcher robust to ordering / missing fields.
  if (type === "job_application") {
    const kv = (k: string) => new RegExp(`${k}:\\s*([^\\n]+)`, "i").exec(body || "")?.[1]?.trim() || "";
    return jobApplicationEmail({
      name:  kv("name")  || "A candidate",
      email: kv("email") || "",
      phone: kv("phone"),
      role:  kv("role")  || title.replace(/^New job application — /, ""),
      link:  kv("link")  || "/dashboard/hr/hiring",
    });
  }

  // ── Report submitted (weekly / monthly) ──────────────────────────
  // Title carries the manager + period, body carries kv lines we
  // unpack with simple regexes (kept robust to ordering).
  if (type === "report") {
    const kind   = /kind:\s*(weekly|monthly)/i.exec(body || "")?.[1]?.toLowerCase() === "monthly"
                   ? "monthly" : "weekly";
    const period = /period:\s*([^\n]+)/i.exec(body || "")?.[1]?.trim()  || "";
    const manager= /manager:\s*([^\n]+)/i.exec(body || "")?.[1]?.trim() || "A manager";
    const link   = /link:\s*([^\n]+)/i.exec(body || "")?.[1]?.trim()    || "";
    return reportSubmittedEmail({
      kind: kind as "weekly" | "monthly",
      periodLabel: period,
      managerName: manager,
      link,
    });
  }

  // ── Decision emails (sent to the submitter) ────────────────────────
  // Format: "Your <type> was approved" or "Your <type> request was rejected"
  const decisionMatch = /^Your\s+(.+?)\s+was\s+(approved|rejected|partially approved)/i.exec(title);
  if (decisionMatch) {
    return decisionEmail({
      applicantName: "there",                    // we don't have the name here; template handles "Hi there,"
      typeLabel: decisionMatch[1],
      outcome: (decisionMatch[2].toLowerCase().startsWith("rej") ? "rejected" : "approved"),
      note: body,
    });
  }

  // ── Submitter → approver request emails ────────────────────────────
  // Prefer structured emailData when caller passed it. Falls back to
  // parsing "<name> requested ___" / "<name> applied for ___" from the
  // title so legacy callers keep working.
  const submitterMatch = /^(.+?)\s+(?:requested|applied for)/i.exec(title);
  const possessiveMatch = /^(.+?)['']s\s+/i.exec(title);
  const applicantName =
    emailData?.applicantName
    ?? submitterMatch?.[1]
    ?? possessiveMatch?.[1]
    ?? "An employee";

  // Most fields (dates, etc.) live in the notification's body line —
  // we surface the body as the "reason" so approvers see the context
  // when emailData isn't provided. With emailData, the reason is the
  // real applicant-supplied reason, and stage/note become extra rows.
  const reasonText = emailData?.reason ?? body;

  switch (type) {
    case "leave": {
      const dayLabel =
        emailData?.totalDays != null
          ? `${emailData.totalDays} day${Number(emailData.totalDays) === 1 ? "" : "s"}${emailData.isHalfDay ? " (half day)" : ""}`
          : "—";
      return leaveRequestEmail({
        applicantName,
        leaveType: emailData?.leaveType   ?? "Leave",
        fromDate:  emailData?.fromDate    ?? new Date(),
        toDate:    emailData?.toDate      ?? new Date(),
        totalDays: emailData?.totalDays  ?? "—",
        reason:    reasonText,
        approverName:   emailData?.approverName,
        stageLabel:     emailData?.stageLabel,
        approvalNote:   emailData?.approvalNote,
        l1ApproverName: emailData?.l1ApproverName,
        l1ApprovalNote: emailData?.l1ApprovalNote,
        dayLabel,
      });
    }
    case "wfh":             return wfhRequestEmail({
      applicantName,
      date:           emailData?.date     ?? new Date(),
      toDate:         emailData?.toDate,
      reason:         reasonText,
      approverName:   emailData?.approverName,
      stageLabel:     emailData?.stageLabel,
      approvalNote:   emailData?.approvalNote,
      l1ApproverName: emailData?.l1ApproverName,
      l1ApprovalNote: emailData?.l1ApprovalNote,
    });
    case "on_duty":         return onDutyRequestEmail({
      applicantName,
      date:           emailData?.date     ?? new Date(),
      // Range fields — only forwarded when the OD route flagged this
      // as a range submission (HR-on-behalf can grant multi-day OD).
      // Single-day requests pass undefined and the template falls
      // back to a single DATE row.
      toDate:         emailData?.toDate,
      totalDays:      emailData?.totalDays,
      // Time window — populated from the OD record's fromTime/toTime
      // when both are set, so HR sees "Time: 10:00 – 14:00".
      fromTime:       emailData?.fromTime,
      toTime:         emailData?.toTime,
      location:       emailData?.location,
      reason:         reasonText,
      approverName:   emailData?.approverName,
      stageLabel:     emailData?.stageLabel,
      approvalNote:   emailData?.approvalNote,
      l1ApproverName: emailData?.l1ApproverName,
      l1ApprovalNote: emailData?.l1ApprovalNote,
    });
    case "regularization":  return regularizationRequestEmail({
      applicantName,
      date:           emailData?.date     ?? new Date(),
      reason:         reasonText,
      approverName:   emailData?.approverName,
      stageLabel:     emailData?.stageLabel,
      approvalNote:   emailData?.approvalNote,
      l1ApproverName: emailData?.l1ApproverName,
      l1ApprovalNote: emailData?.l1ApprovalNote,
    });
    case "comp_off":        return compOffRequestEmail({
      applicantName,
      workedDate:     emailData?.workedDate ?? new Date(),
      creditDays:     emailData?.creditDays ?? "—",
      reason:         reasonText,
      approverName:   emailData?.approverName,
      stageLabel:     emailData?.stageLabel,
      approvalNote:   emailData?.approvalNote,
      l1ApproverName: emailData?.l1ApproverName,
      l1ApprovalNote: emailData?.l1ApprovalNote,
    });
    default:                return null;
  }
}

/**
 * Internal: resolve emails for `userIds` and dispatch the templated
 * email. Fire-and-forget — silently swallows failures so notifications
 * never block the API.
 *
 * `exemptUserIds` is the direct-report escape hatch (see
 * emailsForUserIdsFiltered).
 */
async function dispatchEmails(
  userIds: number[],
  type: NotificationType,
  title: string,
  body?: string,
  emailData?: EmailData,
  exemptUserIds?: number[],
): Promise<void> {
  try {
    // Admin-controllable gate (Admin → Emails Automation). When a type is
    // toggled off, in-app notifications still flow but the outbound
    // email is silently dropped. NotificationType ↔ EmailKey are 1:1.
    if (!(await isEmailEnabled(type as any))) {
      console.log(`[email] dispatch skipped — type "${type}" disabled in admin toggles`);
      return;
    }
    const content = buildEmailFor(type, title, body, emailData);
    if (!content) return;
    // Per-role filter: drops recipients whose role-specific override
    // for this email kind is OFF (e.g. "stop emailing the CEO about
    // leave"). exemptUserIds bypasses the filter for direct-report
    // CEOs — see emailsForUserIdsFiltered.
    const to = await emailsForUserIdsFiltered(userIds, type as any, { exemptUserIds });
    if (to.length === 0) return;
    // Don't await — emails go out in the background.
    void sendEmail({ to, content });
  } catch (e) {
    console.error("[email] dispatchEmails failed:", e);
  }
}

/**
 * Policy: the CEO is emailed only about their OWN direct reports — every
 * other employee's admin-broadcast notification routes to HR (+ Special
 * Access) instead. Given a subject employee's id, returns the CEO's user
 * id IFF the CEO is that employee's *direct* manager, else null.
 *
 * Every blanket-recipient fan-out should (a) exclude the CEO from its
 * standing admin lookup and (b) add this id back for the direct-report
 * case. Note: dropping "ceo" from an `orgLevel: { in: [...] }` list is NOT
 * enough on its own — the CEO/owner account also carries role="admin" and
 * may sit on DEVELOPER_EMAILS, either of which re-adds it — so the lookup
 * needs a top-level `orgLevel: { not: "ceo" }` guard.
 */
export async function ceoRecipientIdForEmployee(
  employeeId: number | null | undefined,
): Promise<number | null> {
  if (!employeeId) return null;
  const emp = await prisma.user.findUnique({
    where:  { id: employeeId },
    select: { manager: { select: { id: true, orgLevel: true, isActive: true } } },
  });
  const mgr = emp?.manager;
  return mgr && mgr.isActive && mgr.orgLevel === "ceo" ? mgr.id : null;
}

/**
 * Returns the CEO id whose `businessUnit` matches the given employee's
 * brand — used for L2 routing where every employee in a brand should
 * route to that brand's CEO at the final-approval stage (NOT just
 * those whose direct manager is the CEO).
 *
 * Distinct from {@link ceoRecipientIdForEmployee}, which is the
 * narrower "direct-manager-only" rule used for email exemptions and
 * report locks. The brand-CEO rule is broader and ties final approval
 * to brand membership, so e.g. every YT Labs leave's L2 stage pulls
 * in the YT Labs CEO regardless of the applicant's reporting chain.
 *
 * Treats NULL `businessUnit` as "NB Media" (parent-brand default) so
 * legacy rows route to the NB Media CEO. Returns null when no active
 * CEO exists for that brand.
 */
export async function brandCeoIdForEmployee(
  employeeId: number | null | undefined,
): Promise<number | null> {
  if (!employeeId) return null;
  const emp = await prisma.user.findUnique({
    where:  { id: employeeId },
    select: { employeeProfile: { select: { businessUnit: true } } },
  });
  const bu = emp?.employeeProfile?.businessUnit ?? "NB Media";
  // Match the brand-resolution rule used everywhere else: NB Media
  // bucket includes null businessUnit + missing profile rows; YT Labs
  // is strict-equal.
  const brandWhere: any = bu === "YT Labs"
    ? { employeeProfile: { businessUnit: "YT Labs" } }
    : { OR: [
        { employeeProfile: { businessUnit: "NB Media" } },
        { employeeProfile: { businessUnit: null } },
        { employeeProfile: null },
      ] };
  const ceo = await prisma.user.findFirst({
    where: { isActive: true, orgLevel: "ceo", ...brandWhere },
    select: { id: true },
  });
  return ceo?.id ?? null;
}

/**
 * Email addresses to notify about an employee's exit — the canonical
 * offboarding audience: HR managers / special-access / admins, developers
 * (gated by the "Notify developers" toggle), the employee's direct manager,
 * and the employee's brand CEO (each CEO sees only their own brand). Deduped.
 *
 * Shared by the "exit recorded" notification (POST /api/hr/exits) and the
 * daily "last working day today" reminder cron, so both fire to the same
 * people without the two lists drifting apart.
 */
export async function exitStakeholderEmails(
  employee: { id: number; managerId: number | null },
): Promise<string[]> {
  const [empRow, stakeholders, brandCeoId] = await Promise.all([
    prisma.user.findUnique({
      where: { id: employee.id },
      select: { employeeProfile: { select: { businessUnit: true } } },
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
        orgLevel: { not: "ceo" }, // brand CEO resolved separately below
        OR: [
          { orgLevel: { in: ["hr_manager", "special_access"] } },
          { role: "admin" },
          ...(await devEmailRecipientsClause()),
          ...(employee.managerId ? [{ id: employee.managerId }] : []),
        ],
      },
      select: { id: true, email: true, employeeProfile: { select: { businessUnit: true } } },
    }),
    brandCeoIdForEmployee(employee.id),
  ]);
  const empBrand = brandBucket(empRow?.employeeProfile?.businessUnit);
  // Brand-scope HR / special-access / admin / dev recipients to the exiting
  // employee's brand; always keep their direct manager + the brand CEO.
  const stakeholderEmails = stakeholders
    .filter((u) => u.id === employee.managerId || brandBucket(u.employeeProfile?.businessUnit) === empBrand)
    .map((u) => u.email);
  let brandCeoEmail: string | null = null;
  if (brandCeoId) {
    const ceo = await prisma.user.findUnique({
      where:  { id: brandCeoId },
      select: { email: true },
    });
    brandCeoEmail = ceo?.email ?? null;
  }
  return Array.from(
    new Set(([...stakeholderEmails, brandCeoEmail].filter(Boolean)) as string[]),
  );
}

/**
 * Returns the subject employee's direct manager id (any role) — used as
 * the "always-deliver" exemption for the per-role email-toggle filter.
 *
 * Whatever role the manager carries (CEO, admin, HR Manager, Special
 * Access, etc.), if HR has flipped that role's toggle for a given email
 * kind OFF, the manager STILL gets the email about their own direct
 * report. The per-role toggle is intended to silence org-wide blanket
 * fan-out, not to cut managers off from their team's signals.
 *
 * Returns null when:
 *  - employeeId is missing
 *  - the employee has no manager
 *  - the manager is inactive
 */
export async function directManagerIdForEmployee(
  employeeId: number | null | undefined,
): Promise<number | null> {
  if (!employeeId) return null;
  const emp = await prisma.user.findUnique({
    where:  { id: employeeId },
    select: { manager: { select: { id: true, isActive: true } } },
  });
  const mgr = emp?.manager;
  return mgr && mgr.isActive ? mgr.id : null;
}

/**
 * Resolve the set of users who should be notified when `actorId` submits a
 * request that needs approval: their direct manager + every active HR
 * manager / Special Access / developer + their BRAND CEO. The actor
 * themselves is excluded so self-approvers don't ping their own inbox.
 *
 * Brand CEO routing (NB Media → Saurabh/Nikit, YT Labs → Kunal): we
 * exclude CEOs from the blanket HR fan-out and add back the CEO whose
 * `businessUnit` matches the actor's. This keeps brand inboxes
 * isolated — Kunal never sees NB Media submissions, Nikit never sees
 * YT Labs ones.
 */
export async function approverIdsForUser(actorId: number): Promise<number[]> {
  // Approver chain: the actor's direct manager + every active Special
  // Access / HR Manager. Developer accounts (DEVELOPER_EMAILS env) are
  // conditionally included: the "Notify developers" toggle in Admin →
  // Emails Automation controls whether they're copied on the fan-out.
  // Default ON for backwards compatibility.
  const devClause = await devEmailRecipientsClause();
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { managerId: true, employeeProfile: { select: { businessUnit: true } } },
  });
  const actorBrand = brandBucket(actor?.employeeProfile?.businessUnit);
  const [adminsRaw, brandCeoId] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
        // CEO excluded from the blanket fan-out — re-added per-brand
        // below so the YT Labs CEO never sees NB Media submissions
        // (and vice versa). Whether the CEO actually receives the
        // mail is controlled by the per-role "CEO" toggle in Admin →
        // Emails Automation (see rolesForUser CEO-exclusive rule).
        orgLevel: { not: "ceo" },
        OR: [
          { orgLevel: "special_access" },
          { role: "hr_manager" },
          ...devClause,
        ],
      },
      select: { id: true, employeeProfile: { select: { businessUnit: true } } },
    }),
    brandCeoIdForEmployee(actorId),
  ]);
  // Brand-scope the HR / special-access / dev fan-out to the actor's own brand,
  // so (e.g.) NB Media HR never gets a YT Labs employee's request. The actor's
  // direct manager + brand CEO are added unconditionally below.
  const admins = adminsRaw.filter((u) => brandBucket(u.employeeProfile?.businessUnit) === actorBrand);
  const ids = new Set<number>(admins.map((u) => u.id));
  // Brand-CEO is added to the recipient list. The per-role CEO
  // toggle in Admin → Emails Automation gates whether they actually
  // receive the email — turning a per-kind CEO toggle OFF drops
  // them silently at the email-dispatch layer.
  if (brandCeoId) ids.add(brandCeoId);
  // The actor's direct manager — explicit add covers non-CEO chain
  // (peer manager, team lead, etc.) that the admin pool doesn't.
  if (actor?.managerId) ids.add(actor.managerId);
  ids.delete(actorId);
  return Array.from(ids);
}

/**
 * Brand-scoped L2 final-approver users for an employee's request: Special
 * Access + HR Managers + (toggle-gated) developer recipients, filtered to the
 * SAME brand as `employeeId` (NB Media bucket includes null businessUnit /
 * missing profile; YT Labs strict). Excludes the CEO — callers add the brand
 * CEO separately via brandCeoIdForEmployee. Drop-in replacement for the inlined
 * HR fan-out the leave / WFH / OD / comp-off / regularize routes used to run.
 */
export async function brandScopedFinalApprovers(
  employeeId: number,
): Promise<{ id: number }[]> {
  const devClause = await devEmailRecipientsClause();
  const empRow = await prisma.user.findUnique({
    where: { id: employeeId },
    select: { employeeProfile: { select: { businessUnit: true } } },
  });
  const brand = brandBucket(empRow?.employeeProfile?.businessUnit);
  // RBAC-designation-driven (policy 2026-07-14): fan out to holders of the
  // L2 permission APPROVE_ALL_REQUESTS via their designation — CEO
  // designations excluded (callers add the brand CEO separately, same as
  // the legacy orgLevel!=ceo rule). Legacy role/orgLevel clauses kept as a
  // fallback for users without designations.
  const l2Ids = await userIdsWithPermission("APPROVE_ALL_REQUESTS", {
    excludeDesignationKeys: ["ceo", "ceo_yt_labs"],
  });
  const raw = await prisma.user.findMany({
    where: {
      isActive: true,
      orgLevel: { not: "ceo" },
      OR: [
        ...(l2Ids.length ? [{ id: { in: l2Ids } }] : []),
        { orgLevel: "special_access" },
        { role: "hr_manager" },
        ...devClause,
      ],
    },
    select: { id: true, employeeProfile: { select: { businessUnit: true } } },
  });
  return raw
    .filter((u) => brandBucket(u.employeeProfile?.businessUnit) === brand)
    .map((u) => ({ id: u.id }));
}

/**
 * Low-level: write notifications for an explicit set of recipient ids. Dedupes
 * and excludes the actor themselves. Pass `actorId: null` (or omit it) to
 * create a system / self-confirmation notification that isn't filtered out of
 * its own recipient list. Swallows failures.
 */
export async function notifyUsers(params: {
  actorId?: number | null;
  userIds:  number[];
  type:     NotificationType;
  title:    string;
  body?:    string;
  entityId?: number;
  linkUrl?:  string;
  /** Structured payload — fills in the email's leave type, dates, total
   *  days, approver name, etc. so the template doesn't fall back to
   *  parsing the title/body. */
  emailData?: EmailData;
  /** Subject employee — the person the email is "about" (leave
   *  applicant, WFH applicant, employee whose violation reminder
   *  this is, etc.). Used to compute the direct-report CEO exemption:
   *  when subject's direct manager is the active CEO, that CEO is
   *  always included on this email regardless of the per-role
   *  CEO toggle. Defaults to actorId — covers the common case where
   *  the subject IS the actor (submit-your-own-leave flow). For L1→L2
   *  transitions where the actor is the approver, callers should
   *  pass `subjectId: application.userId` so the exemption tracks
   *  the applicant, not the approver. */
  subjectId?: number | null;
}): Promise<void> {
  try {
    const actor = params.actorId ?? null;
    const ids = Array.from(new Set(params.userIds))
      .filter((id) => actor == null || id !== actor);
    if (ids.length === 0) return;
    await prisma.notification.createMany({
      data: ids.map((userId) => ({
        userId,
        actorId:  params.actorId,
        type:     params.type,
        title:    params.title,
        body:     params.body,
        entityId: params.entityId,
        linkUrl:  params.linkUrl,
      })),
    });
    // Direct-manager exemption: when this email is "about" an
    // employee, their direct manager ALWAYS gets the mail —
    // regardless of role (CEO, admin, HR Manager, Special Access,
    // etc.) and regardless of whether HR has flipped that role's
    // per-role toggle off. The per-role toggle silences the
    // org-wide blanket fan-out only; managers stay on emails about
    // their own direct reports.
    const subject = params.subjectId ?? params.actorId ?? null;
    const exemptMgrId = subject ? await directManagerIdForEmployee(subject) : null;
    const exemptUserIds = exemptMgrId ? [exemptMgrId] : undefined;
    // Mirror the in-app notification as an email — fire-and-forget.
    void dispatchEmails(ids, params.type, params.title, params.body, params.emailData, exemptUserIds);
  } catch (e) {
    console.error("notifyUsers failed:", e);
  }
}

/**
 * Create notification rows for every approver of `actorId`. Safe to call from
 * a POST handler — failures are swallowed and logged so a notification outage
 * never blocks the underlying request from being created.
 */
export async function notifyApprovers(params: {
  actorId: number;
  type: NotificationType;
  title: string;
  body?: string;
  entityId?: number;
  linkUrl?: string;
  /** Additional users to notify (e.g. names the requester picked in "Notify"). */
  extraUserIds?: number[];
  /** Structured payload — fills in the email's leave type, dates, total
   *  days, approver name, etc. so the template doesn't fall back to
   *  parsing the title/body. Mirrors notifyUsers. */
  emailData?: EmailData;
}): Promise<void> {
  try {
    const approvers = await approverIdsForUser(params.actorId);
    const all = new Set<number>([...approvers, ...(params.extraUserIds ?? [])]);
    if (all.size === 0) return;
    const recipientIds = Array.from(all);
    await prisma.notification.createMany({
      data: recipientIds.map((userId) => ({
        userId,
        actorId:  params.actorId,
        type:     params.type,
        title:    params.title,
        body:     params.body,
        entityId: params.entityId,
        linkUrl:  params.linkUrl,
      })),
    });
    // Direct-manager exemption — same rule as notifyUsers. Subject of an
    // approval email IS the actor, so the actor's direct manager always
    // gets the mail even if their per-role toggle is OFF.
    const exemptMgrId = await directManagerIdForEmployee(params.actorId);
    const exemptUserIds = exemptMgrId ? [exemptMgrId] : undefined;
    void dispatchEmails(recipientIds, params.type, params.title, params.body, params.emailData, exemptUserIds);
  } catch (e) {
    console.error("notifyApprovers failed:", e);
  }
}
