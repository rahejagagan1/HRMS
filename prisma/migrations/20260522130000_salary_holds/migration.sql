-- SalaryHold — per-cycle hold flag on an employee's payroll processing
-- or payout. Used by Run Payroll page Step 5 sub-steps:
--   • SALARY PROCESSING ON HOLD (kind='processing')
--   • SALARY PAYOUT ON HOLD     (kind='payout')
--
-- Processing-hold employees are excluded from payslip generation entirely.
-- Payout-hold employees get their payslip computed (so statutory
-- contributions still count) but the net pay isn't released until HR
-- removes the hold.
--
-- One row per (user, month, year) — switching between kinds replaces the
-- existing row. The unique constraint enforces that.
CREATE TABLE IF NOT EXISTS "SalaryHold" (
  "id"        SERIAL PRIMARY KEY,
  "userId"    INTEGER NOT NULL,
  "month"     INTEGER NOT NULL,                  -- 0-indexed
  "year"      INTEGER NOT NULL,
  "kind"      TEXT    NOT NULL,                  -- 'processing' | 'payout'
  "payAction" TEXT,                              -- e.g. "Hold", "Release"
  "comment"   TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdBy" INTEGER,
  CONSTRAINT "SalaryHold_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "SalaryHold_kind_check"
    CHECK ("kind" IN ('processing', 'payout')),
  CONSTRAINT "SalaryHold_user_month_unique"
    UNIQUE ("userId", "month", "year")
);

CREATE INDEX IF NOT EXISTS "SalaryHold_month_year_kind_idx"
  ON "SalaryHold" ("month", "year", "kind");
CREATE INDEX IF NOT EXISTS "SalaryHold_userId_idx"
  ON "SalaryHold" ("userId");
