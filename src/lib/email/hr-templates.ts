// NB Media — HR hiring-pipeline email templates.
//
// Source of truth: docs/HR_EMAIL_TEMPLATES.md (transcribed verbatim from
// the HR-provided EMAIL TEMPLATES.docx). Greeting / opening / sign-off
// conventions are preserved as written:
//   - Greeting:   "Dear {Candidate Name},"
//   - Opening:    "Greetings from NB Media!"
//   - Sign-off:   "Warms Regards, HR Department, NB-Media"
//
// Each template returns { subject, body } where body is PLAIN TEXT with
// newlines. The hiring modals convert `\n` → `<br/>` at send time, so
// keep template bodies plain — no HTML in here.

export type HRTemplate = { subject: string; body: string };

// Sign-off for INTERNAL emails (team announcements, probation
// confirmation, referral bonus — recipient is already at NB Media).
const sign = `Warms Regards,
HR Department
NB-Media`;

// HR contact block — appended to every CANDIDATE-FACING email so the
// applicant knows who to reach out to with questions. Wording / phone /
// email are owned by HR and should be updated here when the assigned
// HR person changes (set HR_CONTACT_NAME / HR_CONTACT_EMAIL /
// HR_CONTACT_PHONE env vars in prod to override without a deploy).
const HR_CONTACT_NAME  = process.env.HR_CONTACT_NAME  ?? "Vanshika";
const HR_CONTACT_EMAIL = process.env.HR_CONTACT_EMAIL ?? "vanshika@nbmediaproductions.com";
const HR_CONTACT_PHONE = process.env.HR_CONTACT_PHONE ?? "8146891380";

const candidateSign = `For more details and queries, you can reach out to the HR Department:
${HR_CONTACT_NAME}
Phone: ${HR_CONTACT_PHONE}
Email: ${HR_CONTACT_EMAIL}

Warms Regards,
HR Department
NB-Media`;

// Used as placeholder when the value isn't known yet at template render
// time. The modal substitutes real values before sending.
const TOKEN = {
  date:          "{{Date}}",
  interview:     "{{InterviewDateTime}}",
  meetLink:      "{{MeetingLink}}",
  officeAddr:    "{{OfficeAddress}}",
  joining:       "{{JoiningDate}}",
  responseBy:    "{{ResponseDeadline}}",
  refBonus:      "{{BonusAmount}}",
  refDuration:   "{{MilestoneDuration}}",
} as const;

// ── 1. Candidate Rejection ───────────────────────────────────────────
export function rejectionEmail(args: { candidateName: string; jobRole: string }): HRTemplate {
  const { candidateName, jobRole } = args;
  return {
    subject: `Your application for the ${jobRole} at NB Media`,
    body:
`Dear ${candidateName},

Greetings from NB Media!

We thank you for your application for the ${jobRole} position at NB Media. We appreciate you for showing interest in joining our company and we thank you for investing your precious time and efforts in applying to our company.

We're fortunate to have received a lot of interest in this role, resulting in a very competitive selection process and after the careful evaluation of your application, we regret to inform you that unfortunately this time we won't be able to move forward with your application.

Thank you once again for your interest in NB-Media, while it didn't work out this time, we hope you will continue to explore other opportunities with NB Media.

We would be happy to reach out again for a relevant position in the future.

${candidateSign}`,
  };
}

// ── 1a. Over-qualified rejection ─────────────────────────────────────
// Softer rejection for candidates whose experience EXCEEDS the role's
// scope. Used when ArchiveCandidateModal's reason = "Over Qualified".
// Wording from HR (Vanshika, 2026-06-18).
export function overQualifiedEmail(args: { candidateName: string; jobRole: string }): HRTemplate {
  const { candidateName, jobRole } = args;
  return {
    subject: `Your application for the ${jobRole} at NB Media`,
    body:
`Dear ${candidateName},

Thank you for taking the time to apply for the ${jobRole} role at NB Media and for sharing your experience with us. We truly appreciate your interest in being part of our team.

After reviewing your profile, we feel that your level of experience exceeds the current requirements for this position.

Please know that this decision is based solely on the role's present scope and not a reflection of your skills or accomplishments. We will, however, retain your profile for any future openings that better align with your experience.

Wishing you continued success in your professional journey.

${candidateSign}`,
  };
}

// ── 1b. Under-qualified rejection ────────────────────────────────────
// Counterpart to overQualifiedEmail — for candidates whose experience
// FALLS SHORT of the role's requirements. Wording from HR (Vanshika,
// 2026-06-18).
export function underQualifiedEmail(args: { candidateName: string; jobRole: string }): HRTemplate {
  const { candidateName, jobRole } = args;
  return {
    subject: `Your application for the ${jobRole} at NB Media`,
    body:
`Dear ${candidateName},

Thank you for taking the time to apply for the ${jobRole} at NB Media and for sharing your experience with us. We truly appreciate your interest in being part of our team.

After carefully reviewing your profile, we feel that your current experience level does not fully align with the requirements of this position. At present, we are seeking candidates with a broader range of experience that closely matches the scope and responsibilities of the role.

Please know that this decision is based solely on the current requirements of the position and is not a reflection of your potential, skills, or achievements. We will retain your profile in our database and may reach out should a suitable opportunity arise in the future that better matches your experience and background.

We sincerely appreciate your interest in NB Media and wish you all the best in your professional journey.

${candidateSign}`,
  };
}

// ── 2. Portfolio Required ────────────────────────────────────────────
export function portfolioRequestEmail(args: {
  candidateName: string; jobRole: string; deadline?: string;
}): HRTemplate {
  const { candidateName, jobRole, deadline } = args;
  return {
    subject: `Portfolio Required - "${jobRole}" role at NB Media`,
    body:
`Dear ${candidateName},

Greetings from NB Media!

We appreciate your interest in the ${jobRole} at NB Media. As part of our ongoing evaluation process, we would like to learn more about your work and accomplishments.

We would request you to share your professional portfolio with us. This could include examples of projects you've worked on, case studies, or any other materials that highlight your skills and experience relevant to the role.

You can send your portfolio as attachments or provide a link to an online portfolio or personal website. Please ensure that your portfolio includes a diverse range of work that showcases your abilities and achievements.

We kindly request that you submit your portfolio by ${deadline ?? TOKEN.date}.

Thank you for your cooperation, and we look forward to reviewing your portfolio.

${candidateSign}`,
  };
}

// ── 3. Work Sample — Script Writer ───────────────────────────────────
export function workSampleScriptWriterEmail(args: {
  candidateName: string; sampleTopicLink?: string;
}): HRTemplate {
  const { candidateName, sampleTopicLink } = args;
  return {
    subject: `Work Sample Required - "Script Writer" role at NB Media`,
    body:
`Dear ${candidateName},

Greetings from NB Media!

We sincerely appreciate your interest in the Script Writer position at NB Media. As part of our ongoing evaluation process, we would like to invite you to share specific work samples that demonstrate your skills and capabilities to assess your qualifications for the position.

Please refer to the below link for detailed instructions on how to submit your work sample, a 1000-word sample script on a predetermined topic.

${sampleTopicLink ?? "{{SampleTopicDocumentLink}}"}

We kindly request that you submit your portfolio within 24 hours.

Should you have any questions or require further clarification on any aspect of the submission process, feel free to reach out to the undersigned.

Thank you for your time and effort in completing this additional step in our recruitment process. We look forward to reviewing your work samples and gaining a deeper understanding of your capabilities!

${candidateSign}`,
  };
}

// ── 4. Work Sample — Video Editor (original) ─────────────────────────
export function workSampleVideoEditorEmail(args: {
  candidateName: string; scriptLink?: string;
}): HRTemplate {
  const { candidateName, scriptLink } = args;
  return {
    subject: `Work Sample Required - "Video Editor" role at NB Media`,
    body:
`Dear ${candidateName},

Greetings from NB Media!

We sincerely appreciate your interest in the Video editor position at NB Media. As part of our ongoing evaluation process, we would like to invite you to share specific work samples that demonstrate your skills and capabilities to assess your qualifications for the position.

Please produce the video referenced in the attached script to this email. You are required to work the following 4 segments in the same sequence.

1). Introduction
2). The life left behind
3). Turning a new page

Script: ${scriptLink ?? "Work Assignment- Video Editor (Script).docx"}

You can use any Transitions, Overlay Effects, Texts and fonts, Graphics, Background music, and sound effects to make the video creative.

For The Voice Part, you may use: https://we.tl/t-BgqCJEISQB

Please go through these references to better understand the output you need to provide in the assignment.
https://www.youtube.com/watch?v=AcNAah1xT6E
https://www.youtube.com/watch?v=rfzBlqfFjSk
https://www.youtube.com/watch?v=DrvJ6qEqDQE

We kindly request that you submit the final video along with the Adobe Premiere Project file of the assignment within 48 hours.

Should you have any questions or require further clarification on any aspect of the submission process, feel free to reach out to the undersigned.

Thank you for your time and effort in completing this additional step in our recruitment process. We look forward to reviewing your work samples and gaining a deeper understanding of your capabilities!

${candidateSign}`,
  };
}

// ── 4b. Work Sample — Video Editor (NEW SAMPLE variant) ──────────────
export function workSampleVideoEditorV2Email(args: { candidateName: string }): HRTemplate {
  const { candidateName } = args;
  return {
    subject: `Work Sample Required - "Video Editor" role at NB Media`,
    body:
`Dear ${candidateName},

Greetings from NB Media!

We sincerely appreciate your interest in the Video editor position at NB Media. As part of our ongoing evaluation process, we would like to invite you to share specific work samples that demonstrate your skills and capabilities to assess your qualifications for the position.

Please produce the video referenced in the attached link to this email.

Kindly find files in the attachment below:
https://drive.google.com/drive/folders/1LnPuFt9_DnwbzXQI_87wKGmUUTKX_02y?usp=sharing

You can use any Transitions, Overlay Effects, Texts and fonts, Graphics, Background music, and sound effects to make the video creative. You can also do online research to find more data (Photos/Videos) related to the particular assignment.

Please go through these references to better understand the output you need to provide in the assignment.
https://www.youtube.com/watch?v=AcNAah1xT6E
https://www.youtube.com/watch?v=rfzBlqfFjSk
https://www.youtube.com/watch?v=DrvJ6qEqDQE

We kindly request that you submit the final video along with the Adobe Premiere Project file of the assignment within 48 hours.

Should you have any questions or require further clarification on any aspect of the submission process, feel free to reach out to the undersigned.

${candidateSign}`,
  };
}

// ── 5. Work Sample — Graphic Designer ────────────────────────────────
export function workSampleGraphicDesignerEmail(args: {
  candidateName: string; scriptLink?: string;
}): HRTemplate {
  const { candidateName, scriptLink } = args;
  return {
    subject: `Work Sample Required - "Graphic Designer" role at NB Media`,
    body:
`Dear ${candidateName},

Greetings from NB Media!

We sincerely appreciate your interest in the Graphic Designer position at NB Media. As part of our ongoing evaluation process, we would like to invite you to share specific work samples that demonstrate your skills and capabilities to assess your qualifications for the position.

Please produce the designs referenced in the attached script to this email. You are required to complete two tasks.

Script: ${scriptLink ?? "Work Assignment- Graphic Designer (Script).docx"}

Please go through the references that are attached to this email.

We kindly request that you submit the final JPG Files and PSD Files of the assignment within 48 hours.

Should you have any questions or require further clarification on any aspect of the submission process, feel free to reach out to the undersigned.

Thank you for your time and effort in completing this additional step in our recruitment process. We look forward to reviewing your work samples and gaining a deeper understanding of your capabilities!

${candidateSign}`,
  };
}

// ── 6. Technical Interview Round ─────────────────────────────────────
export function technicalRoundEmail(args: {
  candidateName: string;
  jobRole: string;
  interviewDateTime?: string;
  meetingLink?: string;
}): HRTemplate {
  const { candidateName, jobRole, interviewDateTime, meetingLink } = args;
  return {
    subject: `Invitation for Technical Interview Round for ${jobRole} at NB Media`,
    body:
`Dear ${candidateName},

Greetings from NB Media!

We would like to express our appreciation for your participation in the previous rounds of our interview process. After careful consideration, we are pleased to inform you that you have successfully cleared the initial stages of the Selection Process.

Congratulations on your accomplishment!

The next step in our selection process is the Technical Interview Round. The interview will be conducted virtually via Google Meet where you will have the opportunity to showcase your technical abilities and discuss your experience with our team. Please be prepared to discuss your technical skills and experiences during this session.

Meeting Link:
${interviewDateTime ?? TOKEN.interview}
Video call link: ${meetingLink ?? TOKEN.meetLink}

Should you have any questions or require further information about the Technical Interview Round, please feel free to contact the undersigned.

Once again, congratulations on your progress, and we look forward to a productive and insightful technical discussion.

${candidateSign}`,
  };
}

// ── 7. Final Interview Round ─────────────────────────────────────────
// Mirrors the Technical Round body structure paragraph-for-paragraph
// so the two rounds read as siblings of the same template family.
// Only the round-specific wording changes:
//   • "initial stages"  → "all the previous rounds"
//   • "showcase your technical abilities + discuss experience"
//     → "meet key members of our team + discuss responsibilities
//        of the {jobRole} position"
//   • "productive and insightful technical discussion"
//     → "meeting with you for the final interview"
// Onsite mode swaps in the office address line.
export function finalRoundEmail(args: {
  candidateName: string;
  jobRole: string;
  interviewDateTime?: string;
  meetingLink?: string;
  officeAddress?: string;
  mode?: "online" | "onsite";
}): HRTemplate {
  const { candidateName, jobRole, interviewDateTime, meetingLink, officeAddress, mode = "online" } = args;
  const venueLine = mode === "onsite"
    ? `The next step in our selection process is the Final Interview Round. The interview will be held at ${officeAddress ?? TOKEN.officeAddr}, where you will meet key members of our team and discuss the specific responsibilities of the ${jobRole} position. Please come prepared to engage in discussions about your experiences, skills, and how you envision contributing to our team.`
    : `The next step in our selection process is the Final Interview Round. The interview will be conducted virtually via Google Meet where you will have the opportunity to meet key members of our team and discuss the specific responsibilities of the ${jobRole} position. Please come prepared to engage in discussions about your experiences, skills, and how you envision contributing to our team.`;
  return {
    subject: `Invitation for Final Interview Round for ${jobRole} at NB Media`,
    body:
`Dear ${candidateName},

Greetings from NB Media!

We would like to express our appreciation for your participation in the previous rounds of our interview process. After careful consideration, we are pleased to inform you that you have successfully cleared all the previous rounds of the Selection Process.

Congratulations on your accomplishment!

${venueLine}

Meeting Link:
${interviewDateTime ?? TOKEN.interview}
Video call link: ${meetingLink ?? TOKEN.meetLink}

Should you have any questions or require further information about the Final Interview Round, please feel free to contact the undersigned.

Once again, congratulations on your progress, and we look forward to meeting with you for the final interview.

${candidateSign}`,
  };
}

// ── 8. Selection — Documents Request ─────────────────────────────────
export function selectionDocumentsRequestEmail(args: {
  candidateName: string; jobRole: string;
}): HRTemplate {
  const { candidateName, jobRole } = args;
  return {
    subject: `Congratulations on Your Selection as "${jobRole}" at NB Media`,
    body:
`Dear ${candidateName},

Greetings from NB Media!

I hope this email finds you well! It is with great pleasure that I extend my heartfelt congratulations on behalf of NB Media for being selected as ${jobRole}. Your skills and qualifications truly stood out during the interview process, and we are excited to welcome you to our team.

We kindly request you to provide the following documents at your earliest convenience for the provision of the offer letter:

1. Previous 3 months' salary slips / bank transaction proofs.
2. Aadhaar Card
3. Estimated date by which you shall provide us with your experience letter from your previous employer.
4. 2 or 3 References from previous employers.

Please be assured that all the information provided will be treated confidentially and used solely for employment-related purposes.

Feel free to contact me if you have any questions or need further assistance.

Once again, congratulations on your well-deserved success, and we look forward to working together at NB Media.

${candidateSign}`,
  };
}

// ── 9. Offer Letter ──────────────────────────────────────────────────
export function offerLetterEmail(args: {
  candidateName: string;
  jobRole: string;
  joiningDate?: string;
  responseDeadline?: string;
}): HRTemplate {
  const { candidateName, jobRole, joiningDate, responseDeadline } = args;
  return {
    subject: `Congratulations on Your Selection as "${jobRole}" at NB Media`,
    body:
`Dear ${candidateName},

Greetings from NB Media!

We are delighted to extend an offer of employment to you for the position of ${jobRole} at NB Media commencing on ${joiningDate ?? TOKEN.joining}. We were impressed with your qualifications, experience, and the positive impression you left during the interview process.

Please review the enclosed Job offer letter, which outlines the terms and conditions of your employment with NB-Media, and provide your response by ${responseDeadline ?? TOKEN.responseBy}. We believe that your skills and expertise will be a valuable addition to our team, and we are excited about the prospect of working together.

Furthermore, we wish to express our gratitude for your active involvement in the selection procedure. Thus far, we have thoroughly enjoyed the interactions. We hope that you had a similar pleasant experience.

Thank you for considering this opportunity, and we anticipate a positive response from you.

${candidateSign}`,
  };
}

// ── 10. Team Welcome (internal announcement) ─────────────────────────
export function teamWelcomeEmail(args: {
  newJoinerName: string;
  firstName: string;
  homeCity?: string;
  priorRole?: string;
  jobRole: string;
  managerName?: string;
  officeLocation?: string;
  phone?: string;
  workEmail: string;
  pronoun?: "he" | "she" | "they";
}): HRTemplate {
  const { newJoinerName, firstName, jobRole, workEmail, pronoun = "they" } = args;
  // Optional bits — render the sentence gracefully when a value is
  // missing instead of emitting a raw {{placeholder}} into the email.
  const homeCity       = (args.homeCity || "").trim();
  const priorRole      = (args.priorRole || "").trim();
  const managerName    = (args.managerName || "").trim();
  const officeLocation = (args.officeLocation || "").trim();
  const phone          = (args.phone || "").trim();
  const subj = { he: "He",   she: "She",  they: "They" }[pronoun];
  const obj  = { he: "him",  she: "her",  they: "them" }[pronoun];
  const poss = { he: "his",  she: "her",  they: "their" }[pronoun];

  // Background clause — only include the parts we actually have.
  let background = "";
  if (homeCity && priorRole) background = `${firstName} hails from ${homeCity} and has worked as a ${priorRole}. `;
  else if (homeCity)         background = `${firstName} hails from ${homeCity}. `;
  else if (priorRole)        background = `${firstName} has worked as a ${priorRole}. `;
  // "They have joined" vs "He/She has joined"; standalone uses the name.
  const joinSubject = background ? subj : firstName;
  const joinAux     = background && pronoun === "they" ? "have" : "has";
  const para2 = `${background}${joinSubject} ${joinAux} joined us as a "${jobRole}" and we are highly enthusiastic about witnessing ${obj} apply ${poss} experience and educational background to contribute to the growth of our business.`;

  // Reporting + how-to-reach. Drop the manager / office clauses cleanly
  // when unknown so the prose still reads naturally.
  const reportClause = managerName
    ? `${firstName} will report to ${managerName} and collaborate closely with ${obj}. `
    : `${firstName} will collaborate closely with the team. `;
  const reach = [phone, workEmail].filter(Boolean).join(" and ");
  const reachSentence = officeLocation
    ? `${subj} shall be working from the ${officeLocation} office and you can reach ${obj} at ${reach} so be sure to drop by and say hello and take a moment to introduce yourselves to ${obj}.`
    : `You can reach ${obj} at ${reach} so be sure to drop by and say hello and take a moment to introduce yourselves to ${obj}.`;
  const para3 = `${reportClause}${reachSentence} A warm and friendly welcome can go a long way in making someone feel at home.`;

  return {
    subject: `Cheers to New Faces! Introducing ${newJoinerName} to the Team NB Media`,
    body:
`Dear Team,

I am thrilled to announce that we have a new addition to our NB Media Team and I am sure you will join me in extending a warm welcome to ${newJoinerName}.

${para2}

${para3}

Once again, welcome @${firstName}. We are delighted to have you with us and look forward to achieving great things together.

${sign}`,
  };
}

// ── 10b. Team Welcome — rich HTML version ────────────────────────────
// Same copy as teamWelcomeEmail() above (kept verbatim with the approved
// doc), but rendered as the centered, formatted announcement HR actually
// sends: every paragraph centered, key terms bold, the work email a
// mailto link, and the new joiner's photo embedded inline + centered
// between the intro and the reporting paragraphs. The photo rides the
// existing inline-CID pipeline (sender.ts already does this for the logo)
// — pass `photoSrc: "cid:joinerPhoto"` for a real send, or a data: URI
// for an in-app preview. Title ("Ms." / "Mr.") is derived from gender by
// the caller. Sign-off stays the generic "HR Department / NB-Media".
function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export function teamWelcomeEmailHtml(args: {
  newJoinerName: string;
  firstName: string;
  homeCity?: string;
  priorRole?: string;
  jobRole: string;
  managerName?: string;
  officeLocation?: string;
  phone?: string;
  workEmail: string;
  pronoun?: "he" | "she" | "they";
  managerPronoun?: "he" | "she" | "they"; // for "collaborate closely with him/her/them"
  title?: string;       // "Ms." | "Mr." | "" — caller derives from gender
  photoSrc?: string;    // "cid:joinerPhoto" (send) or a data: URI (preview)
}): { subject: string; html: string } {
  const { newJoinerName, firstName, jobRole, workEmail, pronoun = "they", title = "" } = args;
  const homeCity       = (args.homeCity || "").trim();
  const priorRole      = (args.priorRole || "").trim();
  const managerName    = (args.managerName || "").trim();
  const officeLocation = (args.officeLocation || "").trim();
  const phone          = (args.phone || "").trim();
  const subj = { he: "He",  she: "She",  they: "They" }[pronoun];
  const obj  = { he: "him", she: "her",  they: "them" }[pronoun];
  const poss = { he: "his", she: "her",  they: "their" }[pronoun];

  const nameBold = `<strong>${escHtml((title ? `${title} ` : "") + newJoinerName)}</strong>`;
  const fName    = escHtml(firstName);

  // Para 1
  const p1 = `I am thrilled to announce that we have a new addition to our <strong>NB Media</strong> Team and I am sure you will join me in extending a warm welcome to ${nameBold}.`;

  // Para 2 — background + role (graceful drop, same logic as plain version)
  let background = "";
  if (homeCity && priorRole) background = `${fName} hails from ${escHtml(homeCity)} and has worked as a ${escHtml(priorRole)}. `;
  else if (homeCity)         background = `${fName} hails from ${escHtml(homeCity)}. `;
  else if (priorRole)        background = `${fName} has worked as a ${escHtml(priorRole)}. `;
  const joinSubject = background ? subj : fName;
  const joinAux     = background && pronoun === "they" ? "have" : "has";
  const p2 = `${background}${joinSubject} ${joinAux} joined us as a <strong>"${escHtml(jobRole)}"</strong> and we are highly enthusiastic about witnessing ${obj} apply ${poss} experience and educational background to contribute to the growth of our business.`;

  // Inline, centered photo — only when one is supplied.
  const photoBlock = args.photoSrc
    ? `<div style="text-align:center;margin:24px 0;"><img src="${args.photoSrc}" alt="${escHtml(newJoinerName)}" style="max-width:360px;width:80%;height:auto;border-radius:4px;" /></div>`
    : "";

  // Para 3 — reporting + how to reach (email as a mailto link). The
  // "collaborate closely with X" refers to the MANAGER, so it uses the
  // manager's pronoun (defaults to gender-neutral "them" when unknown),
  // not the joiner's.
  const mgrObj = args.managerPronoun
    ? { he: "him", she: "her", they: "them" }[args.managerPronoun]
    : "them";
  const reportClause = managerName
    ? `${fName} will report to ${escHtml(managerName)} and collaborate closely with ${mgrObj}. `
    : `${fName} will collaborate closely with the team. `;
  const emailLink = workEmail ? `<a href="mailto:${escHtml(workEmail)}" style="color:#1155cc;">${escHtml(workEmail)}</a>` : "";
  const reach = [phone ? `<strong>${escHtml(phone)}</strong>` : "", emailLink].filter(Boolean).join(" and ");
  const reachTail = `you can reach ${obj} at ${reach} so be sure to drop by and say hello and take a moment to introduce yourselves to ${obj}.`;
  const reachSentence = officeLocation
    ? `${subj} shall be working from the <strong>${escHtml(officeLocation)} office</strong> and ${reachTail}`
    : `${reachTail.charAt(0).toUpperCase()}${reachTail.slice(1)}`;
  const p3 = `${reportClause}${reachSentence} A warm and friendly welcome can go a long way in making someone feel at home.`;

  const closing = `Once again, welcome @${fName}. We are delighted to have you with us and look forward to achieving great things together.`;

  const C = (inner: string) => `<div style="text-align:center;margin:0 0 16px;">${inner}</div>`;
  const html =
`<div style="font-family:'Times New Roman',Times,serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:680px;margin:0 auto;">
${C("Dear Team,")}
${C(p1)}
${C(p2)}
${photoBlock}
${C(p3)}
${C(closing)}
<div style="text-align:left;margin-top:8px;">Warms Regards,<br/>HR Department<br/><strong>NB-Media</strong></div>
</div>`;

  return {
    subject: `Cheers to New Faces! Introducing ${newJoinerName} to the Team NB Media`,
    html,
  };
}

// ── 11. Probation Confirmation ───────────────────────────────────────
export function probationConfirmationEmail(args: {
  employeeName: string;
  jobRole: string;
  confirmationDate: string;
}): HRTemplate {
  const { employeeName, jobRole, confirmationDate } = args;
  return {
    subject: `Congratulations on the Completion of the Probation Period`,
    body:
`Dear ${employeeName},

We are pleased to inform you that, following a thorough evaluation of your performance during the probationary period, we are pleased to inform you that your employment has been confirmed for the position of ${jobRole} at NB Media with effect from ${confirmationDate}.

The Probation confirmation letter is attached to this mail, you are requested to share the signed scanned copy of the same for our records.

As you progress in your role, we encourage you to maintain the same dedication and enthusiasm you exhibited during your probationary period. This confirmation reflects our confidence in your abilities and opens up additional opportunities for professional development and growth within our organization.

${sign}`,
  };
}

// ── 12. Successful Referral Bonus ────────────────────────────────────
export function referralBonusEmail(args: {
  referrerName: string;
  referredCandidateName: string;
  bonusAmount?: string;
  milestoneDuration?: string;
}): HRTemplate {
  const {
    referrerName, referredCandidateName,
    bonusAmount = "10,000 INR",
    milestoneDuration = "6 months",
  } = args;
  return {
    subject: `Congratulations on Your Successful Referral!`,
    body:
`Dear ${referrerName},

I am pleased to inform you that the candidate you referred to, ${referredCandidateName}, has joined our team at NB Media. We appreciate your recommendation and the effort you put into referring such a talented individual to our organization.

We are happy to inform you that, according to our referral policy, you will receive a bonus of ${bonusAmount} once ${referredCandidateName} completes ${milestoneDuration} of working with NB-Media. We are grateful for your significant contribution to our hiring process, and this incentive is our way of saying thanks.

We believe that ${referredCandidateName} will make a significant impact on our team, and we are excited to welcome them aboard. Your recommendation reflects your confidence in our company, and we are grateful for your support!

${sign}`,
  };
}

// ── Template registry for HR-side modal pickers ──────────────────────
// The kebab "Send Email" action lets HR pick one of these as a starting
// point. Keys are stable; labels show in the dropdown.

// ── Stage-aware template selection ────────────────────────────────
// Maps HiringStage.key (canonical, lowercase_snake) to the template
// HR most likely wants when sending a generic email from a candidate
// at that stage. Used by CandidateActionModal (Send Email kebab) to
// pre-select the right template instead of always starting blank.
//
// Returns "custom" when the stage has no obvious match — HR composes
// freely, or picks from the dropdown.
export function stageToTemplate(stageKey: string | null | undefined): HRTemplateKey {
  switch ((stageKey ?? "").toLowerCase()) {
    case "screening":   return "portfolio_request";
    case "offer":       return "selection_documents_request";
    case "sourced":
    case "phone_screen":
    case "tech_interview":  // handled by Schedule Interview modal
    case "manager_round":   // handled by Schedule Interview modal
    case "hired":           // handled by Team Welcome + Welcome login
    case "rejected":        // handled by Archive modal
    default:
      return "custom";
  }
}

// Stage → interview round for ScheduleInterviewModal. Lets HR open
// Schedule from a Manager Round candidate and have "Final Round" pre-
// selected instead of always defaulting to Technical.
export type InterviewRoundKey = "technical" | "final";
export function stageToInterviewRound(stageKey: string | null | undefined): InterviewRoundKey {
  switch ((stageKey ?? "").toLowerCase()) {
    case "manager_round":
    case "offer":        // post-final but pre-offer; assume HR scheduling a closing call
      return "final";
    case "tech_interview":
    case "phone_screen":
    case "screening":
    case "sourced":
    default:
      return "technical";
  }
}

export type HRTemplateKey =
  | "custom"
  | "portfolio_request"
  | "work_sample_script_writer"
  | "work_sample_video_editor"
  | "work_sample_video_editor_v2"
  | "work_sample_graphic_designer"
  | "selection_documents_request"
  | "offer_letter"
  | "probation_confirmation"
  | "referral_bonus";

export const HR_TEMPLATE_OPTIONS: { key: HRTemplateKey; label: string }[] = [
  { key: "custom",                        label: "Custom (blank)" },
  { key: "portfolio_request",             label: "Portfolio Required" },
  { key: "work_sample_script_writer",     label: "Work Sample — Script Writer" },
  { key: "work_sample_video_editor",      label: "Work Sample — Video Editor" },
  { key: "work_sample_video_editor_v2",   label: "Work Sample — Video Editor (alt)" },
  { key: "work_sample_graphic_designer",  label: "Work Sample — Graphic Designer" },
  { key: "selection_documents_request",   label: "Selection — Documents Request" },
  { key: "offer_letter",                  label: "Offer Letter" },
  { key: "probation_confirmation",        label: "Probation Confirmation" },
  { key: "referral_bonus",                label: "Successful Referral Bonus" },
];

export function buildHRTemplate(
  key: HRTemplateKey,
  ctx: { candidateName: string; jobRole: string },
): HRTemplate {
  switch (key) {
    case "portfolio_request":            return portfolioRequestEmail(ctx);
    case "work_sample_script_writer":    return workSampleScriptWriterEmail({ candidateName: ctx.candidateName });
    case "work_sample_video_editor":     return workSampleVideoEditorEmail({ candidateName: ctx.candidateName });
    case "work_sample_video_editor_v2":  return workSampleVideoEditorV2Email({ candidateName: ctx.candidateName });
    case "work_sample_graphic_designer": return workSampleGraphicDesignerEmail({ candidateName: ctx.candidateName });
    case "selection_documents_request":  return selectionDocumentsRequestEmail(ctx);
    case "offer_letter":                 return offerLetterEmail(ctx);
    case "probation_confirmation":       return probationConfirmationEmail({
      employeeName: ctx.candidateName, jobRole: ctx.jobRole,
      confirmationDate: TOKEN.date,
    });
    case "referral_bonus":               return referralBonusEmail({
      referrerName: ctx.candidateName, referredCandidateName: "{{ReferredCandidateName}}",
    });
    case "custom":
    default:
      return { subject: "", body: `Dear ${ctx.candidateName},\n\n` };
  }
}
