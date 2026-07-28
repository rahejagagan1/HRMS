-- Short Leave needs a quarter-day (0.25) amount, but LeaveApplication.totalDays
-- was Decimal(5,1) which rounds to one decimal place. Widen to Decimal(6,2) so
-- 0.25 stores exactly. Widening is lossless for existing 0.5 / whole-day rows.
ALTER TABLE "LeaveApplication"
  ALTER COLUMN "totalDays" TYPE DECIMAL(6,2);
