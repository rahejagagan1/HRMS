import prisma from "@/lib/prisma";
import { getCronJobsConfig, saveCronJobsConfig } from "@/lib/cron-jobs-config";
import { CRON_JOB_IDS, type CronJobId } from "@/lib/cron-jobs-registry";
import { CRON_JOB_RUNNERS } from "@/lib/cron-jobs-runners";
import { closeMissedClockOuts } from "@/lib/hr/close-missed-clockouts";
import {
  sendMissedClockInReminders,
  sendMissedClockOutReminders,
  sendHrLateClockInSummary,
  resolveHrSummaryTriggers,
  type SummaryTrigger,
} from "@/lib/hr/missed-attendance-emails";
import { maybeRunMonthlyLeaveAccrual } from "@/lib/leave-accrual";
import { istTodayDateOnly, istDateOnlyFrom } from "@/lib/ist-date";

const TICK_MS    = 60_000;
const HOUR_MS    = 60 * 60 * 1000;

// Every configurable cron job (CRON_JOB_IDS) auto-runs once per day, at
// the first scheduler tick at/after this IST time. Replaces the old
// per-job rolling `intervalHours` so HR gets one predictable daily run.
const DAILY_RUN_HOUR_IST = 9;
const DAILY_RUN_MIN_IST  = 0;

// Trigger windows for the daily attendance reminder emails (IST).
//   • Employee  Clock-IN  reminder fires at 09:50 IST — gives everyone
//     a 10-minute heads-up before the late cut-off.
//   • HR Manager Late Summary fires at 10:05 IST — listing absent +
//     late employees consolidated into one mail per HR admin.
//   • Employee  Clock-OUT reminder fires at 19:00 IST — one hour after
//     the standard 6 PM end of shift.
// Window caps:
//   • Clock-IN  fires from 09:50 → 09:59 IST (HR summary at 10:05 takes
//     over the "late" framing after that).
//   • HR Late Summary fires from 10:05 → 11:59 IST (window cap so a
//     restart at noon doesn't email after lunch).
//   • Clock-OUT fires from 19:00 IST → midnight IST (no upper cap;
//     past-midnight, t.day rolls over and the gate is fresh).
const CLOCK_IN_HOUR  = 9;
const CLOCK_IN_MIN   = 50;
// HR late-summary digest splits by brand. Fire times are DYNAMIC:
// resolveHrSummaryTriggers derives each brand's trigger from its Shift
// rows (latest startTime + grace, + 10-min buffer), so editing a shift
// template moves the fire time automatically. The constants below are
// only the clock-in-nudge window cap + the no-shift fallback:
//   • NB Media: 10:10 IST (shift starts 10:00 → 10 min grace)
//   • YT Labs : 11:15 IST (shift starts ~11:00 → 15 min grace)
// Both have a 2-hour upper window so a late restart still catches the
// fire window. Per-day SyncConfig gates (one per brand) prevent
// double-fire across restarts.
// Cap for the employee clock-in nudge window (nudges stop once the first
// brand's late-summary framing takes over). The summary fire times
// themselves are dynamic — see resolveHrSummaryTriggers.
const NB_SUMMARY_HOUR = 10;
const CLOCK_OUT_HOUR = 19;
const CLOCK_OUT_MIN  = 0;

let schedulerStarted    = false;
let lastMissedCloseRun  = 0;
// Guards against overlapping runs: the 60s tick can fire again while a
// slow job (e.g. ClickUp full sync) from the previous tick is still
// running. Without this the second tick would read the not-yet-stamped
// config and re-run the same jobs.
let cronRunInFlight     = false;

// Track when we last logged a DB-unreachable error so a brief outage
// doesn't paper the console with stack traces every 60s. Logs once,
// then stays quiet for 5 minutes before logging the same condition
// again. Re-keyed by the call-site label so each subsystem still
// surfaces its first failure.
const DB_DOWN_QUIET_MS = 5 * 60 * 1000;
const lastDbDownLog = new Map<string, number>();

/**
 * If the error looks like a Prisma "can't reach DB" (P1001), log a
 * one-line warning at most once per 5 minutes per label and swallow
 * the rest. Anything else logs normally so real bugs aren't hidden.
 */
function logSchedulerError(label: string, err: any): void {
  const isDbDown =
    err?.code === "P1001" ||
    /Can't reach database server/i.test(String(err?.message || ""));
  if (isDbDown) {
    const now = Date.now();
    const last = lastDbDownLog.get(label) ?? 0;
    if (now - last >= DB_DOWN_QUIET_MS) {
      lastDbDownLog.set(label, now);
      console.warn(`[CronScheduler/${label}] DB unreachable — pausing this job until the next tick that connects.`);
    }
    return;
  }
  console.error(`[CronScheduler/${label}]`, err);
}

// Per-day gates persist in SyncConfig (NOT in memory) — otherwise a
// post-window restart wipes the gate and the next tick re-fires the
// emails. SyncConfig keys + payload shape mirror the leave-accrual
// helper.
const SYNC_KEY_CLOCK_IN          = "hr_missed_clockin_last_day";
// Per-brand gates so each brand's fire window can be claimed
// independently. The legacy SYNC_KEY_HR_SUMMARY key is no longer used
// (the row may still exist in the DB — harmless, just stale).
const SYNC_KEY_HR_SUMMARY_NB     = "hr_late_summary_last_day_nb_media";
const SYNC_KEY_HR_SUMMARY_YT     = "hr_late_summary_last_day_yt_labs";
const SYNC_KEY_CLOCK_OUT         = "hr_missed_clockout_last_day";

/**
 * Try to claim today's "fired" slot for the given SyncConfig key.
 * Returns true if this caller successfully claimed it (and should run
 * the reminder), false if today's slot was already claimed.
 *
 * The marker is written BEFORE the caller sends emails so:
 *   • a 60s retick mid-send can't double-fire
 *   • a server restart mid-send finds the gate already stamped
 *     and skips the second batch
 */
async function claimDailyGate(key: string, day: string): Promise<boolean> {
  const row = await prisma.syncConfig.findUnique({ where: { key } });
  const lastDay = (row?.value as { lastDay?: string } | null)?.lastDay ?? null;
  if (lastDay === day) return false;
  await prisma.syncConfig.upsert({
    where:  { key },
    create: { key, value: { lastDay: day } },
    update: { value: { lastDay: day } },
  });
  return true;
}

/** YYYY-MM-DD in IST, plus current hour/minute as integers. */
function istClock(): { day: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    day:    `${get("year")}-${get("month")}-${get("day")}`,
    hour:   parseInt(get("hour")   || "0", 10),
    minute: parseInt(get("minute") || "0", 10),
  };
}

/**
 * Generic per-job auto-runner. Every enabled cron job runs ONCE PER DAY,
 * at the first tick at/after 09:00 IST. A job that hasn't run yet on the
 * current IST calendar day fires as soon as we're past 09:00 — so a
 * server that was down at 9am still catches up later the same day rather
 * than skipping it. `lastAutoRunAt` is persisted after each job so an
 * overlapping tick or a mid-batch crash never re-runs a job that already
 * fired today. Errors in one job don't block others.
 */
export async function maybeRunDueCronJobs(): Promise<void> {
    if (cronRunInFlight) return;

    const t = istClock();
    const past9 =
        t.hour > DAILY_RUN_HOUR_IST ||
        (t.hour === DAILY_RUN_HOUR_IST && t.minute >= DAILY_RUN_MIN_IST);
    if (!past9) return;

    cronRunInFlight = true;
    try {
        const cfg = await getCronJobsConfig();
        const todayIst = istTodayDateOnly().getTime();
        for (const id of CRON_JOB_IDS) {
            const job = cfg[id];
            if (!job?.enabled) continue;
            // One run per IST calendar day — skip if already run today.
            const ranToday =
                !!job.lastAutoRunAt &&
                istDateOnlyFrom(new Date(job.lastAutoRunAt)).getTime() === todayIst;
            if (ranToday) continue;
            try {
                await CRON_JOB_RUNNERS[id]();
                cfg[id] = { ...job, lastAutoRunAt: new Date().toISOString() };
                try { await saveCronJobsConfig(cfg); }
                catch (e) { console.error("[CronScheduler] failed to persist last-run:", e); }
                console.log(`[CronScheduler] auto-ran job=${id} (daily ${DAILY_RUN_HOUR_IST}:00 IST)`);
            } catch (e) {
                console.error(`[CronScheduler] job=${id} failed:`, e);
            }
        }
    } finally {
        cronRunInFlight = false;
    }
}

/// Back-compat alias — older imports referenced this name.
export const maybeRunYoutubeDashboardAutoSync = maybeRunDueCronJobs;

/**
 * Polls DB every 60s. Requires long-running Node (`next start`).
 * Set DISABLE_INTERNAL_CRON_SCHEDULER=true to skip (e.g. serverless + external cron only).
 */
export function startInternalCronScheduler(): void {
    if (schedulerStarted) return;
    schedulerStarted = true;

    console.log("[CronScheduler] 60s poll started (YouTube dashboard + HR missed-clockout sweeper)");

    setInterval(() => {
        maybeRunDueCronJobs().catch((e) => logSchedulerError("jobs", e));

        // HR: sweep stale clock-ins once an hour. Cheap single UPDATE; usually 0 rows.
        const now = Date.now();
        if (now - lastMissedCloseRun >= HOUR_MS) {
            lastMissedCloseRun = now;
            closeMissedClockOuts()
                .then((n) => {
                    if (n > 0) console.log(`[CronScheduler/hr] Flagged ${n} missed clock-out(s)`);
                })
                .catch((e) => logSchedulerError("hr-missed-close", e));
        }

        // ── HR: daily attendance reminder emails ─────────────────────
        // Tick every minute, but actually fire only when:
        //   • we're at/past the trigger time in IST, AND
        //   • we haven't already fired today.
        const t = istClock();

        // Employee clock-in reminder — 09:50 IST. Window is narrow
        // (until 09:59 IST) — the 10:05 HR summary takes over after
        // that. SyncConfig gate protects against double-fire.
        const pastClockInWindow =
            (t.hour > CLOCK_IN_HOUR) ||
            (t.hour === CLOCK_IN_HOUR && t.minute >= CLOCK_IN_MIN);
        // Clock-in reminder still caps when the FIRST brand's summary
        // kicks in (NB Media at 10:00 IST) — past that point, the
        // brand-specific late summary takes over the "you missed it"
        // framing.
        const stillInClockInWindow = t.hour < NB_SUMMARY_HOUR;
        if (pastClockInWindow && stillInClockInWindow) {
            claimDailyGate(SYNC_KEY_CLOCK_IN, t.day)
                .then(async (claimed) => {
                    if (!claimed) return;
                    const n = await sendMissedClockInReminders();
                    if (n > 0) console.log(`[CronScheduler/hr] Sent ${n} missed clock-in reminder(s)`);
                })
                .catch((e) => logSchedulerError("hr-clock-in", e));
        }

        // HR Manager daily summary — TWO brand-specific windows, each
        // with its own per-day gate. Each fires only for ITS brand's
        // employees + recipients. Fire times come from the brand's Shift
        // rows (latest start + grace, + 10-min buffer) via the cached
        // resolveHrSummaryTriggers — editing a shift template moves them
        // automatically within ~5 minutes. Each keeps a 2-hour upper
        // window cap so a late restart still catches the fire.
        // Per-brand functions filter both the roster (only their brand's
        // late/absent) and the recipient list (only HR / special_access
        // belonging to that brand, plus the brand's CEO).
        resolveHrSummaryTriggers()
            .then((trig) => {
                const pastTrigger = (tr: SummaryTrigger) =>
                    (t.hour > tr.hour) || (t.hour === tr.hour && t.minute >= tr.minute);
                const withinCap = (tr: SummaryTrigger) => t.hour < (tr.hour + 2);

                if (pastTrigger(trig.nb) && withinCap(trig.nb)) {
                    claimDailyGate(SYNC_KEY_HR_SUMMARY_NB, t.day)
                        .then(async (claimed) => {
                            if (!claimed) return;
                            const n = await sendHrLateClockInSummary({
                                brand: "NB Media",
                                // Brand fallback only — actual per-employee cutoff comes
                                // from their UserShift (startTime + breakMinutes grace).
                                lateCutoffHour: 10,
                                lateCutoffMin:  5,
                                fireTimeLabel:  trig.nb.label,
                                cutoffLabel:    "their shift's grace time",
                            });
                            if (n > 0) console.log(`[CronScheduler/hr] Sent NB Media late-summary email(s): ${n}`);
                        })
                        .catch((e) => logSchedulerError("hr-late-summary-nb", e));
                }

                if (pastTrigger(trig.yt) && withinCap(trig.yt)) {
                    claimDailyGate(SYNC_KEY_HR_SUMMARY_YT, t.day)
                        .then(async (claimed) => {
                            if (!claimed) return;
                            const n = await sendHrLateClockInSummary({
                                brand: "YT Labs",
                                // Brand fallback only — actual per-employee cutoff comes
                                // from their UserShift (startTime + breakMinutes grace).
                                lateCutoffHour: 11,
                                lateCutoffMin:  0,
                                fireTimeLabel:  trig.yt.label,
                                cutoffLabel:    "their shift's grace time",
                            });
                            if (n > 0) console.log(`[CronScheduler/hr] Sent YT Labs late-summary email(s): ${n}`);
                        })
                        .catch((e) => logSchedulerError("hr-late-summary-yt", e));
                }
            })
            .catch((e) => logSchedulerError("hr-late-summary-trigger", e));

        // Clock-out reminder — 19:00 IST. Wide cap (until midnight IST)
        // so a 21:30 restart still fires once.
        const pastClockOutWindow = (t.hour > CLOCK_OUT_HOUR)
            || (t.hour === CLOCK_OUT_HOUR && t.minute >= CLOCK_OUT_MIN);
        if (pastClockOutWindow) {
            claimDailyGate(SYNC_KEY_CLOCK_OUT, t.day)
                .then(async (claimed) => {
                    if (!claimed) return;
                    const n = await sendMissedClockOutReminders();
                    if (n > 0) console.log(`[CronScheduler/hr] Sent ${n} missed clock-out reminder(s)`);
                })
                .catch((e) => logSchedulerError("hr-clock-out", e));
        }

        // ── HR: monthly leave accrual (policy-driven: Sick + Casual + any
        // other leave type with monthlyAccrual > 0) ──
        // Single accrual path for ALL leave types. Idempotent on calendar
        // month; the helper persists its own last-run key in SyncConfig so
        // it fires once per month even across restarts.
        maybeRunMonthlyLeaveAccrual()
            .catch((e) => logSchedulerError("hr-leave-accrual", e));
    }, TICK_MS);
}
