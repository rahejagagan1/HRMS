// Exit survey — server logic (Prisma). The question spec + validation
// live in ./exit-survey-spec.ts (client-safe) and are re-exported here
// so existing server imports keep working.
//
// New ExitSurvey columns (employeeResponses / employeeSubmittedAt /
// employeeSubmittedById) and EmployeeExit.surveyReminderSentAt are
// read/written via raw SQL (isolated) to dodge the stale-Prisma-client
// drift gotcha until `prisma generate` runs on the next VPS build.
import prisma from "@/lib/prisma";
import { EXIT_WINDOW_DAYS, validateExitResponses } from "./exit-survey-spec";

export * from "./exit-survey-spec";

// ── Due / window logic ──────────────────────────────────────────────
export type DueExit = { exitId: number; lastWorkingDay: string; submitted: boolean };

// The active exit in the survey window for a user (last working day from
// 30 days ago up to EXIT_WINDOW_DAYS ahead, not yet fully exited). null
// when the user isn't a near-leaver.
export async function getWindowExitForUser(userId: number): Promise<DueExit | null> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT e.id AS "exitId", e."lastWorkingDay", s."employeeSubmittedAt"
       FROM "EmployeeExit" e
       LEFT JOIN "ExitSurvey" s ON s."exitId" = e.id
      WHERE e."userId" = $1
        AND e.status <> 'exited'
        AND e."lastWorkingDay" <= CURRENT_DATE + ($2 || ' days')::interval
        AND e."lastWorkingDay" >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY e."lastWorkingDay" ASC
      LIMIT 1`,
    userId, String(EXIT_WINDOW_DAYS),
  );
  const r = rows[0];
  if (!r) return null;
  return {
    exitId: r.exitId,
    lastWorkingDay: new Date(r.lastWorkingDay).toISOString().slice(0, 10),
    submitted: !!r.employeeSubmittedAt,
  };
}

// True when the user is in the exit window AND hasn't submitted yet.
export async function isExitSurveyDue(userId: number): Promise<boolean> {
  const e = await getWindowExitForUser(userId);
  return !!e && !e.submitted;
}

// ── Submit ──────────────────────────────────────────────────────────
export async function submitExitSurvey(userId: number, answers: Record<string, unknown>): Promise<void> {
  const exit = await getWindowExitForUser(userId);
  if (!exit) throw new Error("No active exit on record for you — nothing to submit.");

  const v = validateExitResponses(answers);
  if (!v.ok) throw new Error(v.error);

  // Upsert the survey row (raw — ExitSurvey may not exist yet; @updatedAt
  // is bypassed by raw SQL so set createdAt/updatedAt explicitly).
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ExitSurvey" ("exitId","employeeResponses","employeeSubmittedAt","employeeSubmittedById","createdAt","updatedAt")
     VALUES ($1, $2::jsonb, now(), $3, now(), now())
     ON CONFLICT ("exitId") DO UPDATE SET
       "employeeResponses"     = EXCLUDED."employeeResponses",
       "employeeSubmittedAt"   = now(),
       "employeeSubmittedById" = EXCLUDED."employeeSubmittedById",
       "updatedAt"             = now()`,
    exit.exitId, JSON.stringify(answers), userId,
  );
  // Reflect completion in the offboard pipeline checklist.
  await prisma.$executeRawUnsafe(`UPDATE "EmployeeExit" SET "exitInterviewDone" = true WHERE id = $1`, exit.exitId);
}

// ── HR read (profile tab) ───────────────────────────────────────────
export type ExitSurveyView = {
  lastWorkingDay: string | null;
  exitType: string | null;
  submittedAt: string | null;
  answers: Record<string, any> | null;
};

export async function getExitSurveyForUser(userId: number): Promise<ExitSurveyView | null> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT e."lastWorkingDay", e."exitType", s."employeeSubmittedAt", s."employeeResponses"
       FROM "EmployeeExit" e
       LEFT JOIN "ExitSurvey" s ON s."exitId" = e.id
      WHERE e."userId" = $1
      ORDER BY e."createdAt" DESC
      LIMIT 1`,
    userId,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    lastWorkingDay: r.lastWorkingDay ? new Date(r.lastWorkingDay).toISOString().slice(0, 10) : null,
    exitType: r.exitType ?? null,
    submittedAt: r.employeeSubmittedAt ? new Date(r.employeeSubmittedAt).toISOString() : null,
    answers: r.employeeResponses ?? null,
  };
}

// ── Email reminder cron support ─────────────────────────────────────
export type ReminderTarget = { exitId: number; userId: number; name: string; email: string; businessUnit: string | null; lastWorkingDay: string };

// Exits entering the window that still need the reminder email and haven't
// been submitted. Sent once (surveyReminderSentAt stamp).
export async function listExitsNeedingReminder(): Promise<ReminderTarget[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT e.id AS "exitId", e."userId", e."lastWorkingDay",
            u.name, u.email, ep."businessUnit"
       FROM "EmployeeExit" e
       JOIN "User" u ON u.id = e."userId"
       LEFT JOIN "EmployeeProfile" ep ON ep."userId" = e."userId"
       LEFT JOIN "ExitSurvey" s ON s."exitId" = e.id
      WHERE e.status <> 'exited'
        AND e."surveyReminderSentAt" IS NULL
        AND s."employeeSubmittedAt" IS NULL
        AND u."isActive" = true
        AND e."lastWorkingDay" <= CURRENT_DATE + ($1 || ' days')::interval
        AND e."lastWorkingDay" >= CURRENT_DATE - INTERVAL '7 days'`,
    String(EXIT_WINDOW_DAYS),
  );
  return rows.map((r) => ({
    exitId: r.exitId,
    userId: r.userId,
    name: r.name,
    email: r.email,
    businessUnit: r.businessUnit ?? null,
    lastWorkingDay: new Date(r.lastWorkingDay).toISOString().slice(0, 10),
  }));
}

export async function markReminderSent(exitId: number): Promise<void> {
  await prisma.$executeRawUnsafe(`UPDATE "EmployeeExit" SET "surveyReminderSentAt" = now() WHERE id = $1`, exitId);
}
