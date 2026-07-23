-- Door-entry audit log: every biometric door-OPEN (entry) scan from the
-- terminal, including mid-day re-entries (break / washroom). Standalone — no
-- foreign keys — so it never feeds into attendance worked-hours math. Surfaced
-- only to managers / HR / CEO / developers.
CREATE TABLE IF NOT EXISTS "DoorEntry" (
  "id"           SERIAL PRIMARY KEY,
  "userId"       INTEGER NOT NULL,
  "attendanceId" INTEGER,
  "scannedAt"    TIMESTAMP(3) NOT NULL,
  "source"       TEXT NOT NULL DEFAULT 'device',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "DoorEntry_userId_scannedAt_idx" ON "DoorEntry" ("userId", "scannedAt");
CREATE INDEX IF NOT EXISTS "DoorEntry_attendanceId_idx" ON "DoorEntry" ("attendanceId");
