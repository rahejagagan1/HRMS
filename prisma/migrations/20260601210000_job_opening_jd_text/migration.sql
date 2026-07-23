-- JobOpening: store the (HR-edited) plain-text JD alongside the
-- uploaded file. Populated when HR uses the wizard's inline JD
-- preview-and-edit UI; null for legacy rows.
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "jdText" TEXT;
