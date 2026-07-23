-- Pulse responses — one row per (user, weekKey, questionId).
--
-- weekKey is the ISO-week string (e.g. "2026-W23") so the same user
-- gets a fresh slot every week. Existence of ANY row for (userId,
-- weekKey) means "this user has submitted this week's pulse" — used
-- by the clock-out guard to block end-of-day clock-out on Fridays
-- until the pulse is in.
--
-- score column holds:
--   • 0-10 for type=enps
--   • 1-5  for type=likert / rating
--   • 0-4  for type=emoji (the index into the question's emoji array)
--   • NULL for type=text (text-only answers live in `comment`)
--
-- comment holds any free-text answer the user added (always optional
-- except when the question type IS text, in which case it's required
-- by the API).

CREATE TABLE IF NOT EXISTS "PulseResponse" (
  "id"           SERIAL PRIMARY KEY,
  "userId"       INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "weekKey"      TEXT NOT NULL,
  "questionId"   INTEGER NOT NULL REFERENCES "PulseQuestion"(id) ON DELETE CASCADE,
  "score"        INTEGER,
  "comment"      TEXT,
  "submittedAt"  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE ("userId", "weekKey", "questionId")
);

CREATE INDEX IF NOT EXISTS "PulseResponse_weekKey_userId_idx"
  ON "PulseResponse" ("weekKey", "userId");

CREATE INDEX IF NOT EXISTS "PulseResponse_questionId_idx"
  ON "PulseResponse" ("questionId");
