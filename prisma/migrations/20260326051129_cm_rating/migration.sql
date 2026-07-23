-- CreateEnum
CREATE TYPE "ViolationSeverity" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "ViolationStatus" AS ENUM ('open', 'in_progress', 'closed');

-- AlterTable: User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "monthlyDeliveryTargetCases" INTEGER;

-- AlterTable: FormulaTemplate
ALTER TABLE "FormulaTemplate" ADD COLUMN IF NOT EXISTS "roundOff" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: YoutubeStats
ALTER TABLE "YoutubeStats" ADD COLUMN IF NOT EXISTS "ctr" DECIMAL(5,2);

-- CreateTable: TeamManagerRating
CREATE TABLE IF NOT EXISTS "TeamManagerRating" (
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

-- CreateTable: Violation
CREATE TABLE IF NOT EXISTS "Violation" (
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

-- CreateIndex: TeamManagerRating
CREATE UNIQUE INDEX IF NOT EXISTS "TeamManagerRating_teamMemberId_managerId_period_periodType_key" ON "TeamManagerRating"("teamMemberId", "managerId", "period", "periodType");
CREATE INDEX IF NOT EXISTS "TeamManagerRating_managerId_period_idx" ON "TeamManagerRating"("managerId", "period");
CREATE INDEX IF NOT EXISTS "TeamManagerRating_teamMemberId_idx" ON "TeamManagerRating"("teamMemberId");

-- CreateIndex: Violation
CREATE INDEX IF NOT EXISTS "Violation_userId_idx" ON "Violation"("userId");
CREATE INDEX IF NOT EXISTS "Violation_reportedBy_idx" ON "Violation"("reportedBy");
CREATE INDEX IF NOT EXISTS "Violation_status_idx" ON "Violation"("status");
CREATE INDEX IF NOT EXISTS "Violation_severity_idx" ON "Violation"("severity");
CREATE INDEX IF NOT EXISTS "Violation_createdAt_idx" ON "Violation"("createdAt");

-- AddForeignKey: TeamManagerRating
ALTER TABLE "TeamManagerRating" ADD CONSTRAINT "TeamManagerRating_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamManagerRating" ADD CONSTRAINT "TeamManagerRating_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Violation
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_reportedBy_fkey" FOREIGN KEY ("reportedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_responsiblePersonId_fkey" FOREIGN KEY ("responsiblePersonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
