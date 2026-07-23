-- H1. Video Duration ClickUp custom field (whole minutes) — now mapped in
-- CUSTOM_FIELD_MAP and written by the sync. youtubeVideoUrl already exists.
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "videoDuration" INTEGER;
