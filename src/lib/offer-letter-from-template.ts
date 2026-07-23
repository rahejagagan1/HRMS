// Renders the official NB Media offer letter by overlaying text onto
// the actual template PDF (public/templates/offer-letter-template.pdf).
//
// Approach:
//   1. Load the template PDF with pdf-lib.
//   2. For each yellow-highlighted placeholder, draw a small white
//      rectangle to mask the original text + highlight.
//   3. Write the substituted value at the same coordinates with a
//      serif font (TimesRoman) and size that matches the template.
//
// Coordinates came from scripts/_probe-offer-template-coords.ts
// (one-off pdfjs scan). PDFs use bottom-left origin — y values are
// measured up from the page bottom.
//
// Substitutions:
//   • Letter date           (page 1 top)
//   • Candidate Name        (page 1 greeting + page 4 acceptance)
//   • Application date      (page 1 "application dated …")
//   • Job Role              (page 1 greeting + page 2 T&C heading)
//   • Joining Date          (page 1 + page 4 acceptance)
//   • Acceptance deadline   (page 1)
//   • Annual LPA            (page 4 Annexure A "Rs. XX LPA")
//
// "Reporting Time: 10:00 AM" and the "10:00 AM" placeholder in the
// template are KEPT — those are fixed values, not per-candidate.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const TEMPLATE_PATH = resolve(process.cwd(), "public", "templates", "offer-letter-template.pdf");

// One overlay spec per placeholder. (x, y) is the bottom-left baseline
// of the text. `width` is the highlighted rectangle's width — used to
// size the white mask. `size` is the IDEAL font size in pt; if the
// substituted text doesn't fit, the font auto-shrinks to fit `width`.
type Overlay = {
  page:   number;      // 1-indexed
  x:      number;
  y:      number;      // baseline (bottom-left origin)
  width:  number;      // width of the masked area
  height: number;      // height of the masked area
  size:   number;
  text:   string;
  /** When true, use bold instead of regular. The template emphasises
   *  the joining date / role / candidate name etc. with bold. */
  bold?:  boolean;
  /** Extra horizontal padding on the LEFT side of the mask — used to
   *  catch curly-quote artifacts that sit in a separate text run
   *  just before the placeholder. */
  padLeft?:  number;
  /** Extra horizontal padding on the RIGHT side of the mask. */
  padRight?: number;
};

export type OfferTemplateArgs = {
  candidateName:      string;
  jobRole:            string;
  letterDate?:        Date | string | null;
  applicationDate?:   Date | string | null;
  joiningDate?:       Date | string | null;
  acceptanceDeadline?: Date | string | null;
  annualCtcINR:       number | null;
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

// ── Main entry point ───────────────────────────────────────────────
export async function renderOfferLetterFromTemplate(args: OfferTemplateArgs): Promise<Buffer> {
  const templateBytes = await readFile(TEMPLATE_PATH);
  const pdf = await PDFDocument.load(templateBytes);
  const timesRoman     = await pdf.embedFont(StandardFonts.TimesRoman);
  const timesRomanBold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  // Resolve values once.
  const letterDate        = fmtLongDate(args.letterDate ?? new Date());
  const candidateName     = (args.candidateName || "Candidate Name").trim();
  const applicationDate   = fmtLongDate(args.applicationDate ?? null, "—");
  const jobRole           = (args.jobRole || "Job Role").trim();
  const joiningDate       = fmtSlashDate(args.joiningDate ?? null);
  const acceptanceDeadline = fmtSlashDate(args.acceptanceDeadline ?? null);
  const annualLPA         = ctcToLpa(args.annualCtcINR);

  // Mask widths match the placeholder spans found by
  // scripts/_probe-offer-template-coords.ts. Going wider eats into the
  // surrounding original text (e.g. " and subsequent interview" right
  // after the application date) which is what produced the
  // "missing words" bug.
  //
  // Where the template has the OPENING curly quote in a separate text
  // run just before the placeholder (e.g. for page-1 "Candidate Name"
  // and "Job Role"), we replace BOTH quotes in our text and use a
  // small padLeft so the original leading quote is also masked — the
  // typography stays balanced.
  const overlays: Overlay[] = [
    // ── Page 1 ──
    // Letter date — w probe=81.5
    { page: 1, x: 41.8,  y: 576.4, width: 84,   height: 14, size: 11.5, text: letterDate },
    // Candidate Name in greeting — w probe=83.9. Probe matched the
    // "Candidate Name”" span (with trailing curly quote). The leading
    // curly quote sits in a separate run at ~x=66; padLeft=8 masks it
    // and we redraw both quotes in our replacement.
    { page: 1, x: 71.1,  y: 553.9, width: 86,   height: 14, size: 11.5, text: `“${candidateName}”`, padLeft: 8 },
    // Application date "10th January 2024" with curly quotes —
    // w probe=95.3. KEEP mask tight so " and subsequent" after the
    // date isn't wiped out.
    { page: 1, x: 234.8, y: 528.4, width: 96,   height: 14, size: 11.5, text: `“${applicationDate}”`, bold: true },
    // Job Role in greeting. Roles vary widely in length so we mask
    // the remainder of the line (covering "with YT Money Productions
    // Pvt. Ltd.") and redraw both the role AND the trailing context.
    // Loses the bold-italic styling on "YT Money …" but the sentence
    // reads cleanly without overlap.
    { page: 1, x: 290.8, y: 515.9, width: 56,   height: 14, size: 11.5, text: `“${jobRole}” with YT Money Productions Pvt. Ltd.`, bold: true, padRight: 200 },
    // Joining Date "DD/MM/YYYY" — w probe=74.4.
    { page: 1, x: 104.9, y: 401.9, width: 76,   height: 14, size: 11.5, text: joiningDate, bold: true },
    // Acceptance deadline (lowercase placeholder in template) —
    // w probe=56.1.
    { page: 1, x: 502.5, y: 237.4, width: 58,   height: 14, size: 11.5, text: acceptanceDeadline, bold: true },

    // ── Page 2 — Job Role in T&C lead-in. Same overflow concern as
    // page 1: long role titles bleed over " at YT Money Productions
    // Pvt. Ltd.". Mask the trailing context and redraw it. Loses the
    // bold-italic styling on "YT Money …" but reads cleanly. ──
    { page: 2, x: 351.7, y: 713.7, width: 50,   height: 13, size: 11,   text: `“${jobRole}” at YT Money Productions Pvt. Ltd.`, bold: true, padRight: 230 },

    // ── Page 4 — Acceptance section ──
    // "Candidate Name" with trailing " hereby" so a short name doesn't
    // leave a visible gap before "hereby accept...". The original line
    // wraps at "...the conditions"; we only redraw up to "hereby" so
    // we don't disturb the line break.
    { page: 4, x: 72.0,  y: 667.4, width: 93,   height: 14, size: 11.5, text: `“${candidateName}” hereby`, bold: true, padRight: 50 },
    // Joining "DD/MM/YYYY" with both curly quotes — w probe=82.9.
    { page: 4, x: 106.6, y: 654.7, width: 85,   height: 14, size: 11.5, text: `“${joiningDate}”`, bold: true },

    // ── Page 4 (bottom) — Annexure A annual LPA — w probe=27.1 ──
    { page: 4, x: 245.6, y: 58.8,  width: 29,   height: 14, size: 11.5, text: `“${annualLPA}”`, bold: true },
  ];

  for (const o of overlays) {
    const pageIdx = o.page - 1;
    if (pageIdx < 0 || pageIdx >= pdf.getPageCount()) continue;
    const page = pdf.getPage(pageIdx);
    const font = o.bold ? timesRomanBold : timesRoman;

    // Auto-shrink to fit so a long role / candidate name doesn't
    // overflow past the masked area. Floor at 7pt — anything smaller
    // would be unreadable; if HR somehow types a 100-char role the
    // text will still overflow at 7pt and we accept that tradeoff
    // over rendering at 4pt.
    let size = o.size;
    const availableWidth = o.width + (o.padRight ?? 0);
    while (size > 7 && font.widthOfTextAtSize(o.text, size) > availableWidth) {
      size -= 0.25;
    }

    // Mask: covers ascent + descent vertically, plus configured
    // horizontal padding on each side. White rectangle wipes both
    // the placeholder text AND the yellow highlight beneath it.
    const padL = o.padLeft  ?? 1;
    const padR = o.padRight ?? 2;
    page.drawRectangle({
      x:      o.x - padL,
      y:      o.y - 3,
      width:  o.width + padL + padR,
      height: o.height + 4,
      color:  rgb(1, 1, 1),
    });
    page.drawText(o.text, {
      x:    o.x,
      y:    o.y,
      size,
      font,
      color: rgb(0, 0, 0),
    });
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

// ── Adapter for the email-send flow ───────────────────────────────
// Same shape as the previous renderOfferLetterPdf helper so the
// offer endpoints can swap to this with minimal change.
export async function renderOfferLetterPdfFromTemplate(args: OfferTemplateArgs & {
  /** Used to pick a safe attachment filename. */
}): Promise<{ pdf: Buffer; filename: string; mime: string }> {
  const pdf = await renderOfferLetterFromTemplate(args);
  const safeName = args.candidateName.replace(/[\r\n"\/\\]/g, "").slice(0, 80) || "Candidate";
  return {
    pdf,
    filename: `Offer Letter - ${safeName}.pdf`,
    mime:     "application/pdf",
  };
}
