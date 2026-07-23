-- Bring EmployeeProfile to parity with the Keka HR export so a Keka
-- import (and the HR onboarding form) can persist every field the
-- spreadsheet collects. All columns nullable; existing rows survive
-- unchanged. See prisma/schema.prisma for the field-by-field comments.
ALTER TABLE "EmployeeProfile"
  ADD COLUMN IF NOT EXISTS "homePhone"               TEXT,
  ADD COLUMN IF NOT EXISTS "physicallyHandicapped"   TEXT,

  ADD COLUMN IF NOT EXISTS "addressLine2"            TEXT,
  ADD COLUMN IF NOT EXISTS "addressPincode"          TEXT,
  ADD COLUMN IF NOT EXISTS "addressCountry"          TEXT DEFAULT 'India',

  ADD COLUMN IF NOT EXISTS "permanentLine1"          TEXT,
  ADD COLUMN IF NOT EXISTS "permanentLine2"          TEXT,
  ADD COLUMN IF NOT EXISTS "permanentCity"           TEXT,
  ADD COLUMN IF NOT EXISTS "permanentState"          TEXT,
  ADD COLUMN IF NOT EXISTS "permanentPincode"        TEXT,
  ADD COLUMN IF NOT EXISTS "permanentCountry"        TEXT DEFAULT 'India',

  ADD COLUMN IF NOT EXISTS "motherName"              TEXT,
  ADD COLUMN IF NOT EXISTS "spouseName"              TEXT,
  ADD COLUMN IF NOT EXISTS "childrenNames"           TEXT,

  ADD COLUMN IF NOT EXISTS "emergencyRelationship"   TEXT,

  ADD COLUMN IF NOT EXISTS "attendanceCaptureScheme" TEXT,
  ADD COLUMN IF NOT EXISTS "costCenter"              TEXT,

  ADD COLUMN IF NOT EXISTS "pfNumber"                TEXT,
  ADD COLUMN IF NOT EXISTS "uanNumber"               TEXT,

  ADD COLUMN IF NOT EXISTS "biometricId"             TEXT;
