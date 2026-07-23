-- Pivot the Missing Fields tool to operate per ProductionList (what the team
-- calls a "capsule" / C1, C2, ...) instead of per ClickUp folder. The active
-- production-line lists aren't linked to a folder, so folder-level plans never
-- caught them. Tables are empty at this point, so the rename is safe.

-- Plans are now keyed by ProductionList id.
ALTER TABLE "CapsuleFieldPlan" RENAME COLUMN "capsuleId" TO "productionListId";
ALTER TABLE "CapsuleFieldPlan" RENAME CONSTRAINT "CapsuleFieldPlan_capsuleId_key" TO "CapsuleFieldPlan_productionListId_key";

-- Which production lists ("capsules") the tool manages + scans. JSON array of
-- ProductionList ids.
ALTER TABLE "MissingFieldsConfig" ADD COLUMN IF NOT EXISTS "activeListIds" JSONB NOT NULL DEFAULT '[]';
