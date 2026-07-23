-- WFH monthly quota system.
--
-- Two tables:
--
-- 1. WfhPolicy — singleton (id = 1). Global toggle + per-brand
--    monthly quotas. HR edits these from the admin Leave Policies
--    panel. Default: limit ENABLED, NB Media = 2, YT Labs = 3.
--
-- 2. WfhBalance — one row per (user, monthKey). Credited at the
--    start of every month by the auto-credit cron. Increments
--    `used` when an HR-approved WFH request lands. Remaining =
--    credited - used.

CREATE TABLE IF NOT EXISTS "WfhPolicy" (
  "id"            INTEGER PRIMARY KEY,           -- always 1 (singleton)
  "limitEnabled"  BOOLEAN NOT NULL DEFAULT TRUE,
  "nbMediaQuota"  INTEGER NOT NULL DEFAULT 2,
  "ytLabsQuota"   INTEGER NOT NULL DEFAULT 3,
  "updatedById"   INTEGER REFERENCES "User"(id) ON DELETE SET NULL,
  "updatedAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "WfhPolicy_singleton" CHECK (id = 1)
);

-- Seed the singleton row.
INSERT INTO "WfhPolicy" ("id", "limitEnabled", "nbMediaQuota", "ytLabsQuota")
VALUES (1, TRUE, 2, 3)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS "WfhBalance" (
  "id"          SERIAL PRIMARY KEY,
  "userId"      INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "monthKey"    TEXT NOT NULL,                   -- "2026-M06"
  "credited"    INTEGER NOT NULL,                -- 2 (NB Media) or 3 (YT Labs)
  "used"        INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE ("userId", "monthKey")
);

CREATE INDEX IF NOT EXISTS "WfhBalance_monthKey_idx" ON "WfhBalance" ("monthKey");
CREATE INDEX IF NOT EXISTS "WfhBalance_userId_idx"   ON "WfhBalance" ("userId");
