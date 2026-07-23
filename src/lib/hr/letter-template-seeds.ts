// Initial LetterTemplate seeds — exactly the YT Money Productions
// Pvt. Ltd. / NB Media boilerplate HR shared (the 4 PDFs).
//
// Body is stored as HTML — the render endpoint substitutes
// {{Section.Field}} placeholders from the picked employee +
// manually-entered customFields. Edit-able from the Templates page
// once HR is in there.

export type CustomFieldDef = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "textarea" | "checkbox";
  required?: boolean;
  placeholder?: string;
  /** For checkbox inputs only — what the unchecked / checked
   *  values resolve to in the placeholder pipeline. Defaults to
   *  "false"/"true" so existing seeds don't need to specify. */
  uncheckedValue?: string;
  checkedValue?: string;
  /** Helper text shown below the input. */
  help?: string;
};

export type LetterTemplateSeed = {
  key: string;
  title: string;
  category: "offboarding" | "onboarding" | "appraisal" | "general";
  /** Brand variant. Defaults to "NB Media" when omitted, matching
   *  the rows backfilled by the businessUnit migration. */
  businessUnit?: "NB Media" | "YT Labs";
  bodyHtml: string;
  customFields: CustomFieldDef[];
};

// NOTE: We do NOT embed the NB Media letterhead inside each
// template body — the DOCX render pipeline (renderLetterPdfFromHtml)
// uses public/templates/jd-template.docx as the canvas, which
// already contains the letterhead, embedded logo image, and the
// page-header watermark. Putting the header HTML in the body would
// double up.
//
// The body just contains the letter's actual content (title +
// paragraphs + placeholders). The template title text is rendered
// at the top of every page via the template's {{JobTitle}} slot.

const SIGNOFF_HTML = `
<p class="signature-block" style="margin-top:36px">Regards,<br/>Nikit Bassi<br/>Founder &amp; CEO</p>
`;

// YT Labs letters are signed by the YT Labs CEO. The render layer
// injects the matching signature image (Kunal's, not Nikit's) into
// the SIGNOFF block based on the template's businessUnit.
const SIGNOFF_HTML_YT_LABS = `
<p class="signature-block" style="margin-top:36px">Regards,<br/>Kunal Lall<br/>Founder &amp; CEO</p>
`;

export const LETTER_TEMPLATE_SEEDS: LetterTemplateSeed[] = [
  // ── 1. Full & Final Settlement Letter ─────────────────────────
  {
    key: "fnf_settlement",
    title: "Full & Final Settlement Letter",
    category: "offboarding",
    customFields: [
      { key: "FnFAmount",   label: "FnF Amount (INR)", type: "text", required: true,  placeholder: "e.g. 75,000" },
      { key: "ReferenceNo", label: "Reference No.",     type: "text", required: false, placeholder: "e.g. FF-2026-014" },
    ],
    bodyHtml: `
<p>Date: {{DocumentFilterInfo.ShortDate}}</p>
<p>Dear {{EmployeeBasicInfo.DisplayName}},</p>
<p>With reference to your resignation letter dated {{EmployeeJobInfo.ResignationDate}} and subsequent relieving from your duties on {{EmployeeJobInfo.LastWorkingDay}} your full and final letter has been prepared, in accordance with the terms &amp; conditions of your joining and compensation letter.</p>
<p>The company shall pay you a sum of INR {{CustomAttributes.FnFAmount}} only on account of full &amp; final settlement {{CustomAttributes.ReferenceNo}}</p>
<p>With this, your account will be settled with our company and nothing will be due from the company to you.</p>
${SIGNOFF_HTML}
<p class="acknowledgement" style="margin-top:24px">
  Acknowledged and Accepted<br/>
  {{EmployeeBasicHeaderInfo.EmployeeNumber}}<br/>
  {{EmployeeBasicInfo.DisplayName}}<br/>
  Signature
</p>
`.trim(),
  },

  // ── 2. Internship Completion Letter ───────────────────────────
  {
    key: "internship_completion",
    title: "Internship Completion Letter",
    category: "offboarding",
    customFields: [
      { key: "InternshipMonths", label: "Duration (e.g. 3 months)", type: "text", required: true, placeholder: "e.g. 6 months" },
    ],
    bodyHtml: `
<p>Date: {{EmployeeBasicHeaderInfo.ShortDate}}</p>
<p>This is to certify that <strong>{{EmployeeBasicInfo.DisplayName}}</strong> successfully completed an internship as <strong>{{EmployeeJobInfo.JobTitle}}</strong> at YT Money Productions Pvt. Ltd. (operating under the brand name NB Media), located at 201- 202, 5th Floor, Cyber Cube near Platina Tower, Phase 8B, Industrial Area, Sector 74, Sahibzada Ajit Singh Nagar, Punjab 160055.</p>
<p>The internship program began on <strong>{{EmployeeJobInfo.DateJoined}}</strong> and concluded on <strong>{{EmployeeCustomFields.InternshipEndDate}}</strong> lasting for <strong>{{CustomAttributes.InternshipMonths}}</strong>.</p>
<p><strong>{{EmployeeBasicInfo.DisplayName}}</strong> consistently displayed a strong work ethic, a positive attitude, and a willingness to learn. {{DocumentFilterInfo.HeShe}} was a valuable asset to our team, and we are confident {{DocumentFilterInfo.HeShe}} will achieve great success in their future endeavors.</p>
${SIGNOFF_HTML}
`.trim(),
  },

  // ── 3. Probation Confirmation Letter ──────────────────────────
  {
    key: "probation_confirmation",
    title: "Probation Confirmation Letter",
    category: "onboarding",
    customFields: [],
    bodyHtml: `
<p>Dear {{EmployeeBasicInfo.DisplayName}},</p>
<p>Following the completion of your probationary period at YT Money Productions Pvt. Ltd. (operating under the brand name NB Media,) we have reviewed your performance and found the same to be satisfactory.</p>
<p>Given the above, we are pleased to inform you that your employment has been confirmed for the position of <strong>{{EmployeeJobInfo.JobTitle}}</strong> at YT Money Productions Pvt. Ltd. (operating under the brand name NB Media,) with effect from <strong>{{EmployeeJobInfo.ProbationEndDate}}</strong>.</p>
<p>This letter serves as an official appointment document and is governed by the same terms and conditions as that of your initial offer letter. In addition, you shall be entitled to receive Bonuses, perks other benefits that the company may at its discretion make available to its employees as stipulated in the relevant provisions of the Employee policy, under the terms and requirements relating to the benefits imposed by the organization.</p>
<p>We are happy to have you as part of our team and wish you the best of luck in your job.</p>
${SIGNOFF_HTML}
<p class="acknowledgement" style="margin-top:24px">
  Acknowledged and Accepted,<br/>
  {{EmployeeBasicHeaderInfo.EmployeeNumber}}<br/>
  {{EmployeeBasicInfo.DisplayName}}<br/>
  Signature:
</p>
`.trim(),
  },

  // ── 4. Employment Relieving & Service Letter ─────────────────
  // Issued after an exit is finalised. Confirms the employee's
  // tenure, role, department, and that all dues are settled.
  // Carries the standard confidentiality / IP reminder boilerplate
  // HR shared.
  {
    key: "relieving_service",
    title: "Employment Relieving and Service Letter",
    category: "offboarding",
    customFields: [],
    bodyHtml: `
<p>Date: {{EmployeeBasicHeaderInfo.ShortDate}}</p>
<p>Dear {{EmployeeBasicInfo.DisplayName}},</p>
<p>It is to certify that <strong>{{EmployeeBasicInfo.DisplayName}}</strong> was employed as <strong>{{EmployeeJobInfo.JobTitle}}</strong> in the <strong>{{EmployeeJobInfo.Department}}</strong> department of YT Money Productions Pvt. Ltd. (operating under the brand name NB Media) from <strong>{{EmployeeJobInfo.DateJoined}}</strong> to <strong>{{EmployeeJobInfo.LastWorkingDay}}</strong>.</p>
<p>{{EmployeeBasicInfo.DisplayName}} fulfilled {{DocumentFilterInfo.HisHer}} roles and responsibilities diligently with dedication and commitment to company policy and rules and we wish {{DocumentFilterInfo.HimHer}} good luck for his/her future career and endeavors.</p>
<p>Please be advised that all outstanding dues, including salary, benefits, and any other entitlements, have been settled as per company policies.</p>
<p>We would also like to remind you of the obligations of the confidentiality and non-disclosure agreement that you had signed during your employment with the Company. We earnestly hope that you will continue to bestow the same degree of commitment in protecting the Intellectual Property of the company as you have agreed to uphold as per the terms of the confidentiality and non-disclosure agreement. We request you to strive and ensure that the trade secrets, confidential and the intellectual property that were developed when you were in the employment of the company continue to be protected and are not compromised in anyway.</p>
<p>We wish you all the best in your future endeavors!</p>
${SIGNOFF_HTML}
<p class="acknowledgement" style="margin-top:24px">
  Acknowledged and Accepted<br/>
  {{EmployeeBasicHeaderInfo.EmployeeNumber}}<br/>
  {{EmployeeBasicInfo.DisplayName}}<br/>
  Signature
</p>
`.trim(),
  },

  // ── 5. Revised Offer Letter ───────────────────────────────────
  // Multi-page (annexures + terms). HR can edit any section in the
  // Templates page; defaults preserve the exact 6-page wording HR
  // shared as the source of truth.
  {
    key: "revised_offer_letter",
    title: "Offer Letter",
    category: "onboarding",
    // HR types the annual package + ticks PF. The salary breakup
    // table is auto-computed at render time using {{Salary.*}}
    // placeholders — see resolveSalary() in src/lib/hr/letter-render.ts.
    customFields: [
      { key: "JoiningDate",        label: "Joining Date",       type: "date",     required: true },
      { key: "ReportingTime",      label: "Reporting Time",     type: "text",     required: true, placeholder: "10:00 AM" },
      { key: "AcceptanceDeadline", label: "Acceptance Deadline",type: "date",     required: true },
      { key: "AnnualPackage",      label: "Annual Package (₹)", type: "number",   required: true,
        placeholder: "e.g. 600000",
        help: "Enter the gross annual CTC in rupees. Monthly breakup (Basic/HRA/DA/Conveyance/Medical/Special) is auto-calculated."
      },
      { key: "EnablePf",           label: "Include Provident Fund (PF)",         type: "checkbox", required: false,
        checkedValue: "true", uncheckedValue: "false",
        help: "Tick to include a fixed ₹1,800/month PF deduction in the breakup. Special Allowance is reduced accordingly so the monthly CTC stays the same."
      },
    ],
    bodyHtml: `
<p>{{DocumentFilterInfo.ShortDate}}</p>
<p>Dear <strong>{{EmployeeBasicInfo.DisplayName}}</strong></p>
<p>With reference to your application dated and subsequent interview with us, we are pleased to offer you employment for the position of <strong>{{EmployeeJobInfo.JobTitle}}</strong> with <strong>YT Money Productions Pvt. Ltd.</strong> (operating under the brand name NB Media) We trust that your knowledge, skills, and experience will be among our most valuable assets.</p>
<p>Annexure "A" below includes your salary and benefits information and Annexure "B" includes your joining requirement information.</p>
<p>Your signing of these documents confirms your acceptance of the terms and conditions.</p>
<p>Joining Date: <strong>{{CustomAttributes.JoiningDate}}</strong></p>
<p>Reporting Time: <strong>{{CustomAttributes.ReportingTime}}</strong></p>
<p>Location: <strong>Cyber Cube, C 201- 202, Phase 8B, Industrial Area, Sector 74, Sahibzada Ajit Singh Nagar, Mohali Punjab 160055</strong></p>
<p>Employment Type: <strong>Full-Time</strong></p>
<p>Working Hours: <strong>09:00 AM to 6.00 PM (Monday to Friday)</strong></p>
<p><em>*Please note that Saturdays are flexi-offs.</em></p>
<p>Kindly acknowledge your acceptance by signing the document, and confirming the joining date by <strong>{{CustomAttributes.AcceptanceDeadline}}</strong>. <em>Failure to accept prior to the specified deadline will render this offer null and void automatically.</em></p>
<p>For any further questions or concerns feel free to reach us at hrd@nbmediaproductions.com.</p>
<p style="text-align:center"><strong>We extend our heartfelt wishes for an exceptional tenure aboard!</strong></p>
${SIGNOFF_HTML}

<div class="page-break"></div>
<h2 class="section-title">TERMS AND CONDITIONS:</h2>
<p>Following are the terms and conditions in reference to your employment as <strong>{{EmployeeJobInfo.JobTitle}}</strong> at YT Money Productions Pvt. Ltd. (operating under the brand name NB Media.)</p>
<ol class="terms">
  <li>You will be on probation for a period of three months, which may be extended by another three months at the sole discretion of the management. On satisfied completion of the probation period/extended probation period, your positions shall be confirmed as permanent. During this period, you will not be eligible for any bonuses, perks, or benefits given to permanent employees.</li>
  <li>Upon attaining the status of a permanent employee, you are required to remain in our organization for a minimum of one year, unless otherwise determined by management (for reasons such as poor performance, disciplinary action, or similar factors). Neglecting to do so will result in the forfeiture of compensation that is owed to you.</li>
  <li>You shall be entitled to salary allowances and perquisites as per "Annexure A." In addition, you shall be entitled to receive such insurance, health, and other benefits that the company may, at its discretion, make available to its employees as stipulated in the relevant provisions of the employee policy, in accordance with the terms and requirements relating to the benefits imposed by the company. Individual salary and performance ratings should strictly not be shared with other employees.</li>
  <li>You acknowledge and undertake that your remuneration is a matter purely between yourself and the company, and you are to keep this information and any changes thereto strictly confidential. Your remuneration will be periodically reviewed as per organization guidelines. Your increments and promotions shall be at the discretion of the organization and will be subject to and based on performance.</li>
  <li>Your hours of work shift, and timing shall be governed by the exigencies of working as determined by the management from time to time at its discretion. A working day shall comprise Nine (9) hours, irrespective of shifts, with a break for an hour (in the aggregate).</li>
  <li>You will be governed by and will abide by the company's guidelines/code of conduct, and policies, which are in force and may be modified from time to time. The guidelines/code of conduct and policies are deemed to be Inc. herein by reference.</li>
  <li>Your employment with the company is on a full-time basis. While you are in the services of the company, you are not permitted to directly or indirectly, without permission of management, engage yourself or devote any time or attention to any full-time or part-time employment, trade business, or occupation with or without remuneration for any third person or concern (including self-employment). You shall also not undertake or be interested, either directly or indirectly, in any activities that are contrary to or inconsistent with your employment with the company or the company's interests. You shall devote yourself exclusively to the business of the company. Any breach of this condition on your part may lead to the immediate termination of employment with the company.</li>
  <li>Confidential information pertaining to the organization, its affiliates, clients, customers, or other entities may be disclosed to you in the course of your employment. It is expected that you consistently uphold the utmost confidence and trust regarding any confidential information, including any that you may have generated. You shall indemnify and hold harmless the company from and against all liabilities, claims, damages, suits, proceedings, costs, and expenses whatsoever caused by or arising from your breach of the terms and conditions set out herein.</li>
  <li>During the course of employment, if you conceive of any new or advanced methods, inventions, designs or improvements, processes/systems or prepare any reports, tables, or collection of data in which copyright may subsist or any other form of intellectual property concerning your work and operation of the company, all such developments shall be communicated to the company and shall remain the sole right/property of the company, and you shall execute documents and do all things necessary to enable the company to obtain all rights to the same.</li>
  <li>Your entitlement and use of leaves shall be governed as per company policies.</li>
  <li>In the event of your resignation or termination, One Month's written notice from you is required. Failure to provide such notice will result in legal action being pursued by the employer. However, management reserves the right to terminate your employment at its discretion without any notice if you breach any of the provisions of this agreement, guidelines/code of conduct, or policies, or if you indulge in any illegal or unlawful activities.</li>
  <li>After the termination of employment, you shall immediately return all the properties of the company that are in your possession or custody.</li>
  <li>The continuation of your employment will be subject to your being physically and mentally fit. During the tenure of your service, you may be required to undergo a medical checkup at the instance of the company.</li>
  <li>Unless you separate earlier, either voluntarily or by the company, you shall retire from the employment of the company on the last day of the month in which you attain your 60th birth anniversary.</li>
  <li>You will be responsible for the safekeeping and return in good condition of all the office properties, equipment, books, etc. that may be given to you for office, custody, and charge.</li>
  <li>The information you provided was the basis for your appointment. You shall inform the company in writing of any changes in such particulars promptly. If at any time it emerges that such particulars were false or incorrect or that any material or relevant information has been suppressed, concealed, or exaggerated, your appointment pursuant hereto shall be considered ineffective.</li>
  <li>During the term of employment and for a period of two years thereafter, you shall not induce or attempt to induce any employee of the company to leave the employment of the company.</li>
  <li>You covenant and agree that at any time during your employment, you will not own, conduct, engage, manage, operate, join, control, finance, invest in, bid for advice or otherwise participate in, or be connected with any business in the same or similar business as the company ("competing business").</li>
  <li>You shall at all times during the course of your employment in the company indemnify and keep indemnified the company against all losses, damages, claims, interest costs, expenses, liabilities, proceedings, and demands.</li>
  <li>Any notice that may be required to be given to you shall be deemed to be duly and properly given If hand-delivered to you personally or sent by registered post.</li>
  <li>This letter of appointment, read with the documents referred to herein, shall be the sole document governing your relationship.</li>
  <li>Should there be any issue between the Company and the Employee which may require adjudication then the courts of Bathinda shall be the area of Jurisdiction with a total bar on any other place/state/city.</li>
  <li>In acceptance of the above, please sign and return the duplicate copy of the letter on or before five days of issuance of this letter.</li>
  <li>In order to facilitate the joining process, we require documents in original from your end, which is mentioned in Annexure 'B'.</li>
</ol>

<p><strong>Acceptance:</strong></p>
<p>I <strong>{{EmployeeBasicInfo.DisplayName}}</strong> hereby accept your offer, subject to the conditions mentioned above and shall join my duties on <strong>{{CustomAttributes.JoiningDate}}</strong></p>
<p><strong>Background Verification:</strong></p>
<p>I hereby give my consent for background verification. I understand that the issuance of this offer letter or appointment letter is subject to satisfactory references and background verification. In case any declaration given or information furnished by me proves to be false, or if I am found to have willfully suppressed or concealed any material fact, this offer shall be deemed to be null and void.</p>
<p style="margin-top:36px">
  Name:<br/>
  Signature:<br/>
  Address:<br/>
  Date:
</p>

<div class="page-break"></div>
<h2 class="section-title" style="text-align:center">Annexure "A"</h2>
<h3 style="text-align:center">COMPENSATION STRUCTURE</h3>
<p>Your Annual fixed compensation of Rs. <strong>{{Salary.Annual}}</strong> ({{Salary.EnablePfText}}) will be divided per the following break up:</p>
<p style="text-align:center"><strong>FIXED MONTHLY PAY:</strong></p>
<table class="pay-table">
  <thead>
    <tr><th>PAY COMPONENT</th><th>MONTHLY (₹)</th><th>ANNUAL (₹)</th></tr>
  </thead>
  <tbody>
    <tr><td>Basic Pay</td><td>{{Salary.Basic}}</td><td>{{Salary.BasicAnnual}}</td></tr>
    <tr><td>House Rent Allowance</td><td>{{Salary.HRA}}</td><td>{{Salary.HRAAnnual}}</td></tr>
    {{Salary.PfRow}}
    <tr><td>Dearness Allowance</td><td>{{Salary.DA}}</td><td>{{Salary.DAAnnual}}</td></tr>
    <tr><td>Conveyance Allowance</td><td>{{Salary.Conveyance}}</td><td>{{Salary.ConveyanceAnnual}}</td></tr>
    <tr><td>Medical Allowance</td><td>{{Salary.Medical}}</td><td>{{Salary.MedicalAnnual}}</td></tr>
    <tr><td>Special Allowance</td><td>{{Salary.Special}}</td><td>{{Salary.SpecialAnnual}}</td></tr>
    <tr><td><strong>TOTAL CTC</strong></td><td><strong>{{Salary.Total}}</strong></td><td><strong>{{Salary.TotalAnnual}}</strong></td></tr>
  </tbody>
</table>
<p><strong>Note:</strong></p>
<ul>
  <li>You will also be eligible to receive additional bonus amounts, subject to your job performance at NB Media.</li>
  <li>No bonus, whatsoever, shall be payable in the event of resignation by an employee.</li>
  <li>Applicable taxes (if any) would be borne by the employee.</li>
</ul>

<div class="page-break"></div>
<h2 class="section-title" style="text-align:center">Annexure "B"</h2>
<ol>
  <li>Educational Passing certificates and mark sheets (10th, 12th/Diploma/Graduation/PG etc.)</li>
  <li>Copy of Curriculum Vitae</li>
  <li>Passport Sized Photographs</li>
  <li>PAN Card</li>
  <li>Permanent Address Proof:
    <ol type="a"><li>Aadhar Card</li><li>Passport (Optional)</li><li>Voter ID card / Ration card / Driving license / Electricity bill (Optional)</li></ol>
  </li>
  <li>Current Address Proof (Rent Agreement)</li>
  <li>Proof of last 3 month's salary (If applicable)</li>
  <li>Experience letter / Service report / Relieving letter of all previous employers (If applicable)</li>
  <li>Form 16 or receiving of Income Tax Return for last year (If applicable)</li>
  <li>Proof of Bank account i.e. Bank passbook, Bank Cheque, Online statement etc.</li>
  <li>Marriage certificate (If applicable)</li>
</ol>
<p><strong>Note:</strong> You are requested to bring all the above-specified documents in Original &amp; Xerox for joining. These documents are MANDATORY at the time of joining.</p>
<p>In case of any query related to the joining process, please feel free to get in touch with us at hrd@nbmediaproductions.com.</p>
`.trim(),
  },

  // ─────────────────────────────────────────────────────────────
  // YT Labs variants — same wording as NB Media versions but with
  // "Billion Films Private Limited (operating under the brand name
  // YT Labs)" instead of "YT Money Productions Pvt. Ltd. (operating
  // under the brand name NB Media)". The letterhead text, address,
  // CIN, and logo come from the brand-aware preview wrapper +
  // (when supplied) per-template DOCX file under
  // public/templates/letter-<key>-ytlabs.docx.
  // ─────────────────────────────────────────────────────────────

  // ── YT Labs · Full & Final Settlement Letter ─────────────────
  {
    key: "fnf_settlement",
    title: "Full & Final Settlement Letter",
    category: "offboarding",
    businessUnit: "YT Labs",
    customFields: [
      { key: "FnFAmount",   label: "FnF Amount (INR)", type: "text", required: true,  placeholder: "e.g. 75,000" },
      { key: "ReferenceNo", label: "Reference No.",     type: "text", required: false, placeholder: "e.g. FF-2026-014" },
    ],
    bodyHtml: `
<p>Date: {{DocumentFilterInfo.ShortDate}}</p>
<p>Dear {{EmployeeBasicInfo.DisplayName}},</p>
<p>With reference to your resignation letter dated {{EmployeeJobInfo.ResignationDate}} and subsequent relieving from your duties on {{EmployeeJobInfo.LastWorkingDay}} your full and final letter has been prepared, in accordance with the terms &amp; conditions of your joining and compensation letter.</p>
<p>The company shall pay you a sum of INR {{CustomAttributes.FnFAmount}} only on account of full &amp; final settlement {{CustomAttributes.ReferenceNo}}</p>
<p>With this, your account will be settled with our company and nothing will be due from the company to you.</p>
${SIGNOFF_HTML_YT_LABS}
<p class="acknowledgement" style="margin-top:24px">
  Acknowledged and Accepted<br/>
  {{EmployeeBasicHeaderInfo.EmployeeNumber}}<br/>
  {{EmployeeBasicInfo.DisplayName}}<br/>
  Signature
</p>
`.trim(),
  },

  // ── YT Labs · Internship Completion Letter ───────────────────
  {
    key: "internship_completion",
    title: "Internship Completion Letter",
    category: "offboarding",
    businessUnit: "YT Labs",
    customFields: [
      { key: "InternshipMonths", label: "Duration (e.g. 3 months)", type: "text", required: true, placeholder: "e.g. 6 months" },
    ],
    bodyHtml: `
<p>Date: {{EmployeeBasicHeaderInfo.ShortDate}}</p>
<p>This is to certify that <strong>{{EmployeeBasicInfo.DisplayName}}</strong> successfully completed an internship as <strong>{{EmployeeJobInfo.JobTitle}}</strong> at Billion Films Private Limited (operating under the brand name of YouTuber Labs), located at 2nd Floor, NAAR Tower, Sector 74 A, Industrial Area, Sector 74, Sahibzada Ajit Singh Nagar, Punjab 140307.</p>
<p>The internship program began on <strong>{{EmployeeJobInfo.DateJoined}}</strong> and concluded on <strong>{{EmployeeCustomFields.InternshipEndDate}}</strong> lasting for <strong>{{CustomAttributes.InternshipMonths}}</strong>.</p>
<p><strong>{{EmployeeBasicInfo.DisplayName}}</strong> consistently displayed a strong work ethic, a positive attitude, and a willingness to learn. {{DocumentFilterInfo.HeShe}} was a valuable asset to our team, and we are confident {{DocumentFilterInfo.HeShe}} will achieve great success in their future endeavors.</p>
${SIGNOFF_HTML_YT_LABS}
`.trim(),
  },

  // ── YT Labs · Probation Confirmation Letter ──────────────────
  {
    key: "probation_confirmation",
    title: "Probation Confirmation Letter",
    category: "onboarding",
    businessUnit: "YT Labs",
    customFields: [],
    bodyHtml: `
<p>Dear {{EmployeeBasicInfo.DisplayName}},</p>
<p>Following the completion of your probationary period at Billion Films Private Limited (operating under the brand name of YouTuber Labs,) we have reviewed your performance and found the same to be satisfactory.</p>
<p>Given the above, we are pleased to inform you that your employment has been confirmed for the position of <strong>{{EmployeeJobInfo.JobTitle}}</strong> at Billion Films Private Limited (operating under the brand name of YouTuber Labs,) with effect from <strong>{{EmployeeJobInfo.ProbationEndDate}}</strong>.</p>
<p>This letter serves as an official appointment document and is governed by the same terms and conditions as that of your initial offer letter. In addition, you shall be entitled to receive Bonuses, perks other benefits that the company may at its discretion make available to its employees as stipulated in the relevant provisions of the Employee policy, under the terms and requirements relating to the benefits imposed by the organization.</p>
<p>We are happy to have you as part of our team and wish you the best of luck in your job.</p>
${SIGNOFF_HTML_YT_LABS}
<p class="acknowledgement" style="margin-top:24px">
  Acknowledged and Accepted,<br/>
  {{EmployeeBasicHeaderInfo.EmployeeNumber}}<br/>
  {{EmployeeBasicInfo.DisplayName}}<br/>
  Signature:
</p>
`.trim(),
  },

  // ── YT Labs · Employment Relieving & Service Letter ──────────
  {
    key: "relieving_service",
    title: "Employment Relieving and Service Letter",
    category: "offboarding",
    businessUnit: "YT Labs",
    customFields: [],
    bodyHtml: `
<p>Date: {{EmployeeBasicHeaderInfo.ShortDate}}</p>
<p>Dear {{EmployeeBasicInfo.DisplayName}},</p>
<p>It is to certify that <strong>{{EmployeeBasicInfo.DisplayName}}</strong> was employed as <strong>{{EmployeeJobInfo.JobTitle}}</strong> in the <strong>{{EmployeeJobInfo.Department}}</strong> department of Billion Films Private Limited (operating under the brand name of YouTuber Labs) from <strong>{{EmployeeJobInfo.DateJoined}}</strong> to <strong>{{EmployeeJobInfo.LastWorkingDay}}</strong>.</p>
<p>{{EmployeeBasicInfo.DisplayName}} fulfilled {{DocumentFilterInfo.HisHer}} roles and responsibilities diligently with dedication and commitment to company policy and rules and we wish {{DocumentFilterInfo.HimHer}} good luck for his/her future career and endeavors.</p>
<p>Please be advised that all outstanding dues, including salary, benefits, and any other entitlements, have been settled as per company policies.</p>
<p>We would also like to remind you of the obligations of the confidentiality and non-disclosure agreement that you had signed during your employment with the Company. We earnestly hope that you will continue to bestow the same degree of commitment in protecting the Intellectual Property of the company as you have agreed to uphold as per the terms of the confidentiality and non-disclosure agreement. We request you to strive and ensure that the trade secrets, confidential and the intellectual property that were developed when you were in the employment of the company continue to be protected and are not compromised in anyway.</p>
<p>We wish you all the best in your future endeavors!</p>
${SIGNOFF_HTML_YT_LABS}
<p class="acknowledgement" style="margin-top:24px">
  Acknowledged and Accepted<br/>
  {{EmployeeBasicHeaderInfo.EmployeeNumber}}<br/>
  {{EmployeeBasicInfo.DisplayName}}<br/>
  Signature
</p>
`.trim(),
  },

  // ── YT Labs · Revised Offer Letter ──────────────────────────
  {
    key: "revised_offer_letter",
    title: "Offer Letter",
    category: "onboarding",
    businessUnit: "YT Labs",
    // HR types the annual package + ticks PF. The salary breakup
    // table is auto-computed at render time using {{Salary.*}}
    // placeholders — see resolveSalary() in src/lib/hr/letter-render.ts.
    customFields: [
      { key: "JoiningDate",        label: "Joining Date",       type: "date",     required: true },
      { key: "ReportingTime",      label: "Reporting Time",     type: "text",     required: true, placeholder: "10:00 AM" },
      { key: "AcceptanceDeadline", label: "Acceptance Deadline",type: "date",     required: true },
      { key: "AnnualPackage",      label: "Annual Package (₹)", type: "number",   required: true,
        placeholder: "e.g. 600000",
        help: "Enter the gross annual CTC in rupees. Monthly breakup (Basic/HRA/DA/Conveyance/Medical/Special) is auto-calculated."
      },
      { key: "EnablePf",           label: "Include Provident Fund (PF)",         type: "checkbox", required: false,
        checkedValue: "true", uncheckedValue: "false",
        help: "Tick to include a fixed ₹1,800/month PF deduction in the breakup. Special Allowance is reduced accordingly so the monthly CTC stays the same."
      },
    ],
    bodyHtml: `
<p>{{DocumentFilterInfo.ShortDate}}</p>
<p>Dear <strong>{{EmployeeBasicInfo.DisplayName}}</strong></p>
<p>With reference to your application dated and subsequent interview with us, we are pleased to offer you employment for the position of <strong>{{EmployeeJobInfo.JobTitle}}</strong> with <strong>Billion Films Private Limited</strong> (operating under the brand name of YouTuber Labs) We trust that your knowledge, skills, and experience will be among our most valuable assets.</p>
<p>Annexure "A" below includes your salary and benefits information and Annexure "B" includes your joining requirement information.</p>
<p>Your signing of these documents confirms your acceptance of the terms and conditions.</p>
<p>Joining Date: <strong>{{CustomAttributes.JoiningDate}}</strong></p>
<p>Reporting Time: <strong>{{CustomAttributes.ReportingTime}}</strong></p>
<p>Location: <strong>2nd Floor, NAAR Tower, Sector 74 A, Industrial Area, Sector 74, Sahibzada Ajit Singh Nagar, Punjab 140307</strong></p>
<p>Employment Type: <strong>Full-Time</strong></p>
<p>Working Hours: <strong>09:00 AM to 6.00 PM (Monday to Friday)</strong></p>
<p><em>*Please note that Saturdays are flexi-offs.</em></p>
<p>Kindly acknowledge your acceptance by signing the document, and confirming the joining date by <strong>{{CustomAttributes.AcceptanceDeadline}}</strong>. <em>Failure to accept prior to the specified deadline will render this offer null and void automatically.</em></p>
<p>For any further questions or concerns feel free to reach us at hrd@nbmediaproductions.com.</p>
<p style="text-align:center"><strong>We extend our heartfelt wishes for an exceptional tenure aboard!</strong></p>
${SIGNOFF_HTML_YT_LABS}

<div class="page-break"></div>
<h2 class="section-title">TERMS AND CONDITIONS:</h2>
<p>Following are the terms and conditions in reference to your employment as <strong>{{EmployeeJobInfo.JobTitle}}</strong> at Billion Films Private Limited (operating under the brand name of YouTuber Labs.)</p>
<ol class="terms">
  <li>You will be on probation for a period of three months, which may be extended by another three months at the sole discretion of the management. On satisfied completion of the probation period/extended probation period, your positions shall be confirmed as permanent. During this period, you will not be eligible for any bonuses, perks, or benefits given to permanent employees.</li>
  <li>Upon attaining the status of a permanent employee, you are required to remain in our organization for a minimum of one year, unless otherwise determined by management (for reasons such as poor performance, disciplinary action, or similar factors). Neglecting to do so will result in the forfeiture of compensation that is owed to you.</li>
  <li>You shall be entitled to salary allowances and perquisites as per "Annexure A." In addition, you shall be entitled to receive such insurance, health, and other benefits that the company may, at its discretion, make available to its employees as stipulated in the relevant provisions of the employee policy, in accordance with the terms and requirements relating to the benefits imposed by the company. Individual salary and performance ratings should strictly not be shared with other employees.</li>
  <li>You acknowledge and undertake that your remuneration is a matter purely between yourself and the company, and you are to keep this information and any changes thereto strictly confidential. Your remuneration will be periodically reviewed as per organization guidelines. Your increments and promotions shall be at the discretion of the organization and will be subject to and based on performance.</li>
  <li>Your hours of work shift, and timing shall be governed by the exigencies of working as determined by the management from time to time at its discretion. A working day shall comprise Nine (9) hours, irrespective of shifts, with a break for an hour (in the aggregate).</li>
  <li>You will be governed by and will abide by the company's guidelines/code of conduct, and policies, which are in force and may be modified from time to time.</li>
  <li>Your employment with the company is on a full-time basis. While you are in the services of the company, you are not permitted to directly or indirectly, without permission of management, engage yourself or devote any time or attention to any full-time or part-time employment, trade business, or occupation with or without remuneration for any third person or concern (including self-employment).</li>
  <li>Confidential information pertaining to the organization, its affiliates, clients, customers, or other entities may be disclosed to you in the course of your employment. It is expected that you consistently uphold the utmost confidence and trust regarding any confidential information.</li>
  <li>During the course of employment, any new or advanced methods, inventions, designs or improvements you conceive shall remain the sole property of the company.</li>
  <li>Your entitlement and use of leaves shall be governed as per company policies.</li>
  <li>In the event of your resignation or termination, One Month's written notice from you is required.</li>
  <li>After the termination of employment, you shall immediately return all the properties of the company that are in your possession or custody.</li>
  <li>The continuation of your employment will be subject to your being physically and mentally fit.</li>
  <li>Unless you separate earlier, either voluntarily or by the company, you shall retire from the employment of the company on the last day of the month in which you attain your 60th birth anniversary.</li>
  <li>You will be responsible for the safekeeping and return in good condition of all the office properties, equipment, books, etc. that may be given to you for office, custody, and charge.</li>
  <li>Should there be any issue between the Company and the Employee which may require adjudication then the courts of Mohali shall be the area of Jurisdiction.</li>
</ol>

<p><strong>Acceptance:</strong></p>
<p>I <strong>{{EmployeeBasicInfo.DisplayName}}</strong> hereby accept your offer, subject to the conditions mentioned above and shall join my duties on <strong>{{CustomAttributes.JoiningDate}}</strong></p>
<p><strong>Background Verification:</strong></p>
<p>I hereby give my consent for background verification.</p>
<p style="margin-top:36px">
  Name:<br/>
  Signature:<br/>
  Address:<br/>
  Date:
</p>

<div class="page-break"></div>
<h2 class="section-title" style="text-align:center">Annexure "A"</h2>
<h3 style="text-align:center">COMPENSATION STRUCTURE</h3>
<p>Your Annual fixed compensation of Rs. <strong>{{Salary.Annual}}</strong> ({{Salary.EnablePfText}}) will be divided per the following break up:</p>
<p style="text-align:center"><strong>FIXED MONTHLY PAY:</strong></p>
<table class="pay-table">
  <thead>
    <tr><th>PAY COMPONENT</th><th>MONTHLY (₹)</th><th>ANNUAL (₹)</th></tr>
  </thead>
  <tbody>
    <tr><td>Basic Pay</td><td>{{Salary.Basic}}</td><td>{{Salary.BasicAnnual}}</td></tr>
    <tr><td>House Rent Allowance</td><td>{{Salary.HRA}}</td><td>{{Salary.HRAAnnual}}</td></tr>
    {{Salary.PfRow}}
    <tr><td>Dearness Allowance</td><td>{{Salary.DA}}</td><td>{{Salary.DAAnnual}}</td></tr>
    <tr><td>Conveyance Allowance</td><td>{{Salary.Conveyance}}</td><td>{{Salary.ConveyanceAnnual}}</td></tr>
    <tr><td>Medical Allowance</td><td>{{Salary.Medical}}</td><td>{{Salary.MedicalAnnual}}</td></tr>
    <tr><td>Special Allowance</td><td>{{Salary.Special}}</td><td>{{Salary.SpecialAnnual}}</td></tr>
    <tr><td><strong>TOTAL CTC</strong></td><td><strong>{{Salary.Total}}</strong></td><td><strong>{{Salary.TotalAnnual}}</strong></td></tr>
  </tbody>
</table>
<p><strong>Note:</strong></p>
<ul>
  <li>You will also be eligible to receive additional bonus amounts, subject to your job performance at YouTuber Labs.</li>
  <li>No bonus, whatsoever, shall be payable in the event of resignation by an employee.</li>
  <li>Applicable taxes (if any) would be borne by the employee.</li>
</ul>

<div class="page-break"></div>
<h2 class="section-title" style="text-align:center">Annexure "B"</h2>
<ol>
  <li>Educational Passing certificates and mark sheets (10th, 12th/Diploma/Graduation/PG etc.)</li>
  <li>Copy of Curriculum Vitae</li>
  <li>Passport Sized Photographs</li>
  <li>PAN Card</li>
  <li>Permanent Address Proof: Aadhar Card / Passport (Optional) / Voter ID card / Driving license / Electricity bill (Optional)</li>
  <li>Current Address Proof (Rent Agreement)</li>
  <li>Proof of last 3 month's salary (If applicable)</li>
  <li>Experience letter / Service report / Relieving letter of all previous employers (If applicable)</li>
  <li>Form 16 or receiving of Income Tax Return for last year (If applicable)</li>
  <li>Proof of Bank account i.e. Bank passbook, Bank Cheque, Online statement etc.</li>
  <li>Marriage certificate (If applicable)</li>
</ol>
<p><strong>Note:</strong> You are requested to bring all the above-specified documents in Original &amp; Xerox for joining. These documents are MANDATORY at the time of joining.</p>
`.trim(),
  },

  // ─────────────────────────────────────────────────────────────
  // ── 6. Exit Statement (Provisional Full & Final Settlement) ─
  // ─────────────────────────────────────────────────────────────
  // Structured payroll-style statement (not a free-form letter).
  // HR enters each line-item amount; totals + net payable + net-
  // in-words are computed via the {{ExitSettlement.*}} resolver
  // in letter-render.ts. Same template body for both brands;
  // letterhead / logo / signature switch via the wrapper based
  // on businessUnit.
  ...(([
    {
      brand: "NB Media" as const,
      bankHint: "e.g. HDFC Bank",
      ifscHint: "e.g. HDFC0001234",
      acctHint: "e.g. 50100123456789",
      panHint:  "e.g. ABCDE1234F",
    },
    {
      brand: "YT Labs" as const,
      bankHint: "e.g. Bank of Baroda",
      ifscHint: "e.g. BARB0GARIAX",
      acctHint: "e.g. 30620100007754",
      panHint:  "e.g. FBPPD5707L",
    },
  ] as const).map(({ brand, bankHint, ifscHint, acctHint, panHint }): LetterTemplateSeed => ({
    key: "exit_statement",
    title: "Exit Statement",
    category: "offboarding",
    businessUnit: brand,
    customFields: [
      // ── Employee meta. Bank / Bank IFSC / Bank Account / PAN /
      // AnnualPackage / EnablePf are AUTO-FILLED from the picked
      // employee's EmployeeProfile + SalaryStructure by the
      // template editor. Placeholders only show when the profile
      // field is empty.
      { key: "PaymentMode",    label: "Payment Mode",    type: "text",   required: false, placeholder: "Bank Transfer" },
      { key: "Bank",           label: "Bank",            type: "text",   required: false, placeholder: bankHint },
      { key: "BankIFSC",       label: "Bank IFSC",       type: "text",   required: false, placeholder: ifscHint },
      { key: "BankAccount",    label: "Bank Account",    type: "text",   required: false, placeholder: acctHint },
      { key: "PANNumber",      label: "PAN Number",      type: "text",   required: false, placeholder: panHint },
      { key: "SettlementDate", label: "Settlement Date", type: "date",   required: true },

      // ── Salary inputs (drives every earnings line via the
      //    ExitSettlement resolver) ────────────────────────────
      { key: "AnnualPackage",  label: "Annual Package (₹)", type: "number", required: true,
        placeholder: "Auto-filled from salary structure",
        help: "Auto-filled from the employee's SalaryStructure.ctc if set. Drives Basic / HRA / DA / Conveyance / Medical / Special line items via the standard 50/20/10/7.5 split, pro-rated by Working Days." },
      { key: "EnablePf",       label: "Include Provident Fund (PF)", type: "checkbox", required: false,
        checkedValue: "true", uncheckedValue: "false",
        help: "Tick to deduct a fixed ₹1,800/month PF (pro-rated). Auto-checked from the employee's SalaryStructure.pfEligible. Interns never have PF — the toggle is hidden for them." },

      // ── Settlement metrics ─────────────────────────────────
      { key: "WorkingDays",         label: "Working Days",         type: "number", required: true,  placeholder: "e.g. 15",
        help: "Pro-rates every earnings line as (this / 30). Use the actual days the employee worked in their final month." },
      { key: "LossOfPayDays",       label: "Loss of Pay Days",     type: "number", required: false, placeholder: "0" },
      { key: "LeaveEncashmentDays", label: "Leave Encashment Days",type: "number", required: false, placeholder: "0",
        help: "Adds (Basic + DA per day) × this many days to earnings. Leave blank or 0 to skip." },
      { key: "AdvanceSalaryDays",   label: "Advance Salary Days",  type: "number", required: false, placeholder: "0",
        help: "Auto-filled from the employee's Advance Salary entries in payroll (informational — days paid in advance)." },
      { key: "AdvanceSalaryAmount", label: "Advance Salary (₹)",   type: "number", required: false, placeholder: "0.00",
        help: "Auto-filled from the employee's Advance Salary payroll entries. Added to Total Earnings." },
      { key: "LastSalaryProcessed", label: "Last Salary Processed",type: "text",   required: false, placeholder: "Apr-2026" },
      { key: "FnFProcessed",        label: "F&F Processed",        type: "text",   required: false, placeholder: "May-2026" },

      // ── Manual overrides (optional) ────────────────────────
      // Each is OPTIONAL — leave blank and the resolver computes
      // from AnnualPackage. Fill if payroll uses different value.
      { key: "Basic",                 label: "Basic — override (₹)",                 type: "number", required: false, placeholder: "Leave blank to auto-compute" },
      { key: "HRA",                   label: "HRA — override (₹)",                   type: "number", required: false, placeholder: "Leave blank to auto-compute" },
      { key: "MedicalAllowance",      label: "Medical — override (₹)",               type: "number", required: false, placeholder: "Leave blank to auto-compute" },
      { key: "ConveyanceAllowance",   label: "Conveyance — override (₹)",            type: "number", required: false, placeholder: "Leave blank to auto-compute" },
      { key: "SpecialAllowance",      label: "Special — override (₹)",               type: "number", required: false, placeholder: "Leave blank to auto-compute" },
      { key: "DearnessAllowance",     label: "Dearness — override (₹)",              type: "number", required: false, placeholder: "Leave blank to auto-compute" },
      { key: "LeaveEncashmentAmount", label: "Leave Encashment — override (₹)",      type: "number", required: false, placeholder: "Leave blank to auto-compute" },

      // ── Deductions (₹) ─────────────────────────────────────
      { key: "ProfessionalTax", label: "Professional Tax (₹)", type: "number", required: false, placeholder: "0.00" },
    ],
    bodyHtml: `
<table style="border:none; width:100%; margin-top:6pt;">
  <tbody>
    <tr>
      <td style="border:none; width:25%; vertical-align:top;"><span style="font-size:9pt; color:#64748b;">Employee Name</span><br/><strong>{{EmployeeBasicInfo.DisplayName}}</strong></td>
      <td style="border:none; width:25%; vertical-align:top;"><span style="font-size:9pt; color:#64748b;">Employee Number</span><br/><strong>{{EmployeeBasicHeaderInfo.EmployeeNumber}}</strong></td>
      <td style="border:none; width:25%; vertical-align:top;"><span style="font-size:9pt; color:#64748b;">Date Joined</span><br/><strong>{{EmployeeJobInfo.DateJoined}}</strong></td>
      <td style="border:none; width:25%; vertical-align:top;"><span style="font-size:9pt; color:#64748b;">Department</span><br/><strong>{{EmployeeJobInfo.Department}}</strong></td>
    </tr>
    <tr>
      <td style="border:none; vertical-align:top; padding-top:10pt;"><span style="font-size:9pt; color:#64748b;">Designation</span><br/><strong>{{EmployeeJobInfo.JobTitle}}</strong></td>
      <td style="border:none; vertical-align:top; padding-top:10pt;"><span style="font-size:9pt; color:#64748b;">Payment Mode</span><br/><strong>{{CustomAttributes.PaymentMode}}</strong></td>
      <td style="border:none; vertical-align:top; padding-top:10pt;"><span style="font-size:9pt; color:#64748b;">Bank</span><br/><strong>{{CustomAttributes.Bank}}</strong></td>
      <td style="border:none; vertical-align:top; padding-top:10pt;"><span style="font-size:9pt; color:#64748b;">Bank IFSC</span><br/><strong>{{CustomAttributes.BankIFSC}}</strong></td>
    </tr>
    <tr>
      <td style="border:none; vertical-align:top; padding-top:10pt;"><span style="font-size:9pt; color:#64748b;">Bank Account</span><br/><strong>{{CustomAttributes.BankAccount}}</strong></td>
      <td style="border:none; vertical-align:top; padding-top:10pt;"><span style="font-size:9pt; color:#64748b;">PAN Number</span><br/><strong>{{CustomAttributes.PANNumber}}</strong></td>
      <td style="border:none; vertical-align:top; padding-top:10pt;"><span style="font-size:9pt; color:#64748b;">Date Of Leaving</span><br/><strong>{{EmployeeJobInfo.LastWorkingDay}}</strong></td>
      <td style="border:none; vertical-align:top; padding-top:10pt;"><span style="font-size:9pt; color:#64748b;">Settlement Date</span><br/><strong>{{CustomAttributes.SettlementDate}}</strong></td>
    </tr>
  </tbody>
</table>

<h3 style="margin-top:22pt">PROVISIONAL FULL &amp; FINAL SETTLEMENT DETAILS</h3>

<table style="border:none; width:100%;">
  <tbody>
    <tr>
      <td style="border:none; width:16%; vertical-align:top;"><span style="font-size:9pt; color:#64748b;">Working Days</span><br/><strong>{{CustomAttributes.WorkingDays}}</strong></td>
      <td style="border:none; width:16%; vertical-align:top;"><span style="font-size:9pt; color:#64748b;">Loss of Pay Days</span><br/><strong>{{CustomAttributes.LossOfPayDays}}</strong></td>
      <td style="border:none; width:16%; vertical-align:top;"><span style="font-size:9pt; color:#64748b;">Leave Encashment Days</span><br/><strong>{{CustomAttributes.LeaveEncashmentDays}}</strong></td>
      <td style="border:none; width:16%; vertical-align:top;"><span style="font-size:9pt; color:#64748b;">Advance Salary Days</span><br/><strong>{{CustomAttributes.AdvanceSalaryDays}}</strong></td>
      <td style="border:none; width:16%; vertical-align:top;"><span style="font-size:9pt; color:#64748b;">Last Salary Processed</span><br/><strong>{{CustomAttributes.LastSalaryProcessed}}</strong></td>
      <td style="border:none; width:16%; vertical-align:top;"><span style="font-size:9pt; color:#64748b;">F &amp; F Processed</span><br/><strong>{{CustomAttributes.FnFProcessed}}</strong></td>
    </tr>
  </tbody>
</table>

<table style="border:none; width:100%; margin-top:18pt;">
  <tbody>
    <tr>
      <td style="border:none; width:50%; vertical-align:top; padding-right:14pt;">
        <p style="margin:0 0 6pt 0;"><strong>EARNINGS</strong></p>
        <table style="width:100%; border:none;">
          <tbody>
            {{ExitSettlement.EarningsRows}}
            <tr style="border-top:1pt solid #1f2937;"><td style="border:none; padding:6pt 0;"><strong>Total Earnings (A)</strong></td><td style="border:none; text-align:right; padding:6pt 0;"><strong>{{ExitSettlement.TotalEarnings}}</strong></td></tr>
          </tbody>
        </table>
      </td>
      <td style="border:none; width:50%; vertical-align:top; padding-left:14pt; border-left:1pt solid #e5e7eb;">
        {{ExitSettlement.DeductionsColumn}}
      </td>
    </tr>
  </tbody>
</table>

<table style="width:100%; border:none; margin-top:22pt; background:#f8fafc;">
  <tbody>
    <tr>
      <td style="border:none; padding:10pt 12pt;"><strong>Net Salary Payable ( A - B )</strong></td>
      <td style="border:none; padding:10pt 12pt; text-align:right;"><strong>{{ExitSettlement.NetPayable}}</strong></td>
    </tr>
    <tr>
      <td style="border:none; padding:4pt 12pt 10pt 12pt;">Net Salary in words</td>
      <td style="border:none; padding:4pt 12pt 10pt 12pt; text-align:right;"><strong>{{ExitSettlement.NetInWords}}</strong></td>
    </tr>
  </tbody>
</table>

<p style="margin-top:16pt; font-size:10pt; color:#475569;"><strong>**Note :</strong> <em>All amounts displayed in this payslip are in INR</em></p>
`.trim(),
  }))),
];
