-- Stores violation action-document files in Postgres as BYTEA so the
-- bytes survive redeploys. The previous filesystem-backed approach
-- wrote to /public/uploads/violations/ which got wiped on every prod
-- deploy (atomic releases / Docker rebuild), 404'ing every attachment.
--
-- Both columns are nullable: the URL column stays for one transition
-- release so old rows keep linking until the back-fill script runs.
-- New uploads write `actionTakenFileBlob` + `actionTakenFileMime`
-- only and the URL column stops being read.
ALTER TABLE "Violation"
  ADD COLUMN IF NOT EXISTS "actionTakenFileBlob" BYTEA,
  ADD COLUMN IF NOT EXISTS "actionTakenFileMime" TEXT;
