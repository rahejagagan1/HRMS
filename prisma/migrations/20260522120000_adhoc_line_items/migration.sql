-- AdhocLineItem — one-off payments or deductions tied to a payroll
-- cycle (month + year). Used by the Run Payroll page's Step 4
-- sub-steps 3 (Adhoc Payments) and 4 (Adhoc Deductions). Same table
-- for both — `kind` discriminates.
--
-- The payroll generate engine reads these alongside EmployeeBonus
-- to compute the final payslip:
--   net = (gross + adhoc_payments) - (deductions + adhoc_deductions)
CREATE TABLE IF NOT EXISTS "AdhocLineItem" (
  "id"        SERIAL PRIMARY KEY,
  "userId"    INTEGER NOT NULL,
  "month"     INTEGER NOT NULL,                  -- 0-indexed (Jan=0)
  "year"      INTEGER NOT NULL,
  "kind"      TEXT    NOT NULL,                  -- 'payment' | 'deduction'
  "type"      TEXT,                              -- e.g. "Performance", "Salary Advance Recovery"
  "amount"    DECIMAL(12, 2) NOT NULL,
  "comment"   TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdBy" INTEGER,
  CONSTRAINT "AdhocLineItem_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "AdhocLineItem_kind_check"
    CHECK ("kind" IN ('payment', 'deduction'))
);

CREATE INDEX IF NOT EXISTS "AdhocLineItem_month_year_kind_idx"
  ON "AdhocLineItem" ("month", "year", "kind");
CREATE INDEX IF NOT EXISTS "AdhocLineItem_userId_idx"
  ON "AdhocLineItem" ("userId");
