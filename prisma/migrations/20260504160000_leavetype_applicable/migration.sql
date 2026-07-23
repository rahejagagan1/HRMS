-- LeaveType.applicable — when false, the type is balance-only (no
-- apply form). Defaults to true so existing rows stay applicable.
ALTER TABLE "LeaveType"
  ADD COLUMN IF NOT EXISTS "applicable" BOOLEAN NOT NULL DEFAULT true;
