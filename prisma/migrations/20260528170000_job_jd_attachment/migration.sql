-- Job Description file attachment on JobOpening.
--
-- HR uploads a JD PDF / DOC; the file is stored under
-- /public/uploads/jds/<uuid>-<name>.<ext> and the URL + original
-- filename are kept on the row. Public apply form surfaces a
-- "Download JD" link for candidates to read the brief.

ALTER TABLE "JobOpening"
  ADD COLUMN IF NOT EXISTS "jdFileUrl"  TEXT,
  ADD COLUMN IF NOT EXISTS "jdFileName" TEXT;
