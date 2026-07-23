-- Run history for the Missing Fields tool: one row per "Run check", so the
-- tool can show past runs with their date + what was flagged. Standalone, raw-SQL
-- accessed like the other Missing Fields tables.
CREATE TABLE IF NOT EXISTS "MissingFieldsRun" (
  "id"        SERIAL PRIMARY KEY,
  "runAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "runByName" TEXT,
  "scanned"   INTEGER NOT NULL DEFAULT 0,
  "flagged"   INTEGER NOT NULL DEFAULT 0,
  "summary"   JSONB NOT NULL DEFAULT '{}',
  "results"   JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS "MissingFieldsRun_runAt_idx" ON "MissingFieldsRun" ("runAt" DESC);
