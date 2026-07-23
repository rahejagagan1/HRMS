-- CreateTable
CREATE TABLE "YoutubeDashboardChannelQuarterAnalysis" (
    "id" SERIAL NOT NULL,
    "channelId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "chartJson" JSONB NOT NULL,
    "headlineViews" INTEGER,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YoutubeDashboardChannelQuarterAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YoutubeDashboardChannelQuarterAnalysis_channelId_year_quarter_key" ON "YoutubeDashboardChannelQuarterAnalysis"("channelId", "year", "quarter");

-- CreateIndex
CREATE INDEX "YoutubeDashboardChannelQuarterAnalysis_year_quarter_idx" ON "YoutubeDashboardChannelQuarterAnalysis"("year", "quarter");
