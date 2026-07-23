-- Add 12 hiring/onboarding/payroll tables that exist in prod but not in dev.
-- These tables are NOT (yet) modelled in schema.prisma, so the Prisma client
-- can't read/write them via models — but raw SQL queries can.
--
-- Idempotent (IF NOT EXISTS) so this same file can be applied to prod via
-- `prisma migrate resolve --applied` without errors if you'd rather mark it
-- applied than execute. Running it on prod would no-op since prod already
-- has all of these.

-- Tables (created in FK-dependency order so AddForeignKey at the bottom works)
CREATE TABLE IF NOT EXISTS "JobPosting" (
    "id"             SERIAL NOT NULL,
    "title"          TEXT NOT NULL,
    "department"     TEXT,
    "location"       TEXT,
    "employmentType" TEXT NOT NULL DEFAULT 'fulltime',
    "description"    TEXT NOT NULL,
    "requirements"   TEXT,
    "salaryMin"      DECIMAL(10,2),
    "salaryMax"      DECIMAL(10,2),
    "openings"       INTEGER NOT NULL DEFAULT 1,
    "status"         TEXT NOT NULL DEFAULT 'open',
    "createdById"    INTEGER NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobPosting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OnboardingTemplate" (
    "id"        SERIAL NOT NULL,
    "name"      TEXT NOT NULL,
    "roleType"  TEXT,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnboardingTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HiringStage" (
    "id"    SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "name"  TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "HiringStage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Candidate" (
    "id"             SERIAL NOT NULL,
    "jobId"          INTEGER NOT NULL,
    "name"           TEXT NOT NULL,
    "email"          TEXT NOT NULL,
    "phone"          TEXT,
    "resumeUrl"      TEXT,
    "source"         TEXT NOT NULL DEFAULT 'direct',
    "currentStageId" INTEGER,
    "status"         TEXT NOT NULL DEFAULT 'active',
    "notes"          TEXT,
    "appliedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CandidateStage" (
    "id"          SERIAL NOT NULL,
    "candidateId" INTEGER NOT NULL,
    "stageId"     INTEGER NOT NULL,
    "movedById"   INTEGER NOT NULL,
    "notes"       TEXT,
    "movedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CandidateStage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OnboardingTask" (
    "id"          SERIAL NOT NULL,
    "templateId"  INTEGER NOT NULL,
    "title"       TEXT NOT NULL,
    "description" TEXT,
    "dueDay"      INTEGER NOT NULL DEFAULT 1,
    "assignedTo"  TEXT NOT NULL DEFAULT 'employee',
    "order"       INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OnboardingTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EmployeeOnboarding" (
    "id"                SERIAL NOT NULL,
    "userId"            INTEGER NOT NULL,
    "templateId"        INTEGER NOT NULL,
    "startDate"         DATE NOT NULL,
    "completionPercent" INTEGER NOT NULL DEFAULT 0,
    "status"            TEXT NOT NULL DEFAULT 'in_progress',
    CONSTRAINT "EmployeeOnboarding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EmployeeOnboardingTask" (
    "id"           SERIAL NOT NULL,
    "onboardingId" INTEGER NOT NULL,
    "taskId"       INTEGER NOT NULL,
    "status"       TEXT NOT NULL DEFAULT 'pending',
    "completedAt"  TIMESTAMP(3),
    "notes"        TEXT,
    CONSTRAINT "EmployeeOnboardingTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ExitRequest" (
    "id"                 SERIAL NOT NULL,
    "userId"             INTEGER NOT NULL,
    "resignationDate"    DATE NOT NULL,
    "lastWorkingDate"    DATE NOT NULL,
    "reason"             TEXT,
    "type"               TEXT NOT NULL DEFAULT 'voluntary',
    "status"             TEXT NOT NULL DEFAULT 'pending',
    "approvedById"       INTEGER,
    "approvalNote"       TEXT,
    "exitInterviewNotes" TEXT,
    "checklistJson"      JSONB,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExitRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GoalProgressLog" (
    "id"            SERIAL NOT NULL,
    "goalId"        INTEGER NOT NULL,
    "userId"        INTEGER NOT NULL,
    "previousValue" DECIMAL(10,2) NOT NULL,
    "newValue"      DECIMAL(10,2) NOT NULL,
    "notes"         TEXT,
    "loggedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoalProgressLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Interview" (
    "id"            SERIAL NOT NULL,
    "candidateId"   INTEGER NOT NULL,
    "interviewerId" INTEGER NOT NULL,
    "scheduledAt"   TIMESTAMP(3) NOT NULL,
    "type"          TEXT NOT NULL DEFAULT 'video',
    "result"        TEXT,
    "feedback"      TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PayrollEntry" (
    "id"               SERIAL NOT NULL,
    "payrollRunId"     INTEGER NOT NULL,
    "userId"           INTEGER NOT NULL,
    "payableDays"      INTEGER NOT NULL,
    "totalWorkingDays" INTEGER NOT NULL,
    "basicPay"         DECIMAL(10,2) NOT NULL,
    "hra"              DECIMAL(10,2) NOT NULL DEFAULT 0,
    "specialAllowance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "otherAllowances"  DECIMAL(10,2) NOT NULL DEFAULT 0,
    "overtimePay"      DECIMAL(10,2) NOT NULL DEFAULT 0,
    "bonusAmount"      DECIMAL(10,2) NOT NULL DEFAULT 0,
    "grossPay"         DECIMAL(10,2) NOT NULL,
    "pfDeduction"      DECIMAL(10,2) NOT NULL DEFAULT 0,
    "esiDeduction"     DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ptDeduction"      DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tdsDeduction"     DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lopAmount"        DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netPay"           DECIMAL(10,2) NOT NULL,
    CONSTRAINT "PayrollEntry_pkey" PRIMARY KEY ("id")
);

-- Indexes (only those for the 12 new tables)
CREATE INDEX IF NOT EXISTS "Candidate_jobId_idx"                          ON "Candidate"("jobId");
CREATE INDEX IF NOT EXISTS "Candidate_status_idx"                         ON "Candidate"("status");
CREATE INDEX IF NOT EXISTS "CandidateStage_candidateId_idx"               ON "CandidateStage"("candidateId");
CREATE INDEX IF NOT EXISTS "EmployeeOnboarding_userId_idx"                ON "EmployeeOnboarding"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeOnboarding_userId_templateId_key"  ON "EmployeeOnboarding"("userId", "templateId");
CREATE INDEX IF NOT EXISTS "EmployeeOnboardingTask_onboardingId_idx"      ON "EmployeeOnboardingTask"("onboardingId");
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeOnboardingTask_onboardingId_taskId_key" ON "EmployeeOnboardingTask"("onboardingId", "taskId");
CREATE INDEX IF NOT EXISTS "ExitRequest_status_idx"                       ON "ExitRequest"("status");
CREATE INDEX IF NOT EXISTS "ExitRequest_userId_idx"                       ON "ExitRequest"("userId");
CREATE INDEX IF NOT EXISTS "GoalProgressLog_goalId_idx"                   ON "GoalProgressLog"("goalId");
CREATE INDEX IF NOT EXISTS "HiringStage_jobId_idx"                        ON "HiringStage"("jobId");
CREATE INDEX IF NOT EXISTS "Interview_candidateId_idx"                    ON "Interview"("candidateId");
CREATE INDEX IF NOT EXISTS "JobPosting_status_idx"                        ON "JobPosting"("status");
CREATE INDEX IF NOT EXISTS "OnboardingTask_templateId_idx"                ON "OnboardingTask"("templateId");
CREATE UNIQUE INDEX IF NOT EXISTS "OnboardingTemplate_name_key"           ON "OnboardingTemplate"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollEntry_payrollRunId_userId_key"  ON "PayrollEntry"("payrollRunId", "userId");
CREATE INDEX IF NOT EXISTS "PayrollEntry_userId_idx"                      ON "PayrollEntry"("userId");

-- Foreign keys (only those originating from the 12 new tables; FKs touching
-- shared tables like Goal/LeaveApplication/PayrollRun are deliberately
-- omitted so this migration doesn't conflict with dev's existing schema).
-- Wrapped in DO blocks so re-running on a DB that already has the constraint
-- (e.g. prod) doesn't fail.
DO $$ BEGIN
    ALTER TABLE "JobPosting"             ADD CONSTRAINT "JobPosting_createdById_fkey"             FOREIGN KEY ("createdById")    REFERENCES "User"("id")               ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "HiringStage"            ADD CONSTRAINT "HiringStage_jobId_fkey"                  FOREIGN KEY ("jobId")          REFERENCES "JobPosting"("id")         ON DELETE CASCADE  ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "Candidate"              ADD CONSTRAINT "Candidate_jobId_fkey"                    FOREIGN KEY ("jobId")          REFERENCES "JobPosting"("id")         ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "Candidate"              ADD CONSTRAINT "Candidate_currentStageId_fkey"           FOREIGN KEY ("currentStageId") REFERENCES "HiringStage"("id")        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "CandidateStage"         ADD CONSTRAINT "CandidateStage_candidateId_fkey"         FOREIGN KEY ("candidateId")    REFERENCES "Candidate"("id")          ON DELETE CASCADE  ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "CandidateStage"         ADD CONSTRAINT "CandidateStage_stageId_fkey"             FOREIGN KEY ("stageId")        REFERENCES "HiringStage"("id")        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "CandidateStage"         ADD CONSTRAINT "CandidateStage_movedById_fkey"           FOREIGN KEY ("movedById")      REFERENCES "User"("id")               ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "OnboardingTask"         ADD CONSTRAINT "OnboardingTask_templateId_fkey"          FOREIGN KEY ("templateId")     REFERENCES "OnboardingTemplate"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "EmployeeOnboarding"     ADD CONSTRAINT "EmployeeOnboarding_userId_fkey"          FOREIGN KEY ("userId")         REFERENCES "User"("id")               ON DELETE CASCADE  ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "EmployeeOnboarding"     ADD CONSTRAINT "EmployeeOnboarding_templateId_fkey"      FOREIGN KEY ("templateId")     REFERENCES "OnboardingTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "EmployeeOnboardingTask" ADD CONSTRAINT "EmployeeOnboardingTask_onboardingId_fkey" FOREIGN KEY ("onboardingId")   REFERENCES "EmployeeOnboarding"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "EmployeeOnboardingTask" ADD CONSTRAINT "EmployeeOnboardingTask_taskId_fkey"      FOREIGN KEY ("taskId")         REFERENCES "OnboardingTask"("id")     ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "ExitRequest"            ADD CONSTRAINT "ExitRequest_userId_fkey"                 FOREIGN KEY ("userId")         REFERENCES "User"("id")               ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "ExitRequest"            ADD CONSTRAINT "ExitRequest_approvedById_fkey"           FOREIGN KEY ("approvedById")   REFERENCES "User"("id")               ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "GoalProgressLog"        ADD CONSTRAINT "GoalProgressLog_goalId_fkey"             FOREIGN KEY ("goalId")         REFERENCES "Goal"("id")               ON DELETE CASCADE  ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "GoalProgressLog"        ADD CONSTRAINT "GoalProgressLog_userId_fkey"             FOREIGN KEY ("userId")         REFERENCES "User"("id")               ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "Interview"              ADD CONSTRAINT "Interview_candidateId_fkey"              FOREIGN KEY ("candidateId")    REFERENCES "Candidate"("id")          ON DELETE CASCADE  ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "Interview"              ADD CONSTRAINT "Interview_interviewerId_fkey"            FOREIGN KEY ("interviewerId")  REFERENCES "User"("id")               ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "PayrollEntry"           ADD CONSTRAINT "PayrollEntry_payrollRunId_fkey"          FOREIGN KEY ("payrollRunId")   REFERENCES "PayrollRun"("id")         ON DELETE CASCADE  ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "PayrollEntry"           ADD CONSTRAINT "PayrollEntry_userId_fkey"                FOREIGN KEY ("userId")         REFERENCES "User"("id")               ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
