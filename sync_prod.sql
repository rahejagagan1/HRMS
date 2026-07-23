-- CreateEnum
CREATE TYPE "ViolationSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "ViolationStatus" AS ENUM ('open', 'in_progress', 'closed');

-- AlterEnum
ALTER TYPE "OrgLevel" ADD VALUE 'hr_manager';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'lead';
ALTER TYPE "UserRole" ADD VALUE 'sub_lead';
ALTER TYPE "UserRole" ADD VALUE 'hr_manager';

-- CreateTable
CREATE TABLE "TeamManagerRating" (
    "id" SERIAL NOT NULL,
    "teamMemberId" INTEGER NOT NULL,
    "managerId" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "periodType" TEXT NOT NULL DEFAULT 'monthly',
    "ratingsJson" JSONB NOT NULL,
    "overallScore" DECIMAL(5,2),
    "comments" TEXT,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT true,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamManagerRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Violation" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "reportedBy" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "severity" "ViolationSeverity" NOT NULL DEFAULT 'medium',
    "status" "ViolationStatus" NOT NULL DEFAULT 'open',
    "category" TEXT,
    "actionTaken" TEXT,
    "notes" TEXT,
    "violationDate" TIMESTAMP(3),
    "responsiblePersonId" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Violation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamManagerRating_managerId_period_idx" ON "TeamManagerRating"("managerId", "period");

-- CreateIndex
CREATE INDEX "TeamManagerRating_teamMemberId_idx" ON "TeamManagerRating"("teamMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamManagerRating_teamMemberId_managerId_period_periodType_key" ON "TeamManagerRating"("teamMemberId", "managerId", "period", "periodType");

-- CreateIndex
CREATE INDEX "Violation_userId_idx" ON "Violation"("userId");

-- CreateIndex
CREATE INDEX "Violation_reportedBy_idx" ON "Violation"("reportedBy");

-- CreateIndex
CREATE INDEX "Violation_status_idx" ON "Violation"("status");

-- CreateIndex
CREATE INDEX "Violation_severity_idx" ON "Violation"("severity");

-- CreateIndex
CREATE INDEX "Violation_createdAt_idx" ON "Violation"("createdAt");

-- CreateIndex
CREATE INDEX "SyncLog_syncType_status_completedAt_idx" ON "SyncLog"("syncType", "status", "completedAt");

-- CreateIndex
CREATE INDEX "SyncLog_startedAt_idx" ON "SyncLog"("startedAt");

-- CreateIndex
CREATE INDEX "WeeklyReport_year_month_week_idx" ON "WeeklyReport"("year", "month", "week");

-- AddForeignKey
ALTER TABLE "TeamManagerRating" ADD CONSTRAINT "TeamManagerRating_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamManagerRating" ADD CONSTRAINT "TeamManagerRating_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyReport" ADD CONSTRAINT "MonthlyReport_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReportAccess" ADD CONSTRAINT "UserReportAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReportAccess" ADD CONSTRAINT "UserReportAccess_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_reportedBy_fkey" FOREIGN KEY ("reportedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_responsiblePersonId_fkey" FOREIGN KEY ("responsiblePersonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

