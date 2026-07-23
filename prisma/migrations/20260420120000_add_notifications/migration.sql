-- CreateTable
CREATE TABLE "Notification" (
    "id"        SERIAL        PRIMARY KEY,
    "userId"    INTEGER       NOT NULL,
    "actorId"   INTEGER,
    "type"      TEXT          NOT NULL,
    "entityId"  INTEGER,
    "title"     TEXT          NOT NULL,
    "body"      TEXT,
    "linkUrl"   TEXT,
    "isRead"    BOOLEAN       NOT NULL DEFAULT FALSE,
    "readAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX "Notification_userId_isRead_idx"   ON "Notification" ("userId", "isRead");
CREATE INDEX "Notification_createdAt_idx"       ON "Notification" ("createdAt");

-- Foreign keys
ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
