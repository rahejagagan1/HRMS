-- Add an explicit probation start date (nullable; for display/record alongside probationEndDate).
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "probationStartDate" date;
