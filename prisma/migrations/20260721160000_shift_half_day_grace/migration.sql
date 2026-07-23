-- Per-shift grace for second-half arrivals on half-day (first-half leave/WFH)
-- days. NULL falls back to "breakMinutes" (the full-day grace). Additive and
-- idempotent so environments where the column was applied manually don't fail.
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "halfDayGraceMinutes" INTEGER;
