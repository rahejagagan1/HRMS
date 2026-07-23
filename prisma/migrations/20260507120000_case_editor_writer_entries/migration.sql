CREATE TABLE "CaseEditorEntry" (
  "id"            SERIAL PRIMARY KEY,
  "caseId"        INTEGER NOT NULL,
  "userId"        INTEGER NOT NULL,
  "clickupUserId" BIGINT,
  CONSTRAINT "CaseEditorEntry_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE,
  CONSTRAINT "CaseEditorEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id"),
  CONSTRAINT "CaseEditorEntry_caseId_userId_key" UNIQUE ("caseId", "userId")
);
CREATE INDEX "CaseEditorEntry_caseId_idx" ON "CaseEditorEntry"("caseId");

CREATE TABLE "CaseWriterEntry" (
  "id"            SERIAL PRIMARY KEY,
  "caseId"        INTEGER NOT NULL,
  "userId"        INTEGER NOT NULL,
  "clickupUserId" BIGINT,
  CONSTRAINT "CaseWriterEntry_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE,
  CONSTRAINT "CaseWriterEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id"),
  CONSTRAINT "CaseWriterEntry_caseId_userId_key" UNIQUE ("caseId", "userId")
);
CREATE INDEX "CaseWriterEntry_caseId_idx" ON "CaseWriterEntry"("caseId");
