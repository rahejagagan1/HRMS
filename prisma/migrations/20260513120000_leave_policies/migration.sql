-- Leave Policy system: per-(policy × leave-type) rules for daysPerYear
-- (lump sum on apply) and monthlyAccrual (cron / lazy credit). Users get
-- one policy; HR/CEO/dev can still override any LeaveBalance manually.

CREATE TABLE IF NOT EXISTS "LeavePolicy" (
  "id"          SERIAL       PRIMARY KEY,
  "name"        TEXT         NOT NULL UNIQUE,
  "description" TEXT,
  "isActive"    BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "LeavePolicyEntry" (
  "id"             SERIAL       PRIMARY KEY,
  "policyId"       INTEGER      NOT NULL,
  "leaveTypeId"    INTEGER      NOT NULL,
  "daysPerYear"    DECIMAL(5,2) NOT NULL DEFAULT 0,
  "monthlyAccrual" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeavePolicyEntry_policyId_leaveTypeId_key" UNIQUE ("policyId", "leaveTypeId"),
  CONSTRAINT "LeavePolicyEntry_policyId_fkey"
    FOREIGN KEY ("policyId")    REFERENCES "LeavePolicy"("id") ON DELETE CASCADE,
  CONSTRAINT "LeavePolicyEntry_leaveTypeId_fkey"
    FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id")
);

CREATE INDEX IF NOT EXISTS "LeavePolicyEntry_policyId_idx"     ON "LeavePolicyEntry"("policyId");
CREATE INDEX IF NOT EXISTS "LeavePolicyEntry_leaveTypeId_idx"  ON "LeavePolicyEntry"("leaveTypeId");

-- User.leavePolicyId — nullable so existing users without a policy still
-- work (HR sets balances manually for them or assigns a policy later).
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "leavePolicyId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'User_leavePolicyId_fkey' AND table_name = 'User'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_leavePolicyId_fkey"
      FOREIGN KEY ("leavePolicyId") REFERENCES "LeavePolicy"("id") ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "User_leavePolicyId_idx" ON "User"("leavePolicyId");

-- ── Seed two starter policies HR can rename / reconfigure ────────────
-- Idempotent: ON CONFLICT DO NOTHING so re-running the migration is safe.
INSERT INTO "LeavePolicy" ("name", "description")
VALUES
  ('Standard Policy',      'Default for full-time employees'),
  ('Probationary Policy',  'Reduced entitlement during probation')
ON CONFLICT ("name") DO NOTHING;

-- Seed entries for Standard Policy from current LeaveType.daysPerYear so
-- the system has a sensible starting point. SL keeps its +1/month accrual
-- (matching the pre-policy hardcoded behaviour). All applicable types get
-- their daysPerYear as a lump sum.
INSERT INTO "LeavePolicyEntry" ("policyId", "leaveTypeId", "daysPerYear", "monthlyAccrual")
SELECT
  p.id,
  lt.id,
  CASE WHEN lt.code = 'SL' THEN 0 ELSE COALESCE(lt."daysPerYear", 0) END,
  CASE WHEN lt.code = 'SL' THEN 1 ELSE 0 END
FROM "LeavePolicy" p
CROSS JOIN "LeaveType" lt
WHERE p."name" = 'Standard Policy'
  AND lt."isActive" = true
  AND lt."applicable" = true
ON CONFLICT ("policyId", "leaveTypeId") DO NOTHING;

-- Probationary policy: half of daysPerYear, no monthly accrual. HR can
-- tune these from the admin UI; the seed just gives them something.
INSERT INTO "LeavePolicyEntry" ("policyId", "leaveTypeId", "daysPerYear", "monthlyAccrual")
SELECT
  p.id,
  lt.id,
  FLOOR(COALESCE(lt."daysPerYear", 0)::numeric / 2),
  0
FROM "LeavePolicy" p
CROSS JOIN "LeaveType" lt
WHERE p."name" = 'Probationary Policy'
  AND lt."isActive" = true
  AND lt."applicable" = true
ON CONFLICT ("policyId", "leaveTypeId") DO NOTHING;
