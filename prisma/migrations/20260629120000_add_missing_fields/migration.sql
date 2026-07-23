-- Missing Fields tool: flag ClickUp cases that have required custom fields
-- left empty. Two standalone tables (no foreign keys), read/written via raw
-- SQL so they don't require a prisma generate cycle.

-- Per-capsule plan: which Case fields are mandatory for that capsule's cases.
-- requiredFields = JSON array of field keys (Case column names).
CREATE TABLE IF NOT EXISTS "CapsuleFieldPlan" (
  "id"             SERIAL PRIMARY KEY,
  "capsuleId"      INTEGER NOT NULL UNIQUE,
  "requiredFields" JSONB NOT NULL DEFAULT '[]',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Single-row global config (id = 1). inScopeStatuses = JSON array of
-- Case.status strings the run should scan.
CREATE TABLE IF NOT EXISTS "MissingFieldsConfig" (
  "id"              SERIAL PRIMARY KEY,
  "inScopeStatuses" JSONB NOT NULL DEFAULT '[]',
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
