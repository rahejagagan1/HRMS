-- Make User.clickupUserId nullable — HR is the identity source; ClickUp IDs are backfilled by sync on email match.
ALTER TABLE "User" ALTER COLUMN "clickupUserId" DROP NOT NULL;

-- Track ClickUp users whose email does not match any HR User.
CREATE TABLE "ClickupUnmatchedUser" (
    "id" SERIAL NOT NULL,
    "clickupUserId" BIGINT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "profilePictureUrl" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClickupUnmatchedUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClickupUnmatchedUser_clickupUserId_key" ON "ClickupUnmatchedUser"("clickupUserId");
CREATE INDEX "ClickupUnmatchedUser_email_idx" ON "ClickupUnmatchedUser"("email");
