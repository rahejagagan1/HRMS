-- Manager-added extra cases for Section 3 (Individual Contributor Performance)
-- of the Monthly Report. Each user (editor or writer) can have additional
-- cases attached on top of the auto-detected ones.
-- Shape: { [userId]: Array<{ id: string, name: string }> }
ALTER TABLE "MonthlyReport"
    ADD COLUMN "editorExtraCases" JSONB,
    ADD COLUMN "writerExtraCases" JSONB;
