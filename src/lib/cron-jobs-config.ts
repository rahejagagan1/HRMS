// Generic per-job state persisted as a single SyncConfig row. Each job
// id gets one entry with enabled / intervalHours / last-run timestamps.
// New jobs added to the registry get sensible defaults automatically;
// existing job state stays untouched on upsert.

import prisma from "@/lib/prisma";
import {
  CRON_JOB_DEFINITIONS,
  CRON_JOB_IDS,
  type CronJobId,
} from "@/lib/cron-jobs-registry";

export const CRON_JOBS_SYNC_KEY = "cron_jobs";

export type CronJobState = {
  enabled: boolean;
  intervalHours: number;
  lastAutoRunAt: string | null;
  lastManualRunAt: string | null;
  /** youtube_dashboard only: when true, also re-syncs past quarters on every run. */
  syncPastQuarters?: boolean;
};

export type CronJobsConfig = Record<CronJobId, CronJobState>;

function clampHours(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(168, Math.max(1, Math.floor(n)));
}

function defaultStateFor(id: CronJobId): CronJobState {
  const def = CRON_JOB_DEFINITIONS.find((d) => d.id === id);
  return {
    // Applying scheduled reporting-manager changes must run unattended,
    // so this one defaults ON (existing installs pick this up too — the
    // config reader falls back to this default for any key it's missing).
    // Every other sync stays opt-in via Admin → Crons.
    enabled: id === "reporting_manager_changes" || id === "attach_pending_documents" || id === "auto_exit",
    intervalHours: def?.defaultIntervalHours ?? 6,
    lastAutoRunAt: null,
    lastManualRunAt: null,
  };
}

function buildDefault(): CronJobsConfig {
  const out = {} as CronJobsConfig;
  for (const id of CRON_JOB_IDS) out[id] = defaultStateFor(id);
  return out;
}

export async function getCronJobsConfig(): Promise<CronJobsConfig> {
  const row = await prisma.syncConfig.findUnique({ where: { key: CRON_JOBS_SYNC_KEY } });
  const raw = (row?.value ?? {}) as Partial<Record<CronJobId, Partial<CronJobState>>>;
  const out = {} as CronJobsConfig;
  for (const id of CRON_JOB_IDS) {
    const def = defaultStateFor(id);
    const r   = raw[id] ?? {};
    out[id] = {
      enabled:          typeof r.enabled === "boolean" ? r.enabled : def.enabled,
      intervalHours:    clampHours(Number(r.intervalHours), def.intervalHours),
      lastAutoRunAt:    typeof r.lastAutoRunAt   === "string" ? r.lastAutoRunAt   : null,
      lastManualRunAt:  typeof r.lastManualRunAt === "string" ? r.lastManualRunAt : null,
      syncPastQuarters: typeof r.syncPastQuarters === "boolean" ? r.syncPastQuarters : false,
    };
  }
  return out;
}

export async function saveCronJobsConfig(config: CronJobsConfig): Promise<void> {
  // Normalise: clamp interval, drop unknown keys, keep all known keys.
  const normalized = {} as CronJobsConfig;
  for (const id of CRON_JOB_IDS) {
    const def = defaultStateFor(id);
    const c = config[id] ?? def;
    normalized[id] = {
      ...c,
      intervalHours: clampHours(c.intervalHours, def.intervalHours),
    };
  }
  await prisma.syncConfig.upsert({
    where:  { key: CRON_JOBS_SYNC_KEY },
    create: { key: CRON_JOBS_SYNC_KEY, value: normalized as object },
    update: { value: normalized as object },
  });
}

/// Build defaults — exposed for migrations / one-shot reset scripts.
export { buildDefault };
