-- Parked documents for NEW JOINERS not yet in the DB. The letter
-- generator's manual-entry mode renders an offer letter (etc.) for a
-- typed-in person and stores it here keyed by email. When a User with
-- that email is created (onboarding / Add-Employee / ClickUp sync),
-- attachPendingDocuments copies it into EmployeeDocument so it shows in
-- their Documents tab. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "PendingDocument" (
    "id"             SERIAL PRIMARY KEY,
    "email"          TEXT NOT NULL,
    "fullName"       TEXT,
    "category"       TEXT NOT NULL DEFAULT 'employee_letter',
    "templateKey"    TEXT,
    "fileName"       TEXT NOT NULL,
    "fileBlob"       BYTEA NOT NULL,
    "fileMime"       TEXT NOT NULL DEFAULT 'application/pdf',
    "brand"          TEXT,
    "createdById"    INTEGER,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attachedUserId" INTEGER,
    "attachedAt"     TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "PendingDocument_email_idx" ON "PendingDocument" ("email");
CREATE INDEX IF NOT EXISTS "PendingDocument_attachedUserId_idx" ON "PendingDocument" ("attachedUserId");
