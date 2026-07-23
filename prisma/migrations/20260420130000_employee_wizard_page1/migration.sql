-- Employee Wizard Page 1: split name, work country, nationality, and a number-series
-- table that allocates employee IDs atomically via UPDATE … increment … RETURNING.

-- 1. Series table
CREATE TABLE "EmployeeNumberSeries" (
    "id"         SERIAL NOT NULL,
    "name"       TEXT NOT NULL,
    "prefix"     TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "isActive"   BOOLEAN NOT NULL DEFAULT true,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeNumberSeries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmployeeNumberSeries_name_key" ON "EmployeeNumberSeries"("name");

-- 2. Seed the one series you asked for.
INSERT INTO "EmployeeNumberSeries" ("name", "prefix", "nextNumber")
VALUES ('NB Media Series', 'HRM', 1);

-- 3. New EmployeeProfile columns — added nullable so existing rows can be backfilled
ALTER TABLE "EmployeeProfile" ADD COLUMN "firstName"      TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "middleName"     TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "lastName"       TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "workCountry"    TEXT NOT NULL DEFAULT 'India';
ALTER TABLE "EmployeeProfile" ADD COLUMN "nationality"    TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "numberSeriesId" INTEGER;

-- 4. Backfill firstName / lastName from User.name (first word + rest); default
--    nationality = 'Indian' and numberSeriesId = the seeded NB Media series.
UPDATE "EmployeeProfile" ep
SET "firstName" = split_part(u.name, ' ', 1),
    "lastName"  = CASE
                    WHEN position(' ' IN u.name) > 0 THEN substr(u.name, position(' ' IN u.name) + 1)
                    ELSE u.name
                  END,
    "nationality" = 'Indian',
    "numberSeriesId" = (SELECT id FROM "EmployeeNumberSeries" WHERE name = 'NB Media Series')
FROM "User" u
WHERE ep."userId" = u.id;

-- 5. Enforce NOT NULL now that every row has a value
ALTER TABLE "EmployeeProfile" ALTER COLUMN "firstName"      SET NOT NULL;
ALTER TABLE "EmployeeProfile" ALTER COLUMN "lastName"       SET NOT NULL;
ALTER TABLE "EmployeeProfile" ALTER COLUMN "nationality"    SET NOT NULL;
ALTER TABLE "EmployeeProfile" ALTER COLUMN "numberSeriesId" SET NOT NULL;

-- 6. FK + index
ALTER TABLE "EmployeeProfile"
    ADD CONSTRAINT "EmployeeProfile_numberSeriesId_fkey"
    FOREIGN KEY ("numberSeriesId") REFERENCES "EmployeeNumberSeries"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "EmployeeProfile_numberSeriesId_idx" ON "EmployeeProfile"("numberSeriesId");
