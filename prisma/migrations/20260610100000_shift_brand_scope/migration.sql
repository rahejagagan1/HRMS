-- Add brand scoping to Shift templates so an NB Media HR Manager
-- doesn't see YT Labs shifts (and vice versa). Developers + users
-- in CROSS_BRAND_HR_USER_IDS still see all.
--
-- Back-fill strategy: scan the existing shift NAMES for brand hints.
-- Anything containing "yt labs" / "yt_labs" / "ytlabs" (case-insensitive)
-- → "YT Labs". Anything containing "nb media" / "nb_media" / "nbmedia"
-- or " nb " or starting/ending with "nb" → "NB Media". Anything else
-- stays NULL and is visible to everyone (back-compat for old shifts
-- whose name doesn't encode a brand).

ALTER TABLE "Shift"
  ADD COLUMN IF NOT EXISTS "brand" TEXT;

CREATE INDEX IF NOT EXISTS "Shift_brand_idx" ON "Shift" ("brand");

-- Back-fill known patterns.
UPDATE "Shift"
   SET "brand" = 'YT Labs'
 WHERE "brand" IS NULL
   AND LOWER(name) ~ '(^|[^a-z])(yt[ _]?labs?)([^a-z]|$)';

UPDATE "Shift"
   SET "brand" = 'NB Media'
 WHERE "brand" IS NULL
   AND (
     LOWER(name) ~ '(^|[^a-z])(nb[ _]?media?)([^a-z]|$)'
     OR LOWER(name) ~ '(^|[^a-z])nb([^a-z]|$)'
   );
