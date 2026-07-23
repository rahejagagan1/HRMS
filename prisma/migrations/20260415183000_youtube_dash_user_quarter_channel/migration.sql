-- Per-user, per-channel, per-quarter contribution cache for YouTube dashboard
CREATE TABLE "YoutubeDashUserQuarterChannel" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "channelId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "videoCount" INTEGER NOT NULL DEFAULT 0,
    "viewsSum" BIGINT NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YoutubeDashUserQuarterChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "YoutubeDashUserQuarterChannel_userId_channelId_year_quarter_key" ON "YoutubeDashUserQuarterChannel"("userId", "channelId", "year", "quarter");
CREATE INDEX "YoutubeDashUserQuarterChannel_userId_year_quarter_idx" ON "YoutubeDashUserQuarterChannel"("userId", "year", "quarter");
CREATE INDEX "YoutubeDashUserQuarterChannel_channelId_year_quarter_idx" ON "YoutubeDashUserQuarterChannel"("channelId", "year", "quarter");

ALTER TABLE "YoutubeDashUserQuarterChannel" ADD CONSTRAINT "YoutubeDashUserQuarterChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
