// NB Media — official offer letter generator.
//
// Source of truth: docs/OFFER_LETTER_TEMPLATE.md
// (transcribed verbatim from Revised-Offer-Letter-Format.pdf).
//
// HR enters a candidate's name + role + CTC + dates in the New Offer
// modal; calling `buildOfferLetter(args)` returns:
//   • `body`         — the page-1 letter text (shown in the textarea)
//   • `breakdown`    — auto-computed monthly pay split (Annexure A)
//   • `fullHtml`     — print-ready HTML covering all 5 pages
//                      (letterhead, letter, T&Cs, acceptance, annexures)
//
// HR can edit the textarea body before saving; the printable HTML
// re-renders from the (possibly edited) body so changes flow through
// to the PDF.

export type OfferLetterArgs = {
  candidateName:      string;
  jobRole:            string;
  annualCtcINR:       number | null;   // raw rupees; null when unknown
  joiningDate?:       Date | string | null;
  acceptanceDeadline?: Date | string | null;
  applicationDate?:   Date | string | null;
  letterDate?:        Date | string | null;
  hrContactEmail?:    string;          // for the closing query line
};

export type PayBreakdown = {
  basic:        number;
  hra:          number;
  da:           number;
  conveyance:   number;
  medical:      number;
  special:      number;
  totalMonthly: number;
  annualLPA:    string;   // "5" / "5.5" / "6.25" — for the Annexure header
};

export type OfferLetterRender = {
  body:      string;           // page-1 letter (editable)
  breakdown: PayBreakdown | null;
  fullHtml:  string;           // print-ready full document
};

// ── Pay breakdown ────────────────────────────────────────────────
// Standard private-sector split for Indian payroll:
//   Basic       = 40% of monthly gross
//   HRA         = 50% of Basic
//   DA          = 0 (private companies typically don't pay DA)
//   Conveyance  = ₹1,600 (capped — Income Tax exemption ceiling)
//   Medical     = ₹1,250 (capped)
//   Special     = balancer (Total − every other component)
// All values rounded to the nearest rupee; Special absorbs the rounding.
export function computePayBreakdown(annualCtcINR: number | null | undefined): PayBreakdown | null {
  if (!annualCtcINR || annualCtcINR <= 0 || !Number.isFinite(annualCtcINR)) return null;
  const monthly    = Math.round(annualCtcINR / 12);
  const basic      = Math.round(monthly * 0.40);
  const hra        = Math.round(basic   * 0.50);
  const da         = 0;
  const conveyance = Math.min(1600, monthly);
  const medical    = Math.min(1250, monthly);
  // Special is the balancer — can never go negative; clamp to 0 for
  // very small CTCs where fixed allowances would already exceed gross.
  const special = Math.max(0, monthly - basic - hra - da - conveyance - medical);
  return {
    basic, hra, da, conveyance, medical, special,
    totalMonthly: monthly,
    annualLPA: (annualCtcINR / 100_000).toFixed(2).replace(/\.00$/, ""),
  };
}

// ── Helpers ──────────────────────────────────────────────────────
const fmtINR = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const fmtLong = (d: Date | string | null | undefined, fallback = "DD/MM/YYYY") => {
  if (!d) return fallback;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return fallback;
  // "10th January 2024" style — matches the template's letter date.
  const day   = dt.getDate();
  const month = dt.toLocaleString("en-IN", { month: "long" });
  const year  = dt.getFullYear();
  const suffix = (day % 10 === 1 && day !== 11) ? "st"
               : (day % 10 === 2 && day !== 12) ? "nd"
               : (day % 10 === 3 && day !== 13) ? "rd" : "th";
  return `${day}${suffix} ${month} ${year}`;
};

const fmtSlash = (d: Date | string | null | undefined, fallback = "DD/MM/YYYY") => {
  if (!d) return fallback;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return fallback;
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${dt.getFullYear()}`;
};

const esc = (s: string) => s
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// ── Page 1 — Letter body ─────────────────────────────────────────
function letterBody(args: OfferLetterArgs): string {
  const letterDate        = fmtLong(args.letterDate ?? new Date());
  const applicationDate   = fmtLong(args.applicationDate ?? null, "—");
  const joiningSlash      = fmtSlash(args.joiningDate ?? null);
  const acceptanceSlash   = fmtSlash(args.acceptanceDeadline ?? null);

  return `${letterDate}

Dear "${args.candidateName || "Candidate Name"}"

With reference to your application dated "${applicationDate}" and subsequent interview with us, we are pleased to offer you employment for the position of "${args.jobRole || "Job Role"}" with YT Money Productions Pvt. Ltd. (operating under the brand name NB Media). We trust that your knowledge, skills, and experience will be among our most valuable assets.

Annexure "B" below includes your joining requirement information. Your compensation details will be communicated to you separately.

Your signing of these documents confirms your acceptance of the terms and conditions.

Joining Date: ${joiningSlash}
Reporting Time: 10:00 AM
Location: Cyber Cube, C 201- 202, Phase 8B, Industrial Area, Sector 74, Sahibzada Ajit Singh Nagar, Mohali Punjab 160055
Employment Type: Full-Time
Working Hours: 09:00 AM to 6.00 PM (Monday to Friday)
*Please note that Saturdays are flexi-offs.

Kindly acknowledge your acceptance by signing the document, and confirming the joining date by ${acceptanceSlash}.

Failure to accept prior to the specified deadline will render this offer null and void automatically.

For any further questions or concerns feel free to reach us.

We extend our heartfelt wishes for an exceptional tenure aboard!`;
  // Note: the closing "Regards, Nikit Bassi, Founder & CEO" block is
  // NOT part of the editable body — it's rendered as a fixed
  // signature block in buildOfferLetterHTML so HR can't accidentally
  // delete it.
}

// ── Terms & Conditions — verbatim 25 clauses (pages 2–3) ─────────
// Only the "{{jobRole}}" reference in the lead-in gets substituted.
const TERMS_AND_CONDITIONS = (jobRole: string) => `Following are the terms and conditions in reference to your employment as "${jobRole || "Job Role"}" at <strong>YT Money Productions Pvt. Ltd.</strong> (operating under the brand name NB Media.)

<ol>
<li>You will be on probation for a period of three months, which may be extended by another three months at the sole discretion of the management. On satisfied completion of the probation period/extended probation period, your positions shall be confirmed as permanent. During this period, you will not be eligible for any bonuses, perks, or benefits given to permanent employees.</li>

<li>Upon attaining the status of a permanent employee, you are required to remain in our organization for a minimum of one year, unless otherwise determined by management (for reasons such as poor performance, disciplinary action, or similar factors). Neglecting to do so will result in the forfeiture of compensation that is owed to you.</li>

<li>You shall be entitled to salary allowances and perquisites as separately communicated to you. In addition, you shall be entitled to receive such insurance, health, and other benefits that the company may, at its discretion, make available to its employees as stipulated in the relevant provisions of the employee policy, in accordance with the terms and requirements relating to the benefits imposed by the company. Individual salary and performance ratings should strictly not be shared with other employees.</li>

<li>You acknowledge and undertake that your remuneration is a matter purely between yourself and the company, and you are to keep this information and any changes thereto strictly confidential. Your remuneration will be periodically reviewed as per organization guidelines. Your increments and promotions shall be at the discretion of the organization and will be subject to and based on performance.</li>

<li>Your hours of work shift, and timing shall be governed by the exigencies of working as determined by the management from time to time at its discretion. A working day shall comprise Nine (9) hours, irrespective of shifts, with a break for an hour (in the aggregate).</li>

<li>You will be governed by and will abide by the company's guidelines/code of conduct, and policies, which are in force and may be modified from time to time. The guidelines/code of conduct and policies are deemed to be incorporated herein by reference.</li>

<li>Your employment with the company is on a full-time basis. While you are in the services of the company, you are not permitted to directly or indirectly, without permission of management, engage yourself or devote any time or attention to any full-time or part-time employment, trade business, or occupation with or without remuneration for any third person or concern (including self-employment). You shall also not undertake or be interested, either directly or indirectly, in any activities that are contrary to or inconsistent with your employment with the company or the company's interests. You shall devote yourself exclusively to the business of the company. Any breach of this condition on your part may lead to the immediate termination of employment with the company.</li>

<li>Confidential information pertaining to the organization, its affiliates, clients, customers, or other entities may be disclosed to you in the course of your employment. It is expected that you consistently uphold the utmost confidence and trust regarding any confidential information, including any that you may have generated. You shall indemnify and hold harmless the company from and against all liabilities, claims, damages, suits, proceedings, costs, and expenses whatsoever caused by or arising from your breach of the terms and conditions set out herein.</li>

<li>During the course of employment, if you conceive of any new or advanced methods, inventions, designs or improvements, processes/systems or prepare any reports, tables, or collection of data in which copyright may subsist or any other form of intellectual property concerning your work and operation of the company, all such developments shall be communicated to the company and shall remain the sole right/property of the company, and you shall execute documents and do all things necessary to enable the company to obtain all rights to the same.</li>

<li>Your entitlement and use of leaves shall be governed as per company policies.</li>

<li>In the event of your resignation or termination, One Month's written notice from you is required. Failure to provide such notice will result in legal action being pursued by the employer. However, management reserves the right to terminate your employment at its discretion without any notice if you breach any of the provisions of this agreement, guidelines/code of conduct, or policies, or if you indulge in any illegal or unlawful activities.</li>

<li>After the termination of employment, you shall immediately return all the properties of the company that are in your possession or custody.</li>

<li>The continuation of your employment will be subject to your being physically and mentally fit. During the tenure of your service, you may be required to undergo a medical checkup at the instance of the company.</li>

<li>Unless you separate earlier, either voluntarily or by the company, you shall retire from the employment of the company on the last day of the month in which you attain your 60th birth anniversary.</li>

<li>You will be responsible for the safekeeping and return in good condition of all the office properties, equipment, books, etc. that may be given to you for office, custody, and charge. You will be responsible for efficient, satisfactory, and economical operation in areas of your responsibility that may be assigned to you from time to time in writing or verbally, and during which time you will act within the framework of the organizational policies and directions laid down by the company from time to time.</li>

<li>The information you provided was the basis for your appointment. You shall inform the company in writing of any changes in such particulars promptly. If at any time it emerges that such particulars were false or incorrect or that any material or relevant information has been suppressed, concealed, or exaggerated, your appointment pursuant hereto shall be considered ineffective, and your employment shall be liable to be terminated by the company forthwith without notice or salary in lieu of notice. This shall be without prejudice to the right of the company to take such action against you as it may be advised.</li>

<li>During the term of employment and for a period of two years thereafter, you shall not induce or attempt to induce on the set any employee of the company to leave the employment of the company.</li>

<li>You covenant and agree that at any time during your employment (whether as an officer, director, partner, proprietor, investor, shareholder, manager, associate, employee, consultant, representative, advisor, agent or otherwise), you will not and will not permit any related party to, for yourself or jointly with any other person, directly or indirectly own, conduct, engage, manage, operate, join, control, finance, invest in, bid for advice or otherwise participate in, or be connected with any business, individual, partnership, firm corporation, limited liability company or other entity in any geography that is in the same or similar business as the company ("competing business").</li>

<li>You shall at all times during the course of your employment in the company (and even after the termination of this agreement concerning the terms contained herein) indemnify and keep indemnified the company, as the case may be, against all losses, damages, claims, interest costs, expenses, liabilities, proceedings, and demands which the company may suffer or incur or which may be made against the company as a result of your acts or omissions during the course of your employment.</li>

<li>Any notice that may be required to be given to you shall be deemed to be duly and properly given if hand-delivered to you personally or sent by registered post to you at your address as per the records available with the company.</li>

<li>This letter of appointment, read with the documents referred to herein, shall be the sole document governing your relationship and supersede all other letters of appointment previously issued and all other agreements, memoranda, documents, and discussions. Only the terms of this agreement will govern our relationship.</li>

<li>Should there be any issue between the Company and the Employee which may require adjudication then the courts of Bathinda shall be the area of Jurisdiction with a total bar on any other place/state/city.</li>

<li>In acceptance of the above, please sign and return the duplicate copy of the letter on or before five days of issuance of this letter, failing which this employee agreement shall stand automatically withdrawn without any further obligation on our side.</li>

<li>In order to facilitate the joining process, we require documents in original from your end, which is mentioned in Annexure 'B'.</li>
</ol>`;

// ── Annexure B — Joining documents checklist (verbatim) ──────────
const JOINING_DOCUMENTS = `<ol>
<li>Educational Passing certificates and mark sheets (10th, 12th/Diploma/Graduation/PG etc.)</li>
<li>Copy of Curriculum Vitae</li>
<li>Passport Sized Photographs</li>
<li>PAN Card</li>
<li>Permanent Address Proof:
  <ol type="a">
    <li>Aadhar Card</li>
    <li>Passport (Optional)</li>
    <li>Voter ID card / Ration card / Driving license / Electricity bill (Optional)</li>
  </ol>
</li>
<li>Current Address Proof (Rent Agreement)</li>
<li>Proof of last 3 month's salary (If applicable)</li>
<li>Experience letter / Service report / Relieving letter of all previous employer/s (If applicable)</li>
<li>Form 16 or receiving of Income Tax Return for last year (If applicable)</li>
<li>Proof of Bank account i.e. Bank passbook, Bank Cheque, Online statement etc.</li>
<li>Marriage certificate (If applicable)</li>
</ol>

<p><strong>Note: You are requested to bring all the above-specified documents in Original & Xerox for joining. These documents are MANDATORY at the time of joining.</strong></p>`;

// ── Print HTML for the full multi-page document ─────────────────
// Uses the (possibly HR-edited) page-1 body so any tweaks flow into
// the PDF. Annexure A is regenerated from the latest breakdown so HR
// doesn't have to keep numbers in sync manually.
export function buildOfferLetterHTML(args: OfferLetterArgs & { editedBody?: string }): string {
  // Annexure A (compensation structure) is intentionally NOT rendered —
  // candidates don't get a CTC table on the formal letter. HR captures
  // the package in the New Offer form for their own records; package
  // specifics are conveyed verbally or in a separate note. If you ever
  // need to re-add it, restore the `annexureA` block + its page-break
  // section from git history.
  const rawBody = args.editedBody?.trim() || letterBody(args);
  // Defensive: legacy rows may have <br/> tags embedded from the old
  // client-side conversion. Strip them back to \n so the renderer's
  // pre-wrap white-space handling restores the visual breaks.
  const cleanBody = rawBody.replace(/<br\s*\/?>/gi, "\n");
  // Render the letter body as proper paragraphs. Splitting on blank
  // lines (one or more) gives us the same visual rhythm as the
  // template — separated paragraphs with consistent spacing, instead
  // of one merged block.
  const bodyHtml = cleanBody
    .split(/\n{2,}/)
    .map((para) => {
      const trimmed = para.trim();
      if (!trimmed) return "";
      // The closing line in the template is centred + bold. Match it
      // case-insensitively so HR edits ("Heartfelt", different
      // capitalisation, etc.) still get the same treatment.
      if (/^we extend our heartfelt wishes/i.test(trimmed)) {
        return `<p class="centred bold">${esc(trimmed).replace(/\n/g, "<br/>")}</p>`;
      }
      // "Failure to accept …" runs as italic in the template.
      if (/failure to accept prior to the specified deadline/i.test(trimmed)) {
        return `<p class="italic">${esc(trimmed).replace(/\n/g, "<br/>")}</p>`;
      }
      return `<p>${esc(trimmed).replace(/\n/g, "<br/>")}</p>`;
    })
    .join("");
  const candidate = esc(args.candidateName || "Candidate Name");
  const role      = esc(args.jobRole       || "Job Role");
  const joining   = esc(fmtSlash(args.joiningDate ?? null));
  const hrEmail   = esc(args.hrContactEmail || "HRD@nbmediaproductions.com");

  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>Offer Letter — ${candidate}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: "Times New Roman", Georgia, serif; font-size: 11.5pt; line-height: 1.55; color: #1f2937; max-width: 760px; margin: 24px auto; padding: 0 28px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; }
  .header .org { font-size: 11pt; line-height: 1.45; }
  .header .org h2 { font-size: 13pt; margin: 0 0 6px; }
  .header .org div { margin-top: 2px; }
  .logo { background: #fff; padding: 2px 4px; font-weight: 700; color: #dc2626; font-size: 18pt; letter-spacing: -0.02em; }
  .note { text-align: center; font-size: 10pt; color: #475569; font-weight: 600; margin: 14px 0; padding: 4px 0; border-top: 1px dashed #cbd5e1; border-bottom: 1px dashed #cbd5e1; }
  h1.title { text-align: center; font-size: 16pt; text-decoration: underline; margin: 22px 0 14px; font-weight: 700; }
  h2.title { text-align: center; font-size: 13.5pt; text-decoration: underline; margin: 24px 0 14px; font-weight: 700; }
  .body p  { font-size: 11.5pt; line-height: 1.75; margin: 0 0 12px; text-align: justify; }
  .body p.centred { text-align: center; }
  .body p.bold    { font-weight: 700; }
  .body p.italic  { font-style: italic; }
  .signature { margin-top: 28px; font-style: italic; font-size: 14pt; }
  .signature-block { margin-top: 6px; font-style: normal; font-size: 11pt; line-height: 1.4; }
  ol { padding-left: 22px; }
  ol li { margin-bottom: 10px; text-align: justify; }
  .acceptance { margin-top: 30px; }
  .acceptance .sig-line { margin-top: 18px; }
  table.paytable { width: 70%; border-collapse: collapse; margin: 18px auto; }
  table.paytable th, table.paytable td { border: 1px solid #475569; padding: 8px 14px; text-align: left; font-size: 11pt; }
  table.paytable th { background: #f1f5f9; font-weight: 700; text-transform: uppercase; font-size: 10pt; }
  table.paytable td:last-child { text-align: right; }
  .bold { font-weight: 700; }
  .underline { text-decoration: underline; }
  .page-break { page-break-before: always; }
  @media print {
    body { margin: 0; max-width: none; padding: 0; }
    .hint { display: none !important; }
  }
  .hint { position: fixed; top: 12px; right: 12px; background: #1d4ed8; color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 10.5pt; font-family: sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 99; }
</style>
</head><body>
  <div class="hint">Press Ctrl/Cmd + P → Save as PDF</div>

  <!-- ── Letterhead + Page 1 ─────────────────────────────────── -->
  <div class="header">
    <div class="org">
      <h2>YT Money Productions Pvt. Ltd.</h2>
      <div><strong>Registered Office:</strong> 1st Floor, 209, NB Media,</div>
      <div>Model Town, Main Road, Phase 2,</div>
      <div>Bathinda, Punjab, 151001</div>
      <div><strong>Phone:</strong> 8146891380</div>
      <div><strong>Email:</strong> HRD@nbmediaproductions.com</div>
      <div><strong>CIN:</strong> U92113PB2022PTC055026</div>
    </div>
    <div class="logo">nb<br>MEDIA</div>
  </div>
  <p class="note">NOTE: This is a temporary / Conditional offer and cannot be used for Negotiations with other companies.</p>

  <h1 class="title">Letter Of Offer</h1>
  <div class="body">${bodyHtml}</div>
  <p class="signature">Nikit bassi</p>
  <p class="signature-block">Regards,<br>Nikit Bassi<br>Founder &amp; CEO</p>

  <!-- ── Page 2 — Terms & Conditions ───────────────────────── -->
  <div class="page-break"></div>
  <p class="note">NOTE: This is a temporary / Conditional offer and cannot be used for Negotiations with other companies.</p>
  <h2 class="title">TERMS AND CONDITIONS:</h2>
  ${TERMS_AND_CONDITIONS(role)}
  <p class="signature">Nikit bassi<br><span style="font-style: normal;">Regards,<br>Nikit Bassi<br>Founder & CEO</span></p>

  <!-- ── Page 4 — Acceptance ──────────────────────────────── -->
  <div class="page-break"></div>
  <p class="note">NOTE: This is a temporary / Conditional offer and cannot be used for Negotiations with other companies.</p>
  <h2 class="title">Acceptance</h2>
  <div class="acceptance">
    <p>I <strong>"${candidate}"</strong> hereby accept your offer, subject to the conditions mentioned above and shall join my duties on <strong>"${joining}"</strong>.</p>
    <p><strong>Background Verification:</strong> I hereby give my consent for background verification. I understand that the issuance of this offer letter or appointment letter is subject to satisfactory references and background verification. In case any declaration given or information furnished by me proves to be false, or if I am found to have willfully suppressed or concealed any material fact, this offer shall be deemed to be null and void.</p>
    <div class="sig-line"><strong>Name:</strong> _______________________________</div>
    <div class="sig-line"><strong>Signature:</strong> _______________________________</div>
    <div class="sig-line"><strong>Address:</strong> _______________________________</div>
    <div class="sig-line"><strong>Date:</strong> _______________________________</div>
  </div>

  <!-- ── Annexure B — Joining Documents ─────────────────────── -->
  <div class="page-break"></div>
  <p class="note">NOTE: This is a temporary / Conditional offer and cannot be used for Negotiations with other companies.</p>
  <h2 class="title">Annexure "B"</h2>
  ${JOINING_DOCUMENTS}
  <p style="margin-top: 16px;">In case of any query related to the joining process, please feel free to get in touch with us at <a href="mailto:${hrEmail}">${hrEmail}</a>.</p>
</body></html>`;
}

// ── Top-level: build everything HR needs ─────────────────────────
export function buildOfferLetter(args: OfferLetterArgs): OfferLetterRender {
  const breakdown = computePayBreakdown(args.annualCtcINR);
  const body      = letterBody(args);
  const fullHtml  = buildOfferLetterHTML({ ...args, editedBody: body });
  return { body, breakdown, fullHtml };
}
