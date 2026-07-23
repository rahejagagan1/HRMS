-- Payroll lock workflow + bonus integration on payslips.
--
--   PayrollRun gains audit columns for the new lock/paid transitions
--   (generated -> locked -> paid). lockedBy/paidBy point at User.id but are
--   left FK-less to match the existing `runBy` column's style.
--
--   Payslip gains a `bonus` line so monthly bonuses pulled from the Bonus
--   table are visible on the slip. presentDays + lopDays widen to Decimal
--   so half-day attendance can contribute a 0.5 LOP day without rounding.

ALTER TABLE "PayrollRun"
  ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lockedBy" INTEGER,
  ADD COLUMN IF NOT EXISTS "paidAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paidBy"   INTEGER;

ALTER TABLE "Payslip"
  ADD COLUMN IF NOT EXISTS "bonus" DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE "Payslip"
  ALTER COLUMN "presentDays" TYPE DECIMAL(5, 1) USING "presentDays"::DECIMAL(5, 1),
  ALTER COLUMN "lopDays"     TYPE DECIMAL(5, 1) USING "lopDays"::DECIMAL(5, 1);
