-- Probation review workflow: reporting-manager recommendation + HR approval.
-- Additive + idempotent so `prisma migrate deploy` is safe on the VPS even if
-- a column / table was hand-applied earlier.

CREATE TABLE IF NOT EXISTS "ProbationReview" (
  "id"              SERIAL PRIMARY KEY,
  "employeeUserId"  INTEGER NOT NULL,
  "managerId"       INTEGER NOT NULL,
  "recommendation"  TEXT NOT NULL CHECK ("recommendation" IN ('extend','confirm','end')),
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

CREATE INDEX IF NOT EXISTS "ProbationReview_status_idx"         ON "ProbationReview"("status");
CREATE INDEX IF NOT EXISTS "ProbationReview_employeeUserId_idx" ON "ProbationReview"("employeeUserId");
CREATE INDEX IF NOT EXISTS "ProbationReview_managerId_idx"      ON "ProbationReview"("managerId");

-- At most ONE pending review per employee — makes the submit DELETE+INSERT
-- race impossible (the second concurrent insert fails on this index).
CREATE UNIQUE INDEX IF NOT EXISTS "ProbationReview_one_pending_per_employee"
  ON "ProbationReview"("employeeUserId") WHERE "status" = 'pending';

-- Probation lifecycle stamps on the profile (new in this feature).
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "probationConfirmedAt"       TIMESTAMP(3);
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "probationConfirmedById"     INTEGER;
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "probationManagerNotifiedAt" TIMESTAMP(3);

-- The feature's RAW SQL also reads/writes these older probation columns, which
-- live only in schema.prisma + on the (drifted) prod DB — no prior migration
-- creates them. Add them idempotently so a from-scratch `migrate deploy`
-- (CI / new env / disaster recovery) reconstructs the full column set instead
-- of 500-ing on "column does not exist". No-op where they already exist.
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "probationEndDate"        TIMESTAMP(3);
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "probationReminderSentAt" TIMESTAMP(3);
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "probationPolicy"         TEXT;
