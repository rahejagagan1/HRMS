-- Restore JobOpening columns dropped by a past `prisma db push`. The
-- hiring create handler (POST /api/hr/hiring/jobs) writes all of these,
-- so without them every draft/publish INSERT fails with a 500
-- ("Internal server error"). Additive + idempotent: ADD COLUMN IF NOT
-- EXISTS can only ADD columns (never drop/alter existing data), and each
-- column carries a default so existing rows stay valid. Defaults mirror
-- the create handler exactly.
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "salaryMin" INTEGER;
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "salaryMax" INTEGER;
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "salaryUnit" TEXT NOT NULL DEFAULT 'lpa';
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "allowReapplyDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "archiveAfterFilled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "inboundOwnerStrategy" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "inboundOwnerUserId" INTEGER;
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "interviewFeedbackVisibility" TEXT NOT NULL DEFAULT 'open';
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "recruitersAccessOwnOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "interviewersAccessOwnOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "notifyRecruiterOnNewCandidate" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "notifyHiringMgrOnNewCandidate" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "publishChannels" TEXT[] NOT NULL DEFAULT '{career_site}';

-- updatedAt is @updatedAt in Prisma (set by the client), but the create
-- handler writes JobOpening via raw SQL and omits it → NOT NULL violation.
-- Give it a DB default so the raw INSERT path gets a value; Prisma-managed
-- updates still set it explicitly. Existing rows keep their values.
ALTER TABLE "JobOpening" ALTER COLUMN "updatedAt" SET DEFAULT now();
