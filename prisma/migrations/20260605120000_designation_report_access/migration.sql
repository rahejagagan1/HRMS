-- Per-designation report-view grants. Additive + idempotent so it is safe to
-- run on the shared dev DB via `prisma db execute` and again via prod
-- `migrate deploy` (no data loss, no conflict with other devs' tables).

CREATE TABLE IF NOT EXISTS "DesignationReportAccess" (
  "designationId" INTEGER NOT NULL,
  "managerId"     INTEGER NOT NULL,
  "grantedBy"     INTEGER,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DesignationReportAccess_pkey" PRIMARY KEY ("designationId", "managerId")
);

DO $$ BEGIN
  ALTER TABLE "DesignationReportAccess"
    ADD CONSTRAINT "DesignationReportAccess_designationId_fkey"
    FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DesignationReportAccess"
    ADD CONSTRAINT "DesignationReportAccess_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "DesignationReportAccess_managerId_idx"
  ON "DesignationReportAccess"("managerId");
