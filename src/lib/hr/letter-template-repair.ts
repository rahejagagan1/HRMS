// Structural self-repair for letter-template saves.
//
// The visual template editor (Quill) cannot represent tables, page-break
// divs, or heading classes — loading a template and saving it silently
// flattens the Annexure "A" pay table into bare <p> rows, drops every
// <div class="page-break"></div>, un-nests Annexure "B"'s a/b/c address
// proofs, and converts normal spaces to non-breaking ones (2026-08-05:
// two consecutive saves destroyed the NB Media offer letter this way).
//
// Rather than blocking HR's legitimate wording edits, PATCH runs the saved
// body through this repair: wording is kept exactly as typed; the known
// structural blocks are rebuilt to the canonical seed shapes. Idempotent —
// a body that is already well-formed passes through unchanged.

const PB = '<div class="page-break"></div>';

const PAY_TABLE_HTML = `<p style="text-align:center"><strong>FIXED MONTHLY PAY:</strong></p>
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
</table>`;

/** Repair a template body after an editor save. Safe on every template
 *  (whitespace normalization); offer letters additionally get their
 *  structural blocks rebuilt. */
export function repairLetterTemplateStructure(key: string, html: string): string {
  // Non-breaking spaces (editor/Word artifact) break line wrapping in the
  // rendered PDF and defeat all the anchors below — normalize first.
  let body = html.replace(/\u00A0/g, " ").replace(/&nbsp;/gi, " ");
  if (key !== "revised_offer_letter") return body;

  // 1) TERMS AND CONDITIONS always opens its own page, with the print
  //    heading class (keeps the heading attached to its first clause).
  body = body.replace(
    /(?:<div class="page-break"><\/div>\s*)?<h2[^>]*>\s*TERMS AND CONDITIONS:?\s*<\/h2>/i,
    `${PB}<h2 class="section-title">TERMS AND CONDITIONS:</h2>`,
  );

  // 2) Annexure "A": fresh page + centered print headings.
  body = body.replace(
    /(?:<div class="page-break"><\/div>\s*)?<h2[^>]*>\s*Annexure "A"\s*<\/h2>\s*<h3[^>]*>\s*COMPENSATION STRUCTURE\s*<\/h3>/i,
    `${PB}<h2 class="section-title" style="text-align:center">Annexure "A"</h2><h3 style="text-align:center">COMPENSATION STRUCTURE</h3>`,
  );
  //    Pay table flattened into <p> rows → rebuild the canonical table.
  //    The span runs from the FIXED MONTHLY PAY line to the TotalAnnual
  //    placeholder (the table's last cell, wherever the flattening put it).
  if (!/<table[^>]*class="pay-table"/i.test(body)) {
    const startM = /<p[^>]*>(?:<strong>)?FIXED MONTHLY PAY:?(?:<\/strong>)?<\/p>/i.exec(body);
    const endM = /\{\{Salary\.TotalAnnual\}\}(?:<\/strong>)?<\/p>/i.exec(body);
    if (startM && endM && endM.index > startM.index) {
      body = body.slice(0, startM.index) + PAY_TABLE_HTML + body.slice(endM.index + endM[0].length);
    }
  }

  // 3) Annexure "B": fresh page + centered heading; re-nest the a/b/c
  //    address proofs when the editor promoted them to top-level items.
  body = body.replace(
    /(?:<div class="page-break"><\/div>\s*)?<h2[^>]*>\s*Annexure "B"\s*<\/h2>/i,
    `${PB}<h2 class="section-title" style="text-align:center">Annexure "B"</h2>`,
  );
  body = body.replace(
    /<li>\s*Permanent Address Proof:?\s*<\/li>\s*<li>\s*Aadhar Card\s*<\/li>\s*<li>\s*Passport \(Optional\)\s*<\/li>\s*<li>\s*Voter ID card \/ Ration card \/ Driving license \/ Electricity bill \(Optional\)\s*<\/li>/i,
    `<li>Permanent Address Proof:<ol type="a"><li>Aadhar Card</li><li>Passport (Optional)</li><li>Voter ID card / Ration card / Driving license / Electricity bill (Optional)</li></ol></li>`,
  );

  return body;
}
