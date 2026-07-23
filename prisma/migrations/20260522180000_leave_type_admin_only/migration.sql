-- Restricted-admin leave types — adds LeaveType.adminOnly.
--
-- When true, the leave type IS applyable but only by CEO / HR Manager /
-- isDeveloper users. The server returns 403 to anyone else attempting
-- to POST /api/hr/leaves with that leaveTypeId, and the apply-form
-- dropdown filters them out for non-admin viewers.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS so a re-run is harmless even on
-- a partially-applied DB.

ALTER TABLE "LeaveType"
  ADD COLUMN IF NOT EXISTS "adminOnly" BOOLEAN NOT NULL DEFAULT FALSE;

-- Flip the canonical "Carry Over Leave" row to applicable + adminOnly
-- so HR can draw down carried-over days from the on-behalf flow
-- without surfacing it to regular employees. We match on the name
-- because the row's id is not guaranteed across environments. Safe
-- no-op if the row doesn't exist yet (UPDATE … WHERE matches 0 rows).
UPDATE "LeaveType"
   SET "applicable" = TRUE,
       "adminOnly"  = TRUE
 WHERE LOWER(name) IN ('carry over leave', 'carryover leave', 'carry-over leave');
