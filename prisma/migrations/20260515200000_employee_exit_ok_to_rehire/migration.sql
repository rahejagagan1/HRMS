-- Add a structured "ok to rehire" flag to the offboard record. Previously
-- this was stuffed into the free-form `notes` column as a text line, which
-- meant HR couldn't see or query the value after submission. Default
-- false so the column is safe for existing rows.
ALTER TABLE "EmployeeExit"
  ADD COLUMN IF NOT EXISTS "okToRehire" BOOLEAN NOT NULL DEFAULT FALSE;
