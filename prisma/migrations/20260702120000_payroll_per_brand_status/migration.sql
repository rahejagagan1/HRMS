-- Per-brand payroll lock lifecycle.
--
-- A PayrollRun is one row per month shared by both brands (NB Media / YT
-- Labs). Payslips and stepStates are already per-brand slices, but the
-- lock/pay status was a single shared column — so locking one brand locked
-- the other. Move the lifecycle into a per-brand JSON map; the existing
-- top-level columns stay as the legacy fallback for brands with no slice.
ALTER TABLE "PayrollRun" ADD COLUMN "brandStatus" JSONB NOT NULL DEFAULT '{}';
