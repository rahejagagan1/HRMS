-- Per-job Hiring Setup → Application Form support.
--
-- Two tables, both scoped per JobOpening so different roles can have
-- different screening questions / field requirements without polluting
-- a global config.
--
--   JobOpeningQuestion     — custom screening questions HR writes per
--                            role. Optional answer field, multiple types.
--   JobOpeningFieldConfig  — visibility (required / optional / hidden)
--                            of standard candidate fields (First Name,
--                            Last Name, Phone, etc.) per acquisition
--                            channel (Career site, Recruiter sourcing,
--                            Internal job posting, Referral).
--
-- Both CASCADE on JobOpening delete so cleaning up an opening also
-- wipes its form config. No referential link back to JobApplication
-- — answers (when we add them) will reference the question id with
-- ON DELETE SET NULL so deleting a question doesn't nuke history.

-- ── JobOpeningQuestion ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "JobOpeningQuestion" (
  "id"           SERIAL          PRIMARY KEY,
  "jobOpeningId" INTEGER         NOT NULL,
  "text"         TEXT            NOT NULL,
  -- short_text | long_text | yes_no | multiple_choice | file | number | date
  "type"         TEXT            NOT NULL DEFAULT 'short_text',
  -- For multiple_choice: JSON array of strings.
  "options"      JSONB,
  "required"     BOOLEAN         NOT NULL DEFAULT false,
  "sortOrder"    INTEGER         NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  CONSTRAINT "JobOpeningQuestion_jobOpeningId_fkey"
    FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "JobOpeningQuestion_jobOpeningId_idx"
  ON "JobOpeningQuestion"("jobOpeningId");
CREATE INDEX IF NOT EXISTS "JobOpeningQuestion_sort_idx"
  ON "JobOpeningQuestion"("jobOpeningId", "sortOrder");

-- ── JobOpeningFieldConfig ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "JobOpeningFieldConfig" (
  "id"           SERIAL          PRIMARY KEY,
  "jobOpeningId" INTEGER         NOT NULL,
  -- career_site | recruiter_sourcing | internal_job_posting | referral
  "channel"      TEXT            NOT NULL,
  -- first_name | middle_name | last_name | email | phone | resume |
  -- cover_letter | current_company | current_designation |
  -- experience_years | current_salary | expected_salary | notice_period |
  -- highest_education | linkedin_url | portfolio_url | address |
  -- gender | dob | source
  "fieldKey"     TEXT            NOT NULL,
  -- required | optional | hidden
  "visibility"   TEXT            NOT NULL DEFAULT 'optional',
  "sortOrder"    INTEGER         NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  CONSTRAINT "JobOpeningFieldConfig_jobOpeningId_fkey"
    FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE CASCADE
);
-- One row per (job, channel, field) — overwriting is an UPSERT, not
-- a second insert.
CREATE UNIQUE INDEX IF NOT EXISTS "JobOpeningFieldConfig_unique_idx"
  ON "JobOpeningFieldConfig"("jobOpeningId", "channel", "fieldKey");
CREATE INDEX IF NOT EXISTS "JobOpeningFieldConfig_jobOpeningId_idx"
  ON "JobOpeningFieldConfig"("jobOpeningId");
