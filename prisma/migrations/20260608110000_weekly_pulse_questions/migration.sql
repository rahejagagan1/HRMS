-- Weekly Pulse (Keka-style employee engagement survey) — question
-- bank. 4 weeks of 5 questions each rotate continuously; HR can
-- edit the text / type / emoji set / order / active flag from the
-- HR Dashboard → Weekly Pulse tab.
--
-- Each "type" drives the answer widget on the employee page:
--   • emoji  — 5-emoji picker, emojis array stored in `emojis`
--   • rating — 5-star (or 1-5 number) picker
--   • text   — optional free-text comment box
--
-- Responses land in PulseResponse (next migration when we ship
-- the employee-facing answer flow). For now this table is just
-- the question bank — editable in the HR Dashboard.

CREATE TABLE IF NOT EXISTS "PulseQuestion" (
  "id"          SERIAL PRIMARY KEY,
  "week"        INTEGER NOT NULL CHECK ("week" BETWEEN 1 AND 4),
  "order"       INTEGER NOT NULL DEFAULT 0,
  "text"        TEXT NOT NULL,
  "type"        TEXT NOT NULL DEFAULT 'emoji', -- emoji | rating | text
  "emojis"      JSONB,                          -- e.g. ['😡','😟','😐','🙂','😄']
  "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "PulseQuestion_week_order_idx"
  ON "PulseQuestion" ("week", "order");

-- ── Seed: 4 weeks × 5 questions = 20 total ─────────────────────
-- HR can edit any row from the dashboard. Default rotation:
--   Week 1 — Mood & Wellbeing
--   Week 2 — Manager & Team
--   Week 3 — Workload & Resources
--   Week 4 — Growth & Engagement
-- The last row of each week is a free-text comment box.

INSERT INTO "PulseQuestion" ("week", "order", "text", "type", "emojis") VALUES
  -- WEEK 1 — Mood & Wellbeing
  (1, 1, 'How was your week overall?',                                'emoji',  '["😡","😟","😐","🙂","😄"]'::jsonb),
  (1, 2, 'How would you rate your work-life balance this week?',      'rating', NULL),
  (1, 3, 'How motivated did you feel to come to work?',               'emoji',  '["😟","😐","🙂","😄","🤩"]'::jsonb),
  (1, 4, 'How were your energy levels this week?',                    'rating', NULL),
  (1, 5, 'Anything specific you''d like to share about your week?',   'text',   NULL),

  -- WEEK 2 — Manager & Team
  (2, 1, 'How supported did you feel by your manager?',               'rating', NULL),
  (2, 2, 'How well did your team collaborate this week?',             'rating', NULL),
  (2, 3, 'Did your manager give you helpful feedback this week?',     'emoji',  '["😞","😐","🙂","😄","🤩"]'::jsonb),
  (2, 4, 'How was your relationship with your teammates?',            'rating', NULL),
  (2, 5, 'Any feedback for your manager? (kept anonymous)',           'text',   NULL),

  -- WEEK 3 — Workload & Resources
  (3, 1, 'How manageable was your workload this week?',               'emoji',  '["😩","😟","😐","🙂","😌"]'::jsonb),
  (3, 2, 'Did you have the tools and resources you needed?',          'rating', NULL),
  (3, 3, 'Were your priorities clear this week?',                     'rating', NULL),
  (3, 4, 'How focused were you able to be?',                          'rating', NULL),
  (3, 5, 'What''s blocking you right now? (optional)',                'text',   NULL),

  -- WEEK 4 — Growth & Engagement
  (4, 1, 'Did you learn something new this week?',                    'rating', NULL),
  (4, 2, 'How aligned do you feel with the company''s goals?',        'rating', NULL),
  (4, 3, 'Would you recommend us as a place to work?',                'emoji',  '["😡","😟","😐","🙂","🤩"]'::jsonb),
  (4, 4, 'How proud are you of your work this week?',                 'rating', NULL),
  (4, 5, 'Anything you''d like leadership to know? (optional)',       'text',   NULL)
ON CONFLICT DO NOTHING;
