-- AlterTable
ALTER TABLE "MonthlyReport"
    ADD COLUMN "videosPublishedTarget" TEXT,
    ADD COLUMN "videosPublishedActual" TEXT,
    ADD COLUMN "videosPublishedVariance" TEXT,
    ADD COLUMN "videosPublishedActualOverridden" BOOLEAN NOT NULL DEFAULT false;
