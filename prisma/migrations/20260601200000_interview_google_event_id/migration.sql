-- Interview: track the Google Calendar event id so reschedule/cancel
-- can patch/delete the calendar event instead of orphaning it.
ALTER TABLE "Interview" ADD COLUMN IF NOT EXISTS "googleEventId" TEXT;
