-- Free-text tags on each JobApplication. Postgres native TEXT[]
-- avoids a join table for what is fundamentally a small,
-- per-application list of labels.
--
-- Default to an empty array so existing rows stay valid + we don't
-- have to coalesce in every read. GIN index makes "find candidates
-- tagged X" fast once we add that filter to the candidates query.
ALTER TABLE "JobApplication"
  ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS "JobApplication_tags_idx"
  ON "JobApplication" USING GIN ("tags");
