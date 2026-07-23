/**
 * Next.js instrumentation — runs once on Node server startup.
 * Starts a lightweight 60s poll that reads cron job settings from the DB (SyncConfig `cron_jobs`).
 * Set DISABLE_INTERNAL_CRON_SCHEDULER=true on serverless-only setups; use external cron + CRON_SECRET instead.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    if (process.env.DISABLE_INTERNAL_CRON_SCHEDULER === "true") return;

    const { startInternalCronScheduler } = await import("@/lib/youtube/yt-dashboard-scheduler");
    startInternalCronScheduler();
}
