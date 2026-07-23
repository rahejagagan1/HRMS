-- Offboarding pipeline v2.
--
-- Collapses the legacy 3-state EmployeeExit.status (notice_period /
-- cleared / offboarded) into a Keka-style 3-state pipeline that
-- distinguishes "we're still reviewing whether to accept this exit"
-- from "exit accepted, clearance underway":
--
--   under_review → HR has filed the exit, awaiting acceptance.
--                  (Brand-new exits land here. Was implicit in the
--                  old model — there was no "under review" state at
--                  all; every newly-created row defaulted straight
--                  to notice_period.)
--   in_progress  → Exit accepted; clearance + payables underway.
--                  Merges legacy notice_period + cleared.
--   exited       → Last working day has passed; user is off the
--                  books. Replaces legacy offboarded.
--
-- Migration steps in order:

-- 1. Re-map existing rows to the new vocabulary. Done BEFORE the
--    default flip so any row that still uses an old value gets a
--    sensible new mapping rather than being left to fall through to
--    the new default.
UPDATE "EmployeeExit" SET status = 'in_progress' WHERE status IN ('notice_period', 'cleared');
UPDATE "EmployeeExit" SET status = 'exited'      WHERE status = 'offboarded';

-- 2. New default for fresh rows.
ALTER TABLE "EmployeeExit" ALTER COLUMN status SET DEFAULT 'under_review';

-- 3. ExitNote table — one row per HR comment / activity-log entry.
--    Mirrors the "Add note" surface in Keka's offboarding drawer.
--    Idempotent so re-runs are safe.
CREATE TABLE IF NOT EXISTS "ExitNote" (
  "id"        SERIAL      PRIMARY KEY,
  "exitId"    INTEGER     NOT NULL REFERENCES "EmployeeExit"("id") ON DELETE CASCADE,
  "authorId"  INTEGER     REFERENCES "User"("id") ON DELETE SET NULL,
  "body"      TEXT        NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ExitNote_exitId_idx"    ON "ExitNote"("exitId");
CREATE INDEX IF NOT EXISTS "ExitNote_createdAt_idx" ON "ExitNote"("createdAt");
