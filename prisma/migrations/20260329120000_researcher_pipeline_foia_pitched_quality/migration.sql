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

-- CreateIndex
CREATE UNIQUE INDEX "ResearcherPipelineSnapshot_month_key" ON "ResearcherPipelineSnapshot"("month");

-- CreateIndex
CREATE INDEX "ResearcherPipelineSnapshot_month_idx" ON "ResearcherPipelineSnapshot"("month");
