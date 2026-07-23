-- HR Hiring — publish workflow.
--
-- Adds status / publicSlug / publishedAt / vacancies to JobOpening so
-- the careers page (separate company site) can fetch only the jobs HR
-- has explicitly published, and so the dashboard has Draft / On-Hold
-- states instead of just Open / Closed.
--
-- Status transitions handled in code:
--   draft     → published    (sets publishedAt + publicSlug if null)
--   published → on_hold      (removes from careers page, keeps kanban)
--   published → closed       (final — role filled / cancelled)
--   on_hold   → published    (back live)
--   any       → draft        (un-publish back to working state)
--
-- isOpen stays in the table and is kept in sync with status by the
-- API layer (isOpen = true iff status = 'published'). Legacy code
-- paths that read isOpen continue to work.

-- 1. New columns ----------------------------------------------------
ALTER TABLE "JobOpening"
  ADD COLUMN IF NOT EXISTS "status"      TEXT      NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS "publicSlug"  TEXT,
  ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "vacancies"   INTEGER   NOT NULL DEFAULT 1;

-- 2. Backfill existing rows -----------------------------------------
--   isOpen=true   → published (was being treated as live anyway)
--   isOpen=false  → closed
-- Updates only rows still on the default 'draft' so re-running the
-- migration after a partial apply is safe.
UPDATE "JobOpening"
   SET "status" = CASE WHEN "isOpen" THEN 'published' ELSE 'closed' END,
       "publishedAt" = CASE WHEN "isOpen" THEN COALESCE("publishedAt", "createdAt") ELSE "publishedAt" END
 WHERE "status" = 'draft';

-- 3. Backfill slugs --------------------------------------------------
-- Generate a stable slug from the title for jobs that are now
-- published. Lowercased, non-alphanumerics → '-', collapsed runs of
-- '-', trimmed. We tack on the id to guarantee uniqueness even if two
-- titles slugify to the same string.
UPDATE "JobOpening"
   SET "publicSlug" = LOWER(
         REGEXP_REPLACE(
           REGEXP_REPLACE(
             REGEXP_REPLACE("title", '[^A-Za-z0-9]+', '-', 'g'),
             '-+', '-', 'g'),
           '^-|-$', '', 'g')
       ) || '-' || "id"
 WHERE "publicSlug" IS NULL
   AND "status" = 'published';

-- 4. Indexes + uniqueness -------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "JobOpening_publicSlug_key"  ON "JobOpening" ("publicSlug");
CREATE INDEX        IF NOT EXISTS "JobOpening_status_idx"      ON "JobOpening" ("status");
CREATE INDEX        IF NOT EXISTS "JobOpening_publishedAt_idx" ON "JobOpening" ("publishedAt");
