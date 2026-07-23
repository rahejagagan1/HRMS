-- Full offboarding workflow — Phase 1 + 2 + 3 tables.
--
-- One settlement record + N line items per exit (the "Review &
-- Finalise Payables" wizard), an exit-clearance task list, and a
-- single exit-interview survey. All FK-cascade off EmployeeExit so
-- deleting an exit cleans up everything below it.
--
-- Idempotent: ADD COLUMN / CREATE TABLE … IF NOT EXISTS so a re-run
-- is harmless even on a partially-applied DB.

-- ── ExitSettlement (1:1 with EmployeeExit) ─────────────────────────
CREATE TABLE IF NOT EXISTS "ExitSettlement" (
  "id"                SERIAL       PRIMARY KEY,
  "exitId"            INTEGER      NOT NULL UNIQUE
                                   REFERENCES "EmployeeExit"("id") ON DELETE CASCADE,
  "paymentMode"       TEXT         NOT NULL DEFAULT 'pay',
  "settlementMode"    TEXT         NOT NULL DEFAULT 'at_once',
  "settlementDate"    DATE,
  "settlementNotes"   TEXT,
  "actualNoticeDays"  INTEGER      NOT NULL DEFAULT 0,
  "noticeServingDays" INTEGER      NOT NULL DEFAULT 0,
  "buyoutEligible"    BOOLEAN      NOT NULL DEFAULT FALSE,
  "buyoutAmount"      DECIMAL(12,2),
  "gratuityEligible"  BOOLEAN      NOT NULL DEFAULT FALSE,
  "gratuityAmount"    DECIMAL(12,2),
  "finalised"         BOOLEAN      NOT NULL DEFAULT FALSE,
  "finalisedAt"       TIMESTAMP(3),
  "finalisedById"     INTEGER      REFERENCES "User"("id") ON DELETE SET NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ExitSettlement_exitId_idx"    ON "ExitSettlement"("exitId");
CREATE INDEX IF NOT EXISTS "ExitSettlement_finalised_idx" ON "ExitSettlement"("finalised");

-- ── ExitSettlementLine (N per ExitSettlement) ──────────────────────
-- One row per payable / deduction line. section + subsection let the
-- UI route each line into the right Step-1 panel and the Step-2
-- summary aggregates without re-categorising.
CREATE TABLE IF NOT EXISTS "ExitSettlementLine" (
  "id"            SERIAL       PRIMARY KEY,
  "settlementId"  INTEGER      NOT NULL
                               REFERENCES "ExitSettlement"("id") ON DELETE CASCADE,
  "section"       TEXT         NOT NULL,
  "subsection"    TEXT         NOT NULL,
  "label"         TEXT         NOT NULL,
  "amount"        DECIMAL(12,2) NOT NULL,
  "payAction"     TEXT         NOT NULL DEFAULT 'pay',
  "days"          DECIMAL(6,2),
  "comment"       TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ExitSettlementLine_settlementId_idx" ON "ExitSettlementLine"("settlementId");
CREATE INDEX IF NOT EXISTS "ExitSettlementLine_section_idx"      ON "ExitSettlementLine"("section");

-- ── ExitTask (N per exit) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ExitTask" (
  "id"          SERIAL       PRIMARY KEY,
  "exitId"      INTEGER      NOT NULL
                             REFERENCES "EmployeeExit"("id") ON DELETE CASCADE,
  "category"    TEXT         NOT NULL DEFAULT 'tasks',
  "title"       TEXT         NOT NULL,
  "description" TEXT,
  "assigneeId"  INTEGER      REFERENCES "User"("id") ON DELETE SET NULL,
  "status"      TEXT         NOT NULL DEFAULT 'pending',
  "dueDate"     DATE,
  "completedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ExitTask_exitId_idx" ON "ExitTask"("exitId");
CREATE INDEX IF NOT EXISTS "ExitTask_status_idx" ON "ExitTask"("status");

-- ── ExitSurvey (1:1 with EmployeeExit) ─────────────────────────────
CREATE TABLE IF NOT EXISTS "ExitSurvey" (
  "id"                    SERIAL       PRIMARY KEY,
  "exitId"                INTEGER      NOT NULL UNIQUE
                                       REFERENCES "EmployeeExit"("id") ON DELETE CASCADE,
  "reasonForLeaving"      TEXT,
  "satisfactionRating"    INTEGER,
  "managementRating"      INTEGER,
  "workEnvironmentRating" INTEGER,
  "growthRating"          INTEGER,
  "wouldRecommend"        BOOLEAN,
  "additionalFeedback"    TEXT,
  "submittedAt"           TIMESTAMP(3),
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
