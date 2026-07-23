-- Brand-scope LetterTemplate so each letter type can have separate
-- copies for NB Media vs YT Labs. NULL = universal / fallback.
-- The Templates UI picks the row matching the employee's brand at
-- generate time; if no brand-specific row exists, the generate
-- route returns a clear "no template configured" error instead of
-- silently using the wrong brand's letterhead.

ALTER TABLE "LetterTemplate"
  ADD COLUMN IF NOT EXISTS "businessUnit" TEXT;

-- Backfill existing seeded rows as NB Media — current templates
-- were authored against the NB Media letterhead + signature.
UPDATE "LetterTemplate"
   SET "businessUnit" = 'NB Media'
 WHERE "businessUnit" IS NULL;

-- Swap the single-column UNIQUE on key for a compound (key,
-- businessUnit) constraint so we can store one row per brand.
-- Constraint name from the auto-generated migration.
ALTER TABLE "LetterTemplate" DROP CONSTRAINT IF EXISTS "LetterTemplate_key_key";

-- Postgres treats NULL as distinct in UNIQUE constraints, so the
-- compound (key, businessUnit) won't block multiple NULL rows.
-- That's fine — universal templates are rare and HR can dedupe in
-- the UI. NB Media + YT Labs override the NULL fallback at picker
-- time.
ALTER TABLE "LetterTemplate"
  ADD CONSTRAINT "LetterTemplate_key_businessUnit_key"
  UNIQUE ("key", "businessUnit");

CREATE INDEX IF NOT EXISTS "LetterTemplate_key_businessUnit_idx"
  ON "LetterTemplate"("key", "businessUnit");
