-- Add 6 SalaryStructure columns that were added to dev (via prisma db push,
-- without a migration file) but never made it to prod. Defaults and
-- nullability mirror dev exactly so future inserts behave identically.

ALTER TABLE "SalaryStructure"
    ADD COLUMN "salaryType"    VARCHAR(32) NOT NULL DEFAULT 'regular',
    ADD COLUMN "payGroup"      VARCHAR(64),
    ADD COLUMN "bonusIncluded" BOOLEAN     NOT NULL DEFAULT false,
    ADD COLUMN "taxRegime"     VARCHAR(64),
    ADD COLUMN "structureType" VARCHAR(32),
    ADD COLUMN "pfEligible"    BOOLEAN     NOT NULL DEFAULT false;
