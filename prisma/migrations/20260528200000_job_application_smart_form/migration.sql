-- Smart-form columns on JobApplication.
--
-- The public apply form collects a richer profile (split name, DOB,
-- experience in months, salary expectations, preferred location,
-- skills, education + experience JSON blobs) that the INSERT in
-- /api/jobs/apply expects. Without these columns the INSERT fails
-- with 42703 (column "firstName" does not exist).
--
-- All new columns are nullable so legacy rows (pre-smart-form
-- applications) remain valid.

ALTER TABLE "JobApplication"
  ADD COLUMN IF NOT EXISTS "firstName"              TEXT,
  ADD COLUMN IF NOT EXISTS "middleName"             TEXT,
  ADD COLUMN IF NOT EXISTS "lastName"               TEXT,
  ADD COLUMN IF NOT EXISTS "gender"                 TEXT,
  ADD COLUMN IF NOT EXISTS "dateOfBirth"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mobileCountryCode"      TEXT,
  ADD COLUMN IF NOT EXISTS "experienceMonths"       INTEGER,
  ADD COLUMN IF NOT EXISTS "currentSalary"          DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "currentSalaryCurrency"  TEXT,
  ADD COLUMN IF NOT EXISTS "currentSalaryFreq"      TEXT,
  ADD COLUMN IF NOT EXISTS "expectedSalary"         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "expectedSalaryCurrency" TEXT,
  ADD COLUMN IF NOT EXISTS "expectedSalaryFreq"     TEXT,
  ADD COLUMN IF NOT EXISTS "availableToJoinDays"    INTEGER,
  ADD COLUMN IF NOT EXISTS "preferredLocation"      TEXT,
  ADD COLUMN IF NOT EXISTS "currentLocation"        TEXT,
  ADD COLUMN IF NOT EXISTS "skills"                 TEXT,
  ADD COLUMN IF NOT EXISTS "educationDetails"       TEXT,
  ADD COLUMN IF NOT EXISTS "experienceDetails"      TEXT;
