// Resume → structured fields via a local Ollama model on the VPS.
// Server-only (calls the Ollama HTTP API + reuses the Keka phone /
// department helpers so the prefill maps to the same onboard form
// fields the Keka CSV import does).
//
// Config (env, with same-VPS defaults):
//   OLLAMA_BASE_URL  default http://127.0.0.1:11434
//   OLLAMA_MODEL     default llama3.1:8b
import { parsePhone, deriveDepartment } from "@/lib/keka-import";

const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";
const TIMEOUT_MS = 90_000;

// Raw fields the model returns. Everything is best-effort; the model is
// told to leave a field "" rather than guess.
export type ResumeFields = {
  firstName: string;
  middleName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;      // raw, any format — normalised by parsePhone
  gender: string;     // "male" | "female" | "other" | ""
  dateOfBirth: string;// YYYY-MM-DD | ""  (birth date only, never graduation)
  jobTitle: string;   // current / most-recent role
};

// Subset of the onboard form fields we can fill from a resume. Only keys
// we actually extracted are present so the client merges (never blanks a
// field the resume didn't mention).
export type ResumePatch = {
  firstName?: string; middleName?: string; lastName?: string; displayName?: string;
  workEmail?: string; gender?: string; dateOfBirth?: string;
  mobileCountry?: string; mobileNumber?: string; jobTitle?: string; department?: string;
};

const SCHEMA = {
  type: "object",
  properties: {
    firstName:   { type: "string" },
    middleName:  { type: "string" },
    lastName:    { type: "string" },
    fullName:    { type: "string" },
    email:       { type: "string" },
    phone:       { type: "string" },
    gender:      { type: "string", enum: ["male", "female", "other", ""] },
    dateOfBirth: { type: "string" },
    jobTitle:    { type: "string" },
  },
  required: ["firstName", "lastName", "email", "phone", "jobTitle"],
} as const;

const SYSTEM_PROMPT = [
  "You extract structured fields from a resume / CV. Return ONLY JSON matching the schema.",
  "Rules:",
  "- Use an empty string \"\" for anything not clearly present. Never invent or guess.",
  "- firstName / middleName / lastName: split the candidate's own name. fullName: their full name as written.",
  "- email: the candidate's primary email address.",
  "- phone: the candidate's primary phone number, including country code if shown.",
  "- gender: only if explicitly stated in the resume, else \"\".",
  "- dateOfBirth: ONLY an actual date of birth (DOB), formatted YYYY-MM-DD. Never use graduation, joining, or employment dates. Else \"\".",
  "- jobTitle: the candidate's current or most recent job title / designation.",
].join("\n");

export async function extractResumeFields(text: string): Promise<ResumeFields> {
  const body = {
    model: OLLAMA_MODEL,
    stream: false,
    format: SCHEMA,
    options: { temperature: 0 },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text.slice(0, 12_000) },
    ],
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("Resume parsing timed out — the model took too long.");
    throw new Error(`Could not reach the resume model (Ollama) at ${OLLAMA_BASE}.`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Resume model error (${res.status}).`);

  const j = await res.json();
  const content: string = j?.message?.content ?? "";
  let raw: any;
  try { raw = JSON.parse(content); } catch { throw new Error("Resume model returned malformed output."); }

  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    firstName: s(raw.firstName),
    middleName: s(raw.middleName),
    lastName: s(raw.lastName),
    fullName: s(raw.fullName),
    email: s(raw.email),
    phone: s(raw.phone),
    gender: s(raw.gender),
    dateOfBirth: s(raw.dateOfBirth),
    jobTitle: s(raw.jobTitle),
  };
}

// Map the model's raw fields onto the onboard form, reusing the Keka
// helpers so phone + department behave identically. Only present values
// are returned (caller merges into the form).
export function buildResumePatch(f: ResumeFields): ResumePatch {
  const p: ResumePatch = {};
  if (f.firstName) p.firstName = f.firstName;
  if (f.middleName) p.middleName = f.middleName;
  if (f.lastName) p.lastName = f.lastName;
  const displayName = f.fullName || [f.firstName, f.middleName, f.lastName].filter(Boolean).join(" ");
  if (displayName) p.displayName = displayName;
  if (f.email) p.workEmail = f.email;
  if (f.gender === "male" || f.gender === "female" || f.gender === "other") p.gender = f.gender;
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.dateOfBirth)) p.dateOfBirth = f.dateOfBirth;
  const phone = parsePhone(f.phone || "");
  if (phone.number) { p.mobileCountry = phone.country; p.mobileNumber = phone.number; }
  if (f.jobTitle) {
    p.jobTitle = f.jobTitle;
    const dept = deriveDepartment(f.jobTitle, "");
    if (dept) p.department = dept;
  }
  return p;
}
