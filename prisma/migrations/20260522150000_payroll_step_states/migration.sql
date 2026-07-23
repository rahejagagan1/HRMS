-- Per-outer-step completion state for the 6-card Run Payroll wizard.
-- JSON map: { "1": "complete", "2": "pending", ... }.
ALTER TABLE "PayrollRun"
  ADD COLUMN IF NOT EXISTS "stepStates" JSONB NOT NULL DEFAULT '{}'::jsonb;
