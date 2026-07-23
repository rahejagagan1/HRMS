// Shared resume-education extraction fallbacks.
//
// Both the public /api/jobs/parse-resume endpoint (apply form) and
// the HR-side resume-auto-extract helper (candidate drawer) import
// from this module so they exercise the SAME 5-stage fallback chain.
// Before this consolidation the two paths had drifted: improvements
// added to one were silently missing from the other and HR would see
// "No education on file" on the drawer even though the apply form
// had extracted it correctly.
//
// The functions are intentionally side-effect-free + dependency-free
// (just RegExp + Array work) so this module stays cheap to import
// from anywhere.
//
// Three fallback parsers live here. The chain order is consumer
// responsibility (see `applyEducationFallbacks` below) — these are
// the building blocks.

export type ExtractedEducation = {
  course: string;
  branch: string;
  startOfCourse: string;
  endOfCourse: string;
  university: string;
  location: string;
};

// pdfjs sometimes splits ligatures / kerning pairs onto separate
// items ("Bach" + "elor"); this re-joins them when the parser hits
// a known fragment pattern. Lightweight enough to inline here.
function healFragmentedText(s: string): string {
  // Reconnect any obvious split of "fi" / "fl" ligatures, e.g.
  // "Spec\nialized" → "Specialized". Conservative — only joins when
  // the gap is mid-word (lowercase preceded by lowercase across the
  // break).
  return s.replace(/([a-z])\s*\n\s*([a-z])/g, "$1$2");
}

// ── 1. PROSE-PASSED ────────────────────────────────────────────────
// "1.Passed Post Graduation in X (Y) from Z, City in 2022." across
// multiple lines after pdfjs word-wrap. Three required anchors
// (numbered prefix + Passed + from + year + terminating .) keep
// false positives low.
export function scanEducationProsePassed(text: string): ExtractedEducation[] {
  const joined = text.replace(/\s+/g, " ");
  const RE = /\b\d+\.\s*Passed\s+([^.]+?)\s+from\s+([^.]+?)\s+in\s+((?:19|20)\d{2}(?:\s*[-–—]\s*\d{2,4})?)\s*\./gi;
  const out: ExtractedEducation[] = [];
  let m: RegExpExecArray | null;
  while ((m = RE.exec(joined)) !== null) {
    let course = m[1].trim().replace(/\s+with\s+\d+(?:\.\d+)?\s*%.*$/i, "").trim();
    if (course.length > 100) course = course.slice(0, 100);
    let university = m[2].trim();
    if (university.length > 120) university = university.slice(0, 120);
    const yearStr = m[3].trim();
    const ys = yearStr.match(/\d{4}/g) ?? [];
    let startOfCourse = "", endOfCourse = "";
    if (ys.length === 1) {
      endOfCourse = ys[0] ?? "";
    } else if (ys.length >= 2) {
      const a = ys[0] ?? "";
      const b = ys[1] ?? "";
      startOfCourse = a;
      endOfCourse = b.length === 2 ? a.slice(0, 2) + b : b;
    }
    if (course || university) {
      out.push({ course, branch: "", startOfCourse, endOfCourse, university, location: "" });
    }
  }
  return out.slice(0, 8);
}

// ── 2. CLUSTER-BY-SHAPE ────────────────────────────────────────────
// Designed multi-column resumes (sidebar + main column) and
// Indian-style 3-column tables (Course | Board | Remark) often
// confuse pdfjs into column-flattening — the degree / institution /
// year of a single row can land 15+ lines apart. We extract all
// year markers, all institution lines, all degree tokens IN ORDER
// of appearance, then zip them by index.
//
// Years are NOT required — table-style resumes often use a Remark
// column (Passed / Pursuing) instead of years. We zip on degree↔
// institution alone in that case; year fields stay empty.
//
// Position-aware gap-fill: when one row's course doesn't match the
// degree dictionary (e.g. "Voice Dubbing"), every later row would
// misalign without help. We scan the line range that holds matched
// degrees for short, non-institutional, non-year, capitalised lines
// and add them at their real position so the zip stays correct.
export function clusterEducationByShape(text: string): ExtractedEducation[] {
  const lines = text.split(/\n/).map(l => healFragmentedText(l)).filter(l => l.trim());
  const RANGE_RE = /(19|20)\d{2}\s*[-–—]\s*(?:(19|20)\d{2}|present|current)/i;
  const SINGLE_YEAR_RE = /\b(?:19|20)\d{2}\b/;
  const INST_RE = /\b(University|Institute|College|Collage|Polytechnic|Academy|School|Board|CBSE|ICSE|HNBGU|HBSE)\b/i;
  const DEGREE_RE =
    /\b(MBA(?:[\s-][\w &]+)?|BBA|BCA|MCA|BSc|MSc|B\.?Sc|M\.?Sc|B\.A|M\.A|B\.?Com|Bcom|M\.?Com|B\.?Tech|M\.?Tech|B\.E|M\.E|PhD|Doctorate|Diploma|HSC|SSC|XII|X|10\+2|12th|10th|Postgraduate|Undergraduate|Bachelors?|Masters?|Class\s*X{1,2}|Class\s*10|Class\s*12)\b/i;
  const WORK_CONTEXT_RE = /(?:\b|\d)(Jan|Feb|Mar|Apr|May|June|July?|Aug|Sept?|Oct|Nov|Dec)\b|\b(Worked|Working|Duration|Designation|Intern|Volunteer|present|current)\b/i;

  const years: string[] = [];
  const institutions: string[] = [];
  const degrees: string[] = [];

  type WithPos = { text: string; line: number };
  const degsPos: WithPos[] = [];
  const instPos: WithPos[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const line = raw.trim();
    if (!WORK_CONTEXT_RE.test(line)) {
      const range = line.match(RANGE_RE);
      if (range) years.push(range[0]);
      else {
        const single = line.match(SINGLE_YEAR_RE);
        if (single && line.length <= 50) years.push(single[0]);
      }
    }
    if (INST_RE.test(line) && line.length <= 90) instPos.push({ text: line, line: i });
    const dm = line.match(DEGREE_RE);
    if (dm && line.length <= 60) degsPos.push({ text: dm[0].trim(), line: i });
  }

  // Gap-fill for position-alignment when degree count < institution count.
  if (degsPos.length > 0 && instPos.length > degsPos.length) {
    const minLine = degsPos[0]!.line;
    const maxLine = degsPos[degsPos.length - 1]!.line;
    const taken = new Set(degsPos.map((d) => d.line));
    const SECTION_NOISE = /^(profile|summary|objective|skills?|experience|hobbies|languages?|contact|education|qualifications?|references?|certifications?|projects?|achievements?|interests?)\b/i;
    for (let i = minLine; i <= maxLine; i++) {
      if (taken.has(i)) continue;
      const raw = lines[i];
      if (raw === undefined) continue;
      const t = raw.trim();
      if (!t || t.length > 60) continue;
      if (INST_RE.test(t)) continue;
      if (RANGE_RE.test(t) || SINGLE_YEAR_RE.test(t)) continue;
      if (SECTION_NOISE.test(t)) continue;
      if (!/[A-Z]/.test(t)) continue;
      degsPos.push({ text: t, line: i });
    }
    degsPos.sort((a, b) => a.line - b.line);
  }

  for (const d of degsPos) degrees.push(d.text);
  for (const it of instPos) institutions.push(it.text);

  const haveYears = years.length >= 2;
  const N = haveYears
    ? Math.min(years.length, Math.max(institutions.length, degrees.length))
    : Math.min(institutions.length, degrees.length);
  if (N < 2) return [];

  const out: ExtractedEducation[] = [];
  for (let i = 0; i < N; i++) {
    let startOfCourse = "", endOfCourse = "";
    if (haveYears && years[i]) {
      const yr = years[i]!;
      const isRange = /[-–—]/.test(yr);
      if (isRange) {
        const ys = yr.match(/(19|20)\d{2}/g) ?? [];
        startOfCourse = ys[0] ?? "";
        endOfCourse   = ys[1] ?? (/present|current/i.test(yr) ? "Present" : "");
      } else {
        endOfCourse = yr;
      }
    }
    const course = degrees[i] ?? "";
    const rawInst = institutions[i];
    const university = (rawInst ?? "")
      .replace(RANGE_RE, "")
      .replace(SINGLE_YEAR_RE, "")
      .replace(/[|·•]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (course || university) {
      out.push({ course, branch: "", startOfCourse, endOfCourse, university, location: "" });
    }
  }
  return out.slice(0, 8);
}

// ── 3. SECTION-LOOSE WINDOW ────────────────────────────────────────
// Header allowlist deliberately wide: many Indian resumes title the
// section "Professional Qualification" / "Academic Credentials" /
// just "Qualifications". Once found, scan a 30-line window on each
// side for adjacent institution + degree pairs.
export function scanEducationSectionLoose(text: string): ExtractedEducation[] {
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const HEADER_RE = /^(?:EDUCATION(?:\s*&\s*\w+)?|ACADEMIC(?:\s+(?:QUALIFICATIONS?|CREDENTIALS?|DETAILS|RECORD|BACKGROUND))?|EDUCATIONAL\s+(?:QUALIFICATIONS?|BACKGROUND|DETAILS)|PROFESSIONAL\s+QUALIFICATIONS?|QUALIFICATIONS?)\s*[:.\s]*$/i;
  const headerIdx = lines.findIndex(l => HEADER_RE.test(l));
  if (headerIdx === -1) return [];

  const WINDOW = 30;
  const lo = Math.max(0, headerIdx - WINDOW);
  const hi = Math.min(lines.length, headerIdx + WINDOW);
  const win = lines.slice(lo, hi);

  const INST_RE = /\b(University|Institute|College|Collage|Polytechnic|Academy|School|Board|CBSE|ICSE|HNBGU|HBSE)\b/i;
  const DEGREE_RE =
    /\b(MBA(?:[\s-][\w &]+)?|BBA|BCA|MCA|BSc|MSc|B\.?Sc|M\.?Sc|B\.A|M\.A|B\.?Com|Bcom|M\.?Com|B\.?Tech|M\.?Tech|B\.E|M\.E|PhD|Doctorate|Diploma|HSC|SSC|XII|X|10\+2|12th|10th|Postgraduate|Undergraduate|Bachelors?|Bachelor's|Masters?|Master's|Class\s*X{1,2}|Class\s*10|Class\s*12)\b/i;
  const YEAR_RE = /\b(19|20)\d{2}\b/;

  const out: ExtractedEducation[] = [];
  for (let i = 0; i < win.length; i++) {
    const a = win[i] ?? "";
    if (a === lines[headerIdx]) continue;
    const next = win[i + 1] ?? "";
    const aInst = INST_RE.test(a) && a.length <= 90;
    const aDeg  = DEGREE_RE.test(a) && a.length <= 60;
    const bInst = INST_RE.test(next) && next.length <= 90;
    const bDeg  = DEGREE_RE.test(next) && next.length <= 60;

    const fullCourse = (line: string, m: RegExpMatchArray): string => {
      const t = line.trim();
      const lc = t.toLowerCase();
      const tok = m[0].toLowerCase();
      const stripped = lc.replace(/^[\s•·*\-–—"']+/, "");
      if (t.length <= 45 && stripped.startsWith(tok)) return t;
      return m[0].trim();
    };

    let institution = "", course = "";
    if (aInst && bDeg && !aDeg) {
      institution = a; course = fullCourse(next, next.match(DEGREE_RE)!);
      i++;
    } else if (aDeg && bInst && !aInst) {
      course = fullCourse(a, a.match(DEGREE_RE)!); institution = next;
      i++;
    } else if (aInst && aDeg) {
      institution = a.replace(DEGREE_RE, "").replace(/\s+/g, " ").trim();
      course = fullCourse(a, a.match(DEGREE_RE)!);
    } else {
      continue;
    }

    const combined = `${a} ${next}`;
    const ym = combined.match(YEAR_RE);

    institution = institution
      .replace(DEGREE_RE, "")
      .replace(YEAR_RE, "")
      .replace(/[|·•\-–—]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!course && !institution) continue;
    out.push({
      course, branch: "",
      startOfCourse: "",
      endOfCourse: ym ? ym[0] : "",
      university: institution, location: "",
    });
  }

  const seen = new Set<string>();
  return out.filter((e) => {
    const k = `${(e.course || "").toLowerCase()}|${(e.university || "").toLowerCase().slice(0, 32)}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, 6);
}

// Convenience: run the 3 fallbacks in order and return the first
// non-empty result. Caller layers this on top of their primary
// section-based extractor.
export function applyEducationFallbacks(text: string): ExtractedEducation[] {
  let out = scanEducationProsePassed(text);
  if (out.length > 0) return out;
  out = clusterEducationByShape(text);
  if (out.length > 0) return out;
  out = scanEducationSectionLoose(text);
  return out;
}
