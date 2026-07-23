-- Two production drift fixes bundled together so a single
-- `prisma migrate deploy` run brings the VPS up to par with dev.
--
-- 1. Deactivate the legacy "Half Day" LeaveType.
--    The matrix already filters by isActive=true, so once this row flips
--    the HALF DAY column disappears from /dashboard/hr/leaves admin.
--    Idempotent: the WHERE clause is the only filter — re-running this
--    migration on a DB that already has it deactivated is a no-op.
UPDATE "LeaveType"
   SET "isActive" = false
 WHERE name = 'Half Day'
   AND "isActive" = true;

-- 2. Track per-balance monthly accrual stamp so Sick Leave's "+1 day per
--    month" logic stays idempotent. New column, nullable, default NULL —
--    no data loss. The accrual helper treats NULL as "never accrued"; we
--    backfill existing rows with the current YYYY-MM so they don't get
--    retroactive credit.
ALTER TABLE "LeaveBalance"
  ADD COLUMN IF NOT EXISTS "lastAccrualMonth" TEXT;

-- Backfill: stamp every existing row with the current calendar month so
-- the next accrual run starts from "now" rather than crediting months
-- the row was never present for. to_char(now(), 'YYYY-MM') keeps this
-- locale-independent and matches the YYYY-MM key the helper uses.
UPDATE "LeaveBalance"
   SET "lastAccrualMonth" = to_char(now(), 'YYYY-MM')
 WHERE "lastAccrualMonth" IS NULL;
