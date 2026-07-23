-- Effective-dated reporting-manager changes.
-- HR schedules a future reporting manager for an employee; the
-- `reporting_manager_changes` daily cron flips User."managerId" on/after
-- effectiveDate and marks the row applied. Idempotent / additive only —
-- IF NOT EXISTS guards make this safe to re-run.
CREATE TABLE IF NOT EXISTS "ManagerChangeSchedule" (
    "id"            SERIAL PRIMARY KEY,
    "userId"        INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "newManagerId"  INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "effectiveDate" DATE NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'pending',
    "note"          TEXT,
    "createdBy"     INTEGER,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt"     TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "ManagerChangeSchedule_status_effectiveDate_idx" ON "ManagerChangeSchedule" ("status", "effectiveDate");

CREATE INDEX IF NOT EXISTS "ManagerChangeSchedule_userId_idx" ON "ManagerChangeSchedule" ("userId");
