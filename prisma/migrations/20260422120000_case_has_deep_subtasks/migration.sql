-- Case.hasDeepSubtasks — flagged by the ClickUp sync when a level-3 subtask
-- (a task nested inside another subtask) is detected. Used by the cases list
-- UI to surface cases whose ClickUp structure needs cleanup.

ALTER TABLE "Case"
    ADD COLUMN "hasDeepSubtasks" BOOLEAN NOT NULL DEFAULT false;
