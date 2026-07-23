-- Statutory Information (PF + PT) extras for the "Edit Statutory Information"
-- modal. All additive + nullable / defaulted so existing rows are unaffected.
ALTER TABLE "EmployeeProfile"
  ADD COLUMN IF NOT EXISTS "pfEstablishmentId" TEXT,
  ADD COLUMN IF NOT EXISTS "pfEpsMember"       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "pfNotEligible"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "pfJoinDate"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pfAccountName"     TEXT,
  ADD COLUMN IF NOT EXISTS "ptEstablishmentId" TEXT;
