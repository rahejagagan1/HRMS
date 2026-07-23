// Stamp a faint brand watermark on every page of a generated PDF.
// LibreOffice's HTML→PDF importer can't anchor a backdrop image
// (position:absolute either blows up to full-page or gets dropped),
// so we generate the PDF without a watermark and overlay the logo
// here using pdf-lib.

import { PDFDocument, degrees } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Overlay the brand watermark centered on every page.
 *
 *   • NB Media → public/logo.png
 *   • YT Labs  → public/logo-ytlabs.png
 *
 * Rendered at ~50% of page width, centered, 6% opacity so it sits
 * faintly behind the text content (LibreOffice draws text last so
 * the body is unaffected — but we add the watermark on top, with
 * very low alpha, so it reads as a backdrop in print).
 */
export async function stampWatermark(
  pdfBytes: Buffer,
  businessUnit?: string | null,
): Promise<Buffer> {
  const logoFile = businessUnit === "YT Labs" ? "logo-ytlabs.png" : "logo.png";
  const logoPath = join(process.cwd(), "public", logoFile);
  let logoBuf: Buffer;
  try {
    logoBuf = await readFile(logoPath);
  } catch {
    // Logo missing — skip watermarking rather than fail the whole
    // PDF generation. Caller still gets a usable letter, just no
    // backdrop.
    return pdfBytes;
  }

  const pdf = await PDFDocument.load(pdfBytes);
  const logoImg = await pdf.embedPng(logoBuf);
  const pages = pdf.getPages();
  for (const page of pages) {
    const { width, height } = page.getSize();
    const targetWidth = width * 0.5;
    const ratio = logoImg.height / logoImg.width;
    const targetHeight = targetWidth * ratio;
    page.drawImage(logoImg, {
      x: (width - targetWidth) / 2,
      y: (height - targetHeight) / 2,
      width: targetWidth,
      height: targetHeight,
      opacity: 0.06,
      rotate: degrees(0),
    });
  }
  const out = await pdf.save();
  return Buffer.from(out);
}
