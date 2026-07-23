// Shared resume-parsing helpers. Both the public /api/jobs/parse-resume
// endpoint (called by the candidate apply form) and the HR-side auto-
// backfill (run when a candidate's drawer loads and key profile fields
// are still null) call these.
//
// Returns plain JSON shapes — the consumers serialize / persist them.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
// Shared 3-stage fallback chain. Identical to what the public
// /api/jobs/parse-resume endpoint runs; importing instead of
// duplicating means a fix added in one place benefits both call
// sites automatically.
import {
  scanEducationProsePassed,
  clusterEducationByShape,
  scanEducationSectionLoose,
} from "./resume-education-fallbacks";

export type ExtractedEducation = {
  course: string;
  branch: string;
  startOfCourse: string;
  endOfCourse: string;
  university: string;
  location: string;
};

export type ExtractedResume = {
  linkedinUrl:  string | null;
  portfolioUrl: string | null;
  educations:   ExtractedEducation[];
  skills:       string[];
  /** Pulled from the LANGUAGES section (kept separate from skills so
   *  "Hindi" / "English" don't show up under a SKILLS chip group). */
  languages:    string[];
};

// ── Text extraction ───────────────────────────────────────────────
// PDF via pdfjs-dist (custom worker resolution because Next.js's
// chunked build can't find the worker file otherwise). DOCX via
// mammoth. Other formats fall back to ASCII strip.
export async function extractText(buf: Buffer, fileName: string): Promise<string> {
  const ext = (fileName.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();

  if (ext === ".pdf") {
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      try {
        const req = createRequire(import.meta.url);
        pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
          req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
        ).href;
      } catch { /* swallow — caller handles empty text */ }
    }
    // Point pdfjs at its bundled standard font data so it can
    // decode embedded fonts that don't fully ship their own glyph
    // tables. Without this, the parser logs
    //   "Ensure that the `standardFontDataUrl` API parameter is provided"
    // on every PDF and extracts garbage for the affected
    // characters (Nazia #19's resume hit this — extraction was
    // partial / empty). pdfjs-dist ships the font data under
    // standard_fonts/ in its package root.
    let standardFontDataUrl: string | undefined;
    try {
      const req = createRequire(import.meta.url);
      const fontPkg = req.resolve("pdfjs-dist/package.json");
      // package.json sits at <root>/package.json; fonts are at
      // <root>/standard_fonts/ — strip the filename and append.
      const pkgDir = fontPkg.replace(/[\\/]package\.json$/, "");
      standardFontDataUrl = pathToFileURL(`${pkgDir}/standard_fonts/`).href;
      if (!standardFontDataUrl.endsWith("/")) standardFontDataUrl += "/";
    } catch { /* fall through — extraction still works, just noisy */ }
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      isEvalSupported: false,
      useSystemFonts: false,
      ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
    }).promise;
    const annotUrls = new Set<string>();
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      type Item = { str?: string; hasEOL?: boolean; transform?: number[] };
      let lastY: number | null = null;
      let pageBuf = "";
      for (const it of content.items as Item[]) {
        const y = it.transform?.[5];
        if (it.hasEOL || (lastY != null && y != null && Math.abs(y - lastY) > 2)) pageBuf += "\n";
        else if (pageBuf && !pageBuf.endsWith(" ") && !pageBuf.endsWith("\n")) pageBuf += " ";
        pageBuf += it.str ?? "";
        if (y != null) lastY = y;
      }
      pages.push(pageBuf);
      try {
        const annots = await page.getAnnotations();
        for (const a of annots as Array<{ url?: string }>) if (a.url) annotUrls.add(a.url);
      } catch { /* noop */ }
      page.cleanup();
    }
    await doc.destroy();
    const tail = annotUrls.size > 0 ? "\n\n" + [...annotUrls].join("\n") : "";
    return pages.join("\n") + tail;
  }

  if (ext === ".docx" || ext === ".doc") {
    try {
      const mammoth = (await import("mammoth")).default;
      const r = await mammoth.extractRawText({ buffer: buf });
      return String(r?.value ?? "");
    } catch {
      return "";
    }
  }

  if (ext === ".txt" || ext === ".md") return buf.toString("utf8");
  // RTF / unknown — ASCII strip is good enough for URL + heading
  // matching. Caller never throws on empty text.
  return buf.toString("utf8").replace(/[^\x20-\x7e\n]+/g, " ");
}

// ── Section-extraction + heading detection ────────────────────────
const SECTION_HEADINGS = [
  "summary","objective","profile","about me",
  "experience","work experience","professional experience","employment",
  "work history","career history","career",
  "education","academic","qualifications","academics",
  "skills","technical skills","core skills","key skills","expertise","key competencies",
  "languages","languages known",
  "projects","personal projects","key projects",
  "certifications","certificates","courses",
  "achievements","awards","accomplishments",
  "hobbies","interests",
  "references","contact","personal details",
  "responsibilities","key responsibilities",
];

// Compact letter-spaced headings: "S K I L L S" → "SKILLS",
// "E D U C A T I O N  L A N G U A G E S" → "EDUCATION LANGUAGES".
// Resume templates (especially Canva ones) often render section
// labels with each letter as its own glyph + a kerning gap, so
// pdfjs returns them with literal spaces between every character.
function compactLetterSpaced(s: string): string {
  // Split on 2+ spaces so doubled-up headings stay separated.
  const segments = s.split(/\s{2,}/);
  const out = segments.map((seg) => {
    const tokens = seg.trim().split(/\s+/);
    if (tokens.length < 3) return seg;
    const singles = tokens.filter((t) => /^[A-Za-z]$/.test(t)).length;
    if (singles >= tokens.length * 0.8) {
      return tokens.filter((t) => /^[A-Za-z]$/.test(t)).join("");
    }
    return seg;
  });
  return out.join(" ");
}

function isHeadingLine(line: string): string | null {
  let t = line.trim().replace(/[:•·\-_=*]+$/g, "").trim();
  // Compact "S K I L L S"-style first so the length cap doesn't
  // reject letter-spaced headings (each space-padded letter inflates
  // the line length past 40 chars).
  t = compactLetterSpaced(t);
  if (t.length < 3 || t.length > 40) return null;
  const norm = t.toLowerCase().replace(/[^\w\s]/g, "").trim();
  if (SECTION_HEADINGS.includes(norm)) return norm;
  // Spaceless variant. When the compactor merges a heading like
  // "K E Y  C O M P E T E N C I E S" → "KEYCOMPETENCIES" because
  // every letter was separated by a single space (not the expected
  // 2+), the joined form has no word break. Map back by comparing
  // each known heading with whitespace stripped.
  for (const h of SECTION_HEADINGS) {
    if (h.replace(/\s+/g, "") === norm) return h;
  }
  // Doubled-up headings on a single visual row ("EDUCATION LANGUAGES",
  // "SKILLS CONTACT") — return the first recognised word so the slice
  // starts at the right place. The unwanted half ends up inside the
  // section body and is filtered out downstream by the per-section
  // validators.
  const words = norm.split(/\s+/);
  for (const w of words) if (SECTION_HEADINGS.includes(w)) return w;
  return null;
}

function extractSection(text: string, wanted: string[]): string {
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const k = isHeadingLine(lines[i]);
    if (k && wanted.includes(k)) { start = i + 1; break; }
  }
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    const k = isHeadingLine(lines[i]);
    if (k && !wanted.includes(k)) { end = i; break; }
  }
  return lines.slice(start, end).join("\n").trim();
}

// ── Fragmentation healing ─────────────────────────────────────────
function healFragmentedText(s: string): string {
  let out = s;
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/\b([A-Z]) ([a-z]{3,})\b/g, "$1$2");
  out = out.replace(/\b(19|20)\s?(\d)\s?(\d)\b/g, "$1$2$3");
  out = out.replace(/\b(1|2)\s+(9|0)\s?(\d)\s?(\d)\b/g, "$1$2$3$4");
  out = out.replace(/(\d)\s+%/g, "$1%");
  return out;
}

// ── URL extraction ────────────────────────────────────────────────
function extractUrls(text: string): { linkedinUrl: string | null; portfolioUrl: string | null } {
  const compact = text.replace(/\s+/g, "").replace(/(https?:\/\/)/gi, " $1");
  const linkedinMatch =
    text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i) ||
    compact.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i);
  const linkedinUrl = linkedinMatch?.[0]
    ? (linkedinMatch[0].startsWith("http") ? linkedinMatch[0] : "https://" + linkedinMatch[0])
    : null;

  const githubMatch =
    text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+\/?/i) ||
    compact.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+\/?/i);
  const githubUrl = githubMatch?.[0]
    ? (githubMatch[0].startsWith("http") ? githubMatch[0] : "https://" + githubMatch[0])
    : null;

  const allUrls = [
    ...(text.match(/https?:\/\/[^\s,;)]+/gi) || []),
    ...(compact.match(/https?:\/\/[^\s,;)]+/gi) || []),
  ];
  const portfolioUrl = githubUrl ?? allUrls
    .filter(u => !/linkedin\.com/i.test(u))
    .filter(u => !u.endsWith(".pdf") && !u.endsWith(".doc") && !u.endsWith(".docx"))[0] ?? null;

  return { linkedinUrl, portfolioUrl };
}

// ── Education ─────────────────────────────────────────────────────
// Tolerant of misspellings + OCR drift:
//   "Bachelor"  — canonical
//   "Bachlor"   — common typo (missing e)
//   "Bachleor"  — common OCR drift (Tesseract reading custom fonts)
//   "Bachelour" — UK spelling
//   "Bachelours" / "Bachlors" / "Bachelors" — plurals
// The pattern is: "Bach" + 1-4 mid letters + "o" or "ou" + "r" + optional "s".
const DEGREE_PATTERNS = [
  /\b(Bach[a-zA-Z]{1,4}(?:o|ou)rs?(?:'s)?(?:\s+of\s+[\w ]+?)?(?:\s+\([A-Z]+\))?)\b/i,
  /\b(Mast[a-zA-Z]{1,3}(?:o|ou)?rs?(?:'s)?(?:\s+of\s+[\w ]+?)?(?:\s+\([A-Z]+\))?)\b/i,
  /\b(MBA|BBA|BCA|MCA|BSc|MSc|B\.?Sc|M\.?Sc|B\.?A|M\.?A|B\.?Com|M\.?Com|B\.?Tech|M\.?Tech|B\.?E|M\.?E|PhD|Doctorate|Diploma|HSC|SSC|XII|X|10\+2|12th|10th|Postgraduate|Undergraduate)\b/i,
];

// Canonicalize the degree word: "Bachleor" / "Bachlor" /
// "Bachelours" / "Mastrs" → "Bachelor" / "Master". The OCR + typo
// variants are useful for *finding* the line, but the candidate
// drawer should display the conventional spelling.
function canonicalizeDegree(s: string): string {
  if (/^bach/i.test(s)) return "Bachelor";
  if (/^mast/i.test(s)) return "Master";
  return s;
}

function parseEducations(section: string): ExtractedEducation[] {
  if (!section.trim()) return [];
  const lines = section
    .split(/\r?\n/)
    .map((l) => healFragmentedText(l.trim()))
    .filter(Boolean);

  // Group lines into per-entry blocks. The University line is the
  // boundary marker: degree + years usually appear ABOVE it (Canva
  // / Influenshah templates) or together on the same line (classic
  // resumes). We push the university into the current block first
  // then flush, so the resulting block contains "degree + year +
  // university" together — not split across two adjacent blocks
  // (which happened with flush-BEFORE-push and produced rows like
  // {course: MBA, university: ""} followed by {course: "",
  // university: "Chandigarh University"}). When a block already
  // has a university and we see a SECOND one without a flush in
  // between (rare), we still split to avoid merging two entries.
  const entries: string[][] = [];
  let cur: string[] = [];
  let curHasUni = false;
  const uniRe = /\b(University|Institute|College|Polytechnic|Academy|School)\b/i;
  const flush = () => {
    if (cur.length) { entries.push(cur); cur = []; curHasUni = false; }
  };
  for (const line of lines) {
    const hasUni = uniRe.test(line);
    if (hasUni && curHasUni) flush();        // second uni in a row → new entry
    cur.push(line);
    if (hasUni) { curHasUni = true; flush(); } // close on the uni line
  }
  flush();

  const results: ExtractedEducation[] = [];
  for (const block of entries) {
    const text = block.join(" ");

    let startOfCourse = "";
    let endOfCourse   = "";
    const yr = text.match(/(19|20)\d{2}\s*(?:[-–—]|to)\s*(?:(?:19|20)\d{2}|present|current)/i);
    if (yr) {
      const ys = yr[0].match(/(19|20)\d{2}/g) ?? [];
      startOfCourse = ys[0] ?? "";
      endOfCourse   = ys[1] ?? (/present|current/i.test(yr[0]) ? "Present" : "");
    } else {
      const single = text.match(/(19|20)\d{2}/);
      if (single) endOfCourse = single[0];
    }

    let course = "";
    let branch = "";
    // Pass 1: per-line scan. Resumes typically put the degree on
    // its own line ("Bachelor Of Computer Application", "MBA- HR"),
    // so `$` gives us a clean terminator and the branch capture
    // doesn't bleed into the university name on the next line.
    const degreeLineRe = /^(Bach[a-zA-Z]{1,4}(?:o|ou)rs?|Mast[a-zA-Z]{1,3}(?:o|ou)?rs?)(?:\s+of\s+([A-Za-z'’& ]+?))?\s*(?:[\(,|]|$)/i;
    // Abbreviation form ("MBA", "B.Com", "MBA- HR/Marketing",
    // "B.Tech in CSE"). Accepts hyphen / colon / "in" / nothing as
    // the separator before the branch.
    const abbrevLineRe = /^\s*(MBA|BBA|BCA|MCA|BSc|MSc|B\.?Sc|M\.?Sc|B\.?Tech|M\.?Tech|B\.?A|M\.?A|B\.?Com|M\.?Com|PhD|Doctorate|Diploma|XII|10\+2|12th|10th)\b\s*(?:[-–:]\s*|\s+in\s+)?([A-Za-z'’&/ \-]*?)?\s*$/i;
    for (const ln of block) {
      const m = ln.match(degreeLineRe) || ln.match(abbrevLineRe);
      if (m) {
        course = canonicalizeDegree(m[1].trim());
        if (m[2]) branch = m[2].trim().replace(/[\s\-]+$/, "");
        break;
      }
    }
    // Pass 2 (fallback): degree + branch on the SAME line as the
    // university — accept University / College / Institute as a
    // terminator alongside the usual punctuation.
    if (!course) {
      const courseMatch = text.match(/(Bach[a-zA-Z]{1,4}(?:o|ou)rs?|Mast[a-zA-Z]{1,3}(?:o|ou)?rs?)[A-Za-z'’ ]*?(?:\s+of\s+([A-Za-z'’& ]{3,80}?))?(?=\s*(?:—|–|-|\||,|\(|\d{4}|University|Institute|College|Polytechnic|Academy|School|CGPA|GPA|Percentage|$))/i);
      if (courseMatch) {
        course = canonicalizeDegree(courseMatch[1].trim());
        if (courseMatch[2]) branch = courseMatch[2].trim();
      }
    }
    if (!course) {
      const abbrev = text.match(/\b(MBA|BBA|BCA|MCA|BSc|MSc|B\.?Tech|M\.?Tech|B\.?A|M\.?A|B\.?Com|M\.?Com|PhD|Diploma|XII|X|10\+2|12th|10th)\b/i);
      if (abbrev) course = abbrev[0];
    }

    let university = "";
    const uniLine = block.find((l) =>
      /\b(University|Institute|College|Polytechnic|Academy|School)\b/i.test(l),
    );
    if (uniLine) {
      university = uniLine
        .replace(/\(?\s*(19|20)\d{2}\s*[-–—]\s*(?:(19|20)\d{2}|present|current)\s*\)?/i, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    let location = "";
    const locMatch = text.match(/([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?,\s*[A-Z][a-zA-Z]+)\s*$/);
    if (locMatch) location = locMatch[1].trim();

    if (course || university) {
      results.push({ course, branch, startOfCourse, endOfCourse, university, location });
    }
  }
  return results.slice(0, 6);
}

function scanEducationByUniversityYear(text: string): ExtractedEducation[] {
  const lines = text.split(/\n/).map(l => healFragmentedText(l)).filter(l => l.trim());
  // Per-line scan: works for resume templates whose EDUCATION
  // heading is letter-spaced ("E D U C A T I O N") or doubled-up
  // with another heading on the same row, so extractSection can't
  // pick out a clean section. We still want to surface the course
  // when it sits immediately above the university line.
  const degreeLineRe = /^(Bach[a-zA-Z]{1,4}(?:o|ou)rs?|Mast[a-zA-Z]{1,3}(?:o|ou)?rs?)(?:\s+of\s+([A-Za-z'’& ]+?))?\s*(?:[\(,|]|$)/i;
  // Accept hyphen / colon / "in" / no-separator between the degree
  // abbreviation and its branch — covers "MBA- HR/Marketing",
  // "MBA in HR", "B.com" (no branch), "B.Tech: CSE".
  const abbrevLineRe = /^\s*(MBA|BBA|BCA|MCA|BSc|MSc|B\.?Sc|M\.?Sc|B\.?Tech|M\.?Tech|B\.?A|M\.?A|B\.?Com|M\.?Com|PhD|Doctorate|Diploma|XII|10\+2|12th|10th)\b\s*(?:[-–:]\s*|\s+in\s+)?([A-Za-z'’&/ \-]*?)?\s*$/i;
  const yearRangeRe = /(19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2}|present|current)/i;
  const out: ExtractedEducation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\b(University|Institute|College|Polytechnic|Academy)\b/i.test(line)) continue;

    // Year range can sit on the same line OR on a nearby line
    // ("2022 - 2024 :" above the university, common in two-column
    // designs where each column lists year-degree-school).
    let yrMatch: RegExpMatchArray | null = null;
    let yrLineIdx = i;
    for (const j of [i, i - 1, i + 1, i - 2, i + 2, i - 3, i + 3]) {
      if (j < 0 || j >= lines.length) continue;
      const m = lines[j].match(yearRangeRe);
      if (m) { yrMatch = m; yrLineIdx = j; break; }
    }
    if (!yrMatch) continue; // skip — no year context, probably not education

    const ys = yrMatch[0].match(/(19|20)\d{2}/g) ?? [];
    // Strip year text out of the university line so we don't leave
    // a "(2022 - 2024)" tail behind.
    const university = line
      .replace(/\(?\s*(19|20)\d{2}\s*[-–—]\s*(?:(19|20)\d{2}|present|current)\s*\)?/i, "")
      .replace(/\s+/g, " ")
      .trim();

    // Course probe: ±3 lines around the university line, skipping
    // the year line itself.
    let course = "";
    let branch = "";
    for (const j of [i - 1, i - 2, i - 3, i + 1, i + 2, i + 3]) {
      if (j < 0 || j >= lines.length || j === yrLineIdx) continue;
      const probe = lines[j].trim();
      const m = probe.match(degreeLineRe) || probe.match(abbrevLineRe);
      if (m) {
        course = canonicalizeDegree(m[1].trim());
        if (m[2]) branch = m[2].trim().replace(/[\s\-]+$/, "");
        break;
      }
    }

    out.push({ course, branch, startOfCourse: ys[0] ?? "", endOfCourse: ys[1] ?? "", university, location: "" });
  }
  return out.slice(0, 6);
}

// ── Skills ────────────────────────────────────────────────────────
const JOB_TITLE_HINTS = /\b(Manager|Engineer|Officer|Analyst|Specialist|Associate|Consultant|Director|Executive|Lead|Head|Coordinator|Representative|Assistant|Intern)\b/i;

function looksLikeSkill(s: string): boolean {
  if (s.length < 2 || s.length > 40) return false;
  const words = s.split(/\s+/);
  if (words.length > 5) return false;
  if (/@/.test(s))                  return false;
  if (/\d{4,}/.test(s))             return false;
  if (/\+?\d[\d\s-]{6,}/.test(s))   return false;
  if (/[.!?]/.test(s))              return false;
  if (JOB_TITLE_HINTS.test(s))      return false;
  if (/^[a-z]{1,2}$/i.test(s))      return false;
  if (/^(WORK|HISTORY|EXPERIENCE|EDUCATION|PROFILE|CONTACT|PROJECTS|HOBBIES|REFERENCES|TAGS|SUMMARY)$/i.test(s)) return false;
  // URL fragments — the skills tokeniser splits on "/" which shreds
  // any LinkedIn / GitHub / portfolio URL the section body might
  // include (this happens whenever the section is at the bottom of
  // the page and the tail of the document carries the candidate's
  // links). Reject the obvious URL pieces so they don't become
  // chips. Covers "https", "http", "www", "linkedin.com", "github.com",
  // bare TLDs ("com", "in", "io"), and protocol prefixes with the
  // colon stripped.
  if (/^(https?|www|com|in|io|org|net|co|me)$/i.test(s)) return false;
  if (/\b(linkedin|github|gitlab|bitbucket|behance|dribbble|figma|notion|medium)\.com\b/i.test(s)) return false;
  return true;
}

// Shared tokeniser for both Skills and Languages — a SKILLS-style
// list usually wraps the same way the LANGUAGES list does (bullets,
// commas, line continuation), so the splitting + filter logic is
// identical. The CALLER decides which section to feed and how to
// validate each item.
function tokeniseListSection(sec: string, isValid: (s: string) => boolean, cap: number): string[] {
  if (!sec.trim()) return [];
  const rawLines = sec.split(/\r?\n/);
  // Line-continuation: glue a line ending in "and"/"or"/etc onto
  // the next so wrapped skills ("Relationship building and /
  // management") merge into a single item.
  const merged: string[] = [];
  for (const ln of rawLines) {
    const t = ln.trim();
    if (!t) { merged.push(""); continue; }
    const prev = merged[merged.length - 1];
    if (prev && /\b(and|or|of|for|with|to|&)$/i.test(prev)) {
      merged[merged.length - 1] = prev + " " + t;
    } else {
      merged.push(t);
    }
  }
  const tokens = merged
    .flatMap(l => l.split(/[•·▪►★]/))
    .map(l => l.replace(/^[\s*\-–—]+/, "").trim())
    .flatMap(l => l.split(/[,|;/]/))
    .map(t => t.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const cleaned = t.replace(/[:.;]+$/, "").replace(/\s+/g, " ").trim();
    if (!isValid(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out.slice(0, cap);
}

// Skills validation: short labels, no sentences/emails/phones/job
// titles. Plus exclude language names so "Hindi" / "English" don't
// land under SKILLS when the resume sections are adjacent and the
// boundary detection slips.
const KNOWN_LANGUAGE_NAMES = new Set([
  "english","hindi","punjabi","tamil","telugu","kannada","malayalam","marathi","gujarati",
  "bengali","odia","assamese","sanskrit","urdu",
  "spanish","french","german","italian","portuguese","russian","chinese","mandarin","cantonese",
  "japanese","korean","arabic","dutch","swedish","norwegian","danish","polish","turkish",
  "vietnamese","thai","indonesian","malay","hebrew","greek","czech","hungarian","finnish",
]);

function looksLikeSkillNotLanguage(s: string): boolean {
  if (!looksLikeSkill(s)) return false;
  if (KNOWN_LANGUAGE_NAMES.has(s.toLowerCase())) return false;
  return true;
}

function parseSkills(text: string): string[] {
  // SKILLS section only — LANGUAGES is parsed separately so the two
  // categories stay distinct in the candidate drawer.
  const sec = extractSection(text, ["skills","technical skills","core skills","key skills","expertise","key competencies"]);
  return tokeniseListSection(sec, looksLikeSkillNotLanguage, 20);
}

function parseLanguages(text: string): string[] {
  const sec = extractSection(text, ["languages","languages known"]);
  // Validate: short label, plausible language name. Accept either
  // anything in the known-language set OR any short token that
  // passes looksLikeSkill (covers locale variants like "Marathi
  // (Native)" or "English (Fluent)" — strip parens first).
  const cleanForValidation = (s: string) => s.replace(/\s*\(.*?\)\s*/g, "").trim();
  return tokeniseListSection(
    sec,
    (s) => {
      const core = cleanForValidation(s);
      if (KNOWN_LANGUAGE_NAMES.has(core.toLowerCase())) return true;
      // Fall back to skill-shape check for less common languages.
      return core.length >= 2 && core.length <= 25 && /^[A-Za-z][A-Za-z\s'-]+$/.test(core);
    },
    12,
  );
}

// ── Top-level: run all extractors against a resume file ───────────
// When the regular text extraction comes back sparse — typical for
// PDFs that use vector-rendered display fonts (Canva / InDesign
// templates), where letters live as drawing operations rather than
// selectable characters — we fall back to OCR via pdftoppm +
// tesseract. The OCR text is APPENDED to whatever text extraction
// gave us, so we get the best of both: clean URLs / well-spaced text
// from the structured extractor PLUS the bold headings + degree
// names that only show up as pixels.
const TEXT_SPARSE_WORDCOUNT = 80; // empirical: light single-column
                                  // resumes have 150+ words extractable;
                                  // when we see <80 something is off.

export async function extractResumeData(buf: Buffer, fileName: string): Promise<ExtractedResume> {
  let text = await extractText(buf, fileName);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  // OCR only kicks in for PDFs (.docx via mammoth is already
  // comprehensive). Soft-fails the whole way down: any error in
  // OCR setup leaves the text-only result intact.
  //
  // Two trigger paths:
  //   (a) Total word count is sparse — the whole file is image-
  //       only (a scanned resume).
  //   (b) An EDUCATION-style section is named in the text but NO
  //       degree keyword is visible. Templates like Piyush's render
  //       the course name ("Bachlor Of Computer Application") as a
  //       vector outline rather than selectable text, so pdfjs sees
  //       the surrounding labels + the university name but never
  //       the degree itself. (a) alone misses these because the
  //       rest of the document supplies enough text to push the
  //       word count over the threshold.
  const hasDegreeText = /\b(Bach[a-z]{1,5}(?:o|ou)rs?|Mast[a-z]{1,3}rs?|MBA|BBA|BCA|MCA|BSc|MSc|B\.?Tech|M\.?Tech|B\.?A|M\.?A|B\.?Com|M\.?Com|PhD|Doctorate|Diploma|HSC|SSC|XII|10\+2|12th)\b/i.test(text);
  const hasEducationContext = /\b(education|academic|qualifications|university|college|institute|polytechnic)\b/i.test(text);
  const triggerOcr =
    /\.pdf$/i.test(fileName) &&
    (wordCount < TEXT_SPARSE_WORDCOUNT || (hasEducationContext && !hasDegreeText));
  if (triggerOcr) {
    try {
      const { isOcrAvailable, ocrPdf } = await import("./ocr-pdf");
      if (await isOcrAvailable()) {
        const ocrText = await ocrPdf(buf);
        if (ocrText && ocrText.trim().length > 20) {
          // Concatenate. Duplicate phrases between text + OCR are
          // harmless — the downstream parsers de-dupe.
          text = text + "\n\n" + ocrText;
        }
      }
    } catch (e: any) {
      console.error("[resume-auto-extract] OCR fallback failed:", e?.message ?? e);
    }
  }

  if (!text || text.trim().length < 20) {
    return { linkedinUrl: null, portfolioUrl: null, educations: [], skills: [], languages: [] };
  }

  const { linkedinUrl, portfolioUrl } = extractUrls(text);
  // Full 5-stage education fallback chain. Order is from most
  // specific to most permissive — first non-empty result wins.
  // The last three live in the shared module so the apply form +
  // HR drawer run identical code (drift-free).
  const runChain = (src: string): ExtractedEducation[] => {
    let acc = parseEducations(
      extractSection(src, ["education","academic","qualifications","academics"]),
    );
    if (acc.length === 0) acc = scanEducationProsePassed(src);
    if (acc.length === 0) acc = scanEducationByUniversityYear(src);
    if (acc.length === 0) acc = clusterEducationByShape(src);
    if (acc.length === 0) acc = scanEducationSectionLoose(src);
    return acc;
  };
  let educations = runChain(text);

  // SECOND-CHANCE OCR — if the original text extracted but the chain
  // still returned 0 education entries, the PDF text was probably
  // mangled (column-flattened tables, vector outlines on bold heads,
  // multi-column shuffling). Re-render the pages as PNGs and OCR
  // them — Tesseract sees the visual layout the same way humans
  // would. We re-run the full chain against the OCR text + any
  // entries it finds get used. Skipped if OCR already fired above
  // (don't double-run).
  if (educations.length === 0 && !triggerOcr && /\.pdf$/i.test(fileName)) {
    try {
      const { isOcrAvailable, ocrPdf } = await import("./ocr-pdf");
      if (await isOcrAvailable()) {
        const ocrText = await ocrPdf(buf);
        if (ocrText && ocrText.trim().length > 20) {
          const fromOcr = runChain(ocrText);
          if (fromOcr.length > 0) {
            educations = fromOcr;
          }
        }
      }
    } catch (e: any) {
      console.error("[resume-auto-extract] second-chance OCR failed:", e?.message ?? e);
    }
  }
  let skills    = parseSkills(text);
  let languages = parseLanguages(text);

  // ── LLM FALLBACK (Ollama / Llama 3.2 3B) ───────────────────────
  // Heuristic + OCR can fail on multi-column / sidebar resumes
  // where text-flow scrambles the section order. Fire the local
  // LLM when ANY of these hold:
  //   1. educations is empty
  //   2. skills is empty
  //   3. the heuristic produced education entries but they
  //      LOOK GARBLED — missing course AND missing date, or
  //      university that contains obvious junk (long phrase
  //      like "audience eng" appended to a real name).
  // The garbled detector handles cases like Manya #26 where
  // the heuristic emitted 1 entry (so the simple `=== 0` check
  // wouldn't fire), but that entry was clearly broken.
  const isEduGarbled = (es: ExtractedEducation[]): boolean => {
    if (es.length === 0) return true;
    return es.every((e) => {
      const hasCourse  = !!(e.course || e.branch);
      const hasInst    = !!(e.university || e.location);
      const cleanInst  = (e.university ?? "").replace(/\s+/g, " ").trim();
      const wordCount  = cleanInst.split(/\s+/).filter(Boolean).length;
      // Heuristic for "junk appended to a real name": 5+ words
      // and contains lowercase noise (real university names are
      // mostly title-case proper nouns and 1-4 words).
      const looksJunky = wordCount >= 5 && /[a-z]{4,}\s+[a-z]{4,}/.test(cleanInst);
      return !hasCourse || !hasInst || looksJunky;
    });
  };
  const llmNeeded =
    educations.length === 0 ||
    skills.length === 0 ||
    isEduGarbled(educations);
  if (llmNeeded) {
    try {
      const { llmExtractResume } = await import("./resume-llm-extract");
      const llm = await llmExtractResume(text);
      // Replace educations when:
      //   • heuristic empty AND llm has any, OR
      //   • heuristic garbled AND llm has 1+ NON-garbled entries.
      if (llm.educations.length > 0) {
        if (educations.length === 0) {
          educations = llm.educations;
        } else if (isEduGarbled(educations) && !isEduGarbled(llm.educations)) {
          educations = llm.educations;
        }
      }
      if (skills.length === 0 && llm.skills.length > 0) {
        skills = llm.skills;
      }
      if (languages.length === 0 && llm.languages.length > 0) {
        languages = llm.languages;
      }
    } catch (e: any) {
      console.warn("[resume-auto-extract] LLM fallback failed:", e?.message ?? e);
    }
  }

  return { linkedinUrl, portfolioUrl, educations, skills, languages };
}
