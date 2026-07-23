-- Track who last edited a WfhBalance row manually (HR override
-- via the admin panel). The auto-credit cron writes via
-- ON CONFLICT … DO UPDATE without setting updatedById, so a NULL
-- updatedById means "untouched by HR" — clean signal for the UI
-- to show a "manually edited" badge on overridden rows.

ALTER TABLE "WfhBalance"
  ADD COLUMN IF NOT EXISTS "updatedById" INTEGER
  REFERENCES "User"(id) ON DELETE SET NULL;
