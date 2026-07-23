-- Align prod schema to dev: add 6 missing columns and convert 10 column
-- types/nullability to match dev. Safe to no-op on dev (every change is
-- already present there) — should be marked applied via `migrate resolve`.

-- ── Add missing columns ───────────────────────────────────────────────
ALTER TABLE "EmployeeProfile"
    ADD COLUMN "maritalStatus" TEXT,
    ADD COLUMN "personalEmail" TEXT,
    ADD COLUMN "workPhone"     TEXT;

-- (MonthlyReport.editorExtraCases / writerExtraCases are added by
--  20260429140000_monthly_report_extra_cases — not duplicated here.)

ALTER TABLE "User"
    ADD COLUMN "onboardingPending" BOOLEAN NOT NULL DEFAULT false;

-- ── Type / nullability conversions ────────────────────────────────────
-- Announcement.targetId: int4 → text. Existing integer ids cast to their
-- string representation; the column already had no FK so this is safe.
ALTER TABLE "Announcement"
    ALTER COLUMN "targetId" TYPE TEXT USING "targetId"::text;

-- Asset.purchaseDate: date → timestamp(3). Existing dates become midnight UTC.
ALTER TABLE "Asset"
    ALTER COLUMN "purchaseDate" TYPE TIMESTAMP(3) USING "purchaseDate"::timestamp(3);

-- Attendance.totalMinutes: nullable → NOT NULL. Backfill any NULLs to 0
-- first (zero-minute attendance — caller can recompute later if needed).
UPDATE "Attendance" SET "totalMinutes" = 0 WHERE "totalMinutes" IS NULL;
ALTER TABLE "Attendance"
    ALTER COLUMN "totalMinutes" SET NOT NULL;

-- EmployeeDocument.expiryDate: date → timestamp(3).
ALTER TABLE "EmployeeDocument"
    ALTER COLUMN "expiryDate" TYPE TIMESTAMP(3) USING "expiryDate"::timestamp(3);

-- EmployeeProfile date columns: date → timestamp(3).
ALTER TABLE "EmployeeProfile"
    ALTER COLUMN "joiningDate" TYPE TIMESTAMP(3) USING "joiningDate"::timestamp(3),
    ALTER COLUMN "dateOfBirth" TYPE TIMESTAMP(3) USING "dateOfBirth"::timestamp(3);

-- SalaryStructure precision widen: numeric(10,2)→numeric(12,2),
-- numeric(8,2)→numeric(10,2). All safe (no truncation possible).
ALTER TABLE "SalaryStructure"
    ALTER COLUMN "hra"              TYPE DECIMAL(12,2),
    ALTER COLUMN "specialAllowance" TYPE DECIMAL(12,2),
    ALTER COLUMN "professionalTax"  TYPE DECIMAL(10,2);

-- UserShift.effectiveFrom: date → timestamp(3).
ALTER TABLE "UserShift"
    ALTER COLUMN "effectiveFrom" TYPE TIMESTAMP(3) USING "effectiveFrom"::timestamp(3);
