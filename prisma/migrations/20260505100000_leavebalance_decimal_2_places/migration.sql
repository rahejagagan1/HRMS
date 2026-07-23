-- Bump LeaveBalance day columns from DECIMAL(5,1) → DECIMAL(6,2) so
-- HR-entered values like 1.68 survive without rounding to 1.7.
-- Existing rows that were already rounded (e.g. 1.7) stay 1.7 —
-- they don't magically un-round. New writes preserve 2 decimals.
ALTER TABLE "LeaveBalance"
  ALTER COLUMN "totalDays"   TYPE DECIMAL(6, 2) USING "totalDays"::numeric,
  ALTER COLUMN "usedDays"    TYPE DECIMAL(6, 2) USING "usedDays"::numeric,
  ALTER COLUMN "pendingDays" TYPE DECIMAL(6, 2) USING "pendingDays"::numeric;
