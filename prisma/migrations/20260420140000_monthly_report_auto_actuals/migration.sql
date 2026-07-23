-- MonthlyReport: override flags for Production Volume actuals.
-- Actuals auto-compute from qualified CM Check 4 cases unless a CEO/developer
-- has manually overridden them (flag flipped to true on save).

ALTER TABLE "MonthlyReport"
    ADD COLUMN "totalVideoActualOverridden"  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "heroContentActualOverridden" BOOLEAN NOT NULL DEFAULT false;
