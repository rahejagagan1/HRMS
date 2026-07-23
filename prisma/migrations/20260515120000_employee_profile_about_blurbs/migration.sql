-- Free-text bio fields shown on the ABOUT tab of the user profile and the
-- HR people-detail view: a short personal summary, what the employee
-- loves about their job, and their interests / hobbies. All nullable
-- so existing rows survive without a backfill.
ALTER TABLE "EmployeeProfile"
  ADD COLUMN IF NOT EXISTS "about"   TEXT,
  ADD COLUMN IF NOT EXISTS "jobLove" TEXT,
  ADD COLUMN IF NOT EXISTS "hobbies" TEXT;
