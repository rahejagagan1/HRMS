-- Archive metadata on each JobApplication. When HR archives a
-- candidate, we capture WHY (so reports can show "lost to: budget",
-- "lost to: position filled", etc.) plus a freeform note.
--
-- Keep the move-to-rejected-stage logic untouched — these columns
-- are additive. archivedAt is also denormalized from the activity
-- log so the candidates list can filter / sort on it cheaply.

ALTER TABLE "JobApplication"
  ADD COLUMN IF NOT EXISTS "archiveReason" TEXT,
  ADD COLUMN IF NOT EXISTS "archiveNote"   TEXT,
  ADD COLUMN IF NOT EXISTS "archivedAt"    TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "JobApplication_archiveReason_idx"
  ON "JobApplication"("archiveReason");
CREATE INDEX IF NOT EXISTS "JobApplication_archivedAt_idx"
  ON "JobApplication"("archivedAt");
