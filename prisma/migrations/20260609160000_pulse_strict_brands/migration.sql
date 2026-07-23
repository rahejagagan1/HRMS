-- Strict brand separation for PulseQuestion. HR no longer wants
-- "shared" questions that both brands see — each brand has its
-- own independent bank.
--
-- Migration: for every existing brand-NULL question, copy it into
-- BOTH brand-specific buckets, then drop the originals.
--
-- This gives each brand a baseline 20 weekly + 6 monthly questions
-- equivalent to the seed. HR can then customise either side
-- without affecting the other.

-- Step 1: clone every shared question into NB Media.
INSERT INTO "PulseQuestion" (week, "order", text, type, emojis, "isActive", "surveyType", brand, "createdAt", "updatedAt")
SELECT week, "order", text, type, emojis, "isActive", "surveyType", 'NB Media', NOW(), NOW()
  FROM "PulseQuestion"
 WHERE brand IS NULL;

-- Step 2: clone every shared question into YT Labs.
INSERT INTO "PulseQuestion" (week, "order", text, type, emojis, "isActive", "surveyType", brand, "createdAt", "updatedAt")
SELECT week, "order", text, type, emojis, "isActive", "surveyType", 'YT Labs', NOW(), NOW()
  FROM "PulseQuestion"
 WHERE brand IS NULL;

-- Step 3: drop the now-redundant shared rows.
DELETE FROM "PulseQuestion" WHERE brand IS NULL;

-- Step 4: enforce going forward — brand is required from now on.
ALTER TABLE "PulseQuestion"
  ALTER COLUMN "brand" SET NOT NULL;

-- Step 5: validation check — brand must be one of the two known values.
ALTER TABLE "PulseQuestion"
  ADD CONSTRAINT "PulseQuestion_brand_check"
  CHECK (brand IN ('NB Media', 'YT Labs'));
