-- Handoff fields (POC + Work Status + Unavailability) on every
-- request form per the company's standard leave-application format.
--
-- New columns:
--   pocUserId      → "POC in absence" employee picker. Nullable so a
--                    deleted user doesn't cascade-kill the request
--                    (ON DELETE SET NULL).
--   workStatus     → free-text current task status (multi-line).
--   unavailability → free-text time windows the employee is unreachable
--                    (WFH only — every other form's during-day
--                    availability is a non-question since they're off).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + ADD CONSTRAINT IF NOT EXISTS so
-- a re-run is harmless even on a partially-applied DB.

-- ── LeaveApplication ───────────────────────────────────────────────
ALTER TABLE "LeaveApplication"
  ADD COLUMN IF NOT EXISTS "pocUserId"  INTEGER,
  ADD COLUMN IF NOT EXISTS "workStatus" TEXT;

ALTER TABLE "LeaveApplication"
  DROP CONSTRAINT IF EXISTS "LeaveApplication_pocUserId_fkey";
ALTER TABLE "LeaveApplication"
  ADD CONSTRAINT "LeaveApplication_pocUserId_fkey"
  FOREIGN KEY ("pocUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "LeaveApplication_pocUserId_idx" ON "LeaveApplication"("pocUserId");

-- ── WFHRequest ─────────────────────────────────────────────────────
ALTER TABLE "WFHRequest"
  ADD COLUMN IF NOT EXISTS "pocUserId"      INTEGER,
  ADD COLUMN IF NOT EXISTS "workStatus"     TEXT,
  ADD COLUMN IF NOT EXISTS "unavailability" TEXT;

ALTER TABLE "WFHRequest"
  DROP CONSTRAINT IF EXISTS "WFHRequest_pocUserId_fkey";
ALTER TABLE "WFHRequest"
  ADD CONSTRAINT "WFHRequest_pocUserId_fkey"
  FOREIGN KEY ("pocUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "WFHRequest_pocUserId_idx" ON "WFHRequest"("pocUserId");

-- ── OnDutyRequest ──────────────────────────────────────────────────
ALTER TABLE "OnDutyRequest"
  ADD COLUMN IF NOT EXISTS "pocUserId"  INTEGER,
  ADD COLUMN IF NOT EXISTS "workStatus" TEXT;

ALTER TABLE "OnDutyRequest"
  DROP CONSTRAINT IF EXISTS "OnDutyRequest_pocUserId_fkey";
ALTER TABLE "OnDutyRequest"
  ADD CONSTRAINT "OnDutyRequest_pocUserId_fkey"
  FOREIGN KEY ("pocUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "OnDutyRequest_pocUserId_idx" ON "OnDutyRequest"("pocUserId");

-- ── CompOffRequest ─────────────────────────────────────────────────
ALTER TABLE "CompOffRequest"
  ADD COLUMN IF NOT EXISTS "pocUserId"  INTEGER,
  ADD COLUMN IF NOT EXISTS "workStatus" TEXT;

ALTER TABLE "CompOffRequest"
  DROP CONSTRAINT IF EXISTS "CompOffRequest_pocUserId_fkey";
ALTER TABLE "CompOffRequest"
  ADD CONSTRAINT "CompOffRequest_pocUserId_fkey"
  FOREIGN KEY ("pocUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "CompOffRequest_pocUserId_idx" ON "CompOffRequest"("pocUserId");
