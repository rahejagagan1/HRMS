-- EmployeeBonus gains an optional attachment so HR can attach the
-- supporting document (offer letter scan, performance memo PDF, etc.)
-- when adding a bonus. Bytes live in Postgres BYTEA — mirrors the
-- ViolationActionFile pattern so files survive Docker redeploys
-- (the old /public/uploads/ path got wiped on every prod rebuild).

ALTER TABLE "EmployeeBonus"
  ADD COLUMN IF NOT EXISTS "attachmentName" TEXT,
  ADD COLUMN IF NOT EXISTS "attachmentMime" TEXT,
  ADD COLUMN IF NOT EXISTS "attachmentBlob" BYTEA;
