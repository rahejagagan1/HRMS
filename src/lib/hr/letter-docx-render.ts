// Per-template DOCX renderer.
//
// Each LetterTemplate key maps to a DOCX file under public/templates/.
// The DOCX is HR's actual source-of-truth letter — letterhead, logo,
// watermark, Nikit's signature image, signoff block, every visual
// element preserved as binary assets. We don't re-build any of that
// in code; we just walk the document XML, find `{{Section.Field}}`
// placeholders, and substitute the resolved values.
//
// Two layers of substitution:
//   1. `mergeSplitPlaceholders(xml)` — Word often splits a placeholder
//      across multiple <w:r> runs when it ran spell-check or got
//      partial formatting. Before substitution we collapse adjacent
//      <w:r> runs whose combined <w:t> text contains a `{{...}}` so
//      simple string replace works.
//   2. `replacePlaceholders(xml, resolver)` — walks the merged XML
//      and swaps every placeholder occurrence. Resolver returns the
//      already-resolved + XML-escaped value, or null for "leave as-is
//      so HR notices the missing field".
//
// Returns the modified DOCX bytes. The caller hands these to
// docxToPdf (LibreOffice) for the final PDF.

import { readFile, access } from "node:fs/promises";
import { constants as FS_CONSTANTS } from "node:fs";
import { resolve } from "node:path";
import PizZip from "pizzip";

/** Where each LetterTemplate.key looks for its source DOCX. The
 *  filename convention is `letter-<kebab-case-key>.docx`; the
 *  Revised Offer reuses the existing offer-letter-template.docx. */
export const TEMPLATE_DOCX_MAP: Record<string, string> = {
  fnf_settlement:         "letter-fnf-settlement.docx",
  internship_completion:  "letter-internship-completion.docx",
  probation_confirmation: "letter-probation-confirmation.docx",
  relieving_service:      "letter-relieving-service.docx",
  revised_offer_letter:   "offer-letter-template.docx",
};

function docxPathFor(key: string): string | null {
  const name = TEMPLATE_DOCX_MAP[key];
  if (!name) return null;
  return resolve(process.cwd(), "public", "templates", name);
}

export async function docxExistsForKey(key: string): Promise<boolean> {
  const p = docxPathFor(key);
  if (!p) return false;
  try { await access(p, FS_CONSTANTS.R_OK); return true; }
  catch { return false; }
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Merge adjacent <w:r> runs whose combined <w:t> text contains an
 * open `{{` that isn't closed within the same run. Word sometimes
 * splits a placeholder mid-string because spell-check / undo /
 * partial formatting introduced extra runs. We greedily merge until
 * each placeholder lives inside one <w:t> so plain string replace
 * works.
 *
 * Simple approach — extract all text content, find the placeholders,
 * walk runs and merge until the placeholder is whole. We use a
 * loose regex to bound the work; documents with no placeholders
 * skip this entirely.
 */
function mergeSplitPlaceholders(xml: string): string {
  // Only do the work if we actually have a split placeholder. A
  // placeholder living in one run looks like `<w:t>...{{Foo.Bar}}...</w:t>`.
  // A split looks like `<w:t>...{{Foo</w:t></w:r><w:r>...<w:t>.Bar}}...</w:t>`
  // — the `{{` and `}}` are on different lines/runs. If there's no
  // `{{` with no matching `}}` before the next `</w:t>` open the
  // doc is already clean.
  if (!/\{\{/.test(xml)) return xml;

  // Iteratively collapse runs. We repeatedly look for an opening
  // `{{` in a <w:t>, scan forward through following runs/<w:t>s,
  // and merge their text into the original run when we find the
  // closing `}}`. Bounded by `safety` to avoid pathological inputs.
  let result = xml;
  let safety = 256;
  while (safety-- > 0) {
    // Find a `{{` that does NOT have a matching `}}` before the
    // closing </w:t> of the same run.
    const openIdx = result.search(/<w:t(?:\s[^>]*)?>[^<]*\{\{[^}]*$/m);
    if (openIdx === -1) break;
    // Locate the start of the run containing that <w:t>.
    const runStart = result.lastIndexOf("<w:r>", openIdx);
    const runStartAlt = result.lastIndexOf("<w:r ", openIdx);
    const rs = Math.max(runStart, runStartAlt);
    if (rs === -1) break;
    const runEnd = result.indexOf("</w:r>", openIdx);
    if (runEnd === -1) break;
    // Walk forward run-by-run, accumulating text until we find `}}`.
    let cursor = runEnd + "</w:r>".length;
    let accumulatedText = "";
    let merged = false;
    let scanSafety = 64;
    while (scanSafety-- > 0 && cursor < result.length) {
      const nextRunStart = result.indexOf("<w:r>", cursor);
      const nextRunStartAlt = result.indexOf("<w:r ", cursor);
      const nrs = nextRunStart === -1
        ? nextRunStartAlt
        : nextRunStartAlt === -1
          ? nextRunStart
          : Math.min(nextRunStart, nextRunStartAlt);
      if (nrs === -1) break;
      const nextRunEnd = result.indexOf("</w:r>", nrs);
      if (nextRunEnd === -1) break;
      // Extract the text content of this run (concat of every <w:t>…</w:t>).
      const runXml = result.slice(nrs, nextRunEnd);
      const textPieces = [...runXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]);
      const runText = textPieces.join("");
      accumulatedText += runText;
      // Replace the next run's content with empty (we're moving its
      // text into the primary run).
      result = result.slice(0, nrs) + "" + result.slice(nextRunEnd + "</w:r>".length);
      // Inject accumulatedText into the primary run by appending it
      // to the last <w:t> inside that run.
      const primaryRunXml = result.slice(rs, runEnd);
      const lastTextOpenIdx = primaryRunXml.lastIndexOf("<w:t");
      const lastTextOpenEnd = primaryRunXml.indexOf(">", lastTextOpenIdx);
      const lastTextCloseIdx = primaryRunXml.lastIndexOf("</w:t>");
      if (lastTextOpenIdx === -1 || lastTextOpenEnd === -1 || lastTextCloseIdx === -1) {
        // Malformed; bail.
        break;
      }
      const primaryRunStartInResult = rs;
      const insertAt = primaryRunStartInResult + lastTextCloseIdx;
      result = result.slice(0, insertAt) + accumulatedText + result.slice(insertAt);
      accumulatedText = "";
      // Check whether the primary run now contains `}}`.
      const updatedPrimary = result.slice(rs, result.indexOf("</w:r>", rs));
      if (/\}\}/.test(updatedPrimary)) { merged = true; break; }
      cursor = result.indexOf("</w:r>", rs) + "</w:r>".length;
    }
    if (!merged) break; // couldn't merge — give up on this placeholder, leave as-is
  }
  return result;
}

export type PlaceholderResolver = (key: string) => string | null;

/** Walk every `{{Section.Field}}` placeholder in the document XML
 *  and substitute via the resolver. The resolver receives the raw
 *  key (without braces) and returns the plain-text value — we
 *  XML-escape it here so HR doesn't have to remember. Unknown keys
 *  fall back to a `[missing: KEY]` marker, same convention the
 *  preview path uses. */
function replacePlaceholders(xml: string, resolver: PlaceholderResolver, missing: Set<string>): string {
  return xml.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g, (_match, key: string) => {
    const v = resolver(key);
    if (v == null) {
      missing.add(key);
      return xmlEscape(`[missing: ${key}]`);
    }
    return xmlEscape(v);
  });
}

/** Top-level entry — render a DOCX letter for one template +
 *  employee + custom inputs. Returns the DOCX bytes; caller
 *  converts to PDF. Throws if the template DOCX doesn't exist on
 *  disk, so the caller can fall back to the HTML pipeline. */
export async function renderLetterDocxFromFile(
  key: string,
  resolver: PlaceholderResolver,
): Promise<{ docxBytes: Buffer; missing: string[] }> {
  const path = docxPathFor(key);
  if (!path) {
    throw new Error(`No DOCX template mapped for key "${key}".`);
  }
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch (e: any) {
    throw new Error(`Template file ${path} not found: ${e?.message ?? e}`);
  }
  const zip = new PizZip(buf);

  // Substitute placeholders in BOTH the main document body AND
  // any headers/footers (letterhead text often lives there in
  // Keka-exported templates).
  const targets = ["word/document.xml", "word/header1.xml", "word/header2.xml", "word/header3.xml", "word/footer1.xml", "word/footer2.xml", "word/footer3.xml"];
  const missing = new Set<string>();
  for (const target of targets) {
    const file = zip.file(target);
    if (!file) continue;
    let xml = file.asText();
    xml = mergeSplitPlaceholders(xml);
    xml = replacePlaceholders(xml, resolver, missing);
    zip.file(target, xml);
  }
  const docxBytes = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  return { docxBytes, missing: Array.from(missing) };
}
