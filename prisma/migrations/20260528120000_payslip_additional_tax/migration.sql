-- Additional fixed tax deduction (₹200/month) for non-intern employees.
-- Stored as its own column on Payslip so the deduction is itemised on
-- the printable slip and totals stay auditable. The placeholder column
-- name `additionalTax` will be renamed once the exact tax name (LWF,
-- city tax, etc.) is confirmed.

ALTER TABLE "Payslip"
  ADD COLUMN IF NOT EXISTS "additionalTax" DECIMAL(10, 2) NOT NULL DEFAULT 0;
