"use client";

// Keka-parity Create Job Posting wizard — 4 steps in one component.
//
//   1. Job Description — title, brand, department, description, JD file
//   2. Job Details     — type, locations, compensation, hiring flow, options
//   3. Hiring Team     — recruiters, owner-assign, managers, panel, access toggles
//   4. Publish Options — channels, slug, summary, publish/save-draft
//
// Form state lives at the wizard level; each step receives `form` +
// `setField`. Submission fires on Publish or Save Draft. The whole
// payload posts to /api/hr/hiring/jobs (which handles draft vs
// published via the `publish` flag) and the JD file uploads in a
// second pass to /api/hr/hiring/jobs/[id]/jd once the row exists.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import {
  X, ChevronRight, ChevronLeft, Plus, Trash2, Upload, FileText,
  Briefcase, Users, ListChecks, Globe, Calendar,
  AlertCircle, Check, Pencil, ArrowUp, ArrowDown,
  ClipboardList, Type, AlignLeft, ToggleRight, List, Hash, CalendarDays, Paperclip,
  Save, Eye, Maximize2, Minimize2,
} from "lucide-react";
import { JOB_TITLES }           from "@/lib/job-titles";
import { JOB_TITLES_YT_LABS }   from "@/lib/job-titles-yt-labs";
import { DEPARTMENTS }          from "@/lib/departments";
import { DEPARTMENTS_YT_LABS }  from "@/lib/departments-yt-labs";
import { DateField }            from "@/components/ui/date-field";
import { stripLeadingCompanyContent, looksLikeKnownTitle } from "@/lib/hr/jd-format";
import { showToast } from "@/components/ui/Toast";
import dynamic from "next/dynamic";
import "react-quill-new/dist/quill.snow.css";

// Same dynamically-imported Quill as the Replace-JD modal — kept
// here as well so HR gets the WYSIWYG toolbar (bold / italic /
// underline / size / headings / lists / alignment) when creating
// a brand-new job, not just when replacing an existing JD.
const ReactQuill = dynamic(
  async () => (await import("react-quill-new")).default,
  { ssr: false, loading: () => <div className="px-5 py-4 text-[12.5px] text-slate-400">Loading editor…</div> },
);

const JD_QUILL_MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    [{ size: ["small", false, "large", "huge"] }],
    ["bold", "italic", "underline", "strike"],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ align: [] }],
    ["clean"],
  ],
};
const JD_QUILL_FORMATS = [
  "header", "size", "bold", "italic", "underline", "strike",
  "list", "bullet", "align",
];

/** Plain-text (extractor output) → Quill HTML. Same heuristic as
 *  the Replace-JD modal so the two editors behave identically.
 *  Detects:
 *    • Job title (line starting "Job Description - …" or "Job Title:")
 *      → <h2 style="text-align:center"> — same prominence the PDF
 *      gives it.
 *    • Standard JD section headings (Job Overview, Role &
 *      Responsibilities, Required Skills, Qualifications, About
 *      the Company, Benefits, How to Apply, etc.) → <h3>.
 *    • ALL-CAPS short lines (≤ 60 chars) → <h3>.
 *    • Lines ending in ":" with no trailing content → <h3>.
 *    • "- " / "* " / "• " bullets → <ul>.
 *    • "1." / "1)" numbered items → <ol>.
 *    • Everything else → <p>.
 *  Already-HTML input passes through unchanged. */

// Common JD section labels — case-insensitive match on the FULL line
// (after stripping trailing colons / dashes). When the line matches
// any of these we promote it to a <h3>, even if it doesn't end in ":".
const JD_SECTION_HEADINGS = new Set([
  "job overview", "job description", "job summary", "overview", "summary",
  "role & responsibilities", "roles & responsibilities", "responsibilities",
  "key responsibilities", "what you'll do", "what you will do",
  "required skills", "required qualifications", "qualifications",
  "preferred skills", "preferred qualifications", "nice to have",
  "requirements", "must have", "must-haves", "minimum requirements",
  "skills", "skills required", "technical skills",
  "what we offer", "benefits", "perks", "compensation",
  "about us", "about the company", "about nb media",
  "how to apply", "application process", "next steps",
  "education", "experience", "key skills",
  // "Who We are Looking For"-style headers + common JD section names
  // that were missing — so the editor promotes them to headings the
  // same way the PDF does (keeps the preview WYSIWYG).
  "who we are looking for", "who we're looking for",
  "what we are looking for", "what we're looking for",
  "who you are", "the ideal candidate", "ideal candidate",
  "the role", "about the role", "role overview", "your role",
  "what you'll bring", "what you will bring", "what you bring",
  "what success looks like", "day to day", "day-to-day",
  "responsibilities & duties", "duties", "your responsibilities",
]);

function plainTextToQuillHtml(input: string, knownTitle?: string): string {
  if (!input) return "";
  const trimmed = input.trim();
  if (trimmed.startsWith("<")) return input;
  // Drop a pasted company letterhead from the top so it can't double the
  // .docx template's own letterhead (and drag in a typo'd email).
  const lines = stripLeadingCompanyContent(input).replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let bulletBuf: string[] = [];
  let numberedBuf: string[] = [];
  let sawTitle = false;   // only handle the FIRST job-title line
  let sawContent = false; // true once the first real body line is emitted
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const flushB = () => {
    if (bulletBuf.length) {
      out.push(`<ul>${bulletBuf.map((b) => `<li>${escape(b)}</li>`).join("")}</ul>`);
      bulletBuf = [];
    }
  };
  const flushN = () => {
    if (numberedBuf.length) {
      out.push(`<ol>${numberedBuf.map((b) => `<li>${escape(b)}</li>`).join("")}</ol>`);
      numberedBuf = [];
    }
  };
  const flushAll = () => { flushB(); flushN(); };
  const isSectionHeading = (line: string): boolean => {
    const norm = line.replace(/[:\s]+$/, "").trim().toLowerCase()
      // Normalise curly/smart apostrophes (’ ‘ ʼ) to a straight ' so PDF
      // extractor output like "What You’ll Do" matches the set entry
      // "what you'll do" — otherwise that heading rendered as plain text
      // in the editor while the PDF bolded it.
      .replace(/[‘’ʼ]/g, "'");
    return JD_SECTION_HEADINGS.has(norm);
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushAll(); out.push("<p><br></p>"); continue; }
    // Bullets — supports ASCII "-" / "*" plus Unicode bullet
    // glyphs that PDF extractors emit (• U+2022, ‣ U+2023,
    // ⁃ U+2043, ⦁ U+2981, ▪ U+25AA, ◦ U+25E6). The space after
    // the glyph is REQUIRED so we don't eat hyphens in compound
    // words like "AI-driven".
    const bullet = line.match(/^[\-\*•‣⁃⦁▪◦]\s+(.*)$/);
    if (bullet) { flushN(); bulletBuf.push(bullet[1]); continue; }
    const num = line.match(/^\d+[.)]\s+(.*)$/);
    if (num) { flushB(); numberedBuf.push(num[1]); continue; }
    flushAll();
    // ── Job title — "Job Description - Foo" or "Job Title: Foo".
    //    Promote ONCE to a centered <h2>. Uses Quill's native
    //    `ql-align-center` class because Quill strips inline
    //    style="text-align:..." during parse (its alignment format
    //    only honours its own class names). Without this, the
    //    title rendered left-aligned even though the converter
    //    emitted the right HTML.
    if (!sawTitle) {
      const titleMatch = line.match(/^(?:Job\s+Description|Job\s+Title)\s*[-–—:]\s*(.+)$/i);
      // The .docx template already prints "Job Description - {{JobTitle}}",
      // so DROP this line rather than promoting it — promoting it (the old
      // behaviour) rendered the title twice (regression from b6d2471).
      if (titleMatch) { sawTitle = true; continue; }
      // Bare title (no "Job Description -" label): the template's
      // {{JobTitle}}, the careers <h1>, and the preview header all print
      // the title from the Title FIELD — so drop a leading body line that
      // IS that title. Anchored to the known title (not line shape), so a
      // real opening sentence is never eaten.
      if (!sawContent && knownTitle && looksLikeKnownTitle(line, knownTitle)) { sawTitle = true; continue; }
    }
    // Past the title checks → real body content. Gate the bare-title
    // strip above to the FIRST content line only, so a role name that
    // recurs mid-body is never silently deleted.
    sawContent = true;
    // ── Known section heading anywhere in the document.
    if (isSectionHeading(line)) {
      out.push(`<h3>${escape(line.replace(/[:\s]+$/, ""))}</h3>`);
      continue;
    }
    // ── Lines ending in ":" with no trailing content → heading.
    if (/:\s*$/.test(line) && line.length <= 60) {
      out.push(`<h3>${escape(line.replace(/:\s*$/, ""))}</h3>`);
      continue;
    }
    // ── ALL-CAPS short lines → heading (handles "ROLE &
    //    RESPONSIBILITIES" style headers).
    if (line.length <= 60 && line.length >= 3 && line === line.toUpperCase() && /[A-Z]/.test(line)) {
      out.push(`<h3>${escape(line)}</h3>`);
      continue;
    }
    out.push(`<p>${escape(line)}</p>`);
  }
  flushAll();
  return out.join("");
}

// First real content line of an extracted JD = its title. Used to seed
// the Job Title field when HR hasn't typed one, so the preview header,
// the body-strip, and the PDF/careers <h1> all show the title from one
// source. Mirrors the title detection in plainTextToQuillHtml.
function extractJdTitle(text: string): string {
  if (!text) return "";
  for (const raw of stripLeadingCompanyContent(text).replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(?:Job\s+Description|Job\s+Title)\s*[-–—:]\s*(.+)$/i);
    return (m ? m[1] : line).trim();
  }
  return "";
}

const LOCATIONS = ["Mohali", "Remote"];
const EMPLOYMENT_TYPES = ["Full-time", "Remote", "Internship"];
const EXPERIENCE_LEVELS = [
  "Entry-level (0-2 yrs)", "Mid-level (2-5 yrs)",
  "Senior (5-8 yrs)", "Lead (8+ yrs)",
];
const CURRENCIES = [
  { code: "INR", label: "India Rupee — INR" },
  { code: "USD", label: "US Dollar — USD" },
  { code: "EUR", label: "Euro — EUR" },
  { code: "GBP", label: "British Pound — GBP" },
];
const CHANNELS = [
  { key: "career_site", label: "Career site",    desc: "Public NB Media careers page" },
  { key: "indeed",      label: "Indeed",         desc: "Cross-post to Indeed (manual)" },
  { key: "linkedin",    label: "LinkedIn",       desc: "Cross-post to LinkedIn Jobs (manual)" },
  { key: "naukri",      label: "Naukri",         desc: "Cross-post to Naukri (manual)" },
  { key: "referral",    label: "Employee referrals", desc: "Visible on the internal referral page" },
];

interface LocationRow {
  name: string;
  startHireDate: string;   // YYYY-MM-DD
  targetHireDate: string;
  positions: number;
}

// Custom screening question authored inside the wizard. Mirrors the
// /api/hr/hiring/jobs/[id]/questions POST contract. `_localId` is a
// stable client-only key for the React list + edit-in-place state;
// the real DB id only comes back after the POST lands.
type QuestionType = "short_text" | "long_text" | "yes_no" | "multiple_choice" | "number" | "date" | "file";
interface WizardQuestion {
  _localId: string;
  text: string;
  type: QuestionType;
  required: boolean;
  // Only populated for type === "multiple_choice".
  options: string[];
}

interface WizardForm {
  // Step 1
  title: string;
  brand: string;
  department: string;
  description: string;
  internalNotes: string;
  // Step 2
  employmentType: string;
  experienceLevel: string;
  locations: LocationRow[];
  currency: string;
  // Free-text range like "5 - 15" or "5". Parsed into salaryMin / salaryMax
  // at submit time. Kept as one input because HR usually types both ends
  // in the same breath.
  salaryRange: string;
  salaryUnit: "lpa" | "monthly";
  allowReapplyDays: number;
  allowReapplyEnabled: boolean;
  isPriority: boolean;
  archiveAfterFilled: boolean;
  // Step 3
  recruiterIds: number[];
  inboundOwnerStrategy: "round_robin" | "individual" | "none";
  inboundOwnerUserId: number | null;
  hiringManagerIds: number[];
  interviewerIds: number[];
  recruitersAccessOwnOnly: boolean;
  interviewersAccessOwnOnly: boolean;
  notifyRecruiterOnNewCandidate: boolean;
  notifyHiringMgrOnNewCandidate: boolean;
  interviewFeedbackVisibility: "open" | "restricted" | "private";
  // Step 4 — custom application-form questions per job
  questions: WizardQuestion[];
  // Step 5
  publishChannels: string[];
}

const STEPS = [
  { key: "description", label: "Job Description", Icon: FileText     },
  { key: "details",     label: "Job Details",     Icon: ListChecks   },
  { key: "team",        label: "Hiring Team",     Icon: Users        },
  { key: "questions",   label: "Application Form", Icon: ClipboardList },
  { key: "publish",     label: "Publish Options", Icon: Globe        },
] as const;

const today = () => {
  const d = new Date();
  return d.toISOString().slice(0, 10);
};
const inTwoMonths = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 2);
  return d.toISOString().slice(0, 10);
};

/** Parse a free-text package range into numeric [min, max].
 *  Accepts: "5-15", "5 - 15", "5 – 15" (en-dash), "5 to 15",
 *  "5+", or just "5" (treated as a single value).
 *  Returns nulls when the input is blank or unparseable. */
function parseRange(input: string): { min: number | null; max: number | null } {
  const s = (input ?? "").trim();
  if (!s) return { min: null, max: null };
  const cleaned = s.replace(/[–—]/g, "-").replace(/\s+to\s+/i, "-");
  const m = cleaned.match(/^(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?/);
  if (!m) return { min: null, max: null };
  const min = Number(m[1]);
  const max = m[2] != null ? Number(m[2]) : null;
  return {
    min: Number.isFinite(min) ? min : null,
    max: max != null && Number.isFinite(max) ? max : null,
  };
}

export default function CreateJobWizard({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (id: number, status: string) => void;
}) {
  // localStorage key for auto-saved draft state. Bumped if the
  // shape of the persisted payload ever changes so old drafts get
  // discarded gracefully rather than crashing the wizard.
  const DRAFT_KEY     = "hr.createJobWizard.draft.v1";
  const DRAFT_TS_KEY  = "hr.createJobWizard.draft.savedAt";

  // Default form shape — extracted so we can reuse it for both the
  // initial state AND when the user explicitly resets / discards
  // a saved draft.
  const DEFAULT_FORM: WizardForm = {
    title: "",
    brand: "nb_media",
    department: "",
    description: "",
    internalNotes: "",
    employmentType: "Full-time",
    experienceLevel: "Mid-level (2-5 yrs)",
    locations: [{ name: "", startHireDate: today(), targetHireDate: inTwoMonths(), positions: 1 }],
    currency: "INR",
    salaryRange: "",
    salaryUnit: "lpa",
    allowReapplyDays: 0,
    allowReapplyEnabled: false,
    isPriority: false,
    archiveAfterFilled: false,
    recruiterIds: [],
    inboundOwnerStrategy: "none",
    inboundOwnerUserId: null,
    hiringManagerIds: [],
    interviewerIds: [],
    recruitersAccessOwnOnly: false,
    interviewersAccessOwnOnly: false,
    notifyRecruiterOnNewCandidate: false,
    notifyHiringMgrOnNewCandidate: false,
    interviewFeedbackVisibility: "open",
    questions: [],
    publishChannels: ["career_site"],
  };

  // Read saved draft from localStorage on mount. Falls back to the
  // default form when nothing is saved / payload is unparseable.
  // SSR-safe — useState lazy initialiser doesn't run server-side
  // because the wizard itself only mounts inside the client modal.
  function loadDraft(): { form: WizardForm; step: number; jdText: string; jdFileName: string | null } | null {
    try {
      if (typeof window === "undefined") return null;
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return {
        form:       { ...DEFAULT_FORM, ...(parsed.form ?? {}) },
        step:       Number.isInteger(parsed.step) ? Math.max(0, Math.min(STEPS.length - 1, parsed.step)) : 0,
        jdText:     typeof parsed.jdText === "string" ? parsed.jdText : "",
        jdFileName: typeof parsed.jdFileName === "string" ? parsed.jdFileName : null,
      };
    } catch { return null; }
  }
  const draft = (typeof window !== "undefined") ? loadDraft() : null;

  const [step, setStep] = useState(draft?.step ?? 0);
  const [busy, setBusy] = useState<"" | "draft" | "publish">("");
  const [error, setError] = useState("");

  const [form, setForm] = useState<WizardForm>(draft?.form ?? DEFAULT_FORM);
  const setField = <K extends keyof WizardForm>(k: K, v: WizardForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const [jdFile, setJdFile] = useState<File | null>(null);
  // Edited plain-text version of the JD. Populated when HR uploads
  // a file (server extracts text via mammoth/pdf-parse) and tweaked
  // freely in the inline editor before publishing. Sent alongside
  // the file so the original blob and the curated text both land
  // in the DB.
  const [jdText, setJdText] = useState<string>(draft?.jdText ?? "");
  // We can't restore the actual File blob from localStorage (File
  // objects don't serialise, and the binary would blow the 5MB
  // quota anyway), but we remember the original filename so HR
  // sees a "you had X uploaded — re-attach it" hint when they come
  // back to the wizard.
  const [previousJdFileName, setPreviousJdFileName] = useState<string | null>(draft?.jdFileName ?? null);

  // Auto-save draft on every change. Wrapped in a debounce so we
  // don't hit localStorage on every keystroke — saves 250 ms after
  // the user stops typing. localStorage write is synchronous so
  // even a kill -9 mid-typing wouldn't lose more than 250 ms of
  // input.
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const payload = {
          form,
          step,
          jdText,
          jdFileName: jdFile?.name ?? previousJdFileName ?? null,
        };
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
        window.localStorage.setItem(DRAFT_TS_KEY, String(Date.now()));
      } catch { /* quota exceeded or storage disabled — silent no-op */ }
    }, 250);
    return () => window.clearTimeout(t);
  }, [form, step, jdText, jdFile, previousJdFileName]);

  // Clear the saved draft. Called after a successful publish /
  // save-draft so the next "Create Job" starts fresh, and exposed
  // to the user via the resume hint when they want to discard.
  const clearSavedDraft = () => {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
      window.localStorage.removeItem(DRAFT_TS_KEY);
    } catch { /* noop */ }
    setPreviousJdFileName(null);
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !busy) onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const totalPositions = form.locations.reduce((s, l) => s + (Number(l.positions) || 0), 0);

  const validateStep = (s: number): string | null => {
    if (s === 0) {
      if (!form.title.trim()) return "Job title is required.";
      if (!jdFile) return "Please upload the Job Description file.";
    }
    if (s === 1) {
      if (form.locations.length === 0 || !form.locations.some((l) => l.name.trim()))
        return "Add at least one location.";
      const { min, max } = parseRange(form.salaryRange);
      if (min != null && max != null && min > max)
        return "Package range — minimum must be ≤ maximum.";
    }
    if (s === 2) {
      if (form.inboundOwnerStrategy === "individual" && !form.inboundOwnerUserId)
        return "Pick the individual to assign new candidates to.";
    }
    if (s === 3) {
      // Application Form step — questions are optional, but every
      // question must have non-empty text. Multiple-choice questions
      // need at least 2 options.
      for (const q of form.questions) {
        if (!q.text.trim()) return "Each question needs a prompt.";
        if (q.type === "multiple_choice" && q.options.filter((o) => o.trim()).length < 2)
          return `Multiple-choice question "${q.text.slice(0, 40)}…" needs at least 2 options.`;
      }
    }
    if (s === 4) {
      if (form.publishChannels.length === 0)
        return "Pick at least one publish channel.";
    }
    return null;
  };

  const goNext = () => {
    const v = validateStep(step);
    if (v) { setError(v); return; }
    setError("");
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const goBack = () => {
    setError("");
    setStep((s) => Math.max(0, s - 1));
  };

  const submit = async (publish: boolean) => {
    // Validate ALL steps up to and including current — Save Draft
    // shouldn't require step 4 channels.
    const checkSteps = publish ? STEPS.length : Math.min(step + 1, 2);
    for (let i = 0; i < checkSteps; i++) {
      const v = validateStep(i);
      if (v) { setError(`Step ${i + 1}: ${v}`); setStep(i); return; }
    }
    setBusy(publish ? "publish" : "draft"); setError("");
    try {
      const { min: parsedMin, max: parsedMax } = parseRange(form.salaryRange);
      const payload = {
        ...form,
        // Map UI fields to API fields. Free-text range parsed into
        // numeric min/max for the existing API contract.
        salaryMin: parsedMin,
        salaryMax: parsedMax,
        allowReapplyDays: form.allowReapplyEnabled ? Number(form.allowReapplyDays) || 0 : 0,
        locations: form.locations
          .filter((l) => l.name.trim())
          .map((l) => ({
            name: l.name.trim(),
            startHireDate: l.startHireDate || null,
            targetHireDate: l.targetHireDate || null,
            positions: Number(l.positions) || 1,
          })),
        publish,
      };
      const res = await fetch("/api/hr/hiring/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to create job");
      }
      const { id, status } = await res.json();
      if (jdFile && id) {
        const fd = new FormData();
        fd.append("file", jdFile);
        // Send the (possibly edited) extracted text alongside the
        // binary so HR's tweaks survive into the saved JD.
        if (jdText.trim()) fd.append("jdText", jdText);
        await fetch(`/api/hr/hiring/jobs/${id}/jd`, { method: "POST", body: fd });
      }
      // Persist screening questions in the order they were authored.
      // POSTed sequentially (not Promise.all) so the server's append-
      // to-end sortOrder logic preserves the wizard order. Failure to
      // persist a question doesn't abort job creation — the job is
      // already saved and HR can add questions later via the per-job
      // Application Form panel.
      if (id && form.questions.length > 0) {
        let failedQuestions = 0;
        for (const q of form.questions) {
          const text = q.text.trim();
          if (!text) continue;
          try {
            const qRes = await fetch(`/api/hr/hiring/jobs/${id}/questions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text,
                type: q.type,
                required: q.required,
                options: q.type === "multiple_choice"
                  ? q.options.map((o) => o.trim()).filter(Boolean)
                  : undefined,
              }),
            });
            if (!qRes.ok) failedQuestions++;
          } catch { failedQuestions++; }
        }
        // Non-fatal (the job is saved), but tell HR instead of silently
        // dropping screening questions.
        if (failedQuestions > 0) {
          showToast(
            `Job saved, but ${failedQuestions} screening question${failedQuestions === 1 ? "" : "s"} couldn't be saved — add them from the job's Application Form.`,
            "error",
          );
        }
      }
      // Successful create — wipe the saved draft so the next time
      // HR opens "Create Job" they start with a blank wizard
      // instead of resuming the one we just published.
      clearSavedDraft();
      onCreated(Number(id), status);
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
      setBusy("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-[18px] font-semibold text-slate-900 tracking-tight">Create Job Posting</h1>
        <button
          onClick={onClose}
          className="h-9 w-9 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
        ><X size={18} /></button>
      </div>

      {/* Step indicator + nav buttons */}
      <div className="border-b border-slate-200 px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
        <StepIndicator current={step} onJump={(i) => { if (i <= step) setStep(i); }} />
        <div className="flex items-center gap-2">
          <button
            onClick={goBack}
            disabled={step === 0 || !!busy}
            className="h-9 px-4 rounded-lg border border-slate-200 bg-white hover:border-slate-300 text-slate-700 text-[12.5px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          ><ChevronLeft size={13} /> Back</button>
          <button
            onClick={() => submit(false)}
            disabled={!!busy}
            className="h-9 px-4 rounded-lg border border-slate-200 bg-white hover:border-slate-300 text-slate-700 text-[12.5px] font-semibold disabled:opacity-40 inline-flex items-center gap-1.5"
          >{busy === "draft" ? "Saving…" : "Save Draft"}</button>
          {step < STEPS.length - 1 ? (
            <button
              onClick={goNext}
              disabled={!!busy}
              className="h-9 px-5 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[12.5px] font-semibold shadow-sm inline-flex items-center gap-1.5"
            >Continue <ChevronRight size={13} /></button>
          ) : null}
          <button
            onClick={() => submit(true)}
            disabled={!!busy}
            className="h-9 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12.5px] font-semibold shadow-sm disabled:opacity-40 inline-flex items-center gap-1.5"
          >{busy === "publish" ? "Publishing…" : "Publish"}</button>
        </div>
      </div>

      {/* Resume hint — appears when the wizard restored a saved
          draft from localStorage. Auto-hidden once HR re-attaches
          the JD file (then there's no "missing JD" issue to
          surface) and once the user dismisses it.
          Hidden when there's no remembered file because the
          restore is otherwise silent / not worth surfacing. */}
      {previousJdFileName && !jdFile && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2.5 flex items-center gap-3">
          <div className="text-[12px] text-amber-900">
            Resumed your saved draft. Re-attach the JD file (<span className="font-semibold">{previousJdFileName}</span>) to keep going.
          </div>
          <button
            type="button"
            onClick={() => { clearSavedDraft(); setForm(DEFAULT_FORM); setStep(0); setJdText(""); }}
            className="ml-auto text-[11.5px] font-semibold text-amber-700 hover:text-amber-900"
          >Discard draft</button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto bg-slate-50">
        <div className="max-w-[1100px] mx-auto px-6 py-8">
          {error && (
            <div className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-[12.5px] text-rose-700 flex items-center gap-2">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {step === 0 && <Step1Description form={form} setField={setField} jdFile={jdFile} setJdFile={setJdFile} jdText={jdText} setJdText={setJdText} />}
          {step === 1 && <Step2Details      form={form} setField={setField} totalPositions={totalPositions} />}
          {step === 2 && <Step3HiringTeam  form={form} setField={setField} />}
          {step === 3 && <Step4Questions   form={form} setField={setField} />}
          {step === 4 && <Step5Publish      form={form} setField={setField} />}
        </div>
      </div>
    </div>
  );
}

// ── Step indicator ────────────────────────────────────────────────────

function StepIndicator({ current, onJump }: { current: number; onJump: (i: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((s, i) => {
        const active = i === current;
        const done   = i < current;
        return (
          <div key={s.key} className="flex items-center gap-1.5">
            <button
              onClick={() => onJump(i)}
              disabled={i > current}
              className={`inline-flex items-center gap-2 h-9 px-3 rounded-lg transition-colors text-[11px] font-bold uppercase tracking-wider ${
                active
                  ? "bg-[#3b82f6]/10 text-[#1d4ed8] ring-1 ring-[#3b82f6]/30"
                  : done
                    ? "text-slate-700 hover:bg-slate-100 cursor-pointer"
                    : "text-slate-400 cursor-not-allowed"
              }`}
            >
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                active ? "bg-[#3b82f6] text-white" : done ? "bg-emerald-500 text-white" : "border border-slate-300 text-slate-400"
              }`}>
                {done ? <Check size={11} /> : i + 1}
              </span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && <ChevronRight size={12} className="text-slate-300" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Job Description ───────────────────────────────────────────

function Step1Description({
  form, setField, jdFile, setJdFile, jdText, setJdText,
}: {
  form: WizardForm;
  setField: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
  jdFile: File | null;
  setJdFile: (f: File | null) => void;
  jdText: string;
  setJdText: (v: string) => void;
}) {
  const titleOptions = useMemo(
    () => (form.brand === "yt_labs" ? JOB_TITLES_YT_LABS : JOB_TITLES),
    [form.brand],
  );
  const deptOptions = useMemo(
    () => (form.brand === "yt_labs" ? DEPARTMENTS_YT_LABS : DEPARTMENTS),
    [form.brand],
  );

  return (
    <SectionCard>
      <SectionTitle>Job description</SectionTitle>

      <FormGrid>
        <Field label="Business unit" required>
          <RadioPills
            value={form.brand}
            onChange={(v) => setField("brand", v)}
            options={[
              { value: "nb_media", label: "NB Media" },
              { value: "yt_labs",  label: "YT Labs" },
            ]}
          />
        </Field>
        <Field label="Job title" required>
          <Combobox
            value={form.title}
            onChange={(v) => setField("title", v)}
            options={titleOptions}
            placeholder="e.g. Senior Content Strategist"
          />
        </Field>
        <Field label="Department">
          <Combobox
            value={form.department}
            onChange={(v) => setField("department", v)}
            options={deptOptions}
            placeholder="e.g. Content"
          />
        </Field>
      </FormGrid>

      {/* "Description" field removed from the wizard — the JD
          (uploaded + edited inline below) is the single canonical
          body for a role. The earlier short-summary description
          was duplicative on the careers page (which now renders
          only the JD) and HR couldn't tell which one would show
          up where. Existing JobOpening.description values in the
          DB are left untouched; this just stops collecting new
          ones via the wizard. */}

      <Field label="Internal notes (not shown on careers page)">
        <textarea
          value={form.internalNotes}
          onChange={(e) => setField("internalNotes", e.target.value)}
          rows={3}
          placeholder="Context for the hiring team — budget, hidden constraints, candidate sources."
          style={{ fontFamily: '"Times New Roman", Georgia, serif' }}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
        />
      </Field>

      <Field label="Job Description file" required>
        <JdUploader file={jdFile} setFile={setJdFile} />
      </Field>

      {/* Preview + inline edit of the uploaded JD. Appears only after
          a file is picked. The textarea autocompletes from the file
          (mammoth/pdf-parse on the server) and HR can tweak any line
          before publishing. The edited copy lands in JobOpening.jdText. */}
      {jdFile && (
        <JdPreviewEditor
          file={jdFile}
          value={jdText}
          onChange={setJdText}
          jobTitle={form.title}
          onTitleExtract={(t) => setField("title", t)}
        />
      )}
    </SectionCard>
  );
}

// JdPreviewEditor — calls /api/hr/hiring/jd-extract to populate the
// textarea from the uploaded file, then lets HR edit freely. Re-runs
// extraction whenever the picked file changes (size + name + lastMod
// fingerprint). Manual edits stay sticky — once HR types into the
// textarea, we don't auto-overwrite on the next extraction.
function JdPreviewEditor({
  file, value, onChange, jobTitle, onTitleExtract,
}: {
  file: File;
  value: string;
  onChange: (v: string) => void;
  jobTitle: string;
  /// Seed the Job Title field from the JD's first line when it's blank.
  onTitleExtract?: (title: string) => void;
}) {
  const [extracting, setExtracting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  // "Saved snapshot" — the value HR last clicked Save on. Used to
  // tell HR when they have unsaved edits vs everything's locked in.
  const [savedValue, setSavedValue] = useState<string>("");
  const [previewing, setPreviewing] = useState(false);
  // Preview modal state. Renders the freshly-built PDF as a blob
  // URL inside an iframe — sidesteps popup-blocker issues that
  // hit window.open() after an awaited fetch.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Maximised mode pops the editor out into a fullscreen overlay
  // so HR can comfortably edit long JDs without being squeezed
  // inside the wizard's scrollable body.
  const [expanded, setExpanded] = useState(false);
  // Fingerprint so we re-extract when HR picks a different file but
  // skip when the file object identity changes for unrelated reasons.
  const fp = `${file.name}-${file.size}-${file.lastModified}`;
  const dirtied = useRef<boolean>(false);
  // Last raw extracted plain text — kept so we can re-derive (and re-strip
  // the title from) the body if the Job Title arrives AFTER extraction.
  const rawTextRef = useRef<string>("");
  const hasUnsavedChanges = value.trim() !== savedValue.trim();
  // canSave needs the body to be non-empty AFTER tag-stripping —
  // Quill emits "<p><br></p>" for an "empty" editor, which is
  // non-empty by string length but visually blank to the user.
  const stripped = value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").trim();
  const canSave  = !extracting && stripped.length > 0 && hasUnsavedChanges;

  // The Job Title field + the JD uploader share this wizard step with no
  // ordering, so HR may upload BEFORE typing the title. When the title
  // arrives (or changes), re-derive the body from the raw extract so the
  // now-known title gets stripped — but only while HR hasn't hand-edited.
  // Without this the title renders in BOTH the header and the body (and
  // persists into jdText → doubles on the PDF + careers too).
  useEffect(() => {
    if (!rawTextRef.current || dirtied.current) return;
    const html = plainTextToQuillHtml(rawTextRef.current, jobTitle);
    onChange(html);
    setSavedValue(html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobTitle]);

  useEffect(() => {
    let cancelled = false;
    // 30s timeout — if the server hangs (e.g. pdf-parse stuck on a
    // weird PDF), abort the fetch so the UI stops spinning and the
    // user sees a real error instead of "Reading file…" forever.
    const ctrl = new AbortController();
    const timeoutId = window.setTimeout(() => ctrl.abort(), 30_000);
    setExtracting(true);
    setError(null);
    (async () => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/hr/hiring/jd-extract", {
          method: "POST",
          body: fd,
          signal: ctrl.signal,
        });
        const j = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(j?.error || `Couldn't read the file (HTTP ${res.status})`);
        const text = String(j?.text ?? "").trim();
        rawTextRef.current = text;
        // Seed the Job Title from the JD's first line when HR hasn't
        // typed one — so the preview header, the body-strip, and the
        // PDF/careers <h1> all read the title from a single source.
        const derivedTitle = extractJdTitle(text);
        if (derivedTitle && !jobTitle.trim()) onTitleExtract?.(derivedTitle);
        // Convert plain-text extractor output → Quill HTML so the
        // editor opens with light auto-formatting (headings + lists)
        // that HR can refine via the toolbar. Already-HTML values
        // pass through untouched.
        const html = plainTextToQuillHtml(text, jobTitle.trim() || derivedTitle);
        // Don't clobber HR's manual edits. Only auto-fill when the
        // editor is empty / untouched for the current file.
        if (!dirtied.current || !value.trim()) {
          onChange(html);
          // Seed the saved-snapshot so HR doesn't see "unsaved
          // changes" the moment extraction completes.
          setSavedValue(html);
        }
      } catch (e: any) {
        if (cancelled) return;
        // AbortError fires in two cases:
        //   1. The 30s timeout we set with setTimeout(…, 30_000).
        //   2. StrictMode's dev-only double-invocation tearing down
        //      the first effect run. The SECOND run will succeed —
        //      so an AbortError during dev is usually a no-op and
        //      shouldn't surface a scary error to HR.
        if (e?.name === "AbortError") return;
        const msg = e?.message ?? "Couldn't read the file";
        setError(msg);
        // Let HR still edit freely even when extraction failed — the
        // textarea was the goal anyway, just empty as a starting point.
        if (!dirtied.current) onChange("");
      } finally {
        window.clearTimeout(timeoutId);
        if (!cancelled) setExtracting(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fp]);

  // Strip HTML tags before counting words — Quill emits "<p>hello</p>"
  // and HR wants a real body-text count, not markup tokens.
  const plain     = value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").trim();
  const wordCount = plain ? plain.split(/\s+/).length : 0;

  // When `expanded` is on, the editor pops out into a fixed fullscreen
  // overlay (with backdrop) so HR has the whole viewport to edit long
  // JDs. The inline-flow layout is recovered by toggling expanded off.
  const outerClass = expanded
    ? "fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
    : "mt-4";
  const cardClass = expanded
    ? "w-full max-w-[96vw] h-[96vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
    : "rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col";

  return (
    <div className={outerClass}>
      <div className={cardClass}>
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <span className="inline-flex h-5 px-1.5 rounded bg-blue-100 text-[#1d4ed8] text-[10px] font-bold uppercase tracking-wider items-center">
            Preview
          </span>
          <p className="text-[12px] text-slate-600 truncate">
            Extracted from <span className="font-semibold text-slate-800">{file.name}</span>
            {" — "}edit any line; the cleaned-up text is what gets saved.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10.5px] text-slate-400 whitespace-nowrap">
            {extracting ? "Reading file…" : `${wordCount} word${wordCount === 1 ? "" : "s"}`}
          </span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100"
            aria-label={expanded ? "Restore" : "Maximise"}
            title={expanded ? "Restore size" : "Maximise"}
          >
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>
      {error ? (
        <div className="px-4 py-3 text-[12px] text-rose-700 bg-rose-50 border-b border-rose-200">
          {error}
          {/.doc$/i.test(file.name) && (
            <span className="block mt-0.5 text-[11px] text-rose-600">
              Legacy .doc files don&apos;t always parse. Convert to .docx or .pdf and re-upload.
            </span>
          )}
        </div>
      ) : null}
      {/* Full WYSIWYG editor — toolbar gives HR Bold / Italic /
          Underline / font size / headings / lists / alignment.
          The NB Media letterhead + watermark live in the DOCX
          template; toolbar actions here only affect the body
          region of the generated PDF. */}
      <div
        className={`jd-quill-wrap bg-white ${expanded ? "flex-1 overflow-auto" : ""} ${extracting ? "opacity-60 pointer-events-none" : ""}`}
        style={{ fontFamily: '"Times New Roman", Georgia, serif' }}
      >
        {/* Non-editable title header — mirrors the .docx {{JobTitle}} +
            careers <h1> (big, centered) so the preview matches the PDF.
            Lives OUTSIDE ReactQuill so it never leaks into value/onChange;
            the matching title line is stripped from the body above. */}
        {jobTitle && jobTitle.trim() ? (
          <div
            contentEditable={false}
            aria-hidden="true"
            style={{ fontSize: "20px", fontWeight: 700, textAlign: "center", margin: "18px 20px 14px", color: "#0f172a" }}
          >
            {jobTitle}
          </div>
        ) : null}
        <ReactQuill
          theme="snow"
          value={value}
          onChange={(html) => { dirtied.current = true; onChange(html); }}
          modules={JD_QUILL_MODULES}
          formats={JD_QUILL_FORMATS}
          placeholder={
            extracting
              ? "Reading file content…"
              : error
                ? "Couldn't extract the file's text — paste or type the JD here."
                : "Edit the extracted JD here — use the toolbar to bold, resize, or list items."
          }
          readOnly={extracting}
        />
      </div>
      <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[10.5px] text-slate-500 flex items-center gap-2 min-w-0 flex-wrap">
          {extracting ? (
            <span>Reading file content…</span>
          ) : hasUnsavedChanges ? (
            <span className="inline-flex items-center gap-1.5 text-amber-700">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Unsaved changes
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <Check size={11} />
              Saved — will be published as a PDF
            </span>
          )}
          {previewError && (
            <span className="inline-flex items-center gap-1.5 text-rose-700">
              <AlertCircle size={11} /> {previewError}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              if (!value.trim()) return;
              setPreviewing(true);
              setPreviewError(null);
              try {
                const res = await fetch("/api/hr/hiring/jd-render-preview", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ title: jobTitle || "Job Description", text: value }),
                });
                if (!res.ok) {
                  const j = await res.json().catch(() => ({}));
                  setPreviewError(j?.error || `Preview render failed (HTTP ${res.status})`);
                  return;
                }
                const blob = await res.blob();
                if (blob.size === 0) {
                  setPreviewError("Server returned an empty PDF");
                  return;
                }
                // Open the modal — its iframe loads the blob URL.
                // Sidesteps popup blockers entirely.
                setPreviewUrl(URL.createObjectURL(blob));
              } catch (e: any) {
                setPreviewError(e?.message ?? "Couldn't render preview");
              } finally {
                setPreviewing(false);
              }
            }}
            disabled={extracting || previewing || !value.trim()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-slate-200 hover:border-[#3b82f6] hover:text-[#3b82f6] text-slate-700 text-[11.5px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Eye size={12} /> {previewing ? "Rendering…" : "Preview as PDF"}
          </button>
          <button
            type="button"
            onClick={() => setSavedValue(value)}
            disabled={!canSave}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[11.5px] font-semibold shadow-sm disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            <Save size={12} /> Save changes
          </button>
        </div>
      </div>

      {/* Preview modal — opens with the just-rendered PDF in an
          iframe. No popup-blocker concerns since the iframe loads
          a same-origin blob URL we control. */}
      {previewUrl && (
        <JdPreviewModal
          url={previewUrl}
          onClose={() => {
            URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
          }}
        />
      )}
      </div>
    </div>
  );
}

function JdPreviewModal({ url, onClose }: { url: string; onClose: () => void }) {
  // Esc-to-close keyboard handler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl h-[92vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
      >
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-slate-900">JD Preview</h3>
            <p className="text-[11px] text-slate-500">
              This is exactly what candidates will see on the careers page.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={url}
              download="jd-preview.pdf"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-slate-200 hover:border-[#3b82f6] hover:text-[#3b82f6] text-slate-700 text-[11.5px] font-semibold"
            >
              Download
            </a>
            <button
              onClick={onClose}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100"
              aria-label="Close preview"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-slate-100 p-2">
          <iframe
            src={url}
            title="JD Preview"
            className="w-full h-full bg-white rounded border border-slate-200"
            style={{ border: 0 }}
          />
        </div>
      </div>
    </div>
  );
}

function JdUploader({ file, setFile }: { file: File | null; setFile: (f: File | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const ALLOWED = [".pdf", ".doc", ".docx", ".rtf", ".txt"];
  const MAX = 5 * 1024 * 1024;
  const pick = (f: File | null) => {
    if (!f) { setFile(null); return; }
    const ext = f.name.toLowerCase().slice(f.name.lastIndexOf("."));
    if (!ALLOWED.includes(ext)) return showToast("Allowed: PDF, DOC, DOCX, RTF, TXT", "error");
    if (f.size > MAX)            return showToast("Max 5 MB", "error");
    setFile(f);
  };
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <FileText size={20} className="text-slate-400 shrink-0" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-slate-800 truncate">
            {file ? file.name : "No file selected"}
          </p>
          <p className="text-[11px] text-slate-500">PDF / DOC / DOCX / RTF / TXT, up to 5 MB</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {file && (
          <button onClick={() => pick(null)} className="text-[11.5px] font-medium text-slate-500 hover:text-rose-600">Remove</button>
        )}
        <button
          onClick={() => ref.current?.click()}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white border border-slate-200 hover:border-[#3b82f6] text-[12px] font-semibold text-slate-700"
        ><Upload size={13} /> {file ? "Replace" : "Upload"}</button>
        <input
          ref={ref} type="file"
          accept=".pdf,.doc,.docx,.rtf,.txt"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          className="hidden"
        />
      </div>
    </div>
  );
}

// ── Step 2: Job Details ───────────────────────────────────────────────

function Step2Details({
  form, setField, totalPositions,
}: {
  form: WizardForm;
  setField: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
  totalPositions: number;
}) {
  const addLocation = () =>
    setField("locations", [...form.locations, { name: "", startHireDate: today(), targetHireDate: inTwoMonths(), positions: 1 }]);
  const updateLocation = (i: number, patch: Partial<LocationRow>) =>
    setField("locations", form.locations.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const removeLocation = (i: number) =>
    setField("locations", form.locations.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-5">
      <SectionCard>
        <SectionTitle>Job details</SectionTitle>
        <FormGrid>
          <Field label="Job Type" required>
            <Select
              value={form.employmentType}
              onChange={(v) => setField("employmentType", v)}
              options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: t }))}
            />
          </Field>
          <Field label="Experience level">
            <Select
              value={form.experienceLevel}
              onChange={(v) => setField("experienceLevel", v)}
              options={EXPERIENCE_LEVELS.map((t) => ({ value: t, label: t }))}
            />
          </Field>
        </FormGrid>

        {/* Locations table */}
        <div className="mt-4 rounded-xl border border-slate-200 overflow-hidden">
          <div className="grid grid-cols-12 gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
            <div className="col-span-4">Location</div>
            <div className="col-span-3">Start hire date</div>
            <div className="col-span-3">Target hire date</div>
            <div className="col-span-1 text-right">Positions</div>
            <div className="col-span-1" />
          </div>
          {form.locations.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0 items-center">
              <div className="col-span-4">
                <Combobox
                  value={l.name}
                  onChange={(v) => updateLocation(i, { name: v })}
                  options={LOCATIONS}
                  placeholder="Add Location"
                  compact
                />
              </div>
              <div className="col-span-3">
                <DateInput value={l.startHireDate} onChange={(v) => updateLocation(i, { startHireDate: v })} />
              </div>
              <div className="col-span-3">
                <DateInput value={l.targetHireDate} onChange={(v) => updateLocation(i, { targetHireDate: v })} />
              </div>
              <div className="col-span-1">
                <input
                  type="number" min={1}
                  value={l.positions}
                  onChange={(e) => updateLocation(i, { positions: Math.max(1, Number(e.target.value) || 1) })}
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 text-[12.5px] text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
                />
              </div>
              <div className="col-span-1 flex justify-end">
                {form.locations.length > 1 && (
                  <button
                    onClick={() => removeLocation(i)}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                  ><Trash2 size={13} /></button>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 text-[12px]">
            <button onClick={addLocation} className="inline-flex items-center gap-1 text-[#3b82f6] hover:text-[#2563eb] font-semibold">
              <Plus size={13} /> Add
            </button>
            <span className="text-slate-600 font-semibold">Total Positions: <span className="tabular-nums">{totalPositions}</span></span>
          </div>
        </div>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Package details</SectionTitle>
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-3">
            <Select
              value={form.currency}
              onChange={(v) => setField("currency", v)}
              options={CURRENCIES.map((c) => ({ value: c.code, label: c.label }))}
            />
          </div>
          <div className="col-span-6">
            <input
              type="text"
              value={form.salaryRange}
              onChange={(e) => setField("salaryRange", e.target.value)}
              placeholder={form.salaryUnit === "lpa" ? "e.g. 5 – 15" : "e.g. 40000 – 80000"}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
            />
          </div>
          <div className="col-span-3">
            <Select
              value={form.salaryUnit}
              onChange={(v) => setField("salaryUnit", v as "lpa" | "monthly")}
              options={[
                { value: "lpa",     label: "LPA" },
                { value: "monthly", label: "Monthly" },
              ]}
            />
          </div>
        </div>
        <p className="mt-1.5 text-[10.5px] text-slate-400">
          Type a single value (e.g. <code>5</code>) or a range (e.g. <code>5 - 15</code> or <code>5 – 15</code>).
        </p>
      </SectionCard>

      <SectionCard>
        <HiringFlowStrip />
      </SectionCard>

      <SectionCard>
        <SectionTitle>Additional options</SectionTitle>
        <div className="space-y-2">
          <CheckboxRow
            checked={form.allowReapplyEnabled}
            onChange={(b) => setField("allowReapplyEnabled", b)}
            label="Allow applicant to apply for the same job after"
            trailing={
              <div className="inline-flex items-center gap-2">
                <input
                  type="number" min={0}
                  // Show empty when the underlying value is 0 so HR can
                  // type "30" naturally instead of getting "030" / "300"
                  // from the literal "0" the controlled input would
                  // otherwise display. Empty input parses back to 0 on
                  // submit via the existing Number(...) || 0 guard.
                  value={form.allowReapplyDays || ""}
                  onChange={(e) => {
                    // Strip any leading zeros that browsers may still
                    // accept (e.g. paste of "030"), then coerce.
                    const cleaned = e.target.value.replace(/^0+(?=\d)/, "");
                    setField("allowReapplyDays", Math.max(0, parseInt(cleaned, 10) || 0));
                  }}
                  disabled={!form.allowReapplyEnabled}
                  placeholder="30"
                  className="w-20 h-8 px-2 rounded border border-slate-200 text-[12.5px] tabular-nums disabled:opacity-40"
                />
                <span className="text-[12px] text-slate-500">days</span>
              </div>
            }
          />
          <CheckboxRow
            checked={form.isPriority}
            onChange={(b) => setField("isPriority", b)}
            label="Mark the job as priority"
          />
          <CheckboxRow
            checked={form.archiveAfterFilled}
            onChange={(b) => setField("archiveAfterFilled", b)}
            label="Archive job after positions are filled"
          />
        </div>
      </SectionCard>
    </div>
  );
}

interface StageRow {
  id: number;
  label: string;
  sortOrder: number;
  kind: string;       // "active" | "hired" | "rejected"
  color: string;
  isActive: boolean;
}

function HiringFlowStrip() {
  const STAGES_KEY = "/api/hr/hiring/stages?includeInactive=0";
  const { data, mutate } = useSWR<{ stages: StageRow[] }>(STAGES_KEY, fetcher);
  const [editing, setEditing] = useState(false);
  const [busyId, setBusyId]   = useState<number | "new" | null>(null);
  const [error, setError]     = useState<string>("");
  const [newLabel, setNewLabel] = useState("");

  const stages = (data?.stages ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const isTerminal = (s: StageRow) => s.kind === "hired" || s.kind === "rejected";
  const activeStages = stages.filter((s) => !isTerminal(s));

  // Inline rename — debounced-on-blur instead of every keystroke so we
  // don't spam the API. Local state mirror so the input stays editable
  // while the request flies.
  const [labelDrafts, setLabelDrafts] = useState<Record<number, string>>({});
  const labelFor = (s: StageRow) => labelDrafts[s.id] ?? s.label;
  const commitRename = async (s: StageRow) => {
    const next = (labelDrafts[s.id] ?? "").trim();
    if (!next || next === s.label) {
      setLabelDrafts((d) => { const c = { ...d }; delete c[s.id]; return c; });
      return;
    }
    setBusyId(s.id); setError("");
    try {
      const r = await fetch(`/api/hr/hiring/stages/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: next }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || "Couldn't rename");
      }
      setLabelDrafts((d) => { const c = { ...d }; delete c[s.id]; return c; });
      mutate();
    } catch (e: any) {
      setError(e?.message || "Rename failed");
    } finally {
      setBusyId(null);
    }
  };

  const deleteStage = async (s: StageRow) => {
    if (!confirm(`Delete "${s.label}" from the hiring pipeline? This affects every job.`)) return;
    setBusyId(s.id); setError("");
    try {
      const r = await fetch(`/api/hr/hiring/stages/${s.id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || "Couldn't delete");
      }
      mutate();
    } catch (e: any) {
      setError(e?.message || "Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  const reorder = async (s: StageRow, direction: -1 | 1) => {
    // Reorder within the active stages only — terminals stay at the end.
    const idx = activeStages.findIndex((x) => x.id === s.id);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= activeStages.length) return;
    const reordered = activeStages.slice();
    [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]];
    const order = [
      ...reordered.map((x) => x.id),
      ...stages.filter(isTerminal).map((x) => x.id),
    ];
    setBusyId(s.id); setError("");
    try {
      const r = await fetch(STAGES_KEY, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || "Couldn't reorder");
      }
      mutate();
    } catch (e: any) {
      setError(e?.message || "Reorder failed");
    } finally {
      setBusyId(null);
    }
  };

  const addStage = async () => {
    const label = newLabel.trim();
    if (!label) return;
    setBusyId("new"); setError("");
    try {
      const r = await fetch("/api/hr/hiring/stages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || "Couldn't add stage");
      }
      setNewLabel("");
      mutate();
    } catch (e: any) {
      setError(e?.message || "Add failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] font-semibold text-slate-800">
          Hiring Flow
          <span className="text-[11px] font-medium text-slate-400 ml-2">
            ·  Shared pipeline — edits apply to every job
          </span>
        </p>
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-semibold border ${
            editing
              ? "bg-[#3b82f6] text-white border-[#3b82f6] hover:bg-[#2563eb]"
              : "bg-white text-slate-700 border-slate-200 hover:border-[#3b82f6] hover:text-[#3b82f6]"
          }`}
        >
          {editing ? <><Check size={12} /> Done</> : <><Pencil size={12} /> Edit</>}
        </button>
      </div>

      {error && (
        <div className="mb-2 px-3 py-2 rounded-md bg-rose-50 text-rose-700 text-[11.5px] border border-rose-200">
          {error}
        </div>
      )}

      {stages.length === 0 ? (
        <p className="text-[12px] text-slate-400">
          No pipeline stages configured. Add the first stage below.
        </p>
      ) : !editing ? (
        // Read-only strip
        <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
          {stages.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <div className="px-4 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[12px] font-semibold text-slate-700 whitespace-nowrap">
                {s.label}
              </div>
              {i < stages.length - 1 && <ChevronRight size={14} className="text-slate-300 mx-0.5" />}
            </div>
          ))}
        </div>
      ) : (
        // Edit mode — vertical list so each chip has room for controls.
        <div className="space-y-1.5">
          {stages.map((s) => {
            const terminal = isTerminal(s);
            return (
              <div key={s.id} className="flex items-center gap-2">
                <input
                  value={labelFor(s)}
                  onChange={(e) => setLabelDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                  onBlur={() => commitRename(s)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  disabled={busyId === s.id}
                  className="flex-1 h-9 px-3 rounded-lg border border-slate-200 text-[12.5px] font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6] disabled:opacity-50"
                />
                {terminal ? (
                  <span className="text-[10.5px] uppercase tracking-wider font-bold text-slate-400 px-2">
                    Terminal
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => reorder(s, -1)}
                      disabled={busyId === s.id || activeStages[0]?.id === s.id}
                      className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:border-[#3b82f6] hover:text-[#3b82f6] disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move up"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => reorder(s, 1)}
                      disabled={busyId === s.id || activeStages[activeStages.length - 1]?.id === s.id}
                      className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:border-[#3b82f6] hover:text-[#3b82f6] disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move down"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteStage(s)}
                      disabled={busyId === s.id}
                      className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-rose-200 text-rose-500 hover:bg-rose-50 disabled:opacity-30"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            );
          })}

          <div className="flex items-center gap-2 pt-2 mt-2 border-t border-slate-100">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addStage(); } }}
              placeholder="New stage name (e.g. Assignment Round)"
              className="flex-1 h-9 px-3 rounded-lg border border-slate-200 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
            />
            <button
              type="button"
              onClick={addStage}
              disabled={!newLabel.trim() || busyId === "new"}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-[#3b82f6] text-white text-[12px] font-semibold hover:bg-[#2563eb] disabled:bg-slate-300"
            >
              <Plus size={13} /> Add stage
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Step 3: Hiring Team ───────────────────────────────────────────────

interface UserRow { id: number; name: string; email?: string }

function Step3HiringTeam({
  form, setField,
}: {
  form: WizardForm;
  setField: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
}) {
  // ?all=true → include role=member / orgLevel=member rows (regular
  // employees); without it the API filters them out and only HR /
  // managers show up in the picker.
  const { data } = useSWR<{ users?: UserRow[] } | UserRow[]>("/api/users?all=true", fetcher);
  const users: UserRow[] = Array.isArray(data) ? data : Array.isArray((data as any)?.users) ? (data as any).users : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <SectionCard>
        <SectionTitle>Recruiters</SectionTitle>
        <UserMultiPicker
          all={users}
          selected={form.recruiterIds}
          onChange={(ids) => setField("recruiterIds", ids)}
          placeholder="Add recruiter"
        />

        <div className="mt-6">
          <p className="text-[13px] font-semibold text-slate-800 mb-2">
            Inbound candidate owner assignment
            <Hint text="Determines who becomes the default owner of new candidates added to this job." />
          </p>
          <div className="space-y-2">
            <RadioCard
              checked={form.inboundOwnerStrategy === "round_robin"}
              onClick={() => setField("inboundOwnerStrategy", "round_robin")}
              title="Round robin assignment"
              desc="Any new candidate is assigned to a different recruiter until everyone has equal number of active candidates owned."
            />
            <RadioCard
              checked={form.inboundOwnerStrategy === "individual"}
              onClick={() => setField("inboundOwnerStrategy", "individual")}
              title="Assign to individual"
              desc="Each candidate will be assigned to a selected recruiter as their owner."
            >
              {form.inboundOwnerStrategy === "individual" && (
                <div className="mt-3">
                  <Select
                    value={form.inboundOwnerUserId ? String(form.inboundOwnerUserId) : ""}
                    onChange={(v) => setField("inboundOwnerUserId", v ? Number(v) : null)}
                    options={[
                      { value: "", label: "Pick a recruiter" },
                      ...users
                        .filter((u) => form.recruiterIds.includes(u.id))
                        .map((u) => ({ value: String(u.id), label: u.name })),
                    ]}
                  />
                </div>
              )}
            </RadioCard>
            <RadioCard
              checked={form.inboundOwnerStrategy === "none"}
              onClick={() => setField("inboundOwnerStrategy", "none")}
              title="Do not assign owner"
              desc="Candidates will not be automatically assigned to any recruiter as their owner."
            />
          </div>
        </div>

        <div className="mt-6">
          <SectionTitle small>Hiring Managers</SectionTitle>
          <UserMultiPicker
            all={users}
            selected={form.hiringManagerIds}
            onChange={(ids) => setField("hiringManagerIds", ids)}
            placeholder="Add hiring manager"
          />
        </div>

        <div className="mt-6">
          <SectionTitle small>Interview panel members</SectionTitle>
          <UserMultiPicker
            all={users}
            selected={form.interviewerIds}
            onChange={(ids) => setField("interviewerIds", ids)}
            placeholder="Add panel member"
          />
        </div>
      </SectionCard>

      <div className="space-y-5">
        <SectionCard>
          <SectionTitle>Accessibility &amp; notification</SectionTitle>
          <div className="space-y-2.5">
            <ToggleRow
              checked={form.recruitersAccessOwnOnly}
              onChange={(b) => setField("recruitersAccessOwnOnly", b)}
              label="Recruiters can only access candidates sourced/owned by them"
            />
            <ToggleRow
              checked={form.interviewersAccessOwnOnly}
              onChange={(b) => setField("interviewersAccessOwnOnly", b)}
              label="Interviewers can only access profile of their interviewees"
            />
            <ToggleRow
              checked={form.notifyRecruiterOnNewCandidate}
              onChange={(b) => setField("notifyRecruiterOnNewCandidate", b)}
              label="Notify recruiter when new candidate is added to job"
            />
            <ToggleRow
              checked={form.notifyHiringMgrOnNewCandidate}
              onChange={(b) => setField("notifyHiringMgrOnNewCandidate", b)}
              label="Notify hiring manager when new candidate is added to job"
            />
          </div>
        </SectionCard>

        <SectionCard>
          <SectionTitle>Interview feedback visibility</SectionTitle>
          <div className="mb-3 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-[11.5px] text-[#1d4ed8]">
            Global admin, super recruiter and recruiters of this job can view everyone's feedback.
          </div>
          <div className="space-y-2">
            <RadioCard
              checked={form.interviewFeedbackVisibility === "open"}
              onClick={() => setField("interviewFeedbackVisibility", "open")}
              title="Open"
              desc="Interviewers can view feedback from others only after they have submitted their own"
            />
            <RadioCard
              checked={form.interviewFeedbackVisibility === "restricted"}
              onClick={() => setField("interviewFeedbackVisibility", "restricted")}
              title="Restricted"
              desc="Interviewers can view feedbacks given in previous & current stages, but not next stages"
            />
            <RadioCard
              checked={form.interviewFeedbackVisibility === "private"}
              onClick={() => setField("interviewFeedbackVisibility", "private")}
              title="Private"
              desc="Interviewers can only view their own feedback"
            />
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// ── Step 4: Application Form (custom screening questions) ────────────
//
// Lets HR add per-job questions the candidate fills out on /jobs/apply.
// Each question is a small editable card: text, type, required toggle,
// and (for multiple_choice) an option list. New questions are appended
// to the end with a friendly "Add a question" CTA.
//
// Question types map 1:1 with the API contract in
// /api/hr/hiring/jobs/[id]/questions/route.ts ALLOWED_TYPES.

const QUESTION_TYPES: Array<{ value: QuestionType; label: string; hint: string; Icon: any }> = [
  { value: "short_text",      label: "Short answer",   hint: "Single-line text",     Icon: Type        },
  { value: "long_text",       label: "Long answer",    hint: "Paragraph response",   Icon: AlignLeft   },
  { value: "yes_no",          label: "Yes / No",       hint: "Two-option toggle",    Icon: ToggleRight },
  { value: "multiple_choice", label: "Multiple choice", hint: "Pick one from a list", Icon: List        },
  { value: "number",          label: "Number",         hint: "Numeric input",        Icon: Hash        },
  { value: "date",            label: "Date",           hint: "Calendar picker",      Icon: CalendarDays },
  { value: "file",            label: "File upload",    hint: "Optional attachment",  Icon: Paperclip   },
];

function newQuestionId() {
  return `q-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function Step4Questions({
  form, setField,
}: {
  form: WizardForm;
  setField: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const questions = form.questions;

  const update = (next: WizardQuestion[]) => setField("questions", next);

  const add = () => {
    const blank: WizardQuestion = {
      _localId: newQuestionId(),
      text: "",
      type: "short_text",
      required: false,
      options: [],
    };
    update([...questions, blank]);
    setEditingId(blank._localId);
  };

  const remove = (id: string) => {
    if (!confirm("Delete this question?")) return;
    update(questions.filter((q) => q._localId !== id));
    if (editingId === id) setEditingId(null);
  };

  const move = (id: string, dir: -1 | 1) => {
    const i = questions.findIndex((q) => q._localId === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };

  const patch = (id: string, change: Partial<WizardQuestion>) => {
    update(questions.map((q) => (q._localId === id ? { ...q, ...change } : q)));
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-12">
      <SectionCard>
        <SectionTitle>Application form questions</SectionTitle>
        <p className="text-[12px] text-slate-500 -mt-3 mb-4">
          Add custom questions candidates fill in alongside their resume. Optional — leave empty to use the default fields only.
        </p>
        {questions.length === 0 ? (
          <button
            type="button"
            onClick={add}
            className="w-full rounded-xl border-2 border-dashed border-slate-200 hover:border-[#3b82f6]/50 bg-slate-50/40 hover:bg-[#3b82f6]/[0.04] transition-colors px-5 py-8 text-center group"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#3b82f6]/10 text-[#3b82f6] mb-2 group-hover:scale-105 transition-transform">
              <Plus size={18} />
            </span>
            <p className="text-[13.5px] font-semibold text-slate-800">Add your first question</p>
            <p className="mt-1 text-[12px] text-slate-500 max-w-xs mx-auto">
              e.g. "Why do you want to work at NB Media?" or "Are you comfortable with night shifts?"
            </p>
          </button>
        ) : (
          <div className="space-y-3">
            {questions.map((q, idx) => (
              <QuestionCard
                key={q._localId}
                index={idx}
                total={questions.length}
                question={q}
                editing={editingId === q._localId}
                onEdit={() => setEditingId(q._localId)}
                onDone={() => setEditingId(null)}
                onPatch={(change) => patch(q._localId, change)}
                onDelete={() => remove(q._localId)}
                onMove={(dir) => move(q._localId, dir)}
              />
            ))}
            <button
              type="button"
              onClick={add}
              className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl border-2 border-dashed border-slate-200 hover:border-[#3b82f6]/50 hover:bg-[#3b82f6]/[0.04] text-[#3b82f6] text-[13px] font-semibold transition-colors"
            >
              <Plus size={15} /> Add another question
            </button>
          </div>
        )}
      </SectionCard>

      <p className="text-[11.5px] text-slate-400 text-center px-4">
        Tip: ordinary fields like Resume, Email, Experience, and Skills are always asked — you don't need to add them here.
      </p>
    </div>
  );
}

function QuestionCard({
  index, total, question, editing,
  onEdit, onDone, onPatch, onDelete, onMove,
}: {
  index: number;
  total: number;
  question: WizardQuestion;
  editing: boolean;
  onEdit:   () => void;
  onDone:   () => void;
  onPatch:  (change: Partial<WizardQuestion>) => void;
  onDelete: () => void;
  onMove:   (dir: -1 | 1) => void;
}) {
  const typeMeta = QUESTION_TYPES.find((t) => t.value === question.type) ?? QUESTION_TYPES[0];
  const TypeIcon = typeMeta.Icon;
  const previewText = question.text.trim() || <span className="italic text-slate-400">Untitled question</span>;

  return (
    <div className={`rounded-xl border ${editing ? "border-[#3b82f6] bg-[#3b82f6]/[0.03] shadow-[0_4px_18px_-6px_rgba(59,130,246,0.25)]" : "border-slate-200 bg-white hover:border-slate-300"} transition-colors`}>
      {/* Header strip — always visible. Click to expand. */}
      <div className="px-4 py-3 flex items-center gap-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500 shrink-0 text-[11px] font-bold tabular-nums">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-slate-800 truncate">{previewText}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 inline-flex items-center gap-1.5">
            <TypeIcon size={11} /> {typeMeta.label}
            {question.required && <><span className="text-slate-300">·</span><span className="text-rose-600 font-semibold">Required</span></>}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Move up"
          ><ArrowUp size={13} /></button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Move down"
          ><ArrowDown size={13} /></button>
          <button
            type="button"
            onClick={editing ? onDone : onEdit}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-[#3b82f6] hover:bg-slate-100"
            aria-label={editing ? "Done" : "Edit"}
          >{editing ? <Check size={14} /> : <Pencil size={13} />}</button>
          <button
            type="button"
            onClick={onDelete}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"
            aria-label="Delete"
          ><Trash2 size={13} /></button>
        </div>
      </div>

      {/* Editor — expanded when editing. */}
      {editing && (
        <div className="border-t border-slate-200/80 px-4 py-4 space-y-4">
          {/* Question text */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Question</label>
            <textarea
              value={question.text}
              onChange={(e) => onPatch({ text: e.target.value })}
              rows={2}
              autoFocus
              placeholder="e.g. Why are you a good fit for this role?"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 resize-none"
            />
          </div>

          {/* Answer type — pill grid */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Answer type</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {QUESTION_TYPES.map((t) => {
                const Icon = t.Icon;
                const active = question.type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => {
                      const change: Partial<WizardQuestion> = { type: t.value };
                      // Seed two blank options when switching to MC
                      // so the editor has something to render.
                      if (t.value === "multiple_choice" && question.options.length < 2) {
                        change.options = ["", ""];
                      }
                      onPatch(change);
                    }}
                    className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border transition-colors text-[12px] font-semibold ${
                      active
                        ? "border-[#3b82f6] bg-[#3b82f6]/10 text-[#1d4ed8]"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <Icon size={15} className={active ? "text-[#3b82f6]" : "text-slate-400"} />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Multiple-choice options */}
          {question.type === "multiple_choice" && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Options</label>
              <div className="space-y-2">
                {question.options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 tabular-nums w-5">{i + 1}.</span>
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => {
                        const next = [...question.options];
                        next[i] = e.target.value;
                        onPatch({ options: next });
                      }}
                      placeholder={`Option ${i + 1}`}
                      className="flex-1 h-9 px-3 rounded-md border border-slate-200 text-[13px] focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15"
                    />
                    <button
                      type="button"
                      onClick={() => onPatch({ options: question.options.filter((_, j) => j !== i) })}
                      disabled={question.options.length <= 2}
                      className="h-9 w-9 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Remove option"
                    ><Trash2 size={13} /></button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => onPatch({ options: [...question.options, ""] })}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-semibold text-[#3b82f6] hover:bg-[#3b82f6]/10"
                ><Plus size={12} /> Add option</button>
              </div>
            </div>
          )}

          {/* Required toggle */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={question.required}
              onChange={(e) => onPatch({ required: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 accent-[#3b82f6]"
            />
            <span className="text-[12.5px] text-slate-700">Required — candidates must answer to submit</span>
          </label>
        </div>
      )}
    </div>
  );
}

// ── Step 5: Publish Options ───────────────────────────────────────────

function Step5Publish({
  form, setField,
}: {
  form: WizardForm;
  setField: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
}) {
  const toggleChannel = (key: string) => {
    setField(
      "publishChannels",
      form.publishChannels.includes(key)
        ? form.publishChannels.filter((c) => c !== key)
        : [...form.publishChannels, key],
    );
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-5">
        <SectionCard>
          <SectionTitle>Where should this job be posted?</SectionTitle>
          <div className="space-y-2">
            {CHANNELS.map((c) => (
              <button
                key={c.key}
                onClick={() => toggleChannel(c.key)}
                className={`w-full text-left flex items-start gap-3 px-4 py-3 rounded-xl border transition-colors ${
                  form.publishChannels.includes(c.key)
                    ? "border-[#3b82f6] bg-blue-50/40"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <span className={`mt-0.5 h-4 w-4 inline-flex items-center justify-center rounded border-2 shrink-0 ${
                  form.publishChannels.includes(c.key)
                    ? "bg-[#3b82f6] border-[#3b82f6] text-white"
                    : "border-slate-300"
                }`}>
                  {form.publishChannels.includes(c.key) && <Check size={11} />}
                </span>
                <span>
                  <p className="text-[13px] font-semibold text-slate-900">{c.label}</p>
                  <p className="text-[11.5px] text-slate-500 mt-0.5">{c.desc}</p>
                </span>
              </button>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard>
        <SectionTitle>Ready to publish?</SectionTitle>
        <dl className="text-[12.5px] space-y-2">
          <SummaryLine label="Title"        value={form.title} />
          <SummaryLine label="Business unit" value={form.brand === "yt_labs" ? "YT Labs" : "NB Media"} />
          <SummaryLine label="Department"   value={form.department} />
          <SummaryLine label="Job type"     value={form.employmentType} />
          <SummaryLine label="Experience"   value={form.experienceLevel} />
          <SummaryLine label="Locations"    value={form.locations.filter((l) => l.name).map((l) => `${l.name} (${l.positions})`).join(", ")} />
          <SummaryLine label="Package" value={
            form.salaryRange.trim()
              ? `${form.currency} ${form.salaryRange.trim()} ${form.salaryUnit === "lpa" ? "LPA" : "Monthly"}`
              : "—"
          } />
          <SummaryLine label="Recruiters"   value={String(form.recruiterIds.length || "—")} />
          <SummaryLine label="Hiring managers" value={String(form.hiringManagerIds.length || "—")} />
        </dl>
        <p className="mt-4 text-[11.5px] text-slate-500 leading-relaxed">
          <strong>Save Draft</strong> stores everything but keeps the job hidden from candidates.
          <strong className="text-emerald-700"> Publish</strong> immediately makes it live on the selected channels.
        </p>
      </SectionCard>
    </div>
  );
}

// ── Shared form scaffolding ───────────────────────────────────────────

function SectionCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">{children}</div>;
}
function SectionTitle({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <h3 className={`${small ? "text-[12.5px]" : "text-[14.5px]"} font-semibold text-slate-900 flex items-center`}>{children}</h3>;
}
function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{children}</div>;
}
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
// Custom combobox — replaces native <datalist> which Chrome renders
// with the OS theme (often dark) and ignores all styling. Shows the
// option list in a styled popover under the input, filters as you
// type, supports keyboard navigation, and accepts free text so HR
// can enter values not in the suggestion list.
function Combobox({
  value, onChange, options, placeholder, compact,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  compact?: boolean;
}) {
  const [open, setOpen]   = useState(false);
  const [hover, setHover] = useState(0);
  const ref     = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Position of the portaled dropdown — recomputed each open + on
  // scroll / resize so it tracks the input even inside scrolling
  // wizard panes.
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const update = () => {
      const r = ref.current!.getBoundingClientRect();
      setCoords({ top: r.bottom + 6, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const q = value.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return options;
    // If the typed value already exactly matches an option, the user
    // has finished picking — show the full list so they can switch
    // to a different option without clearing first.
    if (options.some((o) => o.toLowerCase() === q)) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, q]);

  // True when the typed value isn't one of the existing options — we
  // surface a clickable "+ Use 'X' as custom" entry so users know they
  // can pick something outside the suggested list (HR roles + departments
  // grow over time and the dropdown is just a hint, not a constraint).
  const isCustom = !!value.trim() && !options.some((o) => o.toLowerCase() === q);

  // Keep hovered option in view as the user arrows through the list.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-i="${hover}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [hover, open]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault(); setOpen(true);
      setHover((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHover((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      if (open && filtered[hover]) { e.preventDefault(); onChange(filtered[hover]); setOpen(false); }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const h = compact ? "h-9" : "h-10";
  const txt = compact ? "text-[12.5px]" : "text-[13px]";

  return (
    <div ref={ref} className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHover(0); }}
        onFocus={() => { setOpen(true); setHover(0); }}
        onKeyDown={onKey}
        placeholder={placeholder}
        className={`w-full ${h} pl-3 pr-8 rounded-lg border border-slate-200 bg-white ${txt} focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]`}
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        tabIndex={-1}
        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-700"
        aria-label="Toggle list"
      >
        <ChevronRight size={13} className={`transition-transform ${open ? "rotate-[270deg]" : "rotate-90"}`} />
      </button>

      {/* Dropdown is portaled to <body> so parent containers with
          overflow:hidden / overflow:auto don't clip it. */}
      {mounted && open && coords && (filtered.length > 0 || isCustom) && createPortal(
        <div
          ref={listRef}
          style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width }}
          className="z-[1000] max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-[0_10px_30px_-6px_rgba(15,23,42,0.18)] py-1"
        >
          {/* "+ Use 'X' as custom" — explicit affordance so users know
              the typed value works even when it isn't in the suggestion
              list. Sits at the top so it's the first thing they see
              after typing a new title / department. */}
          {isCustom && (
            <button
              type="button"
              onClick={() => { onChange(value.trim()); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-[12.5px] text-emerald-700 hover:bg-emerald-50 border-b border-slate-100 inline-flex items-center gap-2 font-medium"
            >
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold leading-none">+</span>
              Use <span className="font-semibold">"{value.trim()}"</span> as custom
            </button>
          )}
          {filtered.map((o, i) => (
            <button
              key={o}
              type="button"
              data-i={i}
              onMouseEnter={() => setHover(i)}
              onClick={() => { onChange(o); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-[12.5px] transition-colors ${
                i === hover
                  ? "bg-blue-50 text-[#1d4ed8] font-semibold"
                  : value.trim() && o === value
                    ? "text-[#1d4ed8] font-semibold"
                    : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              {o}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

function Select({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none w-full h-10 pl-3.5 pr-9 rounded-lg border border-slate-200 bg-white text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronRight size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none rotate-90" />
    </div>
  );
}
function RadioPills({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex p-1 rounded-lg border border-slate-200 bg-white">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`h-8 px-3 rounded text-[12px] font-semibold transition-colors ${
            value === o.value ? "bg-[#3b82f6] text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
          }`}
        >{o.label}</button>
      ))}
    </div>
  );
}
function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // Custom theme-consistent calendar — never the native <input
  // type="date"> which renders with whatever OS theme the user has.
  return <DateField value={value} onChange={onChange} compact />;
}
function CheckboxRow({
  checked, onChange, label, trailing,
}: { checked: boolean; onChange: (b: boolean) => void; label: string; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <label className="inline-flex items-center gap-2.5 text-[13px] text-slate-700 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 accent-[#3b82f6]"
        />
        {label}
      </label>
      {trailing}
    </div>
  );
}
function ToggleRow({ checked, onChange, label }: { checked: boolean; onChange: (b: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-3 py-1.5 text-left"
    >
      <span className="text-[12.5px] text-slate-700">{label}</span>
      <span
        className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${
          checked ? "bg-[#3b82f6]" : "bg-slate-200"
        }`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`} />
      </span>
    </button>
  );
}
function RadioCard({
  checked, onClick, title, desc, children,
}: { checked: boolean; onClick: () => void; title: string; desc: string; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
        checked ? "border-[#3b82f6] bg-blue-50/40" : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 inline-flex items-center justify-center ${
          checked ? "border-[#3b82f6]" : "border-slate-300"
        }`}>
          {checked && <span className="h-2 w-2 rounded-full bg-[#3b82f6]" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-slate-900">{title}</p>
          <p className="text-[11.5px] text-slate-500 mt-0.5 leading-relaxed">{desc}</p>
          {children}
        </div>
      </div>
    </button>
  );
}
function Hint({ text }: { text: string }) {
  return <span title={text} className="ml-1 inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-slate-200 text-slate-500 text-[9px] cursor-help">?</span>;
}
function SummaryLine({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800 font-medium text-right truncate">{value || "—"}</dd>
    </div>
  );
}

// ── User multi-picker ────────────────────────────────────────────────

function UserMultiPicker({
  all, selected, onChange, placeholder,
}: {
  all: UserRow[];
  selected: number[];
  onChange: (ids: number[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ]       = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const selectedUsers = all.filter((u) => selected.includes(u.id));
  const filtered = q.trim()
    ? all.filter((u) =>
        (u.name ?? "").toLowerCase().includes(q.toLowerCase()) ||
        (u.email ?? "").toLowerCase().includes(q.toLowerCase()))
        .filter((u) => !selected.includes(u.id))
    : all.filter((u) => !selected.includes(u.id)).slice(0, 30);

  return (
    <div ref={ref} className="relative">
      <div className="flex flex-wrap gap-1.5 mb-2">
        {selectedUsers.map((u) => (
          <span key={u.id} className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-full bg-blue-50 text-[#1d4ed8] text-[11.5px] font-semibold ring-1 ring-[#3b82f6]/20">
            {u.name}
            <button
              onClick={() => onChange(selected.filter((id) => id !== u.id))}
              className="inline-flex items-center justify-center h-5 w-5 rounded-full hover:bg-[#3b82f6]/20"
            ><X size={11} /></button>
          </span>
        ))}
      </div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-dashed border-slate-300 text-[12.5px] text-slate-500 hover:border-[#3b82f6] hover:text-[#3b82f6]"
      >
        <Plus size={13} /> {placeholder}
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-xl border border-slate-200 bg-white shadow-lg p-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email"
            className="w-full h-9 px-3 rounded-lg border border-slate-200 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
          />
          <div className="mt-2 max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-[12px] text-slate-400">No users.</p>
            ) : filtered.map((u) => (
              <button
                key={u.id}
                onClick={() => { onChange([...selected, u.id]); setQ(""); }}
                className="w-full text-left flex items-center gap-2.5 px-2 py-1.5 rounded text-[12.5px] hover:bg-blue-50 hover:text-[#1d4ed8]"
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[10.5px] font-bold text-slate-600">
                  {u.name?.slice(0, 1).toUpperCase() ?? "?"}
                </span>
                <span className="min-w-0">
                  <p className="font-semibold truncate text-slate-800">{u.name}</p>
                  {u.email && <p className="text-[10.5px] text-slate-500 truncate">{u.email}</p>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
