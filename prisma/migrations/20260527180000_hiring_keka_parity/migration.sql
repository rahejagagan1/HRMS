-- Hiring (Keka-style ATS) — adds 6 new tables + extends JobOpening +
-- JobApplication with hiring-team / pipeline-stage columns.
--
-- New tables:
--   HiringStage             — canonical stages (Sourced / Screening / ...)
--   JobOpeningInterviewer   — join: jobs ↔ interviewer panel
--   JobApplicationStage     — audit log of stage transitions
--   Interview               — one row per interview round
--   InterviewPanelist       — join: interviews ↔ panelists
--   InterviewScorecard      — per-panelist ratings
--   EmailTemplate           — reusable templates with stage triggers
--   OfferLetter             — generated offers
--   CandidateActivity       — activity feed for a candidate
--
-- Backwards-compat: JobApplication.status (legacy) stays as-is.
-- Existing rows get currentStageId = NULL until the seed step
-- backfills them to the "Sourced" stage based on legacy status.

-- ── JobOpening: hiring-team + brand columns ────────────────────────
ALTER TABLE "JobOpening"
  ADD COLUMN IF NOT EXISTS "brand"           TEXT DEFAULT 'nb_media',
  ADD COLUMN IF NOT EXISTS "employmentType"  TEXT,
  ADD COLUMN IF NOT EXISTS "experienceLevel" TEXT,
  ADD COLUMN IF NOT EXISTS "salaryRange"     TEXT,
  ADD COLUMN IF NOT EXISTS "internalNotes"   TEXT,
  ADD COLUMN IF NOT EXISTS "closesAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recruiterId"     INTEGER,
  ADD COLUMN IF NOT EXISTS "hiringManagerId" INTEGER;

ALTER TABLE "JobOpening" DROP CONSTRAINT IF EXISTS "JobOpening_recruiterId_fkey";
ALTER TABLE "JobOpening" DROP CONSTRAINT IF EXISTS "JobOpening_hiringManagerId_fkey";
ALTER TABLE "JobOpening"
  ADD CONSTRAINT "JobOpening_recruiterId_fkey"
  FOREIGN KEY ("recruiterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobOpening"
  ADD CONSTRAINT "JobOpening_hiringManagerId_fkey"
  FOREIGN KEY ("hiringManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "JobOpening_brand_idx" ON "JobOpening"("brand");
CREATE INDEX IF NOT EXISTS "JobOpening_recruiterId_idx" ON "JobOpening"("recruiterId");
CREATE INDEX IF NOT EXISTS "JobOpening_hiringManagerId_idx" ON "JobOpening"("hiringManagerId");

-- ── HiringStage ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "HiringStage" (
  "id"        SERIAL PRIMARY KEY,
  "key"       TEXT NOT NULL UNIQUE,
  "label"     TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "kind"      TEXT NOT NULL DEFAULT 'active',
  "color"     TEXT NOT NULL DEFAULT 'slate',
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "HiringStage_sortOrder_idx" ON "HiringStage"("sortOrder");
CREATE INDEX IF NOT EXISTS "HiringStage_isActive_idx"  ON "HiringStage"("isActive");

-- Seed the canonical Keka-style pipeline (idempotent — ON CONFLICT DO NOTHING).
INSERT INTO "HiringStage" ("key", "label", "sortOrder", "kind", "color") VALUES
  ('sourced',         'Sourced',              10, 'active',   'slate'),
  ('screening',       'Screening',            20, 'active',   'blue'),
  ('phone_screen',    'Phone Screen',         30, 'active',   'cyan'),
  ('tech_interview',  'Tech Interview',       40, 'active',   'violet'),
  ('manager_round',   'Manager Round',        50, 'active',   'amber'),
  ('hr_round',        'HR Round',             60, 'active',   'pink'),
  ('offer',           'Offer',                70, 'active',   'emerald'),
  ('hired',           'Hired',               100, 'hired',    'emerald'),
  ('rejected',        'Rejected',            110, 'rejected', 'rose')
ON CONFLICT ("key") DO NOTHING;

-- ── JobOpeningInterviewer (interviewers panel join) ────────────────
CREATE TABLE IF NOT EXISTS "JobOpeningInterviewer" (
  "id"           SERIAL PRIMARY KEY,
  "jobOpeningId" INTEGER NOT NULL,
  "userId"       INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobOpeningInterviewer_jobOpeningId_userId_key" UNIQUE ("jobOpeningId", "userId"),
  CONSTRAINT "JobOpeningInterviewer_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE CASCADE,
  CONSTRAINT "JobOpeningInterviewer_userId_fkey"        FOREIGN KEY ("userId")       REFERENCES "User"("id")       ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "JobOpeningInterviewer_jobOpeningId_idx" ON "JobOpeningInterviewer"("jobOpeningId");
CREATE INDEX IF NOT EXISTS "JobOpeningInterviewer_userId_idx"       ON "JobOpeningInterviewer"("userId");

-- ── JobApplication: kanban stage + Keka-parity columns ─────────────
ALTER TABLE "JobApplication"
  ADD COLUMN IF NOT EXISTS "currentStageId"  INTEGER,
  ADD COLUMN IF NOT EXISTS "enteredStageAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "overallRating"   INTEGER,
  ADD COLUMN IF NOT EXISTS "source"          TEXT,
  ADD COLUMN IF NOT EXISTS "referredById"    INTEGER;

ALTER TABLE "JobApplication" DROP CONSTRAINT IF EXISTS "JobApplication_currentStageId_fkey";
ALTER TABLE "JobApplication" DROP CONSTRAINT IF EXISTS "JobApplication_referredById_fkey";
ALTER TABLE "JobApplication"
  ADD CONSTRAINT "JobApplication_currentStageId_fkey"
  FOREIGN KEY ("currentStageId") REFERENCES "HiringStage"("id") ON DELETE SET NULL;
ALTER TABLE "JobApplication"
  ADD CONSTRAINT "JobApplication_referredById_fkey"
  FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "JobApplication_currentStageId_idx" ON "JobApplication"("currentStageId");
CREATE INDEX IF NOT EXISTS "JobApplication_referredById_idx"   ON "JobApplication"("referredById");

-- Backfill legacy status → currentStageId on existing rows.
UPDATE "JobApplication" SET
  "currentStageId" = (SELECT "id" FROM "HiringStage" WHERE "key" = 'sourced'),
  "enteredStageAt" = COALESCE("updatedAt", "createdAt")
WHERE "currentStageId" IS NULL AND ("status" = 'new' OR "status" IS NULL);

UPDATE "JobApplication" SET
  "currentStageId" = (SELECT "id" FROM "HiringStage" WHERE "key" = 'screening'),
  "enteredStageAt" = COALESCE("updatedAt", "createdAt")
WHERE "currentStageId" IS NULL AND "status" = 'reviewed';

UPDATE "JobApplication" SET
  "currentStageId" = (SELECT "id" FROM "HiringStage" WHERE "key" = 'phone_screen'),
  "enteredStageAt" = COALESCE("updatedAt", "createdAt")
WHERE "currentStageId" IS NULL AND "status" = 'shortlisted';

UPDATE "JobApplication" SET
  "currentStageId" = (SELECT "id" FROM "HiringStage" WHERE "key" = 'tech_interview'),
  "enteredStageAt" = COALESCE("updatedAt", "createdAt")
WHERE "currentStageId" IS NULL AND "status" = 'interviewing';

UPDATE "JobApplication" SET
  "currentStageId" = (SELECT "id" FROM "HiringStage" WHERE "key" = 'rejected'),
  "enteredStageAt" = COALESCE("updatedAt", "createdAt")
WHERE "currentStageId" IS NULL AND "status" = 'rejected';

UPDATE "JobApplication" SET
  "currentStageId" = (SELECT "id" FROM "HiringStage" WHERE "key" = 'hired'),
  "enteredStageAt" = COALESCE("updatedAt", "createdAt")
WHERE "currentStageId" IS NULL AND "status" = 'hired';

-- ── JobApplicationStage (audit log) ────────────────────────────────
CREATE TABLE IF NOT EXISTS "JobApplicationStage" (
  "id"            SERIAL PRIMARY KEY,
  "applicationId" INTEGER NOT NULL,
  "stageId"       INTEGER NOT NULL,
  "enteredAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exitedAt"      TIMESTAMP(3),
  "movedById"     INTEGER,
  "note"          TEXT,
  CONSTRAINT "JobApplicationStage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE,
  CONSTRAINT "JobApplicationStage_stageId_fkey"       FOREIGN KEY ("stageId")       REFERENCES "HiringStage"("id")    ON DELETE RESTRICT,
  CONSTRAINT "JobApplicationStage_movedById_fkey"     FOREIGN KEY ("movedById")     REFERENCES "User"("id")           ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "JobApplicationStage_applicationId_idx" ON "JobApplicationStage"("applicationId");
CREATE INDEX IF NOT EXISTS "JobApplicationStage_stageId_idx"       ON "JobApplicationStage"("stageId");
CREATE INDEX IF NOT EXISTS "JobApplicationStage_enteredAt_idx"     ON "JobApplicationStage"("enteredAt");

-- ── Interview ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Interview" (
  "id"              SERIAL PRIMARY KEY,
  "applicationId"   INTEGER NOT NULL,
  "roundNumber"     INTEGER NOT NULL DEFAULT 1,
  "title"           TEXT NOT NULL,
  "scheduledAt"     TIMESTAMP(3),
  "durationMinutes" INTEGER NOT NULL DEFAULT 45,
  "location"        TEXT,
  "status"          TEXT NOT NULL DEFAULT 'scheduled',
  "outcome"         TEXT,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "Interview_applicationId_idx" ON "Interview"("applicationId");
CREATE INDEX IF NOT EXISTS "Interview_scheduledAt_idx"   ON "Interview"("scheduledAt");

-- ── InterviewPanelist (interview ↔ user panel join) ────────────────
CREATE TABLE IF NOT EXISTS "InterviewPanelist" (
  "id"          SERIAL PRIMARY KEY,
  "interviewId" INTEGER NOT NULL,
  "userId"      INTEGER NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InterviewPanelist_interviewId_userId_key" UNIQUE ("interviewId", "userId"),
  CONSTRAINT "InterviewPanelist_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE,
  CONSTRAINT "InterviewPanelist_userId_fkey"      FOREIGN KEY ("userId")      REFERENCES "User"("id")      ON DELETE CASCADE
);

-- ── InterviewScorecard ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "InterviewScorecard" (
  "id"                  SERIAL PRIMARY KEY,
  "interviewId"         INTEGER NOT NULL,
  "interviewerId"       INTEGER NOT NULL,
  "technicalScore"      INTEGER,
  "communicationScore"  INTEGER,
  "cultureScore"        INTEGER,
  "problemSolvingScore" INTEGER,
  "strengths"           TEXT,
  "weaknesses"          TEXT,
  "recommendation"      TEXT,
  "notes"               TEXT,
  "submittedAt"         TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InterviewScorecard_interviewId_interviewerId_key" UNIQUE ("interviewId", "interviewerId"),
  CONSTRAINT "InterviewScorecard_interviewId_fkey"   FOREIGN KEY ("interviewId")   REFERENCES "Interview"("id") ON DELETE CASCADE,
  CONSTRAINT "InterviewScorecard_interviewerId_fkey" FOREIGN KEY ("interviewerId") REFERENCES "User"("id")      ON DELETE CASCADE
);

-- ── EmailTemplate ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "EmailTemplate" (
  "id"            SERIAL PRIMARY KEY,
  "key"           TEXT NOT NULL UNIQUE,
  "name"          TEXT NOT NULL,
  "trigger"       TEXT NOT NULL DEFAULT 'manual',
  "stageId"       INTEGER,
  "subject"       TEXT NOT NULL,
  "bodyHtml"      TEXT NOT NULL,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "autoSend"      BOOLEAN NOT NULL DEFAULT false,
  "jobTitleMatch" TEXT,
  "links"         JSONB,
  "deadlineHours" INTEGER,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailTemplate_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "HiringStage"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "EmailTemplate_trigger_idx"       ON "EmailTemplate"("trigger");
CREATE INDEX IF NOT EXISTS "EmailTemplate_stageId_idx"       ON "EmailTemplate"("stageId");
CREATE INDEX IF NOT EXISTS "EmailTemplate_jobTitleMatch_idx" ON "EmailTemplate"("jobTitleMatch");

-- Seed the 12 canonical NB Media email templates. All extracted from
-- the HR Email Templates doc — voice + structure preserved verbatim,
-- only highlighted "candidate name / job role / date / link"
-- placeholders replaced with merge tags the resolver fills at send
-- time. HR can edit / disable / extend any of these from the Settings
-- tab without a code deploy.
INSERT INTO "EmailTemplate"
  ("key", "name", "trigger", "stageId", "subject", "bodyHtml", "isActive", "autoSend", "jobTitleMatch", "links", "deadlineHours")
VALUES
  -- 1) Candidate Rejection (generic)
  ('candidate_rejection',
   'Candidate Rejection',
   'rejection',
   (SELECT "id" FROM "HiringStage" WHERE "key" = 'rejected'),
   'Your application for the {{job_title}} at {{company}}',
   '<p>Dear {{candidate_name}},</p><p>Greetings from {{company}}!</p><p>We thank you for your application for the <strong>{{job_title}}</strong> position at {{company}}. We appreciate you for showing interest in joining our company and we thank you for investing your precious time and efforts in applying to our company.</p><p>We''re fortunate to have received a lot of interest in this role, resulting in a very competitive selection process and after the careful evaluation of your application, we regret to inform you that unfortunately this time we won''t be able to move forward with your application.</p><p>Thank you once again for your interest in {{company}}, while it didn''t work out this time, we hope you will continue to explore other opportunities with {{company}}.</p><p>We would be happy to reach out again for a relevant position in the future.</p><p>Warm Regards,<br/>HR Department<br/>{{company}}</p>',
   true, false, NULL, NULL, NULL),

  -- 2) Portfolio Required (generic role)
  ('portfolio_required',
   'Portfolio Required',
   'manual',
   NULL,
   'Portfolio Required - "{{job_title}}" role at {{company}}',
   '<p>Dear {{candidate_name}},</p><p>Greetings from {{company}}!</p><p>We appreciate your interest in the <strong>{{job_title}}</strong> at {{company}}. As part of our ongoing evaluation process, we would like to learn more about your work and accomplishments.</p><p><strong>We would request you to share your professional portfolio with us.</strong> This could include examples of projects you''ve worked on, case studies, or any other materials that highlight your skills and experience relevant to the role.</p><p>You can send your portfolio as attachments or provide a link to an online portfolio or personal website. Please ensure that your portfolio includes a diverse range of work that showcases your abilities and achievements.</p><p>We kindly request that you submit your portfolio by <strong>{{submission_deadline}}</strong>.</p><p>Thank you for your cooperation, and we look forward to reviewing your portfolio.</p><p>Warm Regards,<br/>HR Department<br/>{{company}}</p>',
   true, false, NULL, NULL, 72),

  -- 3) Work Sample — Script Writer
  ('work_sample_script_writer',
   'Work Sample — Script Writer',
   'manual',
   NULL,
   'Work Sample Required - "Script Writer" role at {{company}}',
   '<p>Dear {{candidate_name}},</p><p>Greetings from {{company}}!</p><p>We sincerely appreciate your interest in the <strong>Script Writer</strong> position at {{company}}. As part of our ongoing evaluation process, we would like to invite you to share specific work samples that demonstrate your skills and capabilities to assess your qualifications for the position.</p><p>Please refer to the below link for detailed instructions on how to submit your work sample, a <strong>1000-word sample</strong> script on a predetermined topic.</p><p><a href="{{assignment_link}}">Sample Topic Document</a></p><p><strong>We kindly request that you submit your portfolio within 24 hours.</strong></p><p>Should you have any questions or require further clarification on any aspect of the submission process, feel free to reach out to the undersigned.</p><p>Thank you for your time and effort in completing this additional step in our recruitment process. We look forward to reviewing your work samples and gaining a deeper understanding of your capabilities!</p><p>Warm Regards,<br/>HR Department<br/>{{company}}</p>',
   true, false, 'Script Writer',
   '{"assignment_link": "https://docs.google.com/document/d/SCRIPT_WRITER_SAMPLE_TOPIC_PLACEHOLDER"}'::jsonb,
   24),

  -- 4) Work Sample — Video Editor
  ('work_sample_video_editor',
   'Work Sample — Video Editor',
   'manual',
   NULL,
   'Work Sample Required - "Video Editor" role at {{company}}',
   '<p>Dear {{candidate_name}},</p><p>Greetings from {{company}}!</p><p>We sincerely appreciate your interest in the <strong>Video Editor position</strong> at {{company}}. As part of our ongoing evaluation process, we would like to invite you to share specific work samples that demonstrate your skills and capabilities to assess your qualifications for the position.</p><p>Please produce the video referenced in the attached link to this email.</p><p><strong>Kindly find files in the attachment below:</strong><br/><a href="{{drive_folder}}">{{drive_folder}}</a></p><p>You can use any Transitions, Overlay Effects, Texts and fonts, Graphics, Background music, and sound effects to make the video creative. You can also do online research to find more data (Photos/Videos) related to the particular assignment.</p><p>Please go through these references to better understand the output you need to provide in the assignment.</p><ul><li><a href="{{reference_1}}">{{reference_1}}</a></li><li><a href="{{reference_2}}">{{reference_2}}</a></li><li><a href="{{reference_3}}">{{reference_3}}</a></li></ul><p><strong>We kindly request that you submit the final video along with the Adobe Premiere Project file of the assignment within 48 hours.</strong></p><p>Should you have any questions or require further clarification on any aspect of the submission process, feel free to reach out to the undersigned.</p><p>Thank you for your time and effort in completing this additional step in our recruitment process. We look forward to reviewing your work samples and gaining a deeper understanding of your capabilities!</p><p>Warm Regards,<br/>HR Department<br/>{{company}}</p>',
   true, false, 'Video Editor',
   '{"drive_folder": "https://drive.google.com/drive/folders/1LnPuFt9_DnwbzXQI_87wKGmUUTKX_02y?usp=sharing", "reference_1": "https://www.youtube.com/watch?v=AcNAah1xT6E", "reference_2": "https://www.youtube.com/watch?v=rfzBlqfFjSk", "reference_3": "https://www.youtube.com/watch?v=DrvJ6qEqDQE"}'::jsonb,
   48),

  -- 5) Work Sample — Graphic Designer
  ('work_sample_graphic_designer',
   'Work Sample — Graphic Designer',
   'manual',
   NULL,
   'Work Sample Required - "Graphic Designer" role at {{company}}',
   '<p>Dear {{candidate_name}},</p><p>Greetings from {{company}}!</p><p>We sincerely appreciate your interest in the <strong>Graphic Designer position</strong> at {{company}}. As part of our ongoing evaluation process, we would like to invite you to share specific work samples that demonstrate your skills and capabilities to assess your qualifications for the position.</p><p>Please produce the designs referenced in the attached script to this email. You are required to complete two tasks.</p><p>Script: <a href="{{assignment_link}}">Work Assignment Brief</a></p><p>Please go through the references that are attached to this email.</p><p><strong>We kindly request that you submit the final JPG Files and PSD Files of the assignment within 48 hours.</strong></p><p>Should you have any questions or require further clarification on any aspect of the submission process, feel free to reach out to the undersigned.</p><p>Thank you for your time and effort in completing this additional step in our recruitment process. We look forward to reviewing your work samples and gaining a deeper understanding of your capabilities!</p><p>Warm Regards,<br/>HR Department<br/>{{company}}</p>',
   true, false, 'Graphic Designer',
   '{"assignment_link": "https://docs.google.com/document/d/GRAPHIC_DESIGNER_BRIEF_PLACEHOLDER"}'::jsonb,
   48),

  -- 6) Technical Interview Round
  ('interview_technical',
   'Technical Interview Invitation',
   'interview_scheduled',
   (SELECT "id" FROM "HiringStage" WHERE "key" = 'tech_interview'),
   'Invitation for Technical Interview Round for {{job_title}} at {{company}}',
   '<p>Dear {{candidate_name}},</p><p>Greetings from {{company}}!</p><p>We would like to express our appreciation for your participation in the previous rounds of our interview process. After careful consideration, we are pleased to inform you that you have successfully cleared the initial stages of the Selection Process.</p><p><strong>Congratulations on your accomplishment!</strong></p><p>The next step in our selection process is the <strong>Technical Interview Round.</strong> The interview will be conducted virtually via <strong>Google Meet</strong> where you will have the opportunity to showcase your technical abilities and discuss your experience with our team. Please be prepared to discuss your technical skills and experiences during this session.</p><p><strong>Meeting Link:</strong><br/>{{interview_date}} · {{interview_time}}<br/>Video call link: <a href="{{meeting_link}}">{{meeting_link}}</a></p><p>Should you have any questions or require further information about the Technical Interview Round, please feel free to contact the undersigned.</p><p>Once again, congratulations on your progress, and we look forward to a productive and insightful technical discussion.</p><p>Warm Regards,<br/>HR Department<br/>{{company}}</p>',
   true, true, NULL, NULL, NULL),

  -- 7) Final Interview Round
  ('interview_final',
   'Final Interview Invitation',
   'interview_scheduled',
   (SELECT "id" FROM "HiringStage" WHERE "key" = 'manager_round'),
   'Invitation for Final Interview Round for {{job_title}} at {{company}}',
   '<p>Dear {{candidate_name}},</p><p>Greetings from {{company}}!</p><p>We want to extend our congratulations as you have successfully cleared all the previous rounds of our interview process.</p><p>Your achievements thus far have been impressive, and we are excited to invite you to the final round of interviews. This round will provide you with an opportunity to meet key members of our team, discuss the specific responsibilities of the <strong>{{job_title}}</strong> position, and gain further insights into our company culture.</p><p>The Final Interview Round is scheduled for <strong>{{interview_date}}</strong> at <strong>{{interview_time}}</strong>.</p><p>The next step in our selection process is the <strong>Final Interview Round.</strong> The interview will be conducted at <strong>{{interview_location}}</strong>. Please come prepared to engage in discussions about your experiences, skills, and how you envision contributing to our team.</p><p><strong>Meeting Link:</strong><br/>{{interview_date}} · {{interview_time}}<br/>Video call link: <a href="{{meeting_link}}">{{meeting_link}}</a></p><p>Should you have any questions or require further information about the Final Interview Round, please feel free to contact the undersigned.</p><p>Congratulations once again on reaching this stage, and we look forward to meeting with you for the final interview.</p><p>Warm Regards,<br/>HR Department<br/>{{company}}</p>',
   true, false, NULL, NULL, NULL),

  -- 8) Selection — Documents Request
  ('selection_documents_request',
   'Selection — Documents Request',
   'stage_change',
   (SELECT "id" FROM "HiringStage" WHERE "key" = 'offer'),
   'Congratulations on Your Selection as "{{job_title}}" at {{company}}',
   '<p>Dear {{candidate_name}},</p><p>Greetings from {{company}}!</p><p>I hope this email finds you well! It is with great pleasure that I extend my heartfelt congratulations on behalf of <strong>{{company}}</strong> for being selected as <strong>{{job_title}}</strong>. Your skills and qualifications truly stood out during the interview process, and we are excited to welcome you to our team.</p><p><strong>We kindly request you to provide the following documents at your earliest convenience for the provision of the offer letter:</strong></p><ol><li>Previous 3 months'' salary slips / bank transaction proofs.</li><li>Aadhaar Card</li><li>Estimated date by which you shall provide us with your experience letter from your previous employer.</li><li>2 or 3 References from previous employers.</li></ol><p>Please be assured that all the information provided will be treated confidentially and used solely for employment-related purposes.</p><p>Feel free to contact me if you have any questions or need further assistance.</p><p>Once again, congratulations on your well-deserved success, and we look forward to working together at {{company}}.</p><p>Warm Regards,<br/>HR Department<br/>{{company}}</p>',
   true, false, NULL, NULL, NULL),

  -- 9) Offer Letter Cover
  ('offer_letter_cover',
   'Offer Letter',
   'offer',
   (SELECT "id" FROM "HiringStage" WHERE "key" = 'offer'),
   'Congratulations on Your Selection as "{{job_title}}" at {{company}}',
   '<p>Dear {{candidate_name}},</p><p>Greetings from {{company}}!</p><p>We are delighted to extend an offer of employment to you for the position of <strong>{{job_title}}</strong> at {{company}} commencing on <strong>{{joining_date}}</strong>. We were impressed with your qualifications, experience, and the positive impression you left during the interview process.</p><p>Please review the enclosed Job offer letter, which outlines the terms and conditions of your employment with {{company}}, and provide your response by <strong>{{response_deadline}}</strong>.</p><p>We believe that your skills and expertise will be a valuable addition to our team, and we are excited about the prospect of working together.</p><p>Furthermore, we wish to express our gratitude for your active involvement in the selection procedure. Thus far, we have thoroughly enjoyed the interactions. We hope that you had a similar pleasant experience.</p><p>Thank you for considering this opportunity, and we anticipate a positive response from you.</p><p>Warm Regards,<br/>HR Department<br/>{{company}}</p>',
   true, false, NULL, NULL, 120),

  -- 10) Internal — New Hire Introduction
  ('internal_new_hire_intro',
   'Internal — New Hire Introduction',
   'internal',
   NULL,
   'Cheers to New Faces! Introducing {{employee_name}} to the Team {{company}}',
   '<p>Dear Team,</p><p>I am thrilled to announce that we have a new addition to our {{company}} Team and I am sure you will join me in extending a warm welcome to <strong>{{employee_name}}</strong>.</p><p>{{employee_name}} hails from {{from_location}} and has worked as a {{previous_role}}. They have joined us as a <strong>"{{role}}"</strong> and we are highly enthusiastic about witnessing them apply their experience and educational background to contribute to the growth of our business.</p><p>{{employee_name}} will report to {{reporting_manager}} and collaborate closely with them. {{employee_name}} shall be working from the <strong>{{office_location}}</strong> and you can reach them at <strong>{{phone}}</strong> and <strong>{{work_email}}</strong> so be sure to drop by and say hello and take a moment to introduce yourselves. A warm and friendly welcome can go a long way in making someone feel at home.</p><p>Once again, welcome {{employee_name}}. We are delighted to have you with us and look forward to achieving great things together.</p><p>Warm Regards,<br/>HR Department<br/>{{company}}</p>',
   true, false, NULL, NULL, NULL),

  -- 11) Probation Confirmation
  ('internal_probation_confirmation',
   'Internal — Probation Confirmation',
   'internal',
   NULL,
   'Congratulations on the Completion of the Probation Period',
   '<p>Dear {{employee_name}},</p><p>We are pleased to inform you that, following a thorough evaluation of your performance during the probationary period, your employment has been confirmed for the position of <strong>{{position}}</strong> at {{company}} with effect from <strong>{{confirmation_date}}</strong>.</p><p>The Probation confirmation letter is attached to this mail, you are requested to share the signed scanned copy of the same for our records.</p><p>As you progress in your role, we encourage you to maintain the same dedication and enthusiasm you exhibited during your probationary period. This confirmation reflects our confidence in your abilities and opens up additional opportunities for professional development and growth within our organization.</p><p>Warm Regards,<br/>HR Department<br/>{{company}}</p>',
   true, false, NULL, NULL, NULL),

  -- 12) Referral Bonus
  ('internal_referral_bonus',
   'Internal — Referral Bonus',
   'internal',
   NULL,
   'Congratulations on Your Successful Referral!',
   '<p>Dear {{referrer_name}},</p><p>I am pleased to inform you that the candidate you referred to, <strong>{{referred_candidate}}</strong>, has joined our team at {{company}}. We appreciate your recommendation and the effort you put into referring such a talented individual to our organization.</p><p>We are happy to inform you that, according to our referral policy, you will receive a bonus of <strong>{{referral_bonus}}</strong> once {{referred_candidate}} completes <strong>{{tenure_months}} months</strong> of working with {{company}}. We are grateful for your significant contribution to our hiring process, and this incentive is our way of saying thanks.</p><p>We believe that {{referred_candidate}} will make a significant impact on our team, and we are excited to welcome them aboard. Your recommendation reflects your confidence in our company, and we are grateful for your support!</p><p>Warm Regards,<br/>HR Department<br/>{{company}}</p>',
   true, false, NULL,
   '{"referral_bonus": "₹10,000 INR", "tenure_months": "6"}'::jsonb,
   NULL)
ON CONFLICT ("key") DO NOTHING;

-- ── OfferLetter ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OfferLetter" (
  "id"                 SERIAL PRIMARY KEY,
  "applicationId"      INTEGER NOT NULL,
  "status"             TEXT NOT NULL DEFAULT 'draft',
  "ctcAnnual"          DECIMAL(12, 2),
  "joiningDate"        TIMESTAMP(3),
  "expiresAt"          TIMESTAMP(3),
  "bodyHtml"           TEXT,
  "attachmentFileName" TEXT,
  "attachmentMime"     TEXT,
  "attachmentBlob"     BYTEA,
  "acceptedAt"         TIMESTAMP(3),
  "declinedAt"         TIMESTAMP(3),
  "revokedAt"          TIMESTAMP(3),
  "createdById"        INTEGER,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfferLetter_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE,
  CONSTRAINT "OfferLetter_createdById_fkey"   FOREIGN KEY ("createdById")   REFERENCES "User"("id")          ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "OfferLetter_applicationId_idx" ON "OfferLetter"("applicationId");
CREATE INDEX IF NOT EXISTS "OfferLetter_status_idx"        ON "OfferLetter"("status");

-- ── CandidateActivity ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CandidateActivity" (
  "id"            SERIAL PRIMARY KEY,
  "applicationId" INTEGER NOT NULL,
  "kind"          TEXT NOT NULL,
  "summary"       TEXT NOT NULL,
  "meta"          JSONB,
  "actorId"       INTEGER,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CandidateActivity_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE,
  CONSTRAINT "CandidateActivity_actorId_fkey"       FOREIGN KEY ("actorId")       REFERENCES "User"("id")          ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "CandidateActivity_applicationId_idx" ON "CandidateActivity"("applicationId");
CREATE INDEX IF NOT EXISTS "CandidateActivity_kind_idx"          ON "CandidateActivity"("kind");
CREATE INDEX IF NOT EXISTS "CandidateActivity_createdAt_idx"     ON "CandidateActivity"("createdAt");
