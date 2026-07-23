-- Employee-filled detailed exit questionnaire (JSON blob) + reminder flag.
-- Additive + idempotent so it's safe to re-run against a drifted prod DB.
ALTER TABLE "ExitSurvey"   ADD COLUMN IF NOT EXISTS "employeeResponses"     JSONB;
ALTER TABLE "ExitSurvey"   ADD COLUMN IF NOT EXISTS "employeeSubmittedAt"   TIMESTAMP(3);
ALTER TABLE "ExitSurvey"   ADD COLUMN IF NOT EXISTS "employeeSubmittedById" INTEGER;
ALTER TABLE "EmployeeExit" ADD COLUMN IF NOT EXISTS "surveyReminderSentAt"  TIMESTAMP(3);
