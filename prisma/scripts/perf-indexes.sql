-- Performance indexes — site-speed audit (perf/site-speed branch).
--
-- WHY A SCRIPT (not a migration): this DB is shared and prod-adjacent, so
-- `prisma migrate dev` / `db push` are unsafe here. Apply these additively:
--
--   npx prisma db execute --file prisma/scripts/perf-indexes.sql --schema prisma/schema.prisma
--
-- All statements are idempotent (IF NOT EXISTS) and use CONCURRENTLY so they
-- do NOT lock the tables while building — safe to run against a live DB.
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction block; run
-- this file as-is (prisma db execute runs statements without an outer BEGIN).
--
-- The two B-tree indexes are also declared in schema.prisma (@@index) so the
-- schema stays the source of truth once applied. The pg_trgm GIN indexes are
-- SQL-only (Prisma schema can't express GIN/trigram).

-- 1) User.isActive — pervasive `WHERE "isActive" = true` (org, managers,
--    employees, payroll, attendance, scores). Was a seq scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_isActive_idx"
  ON "User" ("isActive");

-- 2) MonthlyRating(roleType, overallRating) — leaderboard + dashboard/company
--    filter roleType and ORDER BY overallRating DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "MonthlyRating_roleType_overallRating_idx"
  ON "MonthlyRating" ("roleType", "overallRating");

-- 3) Trigram GIN indexes for leading-wildcard ILIKE searches (`name ILIKE
--    '%term%'`) which can't use a normal B-tree. Needs the pg_trgm extension.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Case.name — `cases` list search + global search.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Case_name_trgm_idx"
  ON "Case" USING gin ("name" gin_trgm_ops);

-- Subtask.name — contributor-stats + rating data-resolver `contains` scans
--    over a large table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Subtask_name_trgm_idx"
  ON "Subtask" USING gin ("name" gin_trgm_ops);
