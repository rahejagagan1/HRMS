-- Snapshot the team roster onto each report at submit/lock time so
-- historical reports keep showing who was on the team that period even
-- after individual users move to a different manager.
--
-- Shape: Array<{ id, name, role, orgLevel, profilePictureUrl }>
-- Null on rows submitted before this column existed — those fall back
-- to the live manager.teamMembers query.

ALTER TABLE "MonthlyReport" ADD COLUMN IF NOT EXISTS "teamSnapshot" JSONB;
ALTER TABLE "WeeklyReport"  ADD COLUMN IF NOT EXISTS "teamSnapshot" JSONB;
