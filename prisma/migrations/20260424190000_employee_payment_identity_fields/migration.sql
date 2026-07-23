-- My Finances > Summary: structured payment + identity fields on EmployeeProfile.
-- All nullable so existing rows don't need backfill. Bank/PAN/Aadhaar are PII —
-- callers MUST restrict `select` to the owning user or HR-admin roles.
ALTER TABLE "EmployeeProfile"
    ADD COLUMN "bankName"          TEXT,
    ADD COLUMN "bankAccountNumber" TEXT,
    ADD COLUMN "bankIfsc"          TEXT,
    ADD COLUMN "bankBranch"        TEXT,
    ADD COLUMN "accountHolderName" TEXT,
    ADD COLUMN "panNumber"         TEXT,
    ADD COLUMN "parentName"        TEXT,
    ADD COLUMN "aadhaarNumber"     TEXT,
    ADD COLUMN "aadhaarEnrollment" TEXT;
