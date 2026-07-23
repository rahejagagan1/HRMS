-- Align DB with schema: enum value + columns that existed on dev via drift (db push / manual).

-- AlterEnum (between hr_manager and member — matches schema.prisma)
ALTER TYPE "UserRole" ADD VALUE 'researcher_manager' AFTER 'hr_manager';

-- AlterTable
ALTER TABLE "FormulaTemplate" ADD COLUMN "assignedUserIds" JSONB;

-- AlterTable
ALTER TABLE "MonthlyReport" ADD COLUMN "hrMonthlyData" JSONB;
