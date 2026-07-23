// LLM-based resume extractor — Ollama backed (Llama 3.2 3B by default).
//
// Used as a fallback layer for src/lib/resume-auto-extract.ts when
// the heuristic parser comes back sparse (no education found, no
// skills, etc.). The heuristic is fast (<1s) and zero-cost so we
// run it first; if it returns useful data, we keep that. If it
// returns empty, we hit Ollama with the raw resume text and ask
// for structured JSON.
//
// Architecture:
//   • POST  http://localhost:11434/api/generate   (Ollama HTTP API)
//   • Model  llama3.2:3b                         (overridable via env)
//   • format JSON  (Ollama's structured-output mode — forces the
//     model to emit valid JSON, no markdown fences, no commentary)
//   • Strict schema validation on the response. Any malformed /
//     hallucinated entry is dropped.
//
// Hard guarantees:
//   • Returns { educations: [], skills: [], languages: [] } on
//     any error (network down, Ollama not installed, model not
//     pulled, JSON malformed, timeout). NEVER throws — caller
//     can rely on the shape.
//   • 30s timeout per call. Ollama on CPU finishes a 3B-model
//     request in ~5-15s for a typical resume; 30s catches stuck
//     requests without making HR wait forever.
//   • All entries are verified against the source text — if the
//     model hallucinates a degree that doesn't appear in the
//     resume, we drop it. Cheap protection against the 1B/3B-
//     model habit of inventing plausible-sounding data.

import type { ExtractedEducation } from "./resume-auto-extract";

// Skills + languages are plain string[] in the upstream module —
// alias here so the local code stays self-documenting.
type ExtractedSkill = string;
type ExtractedLanguage = string;

const OLLAMA_URL  = process.env.OLLAMA_URL  ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2:3b";
// Bumped from 30s → 60s after observing real-world timings:
// 3B model warm-call ≈ 5-15s, cold-start ≈ 20-35s (model load
// from disk into RAM). Nazia #19's reparse hit 30s exactly —
// almost certainly a cold-start that would have completed at
// ~35s. 60s gives the buffer we need without making HR wait
// forever on a genuinely-broken resume.
const TIMEOUT_MS  = 60_000;

type LlmResult = {
  educations: ExtractedEducation[];
  skills:     ExtractedSkill[];
  languages:  ExtractedLanguage[];
};

const EMPTY: LlmResult = { educations: [], skills: [], languages: [] };

const SYSTEM_PROMPT = `You are an information extraction system for resumes. \
You output ONLY valid JSON matching the schema you are given. Do not include any commentary, markdown fences, or explanatory text outside the JSON.

Rules:
- Extract only data that EXPLICITLY appears in the resume text. Do not invent entries.
- If a field is unclear or missing, leave it as an empty string "".

Education entries — INCLUDE ONLY academic credentials:
- Degrees: Bachelor of …, Master of …, MBA, B.Tech, M.Tech, B.A, M.A, B.Com, M.Com, PhD, Diploma, MSc, BSc.
- Schooling: 10th / Class X / SSC / matriculation, 12th / Class XII / HSC / intermediate, Higher Secondary.
- Certificate / Diploma programs that are clearly academic (e.g. "Diploma in Photography").

Education entries — DO NOT INCLUDE (these are EXPERIENCE / WORK, not education):
- Job titles like "HR Executive", "Software Engineer", "Manager", "Counsellor", "Intern", "Trainee".
- Work history at companies (even if "Studied at X University" appears nearby in the resume — match the line to a degree, not a role).
- Internships, freelance projects, or any line that describes WHAT THE PERSON DID rather than WHAT THEY EARNED.

Test for each candidate entry: "Is this line a DEGREE / QUALIFICATION I'm reporting, or is it a JOB / ROLE the person held?" — only the former goes in educations.

Skills are short noun phrases — technologies, methodologies, languages, tools. NOT job duties, NOT degrees.
Date format: keep the year exactly as written in the resume (e.g. "2022", "May 2024", "Sep 2023 - Sep 2026"). Use "Present" for current education.`;

function userPrompt(resumeText: string): string {
  // Trim to a sane size so a 50-page resume can't blow the context
  // window — 3B has 131k tokens so this is conservative.
  const text = resumeText.slice(0, 12_000);
  return `Extract structured data from this resume.

Schema (return EXACTLY these keys):
{
  "educations": [
    {
      "course":        "string — degree name e.g. 'MBA in Human Resource Management'",
      "branch":        "string — specialisation e.g. 'Computer Science'",
      "startOfCourse": "string — start year e.g. '2020'",
      "endOfCourse":   "string — end year or 'Present' e.g. '2024'",
      "university":    "string — institution name e.g. 'Banasthali Vidhyapith'",
      "location":      "string — city / state e.g. 'Rajasthan'"
    }
  ],
  "skills":    ["string — short technology / skill name"],
  "languages": ["string — spoken / written language name"]
}

Resume text:
"""
${text}
"""

Return ONLY the JSON. No prose, no markdown.`;
}

/** Call Ollama's /api/generate with `format: "json"` to force a
 *  parseable response. Returns null (NOT throws) on every error
 *  path — caller treats null as "LLM unavailable, fall back". */
async function callOllama(resumeText: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model:  OLLAMA_MODEL,
        prompt: userPrompt(resumeText),
        system: SYSTEM_PROMPT,
        format: "json",     // Ollama's structured-output mode
        stream: false,
        options: {
          temperature: 0.1,  // low so it doesn't invent entries
          num_predict: 2048, // cap response length
        },
      }),
    });
    if (!res.ok) {
      console.warn(`[resume-llm] ollama returned ${res.status}`);
      return null;
    }
    const data = await res.json() as { response?: string };
    return data?.response ?? null;
  } catch (e: any) {
    if (e?.name === "AbortError") {
      console.warn(`[resume-llm] timeout after ${TIMEOUT_MS}ms`);
    } else {
      console.warn("[resume-llm] fetch failed:", e?.message ?? e);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Job-title sniff. If the model puts a line like "HR Executive &
// Head Counsellor" into the educations array, drop it. The 3B
// model occasionally misclassifies experience entries especially
// when the source line has BOTH a role and an institution
// (e.g. "HR Executive at IIP — May 2023"). Filter explicitly
// rather than just trusting the prompt.
const JOB_ROLE_PATTERNS: RegExp[] = [
  /\b(executive|manager|engineer|developer|consultant|analyst|specialist|coordinator|assistant|associate|administrator|representative|intern|trainee|fellow|counsell?or|designer|architect|director|officer|technician|operator|writer|editor|teacher|tutor|lecturer)\b/i,
  /\b(software|hr|sales|marketing|finance|accounting|business|product|content|customer|technical|client|project|operations|graphic|video|social media)\s+(executive|manager|engineer|developer|consultant|analyst|specialist|coordinator|assistant|associate|intern|lead|head)\b/i,
  /\b(head\s+of|vice\s+president|founder|co[\s-]?founder|ceo|cto|cfo|coo|svp|evp)\b/i,
];
function looksLikeJobTitle(s: string): boolean {
  if (!s) return false;
  return JOB_ROLE_PATTERNS.some((re) => re.test(s));
}

/** Strip ANY non-alphanumeric characters then lowercase, so we
 *  can fuzzy-match a model-emitted institution name like
 *  "Indian Institute of Photography" against the source text
 *  ("Indian  Institute   of   photography\n").  */
function fuzzyContains(haystack: string, needle: string): boolean {
  if (!needle || needle.length < 4) return true; // skip very short strings
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const h = norm(haystack);
  const n = norm(needle);
  if (n.length < 4) return true;
  return h.includes(n.slice(0, Math.min(40, n.length)));
}

/** Validate the LLM-emitted JSON. Throws on schema violation —
 *  caller catches and falls back. */
function validate(parsed: any, sourceText: string): LlmResult {
  if (!parsed || typeof parsed !== "object") throw new Error("not an object");

  const sliceStr = (v: any, n: number) =>
    typeof v === "string" ? v.trim().slice(0, n) : "";

  // ── educations ────────────────────────────────────────────────
  const eduRaw = Array.isArray(parsed.educations) ? parsed.educations : [];
  const educations: ExtractedEducation[] = [];
  for (const e of eduRaw) {
    if (educations.length >= 12) break;          // sanity cap
    if (!e || typeof e !== "object") continue;
    const course     = sliceStr(e.course,        120);
    const branch     = sliceStr(e.branch,        120);
    const startOfCourse = sliceStr(e.startOfCourse, 20);
    const endOfCourse   = sliceStr(e.endOfCourse,   20);
    const university = sliceStr(e.university,    200);
    const location   = sliceStr(e.location,      120);
    // Hallucination guard: need at least course OR university,
    // and at least one of them must fuzzily appear in the source.
    if (!course && !university) continue;
    if (course     && !fuzzyContains(sourceText, course))     continue;
    if (university && !fuzzyContains(sourceText, university)) continue;
    // Job-title guard: 3B models occasionally misclassify
    // experience entries as education when the source line has
    // both a role + an institution ("HR Executive at IIP"). If
    // the course string looks like a job title, drop the entry.
    if (course && looksLikeJobTitle(course))   continue;
    educations.push({ course, branch, startOfCourse, endOfCourse, university, location });
  }

  // ── skills ────────────────────────────────────────────────────
  const skillsRaw = Array.isArray(parsed.skills) ? parsed.skills : [];
  const skills: ExtractedSkill[] = [];
  const seenSkill = new Set<string>();
  for (const s of skillsRaw) {
    if (skills.length >= 60) break;
    const v = sliceStr(s, 80);
    if (!v) continue;
    if (!fuzzyContains(sourceText, v)) continue;
    const key = v.toLowerCase();
    if (seenSkill.has(key)) continue;
    seenSkill.add(key);
    skills.push(v);
  }

  // ── languages ─────────────────────────────────────────────────
  const langsRaw = Array.isArray(parsed.languages) ? parsed.languages : [];
  const languages: ExtractedLanguage[] = [];
  const seenLang = new Set<string>();
  for (const l of langsRaw) {
    if (languages.length >= 20) break;
    const v = sliceStr(l, 40);
    if (!v) continue;
    if (!fuzzyContains(sourceText, v)) continue;
    const key = v.toLowerCase();
    if (seenLang.has(key)) continue;
    seenLang.add(key);
    languages.push(v);
  }

  return { educations, skills, languages };
}

/**
 * Best-effort LLM extraction. Always returns a shape — empty
 * arrays mean either no data or the LLM was unavailable. Callers
 * decide whether to keep the existing heuristic result based on
 * which is fuller.
 */
export async function llmExtractResume(resumeText: string): Promise<LlmResult> {
  if (!resumeText || resumeText.trim().length < 40) return EMPTY;
  const t0 = Date.now();
  const raw = await callOllama(resumeText);
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw);
    const result = validate(parsed, resumeText);
    console.log(
      `[resume-llm] ${Date.now() - t0}ms — educations=${result.educations.length} skills=${result.skills.length} languages=${result.languages.length}`,
    );
    return result;
  } catch (e: any) {
    console.warn(`[resume-llm] JSON parse / validate failed in ${Date.now() - t0}ms:`, e?.message ?? e);
    return EMPTY;
  }
}

/** True when Ollama is reachable at the configured URL. Cheap
 *  one-shot probe — caller can use it to decide whether to even
 *  attempt the LLM fallback during ingest. */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2_000);
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch { return false; }
}
