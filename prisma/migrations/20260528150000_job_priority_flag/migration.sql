-- HR Hiring — priority flag on JobOpening.
--
-- Star-flagged "priority" requisitions surface a filter toggle in the
-- Jobs grid view ("Show only priority"). Shared across all HR users
-- so the team's aligned on what's hot.

ALTER TABLE "JobOpening"
  ADD COLUMN IF NOT EXISTS "isPriority" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "JobOpening_isPriority_idx" ON "JobOpening" ("isPriority");
