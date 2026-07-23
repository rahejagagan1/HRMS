-- Add 27 legacy columns that exist in prod but were missing from dev,
-- bringing dev's column set to full parity with prod. These columns are
-- NOT modelled in schema.prisma (the dev refactor replaced them with new
-- equivalents like Goal.ownerId/cycleId), so the Prisma client won't
-- read/write them — but the columns will exist for raw SQL compatibility.
--
-- This migration must NOT run on prod (every column already exists there).
-- It will be marked applied on prod via `migrate resolve --applied`.

-- ── Asset ──────────────────────────────────────────────────────────
ALTER TABLE "Asset" ADD COLUMN "purchaseValue" DECIMAL(10,2);

-- ── AssetAssignment (empty) ────────────────────────────────────────
ALTER TABLE "AssetAssignment" ADD COLUMN "assignedById" INTEGER NOT NULL;

-- ── Attendance (532 rows; nullable column = safe) ──────────────────
ALTER TABLE "Attendance" ADD COLUMN "regularizeNote" TEXT;

-- ── EmployeeDocument (empty) ───────────────────────────────────────
ALTER TABLE "EmployeeDocument"
    ADD COLUMN "fileSize" INTEGER,
    ADD COLUMN "notes"    TEXT;

-- ── EmployeeProfile (2 rows; nullable column = safe) ───────────────
ALTER TABLE "EmployeeProfile" ADD COLUMN "pincode" TEXT;

-- ── Goal (empty — every column safe even when NOT NULL) ────────────
ALTER TABLE "Goal"
    ADD COLUMN "userId"        INTEGER NOT NULL,
    ADD COLUMN "managerId"     INTEGER,
    ADD COLUMN "targetValue"   DECIMAL(10,2),
    ADD COLUMN "currentValue"  DECIMAL(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN "unit"          TEXT,
    ADD COLUMN "weight"        INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN "dueDate"       DATE,
    ADD COLUMN "period"        TEXT NOT NULL,
    ADD COLUMN "type"          TEXT NOT NULL DEFAULT 'quantitative',
    ADD COLUMN "selfRating"    INTEGER,
    ADD COLUMN "managerRating" INTEGER;

-- ── LeaveType (6 rows; both columns have defaults = safe) ──────────
ALTER TABLE "LeaveType"
    ADD COLUMN "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "color"            TEXT    NOT NULL DEFAULT '#7c3aed';

-- ── PayrollRun (empty) ─────────────────────────────────────────────
ALTER TABLE "PayrollRun"
    ADD COLUMN "processedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "processedById" INTEGER;

-- ── SalaryStructure (1 row — basicPay needs backfill) ──────────────
-- basicPay is NOT NULL with no default in prod. We add it as nullable
-- first, copy the existing `basic` value into it, then add NOT NULL.
ALTER TABLE "SalaryStructure"
    ADD COLUMN "basicPay"        DECIMAL(10,2),
    ADD COLUMN "otherAllowances" JSONB,
    ADD COLUMN "pfPercent"       DECIMAL(5,2) NOT NULL DEFAULT 12,
    ADD COLUMN "esiApplicable"   BOOLEAN      NOT NULL DEFAULT false,
    ADD COLUMN "isActive"        BOOLEAN      NOT NULL DEFAULT true;

UPDATE "SalaryStructure" SET "basicPay" = "basic" WHERE "basicPay" IS NULL;

ALTER TABLE "SalaryStructure" ALTER COLUMN "basicPay" SET NOT NULL;

-- ── Shift (1 row; default = safe) ──────────────────────────────────
ALTER TABLE "Shift" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
