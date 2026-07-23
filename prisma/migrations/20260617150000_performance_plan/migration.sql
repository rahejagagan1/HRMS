-- Performance Improvement Plan (PIP) fields on EmployeeProfile.
-- Additive + idempotent so a re-run / drifted prod DB is safe. All
-- nullable so existing rows need no backfill.
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "pipStartedAt"    TIMESTAMP(3);
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "pipEndDate"      TIMESTAMP(3);
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "pipReason"       TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "pipReportedById" INTEGER;
