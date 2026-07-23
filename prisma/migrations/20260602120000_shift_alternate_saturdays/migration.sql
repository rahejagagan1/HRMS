-- Alternate-Saturday support on shift templates.
-- saturdayPolicy: "all" (every Sat) | "alternate" (every other Sat, anchored
--   at each user's UserShift.effectiveFrom) | "weeks" (specific week ordinals).
-- saturdayWeeks: week-of-month ordinals (1-5) used when saturdayPolicy='weeks'.
ALTER TABLE "Shift"
  ADD COLUMN IF NOT EXISTS "saturdayPolicy" TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS "saturdayWeeks" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
