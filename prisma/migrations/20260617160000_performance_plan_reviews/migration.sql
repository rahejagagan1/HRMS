-- PIP review workflow: reporting-manager recommendation + HR approval.
-- Mirrors ProbationReview. Additive + idempotent.

CREATE TABLE IF NOT EXISTS "PerformancePlanReview" (
  "id"              SERIAL PRIMARY KEY,
  "employeeUserId"  INTEGER NOT NULL,
  "managerId"       INTEGER NOT NULL,
  "recommendation"  TEXT NOT NULL CHECK ("recommendation" IN ('extend','pass','end')),
  "extendMonths"    INTEGER,                -- 1 | 3 | 6 (extend only)
  "proposedEndDate" TIMESTAMP(3),           -- custom extend target
  "feedback"        TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','approved','rejected')),
  "hrNote"          TEXT,
  "decidedById"     INTEGER,
  "decidedAt"       TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "PerformancePlanReview_status_idx"         ON "PerformancePlanReview"("status");
CREATE INDEX IF NOT EXISTS "PerformancePlanReview_employeeUserId_idx" ON "PerformancePlanReview"("employeeUserId");
CREATE INDEX IF NOT EXISTS "PerformancePlanReview_managerId_idx"      ON "PerformancePlanReview"("managerId");

-- At most ONE pending review per employee (makes the submit DELETE+INSERT
-- race impossible — a concurrent second insert fails on this index).
CREATE UNIQUE INDEX IF NOT EXISTS "PerformancePlanReview_one_pending_per_employee"
  ON "PerformancePlanReview"("employeeUserId") WHERE "status" = 'pending';

-- PIP dedupe stamps + (idempotent) the core pip columns, so a from-scratch
-- migrate deploy reconstructs the full set instead of 500-ing on a missing
-- column. No-op where they already exist.
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "pipStartedAt"         TIMESTAMP(3);
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "pipEndDate"           TIMESTAMP(3);
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "pipReason"            TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "pipReportedById"      INTEGER;
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "pipReminderSentAt"    TIMESTAMP(3);
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "pipManagerNotifiedAt" TIMESTAMP(3);
