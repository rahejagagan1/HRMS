-- Saturday-specific shift hours + grace (2026-07-24): NULL = Saturday runs
-- the same hours/grace as weekdays. Idempotent for patched environments.
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "satStartTime" TEXT;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "satEndTime" TEXT;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "satGraceMinutes" INTEGER;
