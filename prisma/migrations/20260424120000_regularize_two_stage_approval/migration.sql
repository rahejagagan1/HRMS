-- Two-stage approval flow for AttendanceRegularization, plus admin emergency grants.
-- All columns are nullable so existing rows are safe: no backfill needed.
ALTER TABLE "AttendanceRegularization"
    ADD COLUMN "approvedAt"        TIMESTAMP(3),
    ADD COLUMN "finalApprovedById" INTEGER,
    ADD COLUMN "finalApprovedAt"   TIMESTAMP(3),
    ADD COLUMN "finalApprovalNote" TEXT,
    ADD COLUMN "grantedByAdminId"  INTEGER;

-- FK for stage-2 approver (grand-manager OR CEO / HR manager).
ALTER TABLE "AttendanceRegularization"
    ADD CONSTRAINT "AttendanceRegularization_finalApprovedById_fkey"
    FOREIGN KEY ("finalApprovedById") REFERENCES "User" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- FK for the admin (CEO / Developer / HR) who granted an on-behalf regularization.
ALTER TABLE "AttendanceRegularization"
    ADD CONSTRAINT "AttendanceRegularization_grantedByAdminId_fkey"
    FOREIGN KEY ("grantedByAdminId") REFERENCES "User" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
