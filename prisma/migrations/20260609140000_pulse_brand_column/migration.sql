-- Add brand column to PulseQuestion so HR can manage separate
-- question banks for NB Media + YT Labs.
--
-- Semantics:
--   • brand IS NULL          → shared question, both brands see it
--   • brand = 'NB Media'     → NB Media employees only
--   • brand = 'YT Labs'      → YT Labs employees only
--
-- Existing 26 seeded questions stay as NULL = shared. HR can re-tag
-- them to a specific brand later if they want NB-only / YT-only
-- variants.

ALTER TABLE "PulseQuestion"
  ADD COLUMN IF NOT EXISTS "brand" TEXT;

CREATE INDEX IF NOT EXISTS "PulseQuestion_brand_idx"
  ON "PulseQuestion" ("brand");
