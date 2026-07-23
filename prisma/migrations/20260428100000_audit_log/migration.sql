-- Append-only audit log for compliance + "who deleted this row?" queries.
CREATE TABLE "AuditLog" (
    "id"          SERIAL NOT NULL,
    "actorId"     INTEGER,
    "actorEmail"  TEXT,
    "action"      TEXT     NOT NULL,
    "entityType"  TEXT     NOT NULL,
    "entityId"    TEXT,
    "before"      JSONB,
    "after"       JSONB,
    "ip"          TEXT,
    "userAgent"   TEXT,
    "metadata"    JSONB,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_actorId_idx"               ON "AuditLog"("actorId");
CREATE INDEX "AuditLog_action_idx"                ON "AuditLog"("action");
CREATE INDEX "AuditLog_entityType_entityId_idx"   ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_createdAt_idx"             ON "AuditLog"("createdAt");

-- Soft FK to User — preserve audit history if the user is later deleted.
ALTER TABLE "AuditLog"
    ADD CONSTRAINT "AuditLog_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
