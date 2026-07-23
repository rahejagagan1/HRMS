-- The schema declares `@@unique([year, date])` on HolidayCalendar, but the
-- live DB shipped with a single-column unique index on `date` alone
-- (HolidayCalendar_date_key). That made every upsert from
-- /api/hr/admin/holidays fail with Postgres 42P10 ("no unique or
-- exclusion constraint matching the ON CONFLICT specification") because
-- Prisma's generated `year_date` ON CONFLICT clause had nothing to bind
-- to. Drop the single-column unique and create the composite one Prisma
-- expects.

-- The stale unique was a UNIQUE INDEX, not a CONSTRAINT, so it has to
-- be DROP INDEX (the constraint name shape is identical, which is why
-- this is easy to get wrong).
DROP INDEX IF EXISTS "HolidayCalendar_date_key";

CREATE UNIQUE INDEX IF NOT EXISTS "HolidayCalendar_year_date_key"
  ON "HolidayCalendar" ("year", "date");

-- The id autoincrement sequence had drifted to 1 while the table held
-- ids up to 25 (likely from a one-off data import that inserted rows
-- with explicit ids without bumping the sequence). Every subsequent
-- insert collided with an existing row and raised P2002. Resync to the
-- current MAX(id) so the next INSERT lands at MAX+1.
SELECT setval(
  '"HolidayCalendar_id_seq"',
  COALESCE((SELECT MAX(id) FROM "HolidayCalendar"), 1),
  true
);
