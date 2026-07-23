-- Widen Subtask.tat from DECIMAL(5,2) (max 999.99) to DECIMAL(7,2) (max 99,999.99).
-- The value stored is elapsed hours between start_date and date_done, so any
-- subtask spanning ~42 calendar days or more overflows the old precision and
-- the upsert fails with PostgreSQL error 22003 (numeric_value_out_of_range).
ALTER TABLE "Subtask"
    ALTER COLUMN "tat" TYPE DECIMAL(7, 2);
