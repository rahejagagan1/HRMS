// Render an edited JD as a branded NB Media PDF.
//
// Uses public/templates/jd-template.docx as the canvas — a derivative
// of the offer-letter template that already contains the NB Media
// letterhead, embedded logo image, and the page-header watermark.
// We do NOT build the DOCX from scratch in code; that would lose the
// binary image assets. Instead, we open the template, find/replace
// the {{JobTitle}} and {{Body}} placeholders, and convert to PDF.
//
// Pipeline:
//   1. Open public/templates/jd-template.docx via pizzip.
//   2. Replace {{JobTitle}} in the centered title.
//   3. Replace the single {{Body}} placeholder paragraph with a run
//      of paragraphs derived from HR's edited text — auto-formatted:
//      headings (lines ending with ":") become bold, lines starting
//      with "- " become bullets, "1." becomes numbered, etc.
//   4. Convert the resulting DOCX to PDF (Word COM on Windows dev /
//      LibreOffice on the VPS).

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import PizZip from "pizzip";
import { docxToPdf } from "./docx-to-pdf";
import { mergeSoftWrappedJdParagraphs } from "./jd-html";

const TEMPLATE_PATH = resolve(process.cwd(), "public", "templates", "jd-template.docx");

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Paragraph-level XML builders (Times New Roman, 11pt) ──────────
const FONT = `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>`;

function paraPlain(text: string): string {
  return (
    `<w:p>` +
      `<w:pPr><w:spacing w:after="120"/></w:pPr>` +
      `<w:r>` +
        `<w:rPr>${FONT}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>` +
        `<w:t xml:space="preserve">${xmlEscape(text)}</w:t>` +
      `</w:r>` +
    `</w:p>`
  );
}

function paraHeading(text: string): string {
  return (
    `<w:p>` +
      `<w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr>` +
      `<w:r>` +
        `<w:rPr>${FONT}<w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>` +
        `<w:t xml:space="preserve">${xmlEscape(text)}</w:t>` +
      `</w:r>` +
    `</w:p>`
  );
}

function paraBullet(text: string): string {
  return (
    `<w:p>` +
      `<w:pPr>` +
        `<w:spacing w:after="60"/>` +
        `<w:ind w:left="720" w:hanging="360"/>` +
      `</w:pPr>` +
      `<w:r>` +
        `<w:rPr>${FONT}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>` +
        `<w:t xml:space="preserve">• ${xmlEscape(text)}</w:t>` +
      `</w:r>` +
    `</w:p>`
  );
}

function paraNumbered(n: number, text: string): string {
  return (
    `<w:p>` +
      `<w:pPr>` +
        `<w:spacing w:after="60"/>` +
        `<w:ind w:left="720" w:hanging="360"/>` +
      `</w:pPr>` +
      `<w:r>` +
        `<w:rPr>${FONT}<w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>` +
        `<w:t xml:space="preserve">${n}. </w:t>` +
      `</w:r>` +
      `<w:r>` +
        `<w:rPr>${FONT}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>` +
        `<w:t xml:space="preserve">${xmlEscape(text)}</w:t>` +
      `</w:r>` +
    `</w:p>`
  );
}

function paraBlank(): string {
  return `<w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>`;
}

// Classify each line of HR's edited text so we can apply the right
// paragraph style. Order matters — bullets before colon-heading
// (so "- Domain:" is a bullet, not a heading).
// Page-marker artefacts left over from PDF-to-text conversion:
//   "-- 1 of 2 --", "Page 1 of 2", "1 of 2", "Page 1"
// Skip them so the generated PDF doesn't reproduce them.
const PAGE_MARKER_RE = /^[\s\-–—]*(?:page\s+)?\d+(?:\s*(?:of|\/)\s*\d+)?[\s\-–—]*$/i;

// JD text is now stored as HTML when authored via the new Quill
// editor (toolbar-driven Bold / Italic / Underline / font size /
// headings / lists / alignment). Older JDs are still plain text.
// Detect by checking for any of Quill's emitted block tags at the
// start of the string.
function isHtmlBody(s: string): boolean {
  const t = s.trim();
  if (!t.startsWith("<")) return false;
  return /<\/?(p|h[1-6]|ul|ol|li|div)\b/i.test(t);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

type RunStyle = {
  bold?:      boolean;
  italic?:    boolean;
  underline?: boolean;
  strike?:    boolean;
  /** Font size in HALF-points (DOCX w:sz unit). 22 = 11pt body default. */
  szHalf?:    number;
};

const BODY_SZ_HALF      = 22; // 11pt
const HEADING_H1_HALF   = 32; // 16pt
const HEADING_H2_HALF   = 28; // 14pt
const HEADING_H3_HALF   = 24; // 12pt
const QUILL_SMALL_HALF  = 18; // 9pt
const QUILL_LARGE_HALF  = 28; // 14pt
const QUILL_HUGE_HALF   = 36; // 18pt

function emitRun(text: string, style: RunStyle): string {
  if (!text) return "";
  const parts: string[] = [FONT];
  if (style.bold)      parts.push("<w:b/><w:bCs/>");
  if (style.italic)    parts.push("<w:i/><w:iCs/>");
  if (style.underline) parts.push('<w:u w:val="single"/>');
  if (style.strike)    parts.push("<w:strike/>");
  const sz = style.szHalf ?? BODY_SZ_HALF;
  parts.push(`<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`);
  return `<w:r><w:rPr>${parts.join("")}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

/** Tokenise an inline HTML fragment and emit the equivalent DOCX
 *  run XML, propagating bold / italic / underline / strike / size
 *  styles down the tree. `base` lets the caller pre-seed a style
 *  (e.g. headings start with bold + larger size). */
function inlineToRuns(inner: string, base: RunStyle = {}): string {
  const tagRe = /<(\/?)(strong|b|em|i|u|s|strike|span|br)\b([^>]*)>/gi;
  const tokens: Array<
    | { type: "open"; tag: string; attrs: string }
    | { type: "close"; tag: string }
    | { type: "text"; text: string }
    | { type: "br" }
  > = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(inner)) !== null) {
    if (m.index > last) tokens.push({ type: "text", text: inner.slice(last, m.index) });
    const tag   = m[2].toLowerCase();
    const close = m[1] === "/";
    if (tag === "br")     tokens.push({ type: "br" });
    else if (close)       tokens.push({ type: "close", tag });
    else                  tokens.push({ type: "open",  tag, attrs: m[3] ?? "" });
    last = m.index + m[0].length;
  }
  if (last < inner.length) tokens.push({ type: "text", text: inner.slice(last) });

  const stack: RunStyle[] = [base];
  const flatten = (): RunStyle => Object.assign({}, ...stack);
  const out: string[] = [];

  for (const tok of tokens) {
    if (tok.type === "open") {
      const next: RunStyle = { ...flatten() };
      switch (tok.tag) {
        case "strong":
        case "b":
          next.bold = true;
          break;
        case "em":
        case "i":
          next.italic = true;
          break;
        case "u":
          next.underline = true;
          break;
        case "s":
        case "strike":
          next.strike = true;
          break;
        case "span": {
          const cls = (tok.attrs.match(/class\s*=\s*"([^"]+)"/i)?.[1] || "").toLowerCase();
          const sty = (tok.attrs.match(/style\s*=\s*"([^"]+)"/i)?.[1] || "").toLowerCase();
          if      (cls.includes("ql-size-small")) next.szHalf = QUILL_SMALL_HALF;
          else if (cls.includes("ql-size-large")) next.szHalf = QUILL_LARGE_HALF;
          else if (cls.includes("ql-size-huge"))  next.szHalf = QUILL_HUGE_HALF;
          const px = sty.match(/font-size:\s*(\d+)\s*px/);
          if (px) next.szHalf = Math.round(Number(px[1]) * 1.5); // px → half-pt approx
          break;
        }
      }
      stack.push(next);
    } else if (tok.type === "close") {
      if (stack.length > 1) stack.pop();
    } else if (tok.type === "br") {
      // Hard line break within a run.
      out.push("<w:r><w:br/></w:r>");
    } else if (tok.type === "text") {
      const decoded = decodeEntities(tok.text);
      if (decoded) out.push(emitRun(decoded, flatten()));
    }
  }
  return out.join("");
}

/** Parse Quill alignment classes / inline text-align into the DOCX
 *  w:jc value. Returns undefined for default (left) so the caller
 *  can omit the element. */
function alignFromAttrs(attrs: string): string | undefined {
  const cls = (attrs.match(/class\s*=\s*"([^"]+)"/i)?.[1] || "").toLowerCase();
  const sty = (attrs.match(/style\s*=\s*"([^"]+)"/i)?.[1] || "").toLowerCase();
  if (cls.includes("ql-align-center")  || sty.includes("text-align: center"))  return "center";
  if (cls.includes("ql-align-right")   || sty.includes("text-align: right"))   return "right";
  if (cls.includes("ql-align-justify") || sty.includes("text-align: justify")) return "both";
  return undefined;
}

function pPrXml(opts: {
  align?:   string;
  before?:  number;
  after?:   number;
  indent?:  { left: number; hanging?: number };
}): string {
  const parts: string[] = [];
  const spc: string[] = [];
  if (opts.before != null) spc.push(`w:before="${opts.before}"`);
  if (opts.after  != null) spc.push(`w:after="${opts.after}"`);
  if (spc.length) parts.push(`<w:spacing ${spc.join(" ")}/>`);
  if (opts.indent) {
    const ind: string[] = [`w:left="${opts.indent.left}"`];
    if (opts.indent.hanging != null) ind.push(`w:hanging="${opts.indent.hanging}"`);
    parts.push(`<w:ind ${ind.join(" ")}/>`);
  }
  if (opts.align && opts.align !== "left") parts.push(`<w:jc w:val="${opts.align}"/>`);
  return parts.length ? `<w:pPr>${parts.join("")}</w:pPr>` : "";
}

/** Convert a Quill-authored HTML JD body into DOCX paragraph XML.
 *  Handles: p / h1-h3 / ul / ol / li with nested bold / italic /
 *  underline / strike / size / alignment. Other tags are passed
 *  through as inline runs (sanitised upstream). */
function htmlToBodyXml(html: string): string {
  const out: string[] = [];
  // Top-level block extractor — matches paired tags. Quill output
  // is always well-formed, so a simple non-greedy match handles all
  // current cases. Whitespace BETWEEN blocks (newlines / indentation)
  // is consumed by the gap-matching slice and ignored.
  const blockRe = /<(p|h[1-6]|ul|ol|div|blockquote)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const tag   = m[1].toLowerCase();
    const attrs = m[2] || "";
    const inner = m[3] || "";
    const align = alignFromAttrs(attrs);

    if (tag === "ul" || tag === "ol") {
      // Iterate <li> within the list. Numbered lists get an
      // explicit "N. " prefix run (sized + bold) so the PDF
      // visually matches the inline render's <ol>.
      const liRe = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
      let li: RegExpExecArray | null;
      let n = 1;
      while ((li = liRe.exec(inner)) !== null) {
        const liAttrs = li[1] || "";
        const liInner = li[2] || "";
        const liAlign = alignFromAttrs(liAttrs) ?? align;
        if (tag === "ol") {
          const prefix = emitRun(`${n}. `, { bold: true });
          out.push(
            `<w:p>${pPrXml({ align: liAlign, after: 60, indent: { left: 720, hanging: 360 } })}` +
              prefix + inlineToRuns(liInner) +
            `</w:p>`,
          );
          n++;
        } else {
          const prefix = emitRun("• ", {});
          out.push(
            `<w:p>${pPrXml({ align: liAlign, after: 60, indent: { left: 720, hanging: 360 } })}` +
              prefix + inlineToRuns(liInner) +
            `</w:p>`,
          );
        }
      }
      continue;
    }

    // Empty paragraphs ("<p><br></p>" / "<p></p>") render as a
    // spacer blank line.
    const stripped = inner.replace(/<br\s*\/?>/gi, "").replace(/&nbsp;/gi, "").trim();
    if (!stripped) {
      out.push(paraBlank());
      continue;
    }
    // Page-break artefacts ("Page 1 of 2", "— 1 of 2 —") that PDF
    // extractors emit. buildBodyXml's plain-text path filters these via
    // PAGE_MARKER_RE; the Quill HTML path (added in 20415b2) regressed by
    // skipping it — re-apply here so they don't render in generated PDFs.
    if (PAGE_MARKER_RE.test(stripped.replace(/<[^>]+>/g, "").trim())) continue;

    if (tag === "h1") {
      out.push(
        `<w:p>${pPrXml({ align, before: 200, after: 100 })}` +
          inlineToRuns(inner, { bold: true, szHalf: HEADING_H1_HALF }) +
        `</w:p>`,
      );
    } else if (tag === "h2") {
      out.push(
        `<w:p>${pPrXml({ align, before: 180, after: 90 })}` +
          inlineToRuns(inner, { bold: true, szHalf: HEADING_H2_HALF }) +
        `</w:p>`,
      );
    } else if (tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
      out.push(
        `<w:p>${pPrXml({ align, before: 160, after: 80 })}` +
          inlineToRuns(inner, { bold: true, szHalf: HEADING_H3_HALF }) +
        `</w:p>`,
      );
    } else if (tag === "blockquote") {
      out.push(
        `<w:p>${pPrXml({ align, after: 120, indent: { left: 480 } })}` +
          inlineToRuns(inner, { italic: true }) +
        `</w:p>`,
      );
    } else {
      // p / div — plain paragraph. NO after-spacing: Quill stores each
      // soft-wrapped line as its own <p> (JDs extracted from PDFs), and
      // the editor renders them flush. Spacing between real paragraphs
      // comes from the explicit blank-line <p><br></p> spacers above —
      // keeps the PDF in lockstep with the editor and the careers page
      // (.jd-prose p { margin: 0 } in globals.css).
      out.push(
        `<w:p>${pPrXml({ align })}` +
          inlineToRuns(inner) +
        `</w:p>`,
      );
    }
  }
  // If nothing matched (malformed input / pure text inside no block),
  // fall back to wrapping the whole thing as a single paragraph.
  if (out.length === 0 && html.trim()) {
    out.push(`<w:p>${pPrXml({ after: 120 })}${inlineToRuns(html)}</w:p>`);
  }
  return out.join("");
}

function buildBodyXml(text: string): string {
  // HTML body (Quill-authored) → walk the markup. Soft-wrapped <p>
  // fragments (one per PDF line in extracted JDs) are merged into
  // flowing paragraphs first — same helper as the careers page render.
  if (isHtmlBody(text)) return htmlToBodyXml(mergeSoftWrappedJdParagraphs(text));

  // Plain text (legacy JDs) — per-line classifier. Consecutive plain
  // lines are soft wraps from PDF-to-text extraction, so they're
  // buffered and joined into ONE paragraph; only a blank line, bullet,
  // number, or heading breaks the flow. Mirrors parseJdBlocks in
  // src/app/jobs/[slug]/page.tsx so the saved PDF and the inline
  // careers-page render stay visually in sync.
  let sawTitle = false; // drop ONE leading "Job Description - X" title line
  const out: string[] = [];
  let paraBuf: string[] = [];
  const flushPara = () => {
    if (paraBuf.length) {
      out.push(paraPlain(paraBuf.join(" ")));
      paraBuf = [];
    }
  };
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); out.push(paraBlank()); continue; }
    if (PAGE_MARKER_RE.test(line.trim())) { flushPara(); continue; }
    // The template prints {{JobTitle}} itself, so a legacy plain-text
    // body that still carries a "Job Description - X" / "Job Title: X"
    // line would double the title — drop it once.
    const titleMatch = line.trim().match(/^(?:Job\s+Description|Job\s+Title)\s*[-–—:]\s*(.+)$/i);
    if (!sawTitle && titleMatch) { sawTitle = true; continue; }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) { flushPara(); out.push(paraBullet(bullet[1])); continue; }
    const num = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (num) { flushPara(); out.push(paraNumbered(parseInt(num[1], 10), num[2])); continue; }
    if (/:\s*$/.test(line) && line.length <= 60) {
      flushPara();
      out.push(paraHeading(line.replace(/:\s*$/, "") + ":"));
      continue;
    }
    paraBuf.push(line.trim());
  }
  flushPara();
  return out.join("");
}

// Replace the entire {{Body}} placeholder PARAGRAPH (not just the
// text) with the generated multi-paragraph body XML. The placeholder
// in the template lives inside one <w:p>...</w:p> wrapper; we need
// to replace from the opening <w:p> through the closing </w:p>.
function replaceBodyParagraph(xml: string, bodyXml: string): string {
  const needle = "{{Body}}";
  const idx = xml.indexOf(needle);
  if (idx === -1) return xml;
  const pStart = xml.lastIndexOf("<w:p>", idx);
  const pStartAlt = xml.lastIndexOf("<w:p ", idx);
  const start = Math.max(pStart, pStartAlt);
  if (start === -1) return xml;
  const end = xml.indexOf("</w:p>", idx);
  if (end === -1) return xml;
  return xml.slice(0, start) + bodyXml + xml.slice(end + "</w:p>".length);
}

/** Render the edited JD text → branded NB Media PDF using the
 *  jd-template.docx as the canvas (letterhead + logo + watermark). */
export async function renderJdPdfFromText(args: {
  title: string;
  text: string;
}): Promise<Buffer> {
  const templateBytes = await readFile(TEMPLATE_PATH);
  const zip = new PizZip(templateBytes);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("word/document.xml missing in jd-template");
  let xml = docFile.asText();

  // ── 1. Replace the title placeholder (string-level) ─────────
  xml = xml.replace(/\{\{JobTitle\}\}/g, xmlEscape(args.title || "Role"));

  // ── 2. Swap the {{Body}} placeholder paragraph with auto-
  //       formatted paragraphs from HR's text. ──────────────────
  const bodyXml = buildBodyXml(args.text || "");
  xml = replaceBodyParagraph(xml, bodyXml);

  zip.file("word/document.xml", xml);
  const docxBytes = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  return docxToPdf(docxBytes);
}
