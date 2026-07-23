-- Section E — Views and Changes (YT Shorts) for the QA Manager weekly +
-- monthly reports. Same channel structure as Section D (Andrew's existing
-- long-form table), but the metrics describe shorts performance per
-- channel for the period.

ALTER TABLE "WeeklyReport"
  ADD COLUMN IF NOT EXISTS "shortsRows" JSONB;

ALTER TABLE "MonthlyReport"
  ADD COLUMN IF NOT EXISTS "andrewERows" JSONB;
