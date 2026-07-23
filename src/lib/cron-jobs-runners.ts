// Per-job runner functions invoked by both the internal scheduler and
// the manual "Run now" admin button. Kept in a separate file so the
// scheduler doesn't import every sync's heavy dependency tree just to
// list job ids.

import { runFullSync, syncUsers as runUsersSync } from "@/lib/clickup/sync-engine";
import { syncYoutubeStats } from "@/lib/youtube/sync";
import { calculateMonthlyRatings } from "@/lib/ratings/calculator";
import { runYoutubeDashboardSync } from "@/lib/youtube/yt-dashboard-sync";
import { sendViolationInProgressReminders, sendViolationFollowUpReminders } from "@/lib/hr/violation-reminders";
import { sendProbationEndingReminders } from "@/lib/hr/probation-reminders";
import { sweepProbationManagerNotifications } from "@/lib/hr/probation-review";
import { applyMissingProbationWindows } from "@/lib/hr/probation-autoassign";
import { sendPipEndingReminders } from "@/lib/hr/pip-reminders";
import { sendExitSurveyReminders } from "@/lib/hr/exit-survey-reminders";
import { sendLastWorkingDayReminders } from "@/lib/hr/last-working-day-reminders";
import { sweepPipManagerNotifications } from "@/lib/hr/performance-plan-review";
import { sendMissingDocReminders } from "@/lib/hr/doc-compliance";
import { runAutoLOP } from "@/lib/hr/auto-lop";
import { applyDueManagerChanges } from "@/lib/hr/manager-changes";
import { attachDuePendingDocuments } from "@/lib/hr/pending-documents";
import { finaliseDueExits } from "@/lib/hr/auto-exit";
import { getCronJobsConfig } from "@/lib/cron-jobs-config";
import type { CronJobId } from "@/lib/cron-jobs-registry";

export const CRON_JOB_RUNNERS: Record<CronJobId, () => Promise<void>> = {
  youtube_dashboard: async () => {
    const cfg = await getCronJobsConfig();
    await runYoutubeDashboardSync({ syncPastQuarters: cfg.youtube_dashboard.syncPastQuarters ?? false });
    await syncYoutubeStats();
  },
  clickup:           async () => { await runFullSync(); },
  users:             async () => { await runUsersSync(); },
  ratings:           async () => { await calculateMonthlyRatings(); },
  // Composite: ClickUp tasks → YouTube stats → ratings recompute.
  all_sync: async () => {
    await runFullSync();
    await syncYoutubeStats();
    await calculateMonthlyRatings();
  },
  // Two related emails fire under the same cron + same admin toggle:
  //   • 15-day "still in progress" reminder → HR / CEO / admins
  //   • Pre-resolution follow-up at day 23 → reported employee's manager
  // Idempotent: each function has its own DB-stamped dedupe column
  // (lastReminderAt vs followUpSentAt), so a single daily run does the
  // right thing whether either or both emails are due.
  violation_reminders: async () => {
    await sendViolationInProgressReminders();
    await sendViolationFollowUpReminders();
  },
  probation_reminders: async () => {
    // First self-heal: auto-put any eligible new joiner on probation who
    // slipped past the onboarding auto-set (added via another route, seeded,
    // or joining date filled in later). Then run the reminder + manager sweep.
    // Each step is isolated + idempotent so one failing never gates the rest.
    try { await applyMissingProbationWindows(); }
    catch (e) { console.error("[probation] auto-assign sweep failed", e); }
    // Isolate the two halves — both are independently idempotent, so an
    // email-side failure shouldn't gate the in-app manager-review nudge.
    try { await sendProbationEndingReminders(); }
    catch (e) { console.error("[probation] email reminders failed", e); }
    try { await sweepProbationManagerNotifications(); } // in-app nudge to reporting managers
    catch (e) { console.error("[probation] manager sweep failed", e); }
  },
  pip_reminders: async () => {
    // Same split as probation: email reminder + in-app manager nudge,
    // each isolated so one failing doesn't gate the other.
    try { await sendPipEndingReminders(); }
    catch (e) { console.error("[pip] email reminders failed", e); }
    try { await sweepPipManagerNotifications(); }
    catch (e) { console.error("[pip] manager sweep failed", e); }
  },
  exit_survey_reminders: async () => { await sendExitSurveyReminders(); },
  // Email leadership when an employee's last working day is today.
  last_day_reminders:  async () => { await sendLastWorkingDayReminders(); },
  doc_compliance:      async () => { await sendMissingDocReminders(); },
  auto_lop:            async () => { await runAutoLOP(); },
  // Apply effective-dated reporting-manager changes whose date arrived.
  reporting_manager_changes: async () => { await applyDueManagerChanges(); },
  // Attach parked new-joiner docs to users that now exist.
  attach_pending_documents: async () => { await attachDuePendingDocuments(); },
  // Flip offboarding exits to "exited" + deactivate once notice ends.
  auto_exit: async () => { await finaliseDueExits(); },
};
