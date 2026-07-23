-- LetterTemplate — HR's reusable letters (FnF, probation, internship,
-- revised offer, etc.). Body is HTML with {{Section.Field}}
-- placeholders that the render endpoint substitutes from the picked
-- employee + HR's per-render custom inputs.
CREATE TABLE IF NOT EXISTS "LetterTemplate" (
  "id"           SERIAL PRIMARY KEY,
  "key"          TEXT NOT NULL UNIQUE,
  "title"        TEXT NOT NULL,
  "category"     TEXT NOT NULL DEFAULT 'general',
  "bodyHtml"     TEXT NOT NULL,
  "customFields" JSONB,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "updatedById"  INTEGER,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "LetterTemplate_category_idx" ON "LetterTemplate"("category");
