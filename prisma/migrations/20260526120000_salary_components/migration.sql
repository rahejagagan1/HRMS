-- Add per-component earnings columns to SalaryStructure so the HR breakdown
-- can show Basic / HRA / Dearness / Conveyance / Medical / Special separately
-- instead of bundling everything past Basic+HRA into specialAllowance.
--
-- Storage convention matches the existing basic/hra/specialAllowance columns:
-- all values are ANNUAL. Payslip generation divides by 12.
--
-- DEFAULT 0 + NOT NULL chosen deliberately so existing rows don't need a
-- backfill — they'll keep summing to their saved CTC via specialAllowance
-- until HR re-saves them with the new split.

ALTER TABLE "SalaryStructure"
  ADD COLUMN IF NOT EXISTS "dearnessAllowance"   DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "conveyanceAllowance" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "medicalAllowance"    DECIMAL(12, 2) NOT NULL DEFAULT 0;
