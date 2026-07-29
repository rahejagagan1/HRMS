-- HR-granted login grace after exit: when set to a future date, the user may
-- sign in even though their last working day has passed / they were deactivated.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accessExtendedUntil" TIMESTAMP(3);
