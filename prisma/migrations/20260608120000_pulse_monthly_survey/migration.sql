-- Pulse & Surveys — extend PulseQuestion to support the Keka-style
-- Monthly Survey alongside the existing Weekly Pulse rotation.
--
-- Changes:
--   • Add `surveyType` column — 'weekly' (default, existing rows) or 'monthly'.
--   • Make `week` nullable so monthly questions can omit it.
--   • Drop the strict 1-4 CHECK so NULL is allowed.
--   • Seed 6 monthly questions (eNPS + 4 Likert + 1 open text).
--
-- New question types `likert` (1-5 Strongly Disagree → Strongly Agree)
-- and `enps` (0-10 slider — drives Employee Net Promoter Score) are
-- not constrained at the schema level; the app's VALID_TYPES set in
-- /api/hr/pulse/questions allows them.

ALTER TABLE "PulseQuestion"
  ADD COLUMN IF NOT EXISTS "surveyType" TEXT NOT NULL DEFAULT 'weekly';

ALTER TABLE "PulseQuestion"
  ALTER COLUMN "week" DROP NOT NULL;

-- Postgres auto-names the CHECK constraint from the original migration
-- as "PulseQuestion_week_check". Replace it with one that permits NULL.
ALTER TABLE "PulseQuestion"
  DROP CONSTRAINT IF EXISTS "PulseQuestion_week_check";

ALTER TABLE "PulseQuestion"
  ADD CONSTRAINT "PulseQuestion_week_check"
  CHECK ("week" IS NULL OR ("week" BETWEEN 1 AND 4));

CREATE INDEX IF NOT EXISTS "PulseQuestion_surveyType_idx"
  ON "PulseQuestion" ("surveyType", "order");

-- ── Seed: Monthly Survey — 6 questions ─────────────────────────
-- Tighter set than the weekly pulse since employees only see this
-- once a month. Mix of eNPS (the gold-standard engagement metric),
-- four Likert scales hitting the biggest engagement drivers, plus
-- one open-text "start / stop / keep" prompt at the end.
--
-- HR can edit any of these from the dashboard's Monthly Survey
-- sub-tab — text, type, order, active flag.

INSERT INTO "PulseQuestion" ("week", "order", "text", "type", "emojis", "surveyType") VALUES
  (NULL, 1, 'How likely are you to recommend NB Media as a place to work?', 'enps',   NULL, 'monthly'),
  (NULL, 2, 'My manager genuinely supports my growth and wellbeing.',       'likert', NULL, 'monthly'),
  (NULL, 3, 'I see a clear path for my career at this company.',            'likert', NULL, 'monthly'),
  (NULL, 4, 'My work is recognised when I do something well.',              'likert', NULL, 'monthly'),
  (NULL, 5, 'I can maintain a healthy work-life balance.',                  'likert', NULL, 'monthly'),
  (NULL, 6, 'What''s one thing we should start, stop, or keep doing?',      'text',   NULL, 'monthly')
ON CONFLICT DO NOTHING;
