-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'manager', 'lead', 'sub_lead', 'writer', 'editor', 'qa', 'researcher', 'gc', 'vo_artist', 'publisher', 'production_manager', 'member');

-- CreateEnum
CREATE TYPE "OrgLevel" AS ENUM ('ceo', 'special_access', 'hod', 'manager', 'lead', 'sub_lead', 'production_team', 'member');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "clickupUserId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'member',
    "orgLevel" "OrgLevel" NOT NULL DEFAULT 'member',
    "managerId" INTEGER,
    "teamCapsule" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "reportAccess" BOOLEAN NOT NULL DEFAULT false,
    "profilePictureUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Space" (
    "id" SERIAL NOT NULL,
    "clickupSpaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSynced" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Capsule" (
    "id" SERIAL NOT NULL,
    "clickupFolderId" TEXT NOT NULL,
    "spaceId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Capsule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionList" (
    "id" SERIAL NOT NULL,
    "clickupListId" TEXT NOT NULL,
    "capsuleId" INTEGER,
    "spaceId" INTEGER,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" SERIAL NOT NULL,
    "clickupTaskId" TEXT NOT NULL,
    "productionListId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusType" TEXT,
    "clickupUrl" TEXT,
    "assigneeUserId" INTEGER,
    "researcherUserId" INTEGER,
    "writerUserId" INTEGER,
    "editorUserId" INTEGER,
    "caseRating" DECIMAL(3,1),
    "caseType" TEXT,
    "channel" TEXT,
    "tthDocLink" TEXT,
    "title" TEXT,
    "scriptFirstDraftLink" TEXT,
    "finalScriptLink" TEXT,
    "voDocLink" TEXT,
    "voLink" TEXT,
    "videoFirstDraftLink" TEXT,
    "finalVideoLink" TEXT,
    "scriptQaStartDate" TIMESTAMP(3),
    "writerQualityScore" INTEGER,
    "writerDeliveryTime" TEXT,
    "writerEfficiencyScore" TEXT,
    "finalWriterRating" DECIMAL(5,2),
    "scriptQualityRating" DECIMAL(4,2),
    "scriptRatingReason" TEXT,
    "videoGcStartDate" TIMESTAMP(3),
    "videoChangesCount" INTEGER,
    "qaVideoMeetingDate" TIMESTAMP(3),
    "editorQualityScore" INTEGER,
    "editorDeliveryTime" TEXT,
    "editorEfficiencyScore" TEXT,
    "finalVideoRating" DECIMAL(5,2),
    "videoQualityRating" DECIMAL(4,2),
    "videoRatingReason" TEXT,
    "helperEditorE" INTEGER,
    "helperEditorT" INTEGER,
    "helperWriterE" INTEGER,
    "helperWriterT" INTEGER,
    "uploadDate" TIMESTAMP(3),
    "caseStartDate" TIMESTAMP(3),
    "caseCompletionDate" TIMESTAMP(3),
    "overallTat" DECIMAL(5,1),
    "tat" DECIMAL(5,1),
    "youtubeVideoUrl" TEXT,
    "dateCreated" TIMESTAMP(3),
    "dateDone" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseAssignee" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "clickupUserId" BIGINT NOT NULL,

    CONSTRAINT "CaseAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subtask" (
    "id" SERIAL NOT NULL,
    "clickupTaskId" TEXT NOT NULL,
    "caseId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusType" TEXT,
    "assigneeUserId" INTEGER,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "dateDone" TIMESTAMP(3),
    "orderIndex" INTEGER,
    "tat" DECIMAL(5,2),
    "customFieldsJson" JSONB,
    "dateCreated" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subtask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YoutubeStats" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "videoTitle" TEXT,
    "viewCount" BIGINT,
    "likeCount" BIGINT,
    "commentCount" BIGINT,
    "last30DaysViews" BIGINT,
    "publishedAt" TIMESTAMP(3),
    "lastFetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YoutubeStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YoutubeStatsHistory" (
    "id" SERIAL NOT NULL,
    "youtubeStatsId" INTEGER NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "viewCount" BIGINT NOT NULL,
    "likeCount" BIGINT,

    CONSTRAINT "YoutubeStatsHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyRating" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "month" DATE NOT NULL,
    "roleType" TEXT NOT NULL,
    "casesCompleted" INTEGER NOT NULL DEFAULT 0,
    "avgQualityScore" DECIMAL(5,2),
    "avgDeliveryScore" DECIMAL(5,2),
    "avgEfficiencyScore" DECIMAL(5,2),
    "totalViews" BIGINT,
    "overallRating" DECIMAL(5,2),
    "rankInRole" INTEGER,
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "writerQualityStars" DECIMAL(3,1),
    "scriptQualityStars" DECIMAL(3,1),
    "ownershipStars" DECIMAL(3,1),
    "monthlyTargetsStars" DECIMAL(3,1),
    "ytViewsStars" DECIMAL(3,1),
    "parametersJson" JSONB,
    "manualRatingsPending" BOOLEAN NOT NULL DEFAULT true,
    "formulaTemplateId" INTEGER,
    "formulaVersion" INTEGER,

    CONSTRAINT "MonthlyRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" SERIAL NOT NULL,
    "syncType" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "recordsSynced" INTEGER,
    "errorsCount" INTEGER DEFAULT 0,
    "errorDetails" JSONB,
    "status" TEXT NOT NULL DEFAULT 'running',

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncConfig" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YtVideoLookup" (
    "id" SERIAL NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "viewCount" BIGINT NOT NULL,
    "likeCount" BIGINT,
    "commentCount" BIGINT,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YtVideoLookup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScorecardConfig" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "roleType" TEXT NOT NULL,
    "layoutType" TEXT NOT NULL,
    "metricsConfig" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScorecardConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreEditLog" (
    "id" SERIAL NOT NULL,
    "monthlyRatingId" INTEGER NOT NULL,
    "fieldName" TEXT NOT NULL,
    "oldValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "editedBy" INTEGER NOT NULL,
    "reason" TEXT,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreEditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagerRating" (
    "id" SERIAL NOT NULL,
    "managerId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "ratingsJson" JSONB NOT NULL,
    "overallScore" DECIMAL(5,2),
    "comments" TEXT,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagerRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatingConfig" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RatingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyReport" (
    "id" SERIAL NOT NULL,
    "managerId" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "writerRows" JSONB,
    "editorRows" JSONB,
    "researcherRows" JSONB,
    "overviewRows" JSONB,
    "viewsRows" JSONB,
    "dataJson" JSONB,
    "isLocked" BOOLEAN NOT NULL DEFAULT true,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyReport" (
    "id" SERIAL NOT NULL,
    "managerId" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reportingPeriod" TEXT,
    "executiveSummary" TEXT,
    "totalVideoTarget" TEXT,
    "totalVideoActual" TEXT,
    "totalVideoVariance" TEXT,
    "heroContentTarget" TEXT,
    "heroContentActual" TEXT,
    "heroContentVariance" TEXT,
    "editorNotes" JSONB,
    "writerNotes" JSONB,
    "shortfallSummary" TEXT,
    "teamRecognition" TEXT,
    "keyLearning1" TEXT,
    "keyLearning2" TEXT,
    "keyLearning3" TEXT,
    "risksAttention" TEXT,
    "behavioralConcerns" TEXT,
    "remark" TEXT,
    "nishantResearcherRows" JSONB,
    "nishantOverview" JSONB,
    "andrewA1Rows" JSONB,
    "andrewA2Rows" JSONB,
    "andrewBRows" JSONB,
    "andrewCRows" JSONB,
    "andrewDRows" JSONB,

    CONSTRAINT "MonthlyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserReportAccess" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "managerId" INTEGER NOT NULL,

    CONSTRAINT "UserReportAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelBaseline" (
    "id" SERIAL NOT NULL,
    "channelName" TEXT NOT NULL,
    "baselineViews" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormulaTemplate" (
    "id" SERIAL NOT NULL,
    "roleType" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "sections" JSONB NOT NULL,
    "guardrails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormulaTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clickupUserId_key" ON "User"("clickupUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_managerId_idx" ON "User"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "Space_clickupSpaceId_key" ON "Space"("clickupSpaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Capsule_clickupFolderId_key" ON "Capsule"("clickupFolderId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionList_clickupListId_key" ON "ProductionList"("clickupListId");

-- CreateIndex
CREATE UNIQUE INDEX "Case_clickupTaskId_key" ON "Case"("clickupTaskId");

-- CreateIndex
CREATE INDEX "Case_status_idx" ON "Case"("status");

-- CreateIndex
CREATE INDEX "Case_statusType_idx" ON "Case"("statusType");

-- CreateIndex
CREATE INDEX "Case_channel_idx" ON "Case"("channel");

-- CreateIndex
CREATE INDEX "Case_writerUserId_idx" ON "Case"("writerUserId");

-- CreateIndex
CREATE INDEX "Case_editorUserId_idx" ON "Case"("editorUserId");

-- CreateIndex
CREATE INDEX "Case_assigneeUserId_idx" ON "Case"("assigneeUserId");

-- CreateIndex
CREATE INDEX "Case_researcherUserId_idx" ON "Case"("researcherUserId");

-- CreateIndex
CREATE INDEX "Case_productionListId_idx" ON "Case"("productionListId");

-- CreateIndex
CREATE INDEX "Case_dateCreated_idx" ON "Case"("dateCreated");

-- CreateIndex
CREATE INDEX "CaseAssignee_caseId_idx" ON "CaseAssignee"("caseId");

-- CreateIndex
CREATE INDEX "CaseAssignee_userId_idx" ON "CaseAssignee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseAssignee_caseId_userId_key" ON "CaseAssignee"("caseId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subtask_clickupTaskId_key" ON "Subtask"("clickupTaskId");

-- CreateIndex
CREATE INDEX "Subtask_caseId_idx" ON "Subtask"("caseId");

-- CreateIndex
CREATE INDEX "Subtask_assigneeUserId_idx" ON "Subtask"("assigneeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "YoutubeStats_caseId_key" ON "YoutubeStats"("caseId");

-- CreateIndex
CREATE INDEX "YoutubeStats_youtubeVideoId_idx" ON "YoutubeStats"("youtubeVideoId");

-- CreateIndex
CREATE UNIQUE INDEX "YoutubeStatsHistory_youtubeStatsId_snapshotDate_key" ON "YoutubeStatsHistory"("youtubeStatsId", "snapshotDate");

-- CreateIndex
CREATE INDEX "MonthlyRating_month_idx" ON "MonthlyRating"("month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyRating_userId_month_roleType_key" ON "MonthlyRating"("userId", "month", "roleType");

-- CreateIndex
CREATE INDEX "SyncLog_syncType_status_completedAt_idx" ON "SyncLog"("syncType", "status", "completedAt");

-- CreateIndex
CREATE INDEX "SyncLog_startedAt_idx" ON "SyncLog"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncConfig_key_key" ON "SyncConfig"("key");

-- CreateIndex
CREATE UNIQUE INDEX "YtVideoLookup_youtubeVideoId_key" ON "YtVideoLookup"("youtubeVideoId");

-- CreateIndex
CREATE INDEX "ScorecardConfig_roleType_idx" ON "ScorecardConfig"("roleType");

-- CreateIndex
CREATE UNIQUE INDEX "ScorecardConfig_userId_roleType_key" ON "ScorecardConfig"("userId", "roleType");

-- CreateIndex
CREATE INDEX "ScoreEditLog_monthlyRatingId_idx" ON "ScoreEditLog"("monthlyRatingId");

-- CreateIndex
CREATE INDEX "ScoreEditLog_editedBy_idx" ON "ScoreEditLog"("editedBy");

-- CreateIndex
CREATE INDEX "ManagerRating_userId_idx" ON "ManagerRating"("userId");

-- CreateIndex
CREATE INDEX "ManagerRating_managerId_idx" ON "ManagerRating"("managerId");

-- CreateIndex
CREATE INDEX "ManagerRating_period_idx" ON "ManagerRating"("period");

-- CreateIndex
CREATE UNIQUE INDEX "ManagerRating_managerId_userId_period_periodType_key" ON "ManagerRating"("managerId", "userId", "period", "periodType");

-- CreateIndex
CREATE UNIQUE INDEX "RatingConfig_key_key" ON "RatingConfig"("key");

-- CreateIndex
CREATE INDEX "WeeklyReport_managerId_idx" ON "WeeklyReport"("managerId");

-- CreateIndex
CREATE INDEX "WeeklyReport_year_month_week_idx" ON "WeeklyReport"("year", "month", "week");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyReport_managerId_week_month_year_key" ON "WeeklyReport"("managerId", "week", "month", "year");

-- CreateIndex
CREATE INDEX "MonthlyReport_managerId_idx" ON "MonthlyReport"("managerId");

-- CreateIndex
CREATE INDEX "MonthlyReport_year_month_idx" ON "MonthlyReport"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyReport_managerId_month_year_key" ON "MonthlyReport"("managerId", "month", "year");

-- CreateIndex
CREATE INDEX "UserReportAccess_userId_idx" ON "UserReportAccess"("userId");

-- CreateIndex
CREATE INDEX "UserReportAccess_managerId_idx" ON "UserReportAccess"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "UserReportAccess_userId_managerId_key" ON "UserReportAccess"("userId", "managerId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelBaseline_channelName_key" ON "ChannelBaseline"("channelName");

-- CreateIndex
CREATE INDEX "FormulaTemplate_roleType_idx" ON "FormulaTemplate"("roleType");

-- CreateIndex
CREATE INDEX "FormulaTemplate_isActive_idx" ON "FormulaTemplate"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FormulaTemplate_roleType_version_key" ON "FormulaTemplate"("roleType", "version");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capsule" ADD CONSTRAINT "Capsule_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionList" ADD CONSTRAINT "ProductionList_capsuleId_fkey" FOREIGN KEY ("capsuleId") REFERENCES "Capsule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_productionListId_fkey" FOREIGN KEY ("productionListId") REFERENCES "ProductionList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_researcherUserId_fkey" FOREIGN KEY ("researcherUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_writerUserId_fkey" FOREIGN KEY ("writerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_editorUserId_fkey" FOREIGN KEY ("editorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAssignee" ADD CONSTRAINT "CaseAssignee_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAssignee" ADD CONSTRAINT "CaseAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subtask" ADD CONSTRAINT "Subtask_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subtask" ADD CONSTRAINT "Subtask_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YoutubeStats" ADD CONSTRAINT "YoutubeStats_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YoutubeStatsHistory" ADD CONSTRAINT "YoutubeStatsHistory_youtubeStatsId_fkey" FOREIGN KEY ("youtubeStatsId") REFERENCES "YoutubeStats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyRating" ADD CONSTRAINT "MonthlyRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyRating" ADD CONSTRAINT "MonthlyRating_formulaTemplateId_fkey" FOREIGN KEY ("formulaTemplateId") REFERENCES "FormulaTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardConfig" ADD CONSTRAINT "ScorecardConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEditLog" ADD CONSTRAINT "ScoreEditLog_monthlyRatingId_fkey" FOREIGN KEY ("monthlyRatingId") REFERENCES "MonthlyRating"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEditLog" ADD CONSTRAINT "ScoreEditLog_editedBy_fkey" FOREIGN KEY ("editedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerRating" ADD CONSTRAINT "ManagerRating_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerRating" ADD CONSTRAINT "ManagerRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyReport" ADD CONSTRAINT "MonthlyReport_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReportAccess" ADD CONSTRAINT "UserReportAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReportAccess" ADD CONSTRAINT "UserReportAccess_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

