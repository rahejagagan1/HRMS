-- Designation-driven report templates. Additive + idempotent so it is safe to
-- run via `prisma db execute` on the shared DB and again via `migrate deploy`.
-- Phase A: new join table + nullable template columns + template-inclusive
-- unique indexes added ALONGSIDE the existing unique keys (old keys are NOT
-- dropped here — that happens in Phase B once multi-template filling is wired).

-- 1) Which report templates a designation fills/views (multiple per designation).
CREATE TABLE IF NOT EXISTS "DesignationReportTemplate" (
  "designationId" INTEGER NOT NULL,
  "template"      TEXT    NOT NULL,   -- 'production' | 'researcher' | 'qa' | 'hr'
  "grantedBy"     INTEGER,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DesignationReportTemplate_pkey" PRIMARY KEY ("designationId", "template")
);

DO $$ BEGIN
  ALTER TABLE "DesignationReportTemplate"
    ADD CONSTRAINT "DesignationReportTemplate_designationId_fkey"
    FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DesignationReportTemplate"
    ADD CONSTRAINT "DesignationReportTemplate_template_check"
    CHECK ("template" IN ('production','researcher','qa','hr'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "DesignationReportTemplate_template_idx"
  ON "DesignationReportTemplate" ("template");

-- 2) Nullable template tag on each report (NULL = legacy, pre-backfill).
ALTER TABLE "WeeklyReport"  ADD COLUMN IF NOT EXISTS "reportTemplate" TEXT;
ALTER TABLE "MonthlyReport" ADD COLUMN IF NOT EXISTS "reportTemplate" TEXT;

-- 3) Template-inclusive unique indexes, added alongside the existing unique keys.
--    Safe today because each manager maps 1:1 to a template, so no collisions.
CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyReport_manager_template_period_key"
  ON "WeeklyReport" ("managerId", "reportTemplate", "week", "month", "year");
CREATE UNIQUE INDEX IF NOT EXISTS "MonthlyReport_manager_template_period_key"
  ON "MonthlyReport" ("managerId", "reportTemplate", "month", "year");
