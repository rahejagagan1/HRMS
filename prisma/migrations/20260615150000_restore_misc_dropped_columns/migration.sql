-- Restore three columns referenced by raw-SQL writes but missing from the
-- DB (dropped by the same past `prisma db push` that took the JobOpening
-- columns). Each is written by current code but absent, so the feature
-- 500s today:
--   • JobApplication.recruiterOwnerId — candidate "assign owner" action
--   • JobApplication.tags             — candidate add/remove tag
--   • Shift.brand                     — brand-scoped shift creation
-- Additive + idempotent: ADD COLUMN IF NOT EXISTS cannot drop/alter
-- existing data; defaults keep existing rows valid.
ALTER TABLE "JobApplication" ADD COLUMN IF NOT EXISTS "recruiterOwnerId" INTEGER;
ALTER TABLE "JobApplication" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "brand" TEXT;
