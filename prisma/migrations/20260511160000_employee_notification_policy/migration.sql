-- Per-employee override for attendance + payroll email/processing.
-- Row absent => use role-based defaults (CEO + DEVELOPER_EMAILS → both off;
-- everyone else → both on). Row present => explicit override wins.

CREATE TABLE "EmployeeNotificationPolicy" (
    "id"                SERIAL          PRIMARY KEY,
    "userId"            INTEGER         NOT NULL,
    "attendanceEnabled" BOOLEAN         NOT NULL DEFAULT true,
    "payrollEnabled"    BOOLEAN         NOT NULL DEFAULT true,
    "updatedById"       INTEGER,
    "createdAt"         TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)    NOT NULL,
    CONSTRAINT "EmployeeNotificationPolicy_userId_fkey"      FOREIGN KEY ("userId")      REFERENCES "User"("id") ON DELETE CASCADE,
    CONSTRAINT "EmployeeNotificationPolicy_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "EmployeeNotificationPolicy_userId_key" ON "EmployeeNotificationPolicy"("userId");
CREATE        INDEX "EmployeeNotificationPolicy_userId_idx" ON "EmployeeNotificationPolicy"("userId");
