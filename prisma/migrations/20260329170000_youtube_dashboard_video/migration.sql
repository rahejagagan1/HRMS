-- CreateTable
CREATE TABLE "YoutubeDashboardVideo" (
    "id" SERIAL NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "viewCount" BIGINT NOT NULL,
    "likeCount" BIGINT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YoutubeDashboardVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YoutubeDashboardVideo_youtubeVideoId_key" ON "YoutubeDashboardVideo"("youtubeVideoId");

-- CreateIndex
CREATE INDEX "YoutubeDashboardVideo_channelId_idx" ON "YoutubeDashboardVideo"("channelId");

-- CreateIndex
CREATE INDEX "YoutubeDashboardVideo_publishedAt_idx" ON "YoutubeDashboardVideo"("publishedAt");

-- CreateIndex
CREATE INDEX "YoutubeDashboardVideo_syncedAt_idx" ON "YoutubeDashboardVideo"("syncedAt");
