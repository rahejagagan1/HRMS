-- CreateTable
CREATE TABLE "YoutubeDashboardVideoSnapshot" (
    "id" SERIAL NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "viewCount" BIGINT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YoutubeDashboardVideoSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YoutubeDashboardVideoSnapshot_youtubeVideoId_snapshotDate_key" ON "YoutubeDashboardVideoSnapshot"("youtubeVideoId", "snapshotDate");

-- CreateIndex
CREATE INDEX "YoutubeDashboardVideoSnapshot_channelId_snapshotDate_idx" ON "YoutubeDashboardVideoSnapshot"("channelId", "snapshotDate");

-- CreateIndex
CREATE INDEX "YoutubeDashboardVideoSnapshot_youtubeVideoId_snapshotDate_idx" ON "YoutubeDashboardVideoSnapshot"("youtubeVideoId", "snapshotDate");
