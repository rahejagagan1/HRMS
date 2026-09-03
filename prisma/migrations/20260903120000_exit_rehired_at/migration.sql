-- Interim rejoin marker on an exit row. The full rehire flow
-- (POST /api/hr/exits/:id/rehire) removes the exit row outright, but the
-- column is still read defensively by the attendance board, the attendance
-- log and payroll so a partially-converted row can never make an employed
-- person look like a leaver.
--
-- IF NOT EXISTS: the column was already added by hand on the live database
-- before this file existed, so deploy must be a no-op there.
ALTER TABLE "EmployeeExit" ADD COLUMN IF NOT EXISTS "rehiredAt" DATE;
