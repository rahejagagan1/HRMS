-- Recruiter owner on each JobApplication. The owner is the HR
-- person responsible for moving the candidate through the pipeline,
-- separate from the job's recruiter (which is per-opening, not
-- per-application). Keka shows this as "Owner" on each candidate row.
--
-- ON DELETE SET NULL so deactivating a user doesn't cascade-orphan
-- candidates — they just lose their owner and get reassigned.

ALTER TABLE "JobApplication"
  ADD COLUMN IF NOT EXISTS "recruiterOwnerId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'JobApplication_recruiterOwnerId_fkey'
  ) THEN
    ALTER TABLE "JobApplication"
      ADD CONSTRAINT "JobApplication_recruiterOwnerId_fkey"
      FOREIGN KEY ("recruiterOwnerId") REFERENCES "User"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "JobApplication_recruiterOwnerId_idx"
  ON "JobApplication"("recruiterOwnerId");
