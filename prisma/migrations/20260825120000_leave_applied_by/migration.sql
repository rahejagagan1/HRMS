-- Who actually FILED a leave application (differs from userId when HR
-- applies on behalf of the employee). NULL on legacy rows: filer unknown.
ALTER TABLE "LeaveApplication" ADD COLUMN "appliedById" INTEGER;
ALTER TABLE "LeaveApplication" ADD CONSTRAINT "LeaveApplication_appliedById_fkey"
  FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
