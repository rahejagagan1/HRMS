-- Drop the CTR column from YoutubeStats (feature removed)
ALTER TABLE "YoutubeStats" DROP COLUMN IF EXISTS "ctr";
