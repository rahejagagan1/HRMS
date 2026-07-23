-- TaxOverride — per-employee per-cycle override of a statutory tax/
-- contribution amount. Used by Run Payroll page Step 6 sub-steps:
--   • PT  — Professional Tax (single amount)
--   • ESI — Employee State Insurance (employee + employer)
--   • TDS — Income Tax Deducted at Source (single amount)
--   • LWF — Labour Welfare Fund (employee + employer)
--
-- One row per (user, month, year, kind). PT/TDS only populate
-- "employeeOverride"; ESI/LWF populate both employee and employer
-- override columns. The payroll engine, when generating a payslip,
-- replaces the regular computed value with whichever override exists.
CREATE TABLE IF NOT EXISTS "TaxOverride" (
  "id"               SERIAL PRIMARY KEY,
  "userId"           INTEGER NOT NULL,
  "month"            INTEGER NOT NULL,            -- 0-indexed
  "year"             INTEGER NOT NULL,
  "kind"             TEXT    NOT NULL,            -- 'PT' | 'ESI' | 'TDS' | 'LWF'
  "employeeOverride" DECIMAL(12, 2),
  "employerOverride" DECIMAL(12, 2),              -- ESI/LWF only
  "comment"          TEXT,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdBy"        INTEGER,
  CONSTRAINT "TaxOverride_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "TaxOverride_kind_check"
    CHECK ("kind" IN ('PT', 'ESI', 'TDS', 'LWF')),
  CONSTRAINT "TaxOverride_user_month_kind_unique"
    UNIQUE ("userId", "month", "year", "kind")
);

CREATE INDEX IF NOT EXISTS "TaxOverride_month_year_kind_idx"
  ON "TaxOverride" ("month", "year", "kind");
CREATE INDEX IF NOT EXISTS "TaxOverride_userId_idx"
  ON "TaxOverride" ("userId");
