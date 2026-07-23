-- CreateTable
CREATE TABLE "UserTabPermission" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tabKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" INTEGER,

    CONSTRAINT "UserTabPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserTabPermission_userId_tabKey_key" ON "UserTabPermission"("userId", "tabKey");

-- CreateIndex
CREATE INDEX "UserTabPermission_userId_idx" ON "UserTabPermission"("userId");

-- AddForeignKey
ALTER TABLE "UserTabPermission" ADD CONSTRAINT "UserTabPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTabPermission" ADD CONSTRAINT "UserTabPermission_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
