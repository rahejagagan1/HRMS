// Single source of truth for every cron-able sync in the dashboard.
// To add a new auto-runnable sync:
//   1. Append a new entry to CRON_JOB_DEFINITIONS below.
//   2. Add a runner to CRON_JOB_RUNNERS in src/lib/cron-jobs-runners.ts.
// The Admin → Crons UI, the GET/PATCH endpoints, and the internal
// scheduler all read from this list.

export type CronJobId =
  | "youtube_dashboard"
  | "clickup"
  | "users"
  | "ratings"
  | "all_sync"
  | "violation_reminders"
  | "probation_reminders"
  | "pip_reminders"
  | "exit_survey_reminders"
  | "last_day_reminders"
  | "doc_compliance"
  | "auto_lop"
  | "reporting_manager_changes"
  | "attach_pending_documents"
  | "auto_exit";

export type CronJobDefinition = {
  id: CronJobId;
  name: string;
  description: string;
  /// Default interval (hours) when the job is first enabled and no row
  /// exists yet. Falls between 1 and 168.
  defaultIntervalHours: number;
};

export const CRON_JOB_DEFINITIONS: CronJobDefinition[] = [
  {
    id: "youtube_dashboard",
    name: "YouTube dashboard quarter sync",
    description:
      "YouTube Analytics + Data API: upserts YoutubeDashboardQuarterMetrics (quarter totals) and YoutubeDashboardChannelQuarterAnalysis (7-day view buckets + uploads) per channel (OAuth). Dashboard reads DB only. Enable 'Sync past quarters' to also refresh historical quarters on every run.",
    defaultIntervalHours: 5,
  },
  {
    id: "clickup",
    name: "ClickUp full sync",
    description:
      "Pulls workspaces, capsules, lists, and tasks from ClickUp. Required for the case data behind Cases / Reports / Scores.",
    defaultIntervalHours: 6,
  },
  {
    id: "users",
    name: "Users sync (ClickUp → DB)",
    description:
      "Refreshes the User table from the ClickUp workspace — picks up new joiners, name / picture changes, and disabled accounts.",
    defaultIntervalHours: 24,
  },
  {
    id: "ratings",
    name: "Monthly ratings recalculation",
    description:
      "Recomputes MonthlyRating rows for every active employee using the latest case data. Skips manually-locked rows.",
    defaultIntervalHours: 12,
  },
  {
    id: "all_sync",
    name: "Full sync (ClickUp + YouTube + Ratings)",
    description:
      "End-to-end pipeline: ClickUp tasks → YouTube stats → monthly ratings. Use this for a single nightly catch-up run.",
    defaultIntervalHours: 24,
  },
  {
    id: "violation_reminders",
    name: "Violation in-progress reminders + manager follow-up",
    description:
      "Two emails fire from this daily cron: (1) Every 15+ days, nudges HR / CEO / admins / special_access / developers about any 'in progress' violation (throttled per-violation via lastReminderAt). (2) Once at day 23 (= 30 - 7), sends a follow-up to the reported employee's reporting manager asking for a status update before the implicit 1-month mark. Dedupe via followUpSentAt — each violation triggers the follow-up exactly once.",
    // Run daily; per-row throttles (lastReminderAt + followUpSentAt)
    // keep the actual email volume sane.
    defaultIntervalHours: 24,
  },
  {
    id: "probation_reminders",
    name: "Probation ending reminders",
    description:
      "Daily sweep. First self-heals: auto-puts any eligible new joiner (joined within the last 3 months, no probation window yet) on a 3-month probation so nobody who should be on probation is missed. Then emails HR + the employee's reporting manager when an active employee's probation ends in exactly 14, 7, or 1 day (three nudges as the date nears). Same-day dedupe via probationReminderSentAt so the cron never double-sends within a milestone — that stamp is auto-cleared when HR edits the end date so extensions re-arm all three cleanly. Email includes one-click extension links (+1 month / +2 months / custom).",
    defaultIntervalHours: 24,
  },
  {
    id: "pip_reminders",
    name: "PIP review reminders",
    description:
      "Daily sweep: for every active employee on a Performance Improvement Plan whose review date (pipEndDate) is within the next 7 days AND who hasn't been reminded yet, emails HR + the employee's reporting manager. The manager reviews it in My Team → PIP Reviews (recommend extend / pass / end → HR approves). Stamps pipReminderSentAt so it never double-sends; auto-cleared when the review date changes.",
    defaultIntervalHours: 24,
  },
  {
    id: "exit_survey_reminders",
    name: "Exit survey reminders",
    description:
      "Daily sweep: ~2 days before each leaving employee's last working day, sends BOTH an in-app notification (with a 'Complete exit survey' button, same style as the weekly pulse) AND an email — once per exit. Skips anyone who already submitted. The survey is also required before the employee can clock out on their final day, and HR sees the responses on the employee's profile → Exit Survey tab.",
    defaultIntervalHours: 24,
  },
  {
    id: "last_day_reminders",
    name: "Last working day reminders",
    description:
      "Daily sweep: for every employee whose last working day is TODAY (IST) and who isn't already marked exited, emails the offboarding stakeholders (HR managers / special-access / admins, toggle-gated developers, the employee's direct manager, and their brand CEO) one reminder per employee — so leadership knows the person is off the books as of today. Deduped by the date itself (no per-row stamp needed).",
    defaultIntervalHours: 24,
  },
  {
    id: "doc_compliance",
    name: "Compliance docs (PAN / Aadhaar / Education)",
    description:
      "Daily sweep: for every active employee past their 7-day post-joining grace, checks PAN number + PAN file + Aadhaar number + Aadhaar file + Education details + Education certificate. Missing any one → warning email to the employee. Still missing 2 days later → auto-creates a Violation (reported by the HR Manager, severity=low) and emails the employee + HR Manager + reporting manager. Becoming compliant auto-clears the dedupe stamps. Toggleable via 'missing_doc_compliance' in Admin → Emails Automation.",
    defaultIntervalHours: 24,
  },
  {
    id: "auto_lop",
    name: "Auto-mark missing attendance as LOP",
    description:
      "For each working day in the last 7 days where the 48-hour grace has passed, mark active users as status=\"lop\" if they have no Attendance row AND no pending/approved leave, regularization, WFH, OD, or comp-off for that date. Skips holidays and days outside each user's shift workDays. Idempotent.",
    defaultIntervalHours: 24,
  },
  {
    id: "reporting_manager_changes",
    name: "Apply scheduled reporting-manager changes",
    description:
      "Daily sweep: applies every effective-dated reporting-manager change whose date has arrived (IST). Flips User.managerId to the scheduled new manager, marks the ManagerChangeSchedule row 'applied', and emails the employee + new manager + brand HR. Idempotent — the apply is guarded on status='pending'. Enabled by default so HR's scheduled changes take effect automatically.",
    defaultIntervalHours: 24,
  },
  {
    id: "attach_pending_documents",
    name: "Attach parked new-joiner documents",
    description:
      "Sweep: for every parked PendingDocument (offer letters etc. generated for a new joiner before they were in the system) whose email now matches an active User, copies it into that employee's EmployeeDocument (Documents tab) and marks it attached. Covers joiners added via any path (Add-Employee hooks this immediately; ClickUp-sync joiners get caught here). Idempotent. Enabled by default.",
    defaultIntervalHours: 1,
  },
  {
    id: "auto_exit",
    name: "Auto-finalise exits at end of notice",
    description:
      "Daily sweep: for every offboarding exit still 'In Progress' whose last working day has passed (IST), flips the Exit Stage to 'Exited' and deactivates the user account — the same effect as HR's manual Exited toggle. Idempotent (only touches non-final exits with a past last working day). Enabled by default so the stage moves itself once notice ends.",
    defaultIntervalHours: 24,
  },
];

export const CRON_JOB_IDS: CronJobId[] = CRON_JOB_DEFINITIONS.map((d) => d.id);
