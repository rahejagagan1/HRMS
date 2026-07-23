-- Two-stage approval flow for LeaveApplication.
ALTER TABLE "LeaveApplication"
    ADD COLUMN "approvedAt"        TIMESTAMP(3),
    ADD COLUMN "finalApprovedById" INTEGER,
    ADD COLUMN "finalApprovedAt"   TIMESTAMP(3),
    ADD COLUMN "finalApprovalNote" TEXT,
    ADD COLUMN "notifyUserIds"     INTEGER[] NOT NULL DEFAULT '{}';

-- FK for stage-2 approver (CEO / HR manager).
ALTER TABLE "LeaveApplication"
    ADD CONSTRAINT "LeaveApplication_finalApprovedById_fkey"
    FOREIGN KEY ("finalApprovedById") REFERENCES "User" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
