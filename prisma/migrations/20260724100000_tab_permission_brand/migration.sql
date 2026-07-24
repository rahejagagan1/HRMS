-- Brand-scoped tab switches (2026-07-24): "" = applies to all brands (all
-- legacy rows), "NB Media"/"YT Labs" = brand-specific override for
-- See-all-brands users. Idempotent so manually-patched environments don't fail.
ALTER TABLE "UserTabPermission" ADD COLUMN IF NOT EXISTS "brand" TEXT NOT NULL DEFAULT '';
DROP INDEX IF EXISTS "UserTabPermission_userId_tabKey_key";
CREATE UNIQUE INDEX IF NOT EXISTS "UserTabPermission_userId_tabKey_brand_key"
  ON "UserTabPermission"("userId", "tabKey", "brand");
