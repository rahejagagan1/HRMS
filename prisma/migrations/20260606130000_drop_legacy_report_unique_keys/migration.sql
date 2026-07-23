-- Phase B: drop the legacy (managerId, period) unique CONSTRAINTS on the report
-- tables so a single manager can hold MORE THAN ONE report template for the same
-- period. Identity is now enforced by the template-inclusive unique indexes
-- added in 20260606120000_designation_report_template
-- ("WeeklyReport_manager_template_period_key" / "MonthlyReport_manager_template_period_key").
--
-- Idempotent + additive-safe: only drops constraints; no data is touched. Safe to
-- run after every existing row has been backfilled with a non-null reportTemplate.

ALTER TABLE "WeeklyReport"  DROP CONSTRAINT IF EXISTS "WeeklyReport_managerId_week_month_year_key";
ALTER TABLE "MonthlyReport" DROP CONSTRAINT IF EXISTS "MonthlyReport_managerId_month_year_key";
