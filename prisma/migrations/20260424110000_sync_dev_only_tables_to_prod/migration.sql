-- Sync dev-only tables to prod.
-- Adds 15 tables that exist in nb_dashboard_dev but not in nb_dashboard
-- and that are NOT covered by their own dedicated pending migration:
--   AttendanceRegularization, CompOffRequest,
--   EngageComment, EngagePost, EngageReaction,
--   Expense, GoalCycle, KeyResult,
--   OnDutyRequest, Payslip, ResearcherPipelineSnapshot,
--   TeamManagerRating, TravelRequest, Violation, WFHRequest.
--
-- Excluded (handled by their own migrations):
--   Notification         -> 20260420120000_add_notifications
--   UserTabPermission    -> 20260424170000_user_tab_permissions
--   AuditLog             -> 20260428100000_audit_log
--
-- AttendanceRegularization is created here with its ORIGINAL column set;
-- the two-stage-approval columns are added by the immediately-following
-- 20260424120000_regularize_two_stage_approval migration.
--
-- This migration also does NOT touch any shared table and does NOT drop
-- the prod-only hiring/onboarding/payroll tables.

-- CreateEnum
CREATE TYPE "ViolationSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "ViolationStatus" AS ENUM ('open', 'in_progress', 'closed');

-- CreateTable
CREATE TABLE "AttendanceRegularization" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "requestedIn" TIMESTAMP(3),
    "requestedOut" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedById" INTEGER,
    "approvalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRegularization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompOffRequest" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "workedDate" DATE NOT NULL,
    "creditDays" DECIMAL(3,1) NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedById" INTEGER,
    "approvalNote" TEXT,
    "isUtilized" BOOLEAN NOT NULL DEFAULT false,
    "expiryDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompOffRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngageComment" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngageComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagePost" (
    "id" SERIAL NOT NULL,
    "authorId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'post',
    "content" TEXT NOT NULL,
    "praiseToId" INTEGER,
    "scope" TEXT NOT NULL DEFAULT 'org',
    "department" TEXT,
    "mediaUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagePost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngageReaction" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '👍',

    CONSTRAINT "EngageReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "expenseDate" DATE NOT NULL,
    "receiptUrl" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedById" INTEGER,
    "approvalNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalCycle" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "cycleType" TEXT NOT NULL DEFAULT 'quarterly',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyResult" (
    "id" SERIAL NOT NULL,
    "goalId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "targetValue" DECIMAL(10,2) NOT NULL DEFAULT 100,
    "currentValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT '%',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeyResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnDutyRequest" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "fromTime" TIMESTAMP(3),
    "toTime" TIMESTAMP(3),
    "purpose" TEXT NOT NULL,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedById" INTEGER,
    "approvalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnDutyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "payrollRunId" INTEGER NOT NULL,
    "salaryStructureId" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "workingDays" INTEGER NOT NULL DEFAULT 26,
    "presentDays" INTEGER NOT NULL DEFAULT 26,
    "lopDays" INTEGER NOT NULL DEFAULT 0,
    "grossEarnings" DECIMAL(12,2) NOT NULL,
    "totalDeductions" DECIMAL(12,2) NOT NULL,
    "netPay" DECIMAL(12,2) NOT NULL,
    "tds" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pfEmployee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "professionalTax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'generated',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearcherPipelineSnapshot" (
    "id" SERIAL NOT NULL,
    "month" DATE NOT NULL,
    "rtcCount" INTEGER NOT NULL DEFAULT 0,
    "foiaCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "rtcCaseRatingAvg" DECIMAL(5,2),
    "foiaCaseRatingAvg" DECIMAL(5,2),
    "foiaPitchedCount" INTEGER NOT NULL DEFAULT 0,
    "foiaPitchedCaseRatingAvg" DECIMAL(5,2),
    "caseRatingAvgCombined" DECIMAL(5,2),
    "rtcListName" TEXT,
    "foiaListName" TEXT,
    "foiaPitchedListName" TEXT,
    "snapshotData" JSONB,
    "syncError" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearcherPipelineSnapshot_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "TravelRequest" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "fromLocation" TEXT NOT NULL,
    "toLocation" TEXT NOT NULL,
    "travelDate" DATE NOT NULL,
    "returnDate" DATE,
    "estimatedCost" DECIMAL(10,2),
    "advanceNeeded" BOOLEAN NOT NULL DEFAULT false,
    "advanceAmount" DECIMAL(10,2),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedById" INTEGER,
    "approvalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelRequest_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "WFHRequest" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedById" INTEGER,
    "approvalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WFHRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceRegularization_date_idx" ON "AttendanceRegularization"("date");
CREATE INDEX "AttendanceRegularization_status_idx" ON "AttendanceRegularization"("status");
CREATE INDEX "AttendanceRegularization_userId_idx" ON "AttendanceRegularization"("userId");

-- CreateIndex
CREATE INDEX "CompOffRequest_status_idx" ON "CompOffRequest"("status");
CREATE INDEX "CompOffRequest_userId_idx" ON "CompOffRequest"("userId");

-- CreateIndex
CREATE INDEX "EngageComment_postId_idx" ON "EngageComment"("postId");

-- CreateIndex
CREATE INDEX "EngagePost_authorId_idx" ON "EngagePost"("authorId");
CREATE INDEX "EngagePost_createdAt_idx" ON "EngagePost"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EngageReaction_postId_userId_key" ON "EngageReaction"("postId", "userId");

-- CreateIndex
CREATE INDEX "Expense_expenseDate_idx" ON "Expense"("expenseDate");
CREATE INDEX "Expense_status_idx" ON "Expense"("status");
CREATE INDEX "Expense_userId_idx" ON "Expense"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GoalCycle_name_key" ON "GoalCycle"("name");

-- CreateIndex
CREATE INDEX "KeyResult_goalId_idx" ON "KeyResult"("goalId");

-- CreateIndex
CREATE INDEX "OnDutyRequest_date_idx" ON "OnDutyRequest"("date");
CREATE INDEX "OnDutyRequest_status_idx" ON "OnDutyRequest"("status");
CREATE INDEX "OnDutyRequest_userId_idx" ON "OnDutyRequest"("userId");

-- CreateIndex
CREATE INDEX "Payslip_payrollRunId_idx" ON "Payslip"("payrollRunId");
CREATE INDEX "Payslip_userId_idx" ON "Payslip"("userId");
CREATE UNIQUE INDEX "Payslip_userId_month_year_key" ON "Payslip"("userId", "month", "year");

-- CreateIndex
CREATE INDEX "ResearcherPipelineSnapshot_month_idx" ON "ResearcherPipelineSnapshot"("month");
CREATE UNIQUE INDEX "ResearcherPipelineSnapshot_month_key" ON "ResearcherPipelineSnapshot"("month");

-- CreateIndex
CREATE INDEX "TeamManagerRating_managerId_period_idx" ON "TeamManagerRating"("managerId", "period");
CREATE INDEX "TeamManagerRating_teamMemberId_idx" ON "TeamManagerRating"("teamMemberId");
CREATE UNIQUE INDEX "TeamManagerRating_teamMemberId_managerId_period_periodType_key" ON "TeamManagerRating"("teamMemberId", "managerId", "period", "periodType");

-- CreateIndex
CREATE INDEX "TravelRequest_status_idx" ON "TravelRequest"("status");
CREATE INDEX "TravelRequest_userId_idx" ON "TravelRequest"("userId");

-- CreateIndex
CREATE INDEX "Violation_createdAt_idx" ON "Violation"("createdAt");
CREATE INDEX "Violation_reportedBy_idx" ON "Violation"("reportedBy");
CREATE INDEX "Violation_severity_idx" ON "Violation"("severity");
CREATE INDEX "Violation_status_idx" ON "Violation"("status");
CREATE INDEX "Violation_userId_idx" ON "Violation"("userId");

-- CreateIndex
CREATE INDEX "WFHRequest_date_idx" ON "WFHRequest"("date");
CREATE INDEX "WFHRequest_status_idx" ON "WFHRequest"("status");
CREATE INDEX "WFHRequest_userId_idx" ON "WFHRequest"("userId");

-- AddForeignKey
ALTER TABLE "AttendanceRegularization" ADD CONSTRAINT "AttendanceRegularization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceRegularization" ADD CONSTRAINT "AttendanceRegularization_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompOffRequest" ADD CONSTRAINT "CompOffRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompOffRequest" ADD CONSTRAINT "CompOffRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngageComment" ADD CONSTRAINT "EngageComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "EngagePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EngageComment" ADD CONSTRAINT "EngageComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagePost" ADD CONSTRAINT "EngagePost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EngagePost" ADD CONSTRAINT "EngagePost_praiseToId_fkey" FOREIGN KEY ("praiseToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngageReaction" ADD CONSTRAINT "EngageReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "EngagePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EngageReaction" ADD CONSTRAINT "EngageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyResult" ADD CONSTRAINT "KeyResult_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnDutyRequest" ADD CONSTRAINT "OnDutyRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OnDutyRequest" ADD CONSTRAINT "OnDutyRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_salaryStructureId_fkey" FOREIGN KEY ("salaryStructureId") REFERENCES "SalaryStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamManagerRating" ADD CONSTRAINT "TeamManagerRating_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamManagerRating" ADD CONSTRAINT "TeamManagerRating_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelRequest" ADD CONSTRAINT "TravelRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TravelRequest" ADD CONSTRAINT "TravelRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_reportedBy_fkey" FOREIGN KEY ("reportedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_responsiblePersonId_fkey" FOREIGN KEY ("responsiblePersonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WFHRequest" ADD CONSTRAINT "WFHRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WFHRequest" ADD CONSTRAINT "WFHRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
