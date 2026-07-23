-- CreateTable
CREATE TABLE "YoutubeDashboardQuarterMetrics" (
    "id" SERIAL NOT NULL,
    "channelId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "analyticsStartStr" TEXT NOT NULL,
    "analyticsEndStr" TEXT NOT NULL,
    "viewsGainedInQuarter" BIGINT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YoutubeDashboardQuarterMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YoutubeDashboardQuarterMetrics_channelId_year_quarter_key" ON "YoutubeDashboardQuarterMetrics"("channelId", "year", "quarter");

-- CreateIndex
CREATE INDEX "YoutubeDashboardQuarterMetrics_year_quarter_idx" ON "YoutubeDashboardQuarterMetrics"("year", "quarter");
