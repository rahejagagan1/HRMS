-- Section 2 / A Overall Output: add the "Targets Completed (by Managers)"
-- column for each of the three production metrics. These are manager-entered
-- strings (kept as TEXT to mirror the existing target/actual/variance columns),
-- distinct from the ClickUp-derived *Actual* fields.
ALTER TABLE "MonthlyReport"
  ADD COLUMN IF NOT EXISTS "totalVideoTargetAchieved"      TEXT,
  ADD COLUMN IF NOT EXISTS "heroContentTargetAchieved"     TEXT,
  ADD COLUMN IF NOT EXISTS "videosPublishedTargetAchieved" TEXT;
