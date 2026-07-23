// Render the offer letter by filling in placeholders directly inside
// the .docx template. No coordinate math, no overlay edge cases —
// pure string substitution on the document's XML. Text reflows
// naturally because Word/Google Docs handles layout when the
// candidate opens the file.
//
// Approach:
//   1. Load public/templates/offer-letter-template.docx as a zip.
//   2. Read word/document.xml — the doc's content as Office XML.
//   3. Find/replace each placeholder string in the XML. We verified
//      via scripts/_inspect-docx-runs.ts that every placeholder is
//      intact in a single <w:t> run, so plain regex replacement is
//      enough — no need to merge split runs.
//   4. Re-zip and return the modified .docx bytes.
//
// "10th January 2024" appears twice (letter date + application date).
// Replaced in order: first match = letter date, second = application
// date. The other placeholders all map 1:1 to a single value.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import PizZip from "pizzip";

const TEMPLATE_PATH = resolve(process.cwd(), "public", "templates", "offer-letter-template.docx");

export type DocxOfferArgs = {
  candidateName:       string;
  jobRole:             string;
  letterDate?:         Date | string | null;
  applicationDate?:    Date | string | null;
  joiningDate?:        Date | string | null;
  acceptanceDeadline?: Date | string | null;
  annualCtcINR?:       number | null;
  hrContactName?:      string;
};

// ── Date helpers ────────────────────────────────────────────────────
function fmtLongDate(d: Date | string | null | undefined, fallback = "DD/MM/YYYY"): string {
  if (!d) return fallback;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return fallback;
  const day   = dt.getDate();
  const month = dt.toLocaleString("en-IN", { month: "long" });
  const year  = dt.getFullYear();
  const suffix = (day % 10 === 1 && day !== 11) ? "st"
               : (day % 10 === 2 && day !== 12) ? "nd"
               : (day % 10 === 3 && day !== 13) ? "rd" : "th";
  return `${day}${suffix} ${month} ${year}`;
}

function fmtSlashDate(d: Date | string | null | undefined, fallback = "DD/MM/YYYY"): string {
  if (!d) return fallback;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return fallback;
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${dt.getFullYear()}`;
}

function ctcToLpa(annualCtcINR: number | null | undefined): string {
  if (!annualCtcINR || annualCtcINR <= 0) return "XX";
  return (annualCtcINR / 100_000).toFixed(2).replace(/\.00$/, "");
}

// Format a rupee amount for the Annexure A table cells. Renders as
// "Rs. 24,000" — preserves the "Rs." prefix that's already in the
// template so the column reads consistently across rows.
function fmtRupeeCell(n: number): string {
  return `Rs. ${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// Standard private-sector monthly split — matches computePayBreakdown
// in @/lib/offer-letter so the textarea peek and the printed PDF agree.
//   Basic       = 40% of monthly gross
//   HRA         = 50% of Basic
//   DA          = 0
//   Conveyance  = ₹1,600 (cap)
//   Medical     = ₹1,250 (cap)
//   Special     = balancer (clamped to 0 for tiny CTCs)
type PayBreakdown = {
  basic: number; hra: number; da: number;
  conveyance: number; medical: number; special: number;
  totalMonthly: number;
};
function computeBreakdown(annualCtcINR: number | null | undefined): PayBreakdown | null {
  if (!annualCtcINR || annualCtcINR <= 0 || !Number.isFinite(annualCtcINR)) return null;
  const monthly    = Math.round(annualCtcINR / 12);
  const basic      = Math.round(monthly * 0.40);
  const hra        = Math.round(basic   * 0.50);
  const da         = 0;
  const conveyance = Math.min(1600, monthly);
  const medical    = Math.min(1250, monthly);
  const special    = Math.max(0, monthly - basic - hra - da - conveyance - medical);
  return { basic, hra, da, conveyance, medical, special, totalMonthly: monthly };
}

/** XML-escape a value before injecting it into the docx's XML. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Replace the Nth occurrence of `needle` in `haystack` with
 *  `replacement`. Both `needle` and `replacement` are PLAIN text;
 *  replacement is xml-escaped first. */
function replaceNth(haystack: string, needle: string, replacement: string, n: number): string {
  let idx = -1;
  for (let i = 0; i <= n; i++) {
    idx = haystack.indexOf(needle, idx + 1);
    if (idx === -1) return haystack;
  }
  return haystack.slice(0, idx) + xmlEscape(replacement) + haystack.slice(idx + needle.length);
}

/** Replace EVERY occurrence of `needle` with `replacement`. */
function replaceAll(haystack: string, needle: string, replacement: string): string {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return haystack.replace(new RegExp(escaped, "g"), xmlEscape(replacement));
}

/** Replace the first N occurrences of `needle` with the
 *  corresponding entry in `replacements`, in left-to-right order.
 *  Cursor advances PAST each replacement so a replacement that itself
 *  contains `needle` (e.g. "Rs." → "Rs. 24,000") doesn't double-match.
 */
function replaceEachOccurrence(haystack: string, needle: string, replacements: string[]): string {
  let out = "";
  let cursor = 0;
  for (const value of replacements) {
    const idx = haystack.indexOf(needle, cursor);
    if (idx === -1) break;
    out += haystack.slice(cursor, idx) + xmlEscape(value);
    cursor = idx + needle.length;
  }
  out += haystack.slice(cursor);
  return out;
}

/** Fill the template and return the modified .docx bytes. */
export async function renderOfferLetterDocx(args: DocxOfferArgs): Promise<Buffer> {
  const templateBytes = await readFile(TEMPLATE_PATH);
  const zip = new PizZip(templateBytes);
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) throw new Error("word/document.xml not found in template");
  let xml = xmlFile.asText();

  // Resolve values.
  const letterDate         = fmtLongDate(args.letterDate ?? new Date());
  const candidateName      = (args.candidateName || "Candidate Name").trim();
  const applicationDate    = fmtLongDate(args.applicationDate ?? null, "—");
  const jobRole            = (args.jobRole || "Job Role").trim();
  const joiningDate        = fmtSlashDate(args.joiningDate ?? null);
  const acceptanceDeadline = fmtSlashDate(args.acceptanceDeadline ?? null);
  const annualLPA          = ctcToLpa(args.annualCtcINR);
  const hrContactName      = (args.hrContactName ?? "Vanshika").trim();

  // ── 1. "10th January 2024" appears TWICE — letter date first,
  // application date second. Replace in order so they don't get the
  // same value.
  xml = replaceNth(xml, "10th January 2024", letterDate,      0);
  xml = replaceNth(xml, "10th January 2024", applicationDate, 0);  // n=0 because we already consumed the first

  // ── 2. Everywhere-the-same substitutions.
  xml = replaceAll(xml, "Candidate Name", candidateName);
  xml = replaceAll(xml, "Job Role",       jobRole);
  xml = replaceAll(xml, "DD/MM/YYYY",     joiningDate);
  xml = replaceAll(xml, "dd/mm/yyyy",     acceptanceDeadline);

  // ── 3. Annexure A annual LPA: replace bare "XX" with the LPA value
  // (don't replace "XX" inside other words; we know it only appears
  // as `"XX"` per the inspect-runs probe so this is safe).
  xml = replaceAll(xml, "XX", annualLPA);

  // ── 4. Annexure A pay component table. The template ships with
  // every cell reading just "Rs." as a placeholder; we fill them in
  // left-to-right (1 annual header + 7 monthly rows). The order in
  // the docx XML — verified by scripts/_inspect-docx-runs.ts — is:
  //   [0] "Your Annual fixed compensation of Rs."   → annual total
  //   [1] Basic Pay row
  //   [2] House Rent Allowance row
  //   [3] Dearness Allowance row
  //   [4] Conveyance Allowance row
  //   [5] Medical Allowance row
  //   [6] Special Allowance row
  //   [7] TOTAL MONTHLY CTC row
  // When the CTC isn't known the cells stay "Rs." (the existing
  // placeholder) so HR can fill manually later.
  const pay = computeBreakdown(args.annualCtcINR);
  if (pay && args.annualCtcINR) {
    xml = replaceEachOccurrence(xml, "Rs.", [
      fmtRupeeCell(args.annualCtcINR),
      fmtRupeeCell(pay.basic),
      fmtRupeeCell(pay.hra),
      fmtRupeeCell(pay.da),
      fmtRupeeCell(pay.conveyance),
      fmtRupeeCell(pay.medical),
      fmtRupeeCell(pay.special),
      fmtRupeeCell(pay.totalMonthly),
    ]);
  }

  // ── 5. HR contact at the bottom — Tanvi → Vanshika (or whoever).
  xml = replaceAll(xml, "Tanvi", hrContactName);

  // ── 6. Strip the yellow highlight markers.
  // The template uses <w:highlight w:val="yellow"/> on placeholder
  // runs as a visual cue for HR while editing. The candidate should
  // never see those markers — substituted text reads cleanly on a
  // plain background.
  xml = xml.replace(/<w:highlight\s+w:val="yellow"\s*\/>/g, "");

  zip.file("word/document.xml", xml);
  const out = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  return out;
}

// ── Adapter for the email-send flow ────────────────────────────────
// Pipeline:
//   1. Fill the .docx template via XML find/replace (above).
//   2. Convert filled .docx → PDF (LibreOffice on VPS, Word COM on
//      Windows dev). Conversion preserves the template's formatting
//      exactly because we're letting Word/LO render the doc.
//   3. Email attaches the PDF.
//
// If PDF conversion fails (no LibreOffice + non-Windows), we fall
// back to attaching the .docx so the candidate still gets the offer —
// just in editable form.
export async function renderOfferLetterDocxAttachment(args: DocxOfferArgs): Promise<{
  pdf: Buffer; filename: string; mime: string;
}> {
  const safeName = args.candidateName.replace(/[\r\n"\/\\]/g, "").slice(0, 80) || "Candidate";
  const docxBytes = await renderOfferLetterDocx(args);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { docxToPdf } = require("./docx-to-pdf") as typeof import("./docx-to-pdf");
  try {
    const pdfBytes = await docxToPdf(docxBytes);
    return {
      pdf:      pdfBytes,
      filename: `Offer Letter - ${safeName}.pdf`,
      mime:     "application/pdf",
    };
  } catch (e: any) {
    console.error("[offer-letter] docx→pdf conversion failed; attaching docx instead:", e?.message ?? e);
    return {
      pdf:      docxBytes,
      filename: `Offer Letter - ${safeName}.docx`,
      mime:     "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }
}
