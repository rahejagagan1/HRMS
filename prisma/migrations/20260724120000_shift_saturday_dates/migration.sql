-- Hand-picked working Saturdays ("YYYY-MM-DD"), used when
-- saturdayPolicy = 'dates' (2026-07-24). Idempotent for patched envs.
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "saturdayDates" TEXT[] NOT NULL DEFAULT '{}';
