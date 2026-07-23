-- Adds optional file-attachment columns to Violation so the reporter
-- can upload a PDF (or other document) of the action taken alongside
-- the free-text note. Both columns are nullable — existing rows keep
-- working unchanged.
ALTER TABLE "Violation"
  ADD COLUMN IF NOT EXISTS "actionTakenFileUrl"  TEXT,
  ADD COLUMN IF NOT EXISTS "actionTakenFileName" TEXT;
