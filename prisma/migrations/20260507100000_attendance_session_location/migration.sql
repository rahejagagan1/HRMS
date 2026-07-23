-- Per-session geolocation capture for clock-in AND clock-out.
--
-- The parent Attendance.location column already stores the latest
-- clock-in location for the whole day. With multi-session days
-- (clock-in / out / in / out / …), that single column can't tell us
-- where each individual punch happened. These two columns on
-- AttendanceSession give us per-punch geolocation: clockInLocation
-- on every session, clockOutLocation when the session closes.
-- Both nullable — existing rows + sessions without geolocation keep
-- working unchanged.
ALTER TABLE "AttendanceSession"
  ADD COLUMN IF NOT EXISTS "clockInLocation"  TEXT,
  ADD COLUMN IF NOT EXISTS "clockOutLocation" TEXT;
