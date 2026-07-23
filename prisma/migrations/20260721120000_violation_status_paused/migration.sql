-- Add the "paused" state to the ViolationStatus enum (Strike Log).
-- Positioned before "closed" to mirror the enum order in schema.prisma.
-- Idempotent so re-running against a DB that already has it is a no-op.
ALTER TYPE "ViolationStatus" ADD VALUE IF NOT EXISTS 'paused' BEFORE 'closed';
