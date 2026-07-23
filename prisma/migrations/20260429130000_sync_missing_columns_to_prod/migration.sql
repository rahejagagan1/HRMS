-- Sync missing columns from dev to prod for shared tables.
-- All affected tables (Announcement, Attendance, Goal, HolidayCalendar,
-- LeaveBalance, PayrollRun, SalaryStructure) are empty in prod, so NOT NULL
-- columns without defaults can be added directly without backfill.
--
-- This migration ONLY adds columns; it does not drop the prod-only legacy
-- columns (e.g. Goal.userId, Goal.managerId, SalaryStructure.basicPay).
-- Those should be cleaned up in a separate migration once it's confirmed
-- nothing else reads them.

-- Announcement
ALTER TABLE "Announcement"
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Attendance
ALTER TABLE "Attendance"
    ADD COLUMN "location" TEXT,
    ADD COLUMN "notes"    TEXT;

-- HolidayCalendar
ALTER TABLE "HolidayCalendar"
    ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- LeaveBalance
ALTER TABLE "LeaveBalance"
    ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- PayrollRun
ALTER TABLE "PayrollRun"
    ADD COLUMN "runBy"        INTEGER     NOT NULL,
    ADD COLUMN "totalCTC"     DECIMAL(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN "totalNetPay"  DECIMAL(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- SalaryStructure
ALTER TABLE "SalaryStructure"
    ADD COLUMN "ctc"          DECIMAL(12,2) NOT NULL,
    ADD COLUMN "basic"        DECIMAL(12,2) NOT NULL,
    ADD COLUMN "pfEmployee"   DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "pfEmployer"   DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "esiEmployee"  DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "esiEmployer"  DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "tds"          DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Goal — adds the refactored columns alongside the existing prod-only ones.
ALTER TABLE "Goal"
    ADD COLUMN "ownerId"    INTEGER NOT NULL,
    ADD COLUMN "cycleId"    INTEGER NOT NULL,
    ADD COLUMN "visibility" TEXT    NOT NULL DEFAULT 'personal',
    ADD COLUMN "progress"   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "startDate"  DATE,
    ADD COLUMN "endDate"    DATE;

-- Goal foreign keys for the new columns.
ALTER TABLE "Goal"
    ADD CONSTRAINT "Goal_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Goal"
    ADD CONSTRAINT "Goal_cycleId_fkey"
    FOREIGN KEY ("cycleId") REFERENCES "GoalCycle" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- PayrollRun foreign key for the new runBy column.
ALTER TABLE "PayrollRun"
    ADD CONSTRAINT "PayrollRun_runBy_fkey"
    FOREIGN KEY ("runBy") REFERENCES "User" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
