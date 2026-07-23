-- One Violation row used to carry a single Action-Taken attachment
-- inline (actionTakenFileBlob + Name + Mime). HR asked to attach
-- multiple PDFs per violation, so we normalise into a side table.
-- The legacy single-file columns on "Violation" stay nullable for one
-- transition release so an unmigrated row still works on read.

CREATE TABLE IF NOT EXISTS "ViolationActionFile" (
  "id"            SERIAL PRIMARY KEY,
  "violationId"   INT     NOT NULL REFERENCES "Violation"("id") ON DELETE CASCADE,
  "fileName"      TEXT    NOT NULL,
  "fileMime"      TEXT,
  "fileBlob"      BYTEA   NOT NULL,
  "uploadedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uploadedById"  INT REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "ViolationActionFile_violationId_idx"
  ON "ViolationActionFile" ("violationId");

-- Backfill: every Violation row that has a legacy inline file becomes a
-- single ViolationActionFile row. Only run once (NOT EXISTS guard so the
-- migration is idempotent if re-applied accidentally).
INSERT INTO "ViolationActionFile" ("violationId", "fileName", "fileMime", "fileBlob")
SELECT
  v."id",
  COALESCE(v."actionTakenFileName", 'attachment'),
  v."actionTakenFileMime",
  v."actionTakenFileBlob"
FROM "Violation" v
WHERE v."actionTakenFileBlob" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ViolationActionFile" f WHERE f."violationId" = v."id"
  );
