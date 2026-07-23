-- Schema for the Keka-parity 4-step Create Job wizard.
--
-- Adds the columns + junction tables we need to capture everything
-- step 2-4 of the wizard collects. Keeps backwards-compat:
--   • JobOpening.location stays (denormalized "primary location"
--     from the first JobOpeningLocation row — read code can ignore
--     the new table until ready).
--   • JobOpening.recruiterId / hiringManagerId stay as the
--     "primary" recruiter / hiring manager; the junction tables
--     hold the full multi-person list.
--   • JobOpening.vacancies stays as the SUM of per-location
--     positions, maintained by the create endpoint.
--
-- ── JobOpening additive columns ────────────────────────────────────
ALTER TABLE "JobOpening"
  ADD COLUMN IF NOT EXISTS "currency"                       TEXT    DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS "salaryMin"                      INTEGER,
  ADD COLUMN IF NOT EXISTS "salaryMax"                      INTEGER,
  ADD COLUMN IF NOT EXISTS "salaryUnit"                     TEXT    DEFAULT 'annual',
  ADD COLUMN IF NOT EXISTS "allowReapplyDays"               INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "archiveAfterFilled"             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "inboundOwnerStrategy"           TEXT    NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "inboundOwnerUserId"             INTEGER,
  ADD COLUMN IF NOT EXISTS "interviewFeedbackVisibility"    TEXT    NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS "recruitersAccessOwnOnly"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "interviewersAccessOwnOnly"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "notifyRecruiterOnNewCandidate"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "notifyHiringMgrOnNewCandidate"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "publishChannels"                TEXT[]  NOT NULL DEFAULT ARRAY['career_site']::TEXT[];

-- FK for the inbound owner (ON DELETE SET NULL so deactivating that
-- user doesn't cascade-orphan the job).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'JobOpening_inboundOwnerUserId_fkey'
  ) THEN
    ALTER TABLE "JobOpening"
      ADD CONSTRAINT "JobOpening_inboundOwnerUserId_fkey"
      FOREIGN KEY ("inboundOwnerUserId") REFERENCES "User"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- ── JobOpeningLocation ─────────────────────────────────────────────
-- One row per (job, location). Each location carries its own hire
-- timeline + position count so HR can spin a single requisition
-- across Mohali + Remote + Bangalore with different targets.
CREATE TABLE IF NOT EXISTS "JobOpeningLocation" (
  "id"             SERIAL          PRIMARY KEY,
  "jobOpeningId"   INTEGER         NOT NULL,
  "name"           TEXT            NOT NULL,
  "startHireDate"  DATE,
  "targetHireDate" DATE,
  "positions"      INTEGER         NOT NULL DEFAULT 1,
  "sortOrder"      INTEGER         NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  CONSTRAINT "JobOpeningLocation_jobOpeningId_fkey"
    FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "JobOpeningLocation_jobOpeningId_idx"
  ON "JobOpeningLocation"("jobOpeningId");

-- ── JobOpeningRecruiterJoin ────────────────────────────────────────
-- The recruiter pool for this job. JobOpening.recruiterId stays as
-- the "primary" recruiter (used by legacy notifications / candidate
-- lists) — usually equals the first row here.
CREATE TABLE IF NOT EXISTS "JobOpeningRecruiterJoin" (
  "jobOpeningId" INTEGER NOT NULL,
  "userId"       INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "JobOpeningRecruiterJoin_pkey" PRIMARY KEY ("jobOpeningId", "userId"),
  CONSTRAINT "JobOpeningRecruiterJoin_jobOpeningId_fkey"
    FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE CASCADE,
  CONSTRAINT "JobOpeningRecruiterJoin_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "JobOpeningRecruiterJoin_userId_idx"
  ON "JobOpeningRecruiterJoin"("userId");

-- ── JobOpeningHiringManagerJoin ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "JobOpeningHiringManagerJoin" (
  "jobOpeningId" INTEGER NOT NULL,
  "userId"       INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "JobOpeningHiringManagerJoin_pkey" PRIMARY KEY ("jobOpeningId", "userId"),
  CONSTRAINT "JobOpeningHiringManagerJoin_jobOpeningId_fkey"
    FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE CASCADE,
  CONSTRAINT "JobOpeningHiringManagerJoin_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "JobOpeningHiringManagerJoin_userId_idx"
  ON "JobOpeningHiringManagerJoin"("userId");
