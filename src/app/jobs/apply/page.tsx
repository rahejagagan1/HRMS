"use client";

// Public job-application form. Lives outside the dashboard auth wall —
// rendered with no sidebar / header by LayoutShell so it can be iframed
// straight into the marketing site at https://nbmedia.co.in/careers.
//
// Field set is dynamic: pulled from /api/jobs/form-fields, which HR
// controls from the Hiring → Form Settings tab. Mandatory fields (name /
// email / job / resume) are always rendered regardless.

import React, { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { DatePicker } from "@/components/ui/date-picker";
import { DateField } from "@/components/ui/date-field";
import { CalendarField } from "@/components/ui/calendar-field";
import SelectField from "@/components/ui/SelectField";
import { fbqTrack } from "@/components/meta-pixel";
import {
  CheckCircle2, AlertCircle, User, Mail, Phone, Briefcase,
  Building2, Clock, Link as LinkIcon, FileText, Upload, X,
  Sparkles, Send, IndianRupee, MapPin,
} from "lucide-react";

// Date-picker class tuned to match the form's input height and brand
// blue focus ring so the three Day/Month/Year dropdowns sit naturally
// beside the rest of the form inputs.
const datePickerCls =
  "h-11 px-2.5 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 cursor-pointer transition-colors focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 hover:border-slate-300";

type Field = {
  fieldKey: string;
  label: string;
  fieldType: string;
  isVisible: boolean;
  isRequired: boolean;
  sortOrder: number;
  isMandatory: boolean;
};
type Opening = { id: number; title: string; department: string | null; location: string | null };

type ExperienceEntry = {
  companyName: string;
  jobTitle: string;
  currentlyWorking: boolean;
  dateOfJoining: string;
  dateOfRelieving: string;
  location: string;
};
type EducationEntry = {
  course: string;
  branch: string;
  startOfCourse: string;
  endOfCourse: string;
  university: string;
  location: string;
};
const emptyExperience: ExperienceEntry = {
  companyName: "", jobTitle: "", currentlyWorking: false,
  dateOfJoining: "", dateOfRelieving: "", location: "",
};
const emptyEducation: EducationEntry = {
  course: "", branch: "", startOfCourse: "", endOfCourse: "",
  university: "", location: "",
};

// Brand-blue (#3b82f6) — same friendlier tone used across the dashboard.
const BRAND       = "#3b82f6";
const BRAND_HOVER = "#2563eb";

const inputCls =
  "w-full h-11 pl-10 pr-3.5 bg-white border border-slate-200 rounded-lg text-[14px] text-slate-800 placeholder-slate-400 transition-colors focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 hover:border-slate-300";
const inputClsNoIcon =
  "w-full h-11 px-3.5 bg-white border border-slate-200 rounded-lg text-[14px] text-slate-800 placeholder-slate-400 transition-colors focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 hover:border-slate-300";
const textareaCls =
  "w-full px-3.5 py-3 bg-white border border-slate-200 rounded-lg text-[14px] text-slate-800 placeholder-slate-400 leading-relaxed transition-colors focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 hover:border-slate-300 resize-none";

// Per-field icon (only used for the canonical fields). Optional fields
// get a generic icon if we recognise them, otherwise no icon.
const FIELD_ICON: Record<string, any> = {
  fullName:        User,
  email:           Mail,
  phone:           Phone,
  experienceYears: Briefcase,
  currentCompany:  Building2,
  noticePeriod:    Clock,
  linkedinUrl:     LinkIcon,
  portfolioUrl:    LinkIcon,
};

// Group every visible field into a section. Mandatory hardcoded fields
// (name / email / job) live in "Personal info"; resume sits in its own
// "Documents" section at the end. Everything else gets bucketed.
const SECTION_FOR_FIELD: Record<string, "personal" | "professional" | "links" | "story"> = {
  fullName:        "personal",
  email:           "personal",
  phone:           "personal",
  jobOpeningId:    "personal",
  experienceYears: "professional",
  currentCompany:  "professional",
  noticePeriod:    "professional",
  linkedinUrl:     "links",
  portfolioUrl:    "links",
  coverLetter:     "story",
};

export default function JobApplyPage() {
  const { data: fields }   = useSWR<Field[]>("/api/jobs/form-fields", fetcher);
  const { data: openings } = useSWR<Opening[]>("/api/jobs/openings",  fetcher);

  const [form, setForm]     = useState<Record<string, string>>({});
  const [resume, setResume] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]     = useState(false);
  const [error, setError]   = useState("");
  // The role id from ?role=<id> on the URL. Drives the Job Details
  // panel so candidates see exactly what they're applying for —
  // title, brand, meta, full description, and a downloadable JD.
  const [roleId, setRoleId] = useState<number | null>(null);
  // (The Job Description download + collapsible text live on the
  // public /jobs/[slug] page now — the apply form just shows the
  // basic title + meta so the candidate knows what they're applying
  // for without duplicating the JD download.)
  // Fetch the full job whenever roleId resolves. Soft-fails — if the
  // endpoint 404s (job closed, removed, etc.), the panel just hides
  // and the candidate continues with the generic form.
  const { data: jobDetail } = useSWR<{ job: any }>(
    roleId ? `/api/jobs/${roleId}` : null,
    fetcher,
  );
  const job = jobDetail?.job;
  // Single resume control at the top of the form — drives both the
  // auto-fill (parse) and the actual file submission.
  const smartInputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [parsedFields, setParsedFields] = useState<string[]>([]); // names of fields we auto-filled, used for the success badge
  const [parseWarning, setParseWarning] = useState("");           // shown inline next to the resume so users see it
  const [skills, setSkills] = useState<string[]>([]);             // tag-style skill chips
  // Multi-file additional documents (portfolios, certificates, etc.).
  // First slot mirrors the uploaded resume so HR sees a copy there
  // automatically; the candidate can stack more on top.
  const [additionalDocs, setAdditionalDocs] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);                  // privacy-consent checkbox
  // Repeatable experience/education sub-forms — each "+ Add" appends a
  // blank entry which the candidate fills in. Serialized to JSON on
  // submit so the existing `experienceDetails` / `educationDetails`
  // text columns can hold the structured data.
  const [experiences, setExperiences] = useState<ExperienceEntry[]>([]);
  const [educations,  setEducations]  = useState<EducationEntry[]>([]);

  // Custom screening questions configured per-job by HR under
  // Hiring Setup → Application Form. Fetched once `roleId` resolves;
  // answers live in `screeningAnswers` keyed by questionId.
  type ScreeningQuestion = {
    id:       number;
    text:     string;
    type:     "short_text" | "long_text" | "yes_no" | "multiple_choice" | "number" | "date" | "file";
    options:  string[] | null;
    required: boolean;
  };
  const [screeningQuestions, setScreeningQuestions] = useState<ScreeningQuestion[]>([]);
  const [screeningAnswers,   setScreeningAnswers]   = useState<Record<number, string>>({});

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // ── Autosave (draft) ─────────────────────────────────────────
  // Persist text fields + repeatables to localStorage so candidates
  // don't lose their progress on accidental refresh / tab close.
  // Files (resume, additionalDocs) can't go to localStorage so they
  // stay in memory and must be re-picked on a fresh load — we show
  // a small "Draft restored" badge to tell the candidate what came
  // back and what didn't.
  const DRAFT_KEY = "nb-apply-draft-v1";
  const [draftRestored, setDraftRestored] = useState(false);
  // Hydrate from localStorage exactly once on mount. URL-derived
  // jobOpeningId / roleId still wins over the saved draft so
  // sharing /jobs/apply?role=N from a different role doesn't snap
  // back to the previous draft's role.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        form?: Record<string, string>;
        skills?: string[];
        experiences?: ExperienceEntry[];
        educations?: EducationEntry[];
        consent?: boolean;
      };
      if (draft.form)        setForm((cur) => ({ ...draft.form, ...cur })); // URL params win
      if (draft.skills)      setSkills(draft.skills);
      if (draft.experiences) setExperiences(draft.experiences);
      if (draft.educations)  setEducations(draft.educations);
      if (typeof draft.consent === "boolean") setConsent(draft.consent);
      setDraftRestored(true);
    } catch { /* malformed JSON — ignore and start fresh */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-select an opening if the URL carries ?role=<id>. Runs AFTER
  // the draft hydration above so a fresh ?role= overrides any
  // stale role in the draft.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const role = params.get("role");
    if (role && /^\d+$/.test(role)) {
      set("jobOpeningId", role);
      setRoleId(Number(role));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the screening question set for this job once roleId resolves.
  // Soft-fails to an empty list — the public endpoint returns
  // { questions: [] } on missing tables / unpublished jobs so the rest
  // of the form keeps working.
  useEffect(() => {
    if (!roleId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/jobs/${roleId}/questions`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        setScreeningQuestions(Array.isArray(json?.questions) ? json.questions : []);
      } catch { /* silent — questions block just won't render */ }
    })();
    return () => { cancelled = true; };
  }, [roleId]);

  // Debounced save — every change to text fields / skills / repeatable
  // sub-forms / consent persists 500ms later. Skips files (can't be
  // serialised) and skips empty drafts on first mount.
  useEffect(() => {
    const hasContent =
      Object.values(form).some((v) => v && String(v).trim().length > 0) ||
      skills.length > 0 ||
      experiences.length > 0 ||
      educations.length > 0;
    if (!hasContent) return;
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ form, skills, experiences, educations, consent }),
        );
      } catch { /* quota / private-mode — silently ignore */ }
    }, 500);
    return () => clearTimeout(t);
  }, [form, skills, experiences, educations, consent]);

  // Smart upload: parses the resume server-side and pre-fills the form.
  // Also stores the file as the actual resume submission so the candidate
  // doesn't have to upload it twice.
  const handleSmartUpload = async (file: File | null) => {
    if (!file) return;
    setError("");
    if (file.size > 5 * 1024 * 1024) { setError("Resume must be 5 MB or smaller"); return; }
    const ext = file.name.split(".").pop()?.toLowerCase();
    const ALLOWED = ["pdf", "doc", "docx", "rtf", "odt", "pages", "txt", "md", "html", "htm"];
    if (!ALLOWED.includes(ext || "")) {
      setError("Resume must be a PDF, Word, RTF, ODT, TXT, or HTML file"); return;
    }
    setResume(file);
    // Mirror the resume into the Additional Documents list so HR
    // always sees a copy there too — candidates who only attach one
    // file shouldn't have to upload it twice. Any extra files the
    // candidate later adds stack on top of this mirror.
    setAdditionalDocs((prev) => {
      // If the same file is already first, no-op; otherwise replace
      // the leading slot with the new resume.
      if (prev[0]?.name === file.name && prev[0]?.size === file.size) return prev;
      const others = prev.filter((f) => !(f.name === file.name && f.size === file.size));
      return [file, ...others];
    });
    setParsing(true);
    setParsedFields([]);
    setParseWarning("");
    try {
      const fd  = new FormData();
      fd.append("resume", file);
      const res = await fetch("/api/jobs/parse-resume", { method: "POST", body: fd });
      const data = await res.json();
      // Surface server-side parse warnings inline next to the resume
      // (visible) — much friendlier than the global error banner at the
      // bottom of the form which the candidate may never scroll to.
      if (data?.warning) setParseWarning(data.warning);
      const p = data?.parsed ?? {};
      const filled: string[] = [];
      const apply = (key: string, val: string | null | undefined, label: string) => {
        if (!val) return;
        setForm((f) => ({ ...f, [key]: String(val) }));
        filled.push(label);
      };
      apply("firstName",         p.firstName,         "First name");
      apply("middleName",        p.middleName,        "Middle name");
      apply("lastName",          p.lastName,          "Last name");
      // Build a fallback fullName for the legacy submit handler.
      if (p.firstName || p.lastName) {
        setForm((f) => ({
          ...f,
          fullName: [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ").trim(),
        }));
      }
      apply("email",             p.email,             "Email");
      apply("phone",             p.phone,             "Phone");
      apply("mobileCountryCode", p.mobileCountryCode, "Country code");
      apply("linkedinUrl",       p.linkedinUrl,       "LinkedIn URL");
      apply("portfolioUrl",      p.portfolioUrl,      "Portfolio URL");
      if (p.experienceYears != null) {
        setForm((f) => ({ ...f, experienceYears: String(p.experienceYears) }));
        filled.push("Experience");
      }
      // Education — only auto-fill when the candidate hasn't already
      // added entries by hand. Each extracted entry maps 1:1 to the
      // EducationEntry shape the form's repeatable sub-form uses.
      if (Array.isArray(p.educations) && p.educations.length > 0) {
        setEducations((prev) => {
          if (prev.length > 0) return prev;
          return p.educations.map((e: any) => ({
            course:        String(e?.course ?? ""),
            branch:        String(e?.branch ?? ""),
            startOfCourse: String(e?.startOfCourse ?? ""),
            endOfCourse:   String(e?.endOfCourse ?? ""),
            university:    String(e?.university ?? ""),
            location:      String(e?.location ?? ""),
          }));
        });
        filled.push("Education");
      }
      // Skills — extracted as a flat string[]. Push them into the
      // chip state AND mirror to form.skills (comma-separated) so the
      // existing submit-time serialization picks them up.
      if (Array.isArray(p.skills) && p.skills.length > 0) {
        setSkills((prev) => (prev.length > 0 ? prev : p.skills));
        if (skills.length === 0) {
          setForm((f) => ({ ...f, skills: (p.skills as string[]).join(", ") }));
        }
        filled.push("Skills");
      }
      setParsedFields(filled);
    } catch {
      // Non-fatal — the resume file is still attached, the candidate
      // can fill the form manually.
    } finally {
      setParsing(false);
    }
  };


  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    // Resume is mandatory — block the submit before doing any work
    // so the candidate gets immediate, scrollable feedback.
    if (!resume) {
      setError("Please upload your resume — it's required to apply.");
      // Scroll the resume upload zone into view so it's obvious where
      // the candidate needs to look.
      try { smartInputRef.current?.closest("form")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
      return;
    }
    // Enforce required screening questions before sending the request.
    const missing = screeningQuestions.find(
      (q) => q.required && !(screeningAnswers[q.id] ?? "").trim(),
    );
    if (missing) {
      setError(`Please answer the screening question: "${missing.text}"`);
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(form)) fd.append(k, v);
      fd.append("resume", resume);
      // Bundle per-job screening answers as JSON so the apply route
      // can append them to coverLetter (no new schema column needed).
      if (screeningQuestions.length > 0) {
        const payload = screeningQuestions.map((q) => ({
          questionId: q.id,
          text:       q.text,
          answer:     (screeningAnswers[q.id] ?? "").trim(),
        })).filter((a) => a.answer.length > 0);
        if (payload.length > 0) {
          fd.append("screeningAnswers", JSON.stringify(payload));
        }
      }
      // Send every selected additional doc under the same form key
      // so the server can read them via formData.getAll(). Backend
      // currently persists the first one — extra files are preserved
      // in the request payload for future multi-attachment storage.
      additionalDocs.forEach((f) => fd.append("additionalDoc", f));
      // Serialize repeatable sub-forms into the existing text columns.
      if (experiences.length > 0) {
        fd.set("experienceDetails", JSON.stringify(experiences));
      }
      if (educations.length > 0) {
        fd.set("educationDetails", JSON.stringify(educations));
      }
      // Skills already mirrored into form.skills as a comma-separated
      // string each time the chip list changes; nothing extra here.
      const res  = await fetch("/api/jobs/apply", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Submission failed");
      // Wipe the autosave draft now that the application landed —
      // we don't want the next visitor on this device to see the
      // previous candidate's data.
      try { window.localStorage.removeItem(DRAFT_KEY); } catch {}
      setDone(true);
      // Meta Pixel — a completed application is the conversion the
      // hiring ads optimise for; tag it with the role so Events
      // Manager can break results down per opening.
      const applied = openings?.find((o) => String(o.id) === form.jobOpeningId);
      fbqTrack("Lead", {
        content_name: applied?.title || "Job application",
        content_ids: form.jobOpeningId ? [form.jobOpeningId] : undefined,
        content_category: "job_application",
      });
    } catch (e: any) {
      setError(e?.message || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success state ──────────────────────────────────────────────────
  if (done) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-slate-50 flex items-center justify-center px-4 py-12">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 -left-32 h-[420px] w-[420px] rounded-full bg-emerald-300/20 blur-[120px]" />
          <div className="absolute -bottom-40 -right-32 h-[420px] w-[420px] rounded-full bg-[#3b82f6]/20 blur-[120px]" />
        </div>
        <div className="relative w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-[0_8px_24px_rgba(15,23,42,0.06)] overflow-hidden">
          <div className="flex flex-col items-center text-center px-8 py-12">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-emerald-400/30 blur-xl" />
              <div className="relative h-16 w-16 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 ring-4 ring-white">
                <CheckCircle2 size={36} strokeWidth={2.25} />
              </div>
            </div>
            <h1 className="mt-5 text-[22px] font-bold text-slate-800 tracking-tight">Application received</h1>
            <p className="mt-2 text-[13.5px] text-slate-500 leading-relaxed max-w-xs">
              Thanks for applying to NB Media. We've forwarded your details to the
              hiring team — you'll hear back if you're shortlisted.
            </p>
            <p className="mt-4 inline-flex items-center gap-1.5 text-[11.5px] text-slate-400">
              <Sparkles size={12} className="text-amber-400" />
              Watch your inbox in the next 5–7 days
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading state ──────────────────────────────────────────────────
  if (!fields || !openings) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 rounded-full border-2 border-slate-300 border-t-[#3b82f6] animate-spin" />
          <p className="text-[12.5px] text-slate-400">Loading the application form…</p>
        </div>
      </div>
    );
  }

  // ── Field setup ────────────────────────────────────────────────────
  const HARDCODED = new Set(["fullName", "email", "jobOpeningId", "resume"]);
  const optionalFields = fields
    .filter(f => f.isVisible && !HARDCODED.has(f.fieldKey))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const fieldsBySection = (section: "professional" | "links" | "story") =>
    optionalFields.filter(f => SECTION_FOR_FIELD[f.fieldKey] === section);

  const selectedRole = form.jobOpeningId
    ? openings.find(o => String(o.id) === form.jobOpeningId)
    : null;

  // ── Render a single optional field ────────────────────────────────
  const renderField = (f: Field) => {
    const Icon = FIELD_ICON[f.fieldKey];
    const hasIcon = !!Icon && f.fieldType !== "textarea";
    return (
      <div key={f.fieldKey}>
        <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
          {f.label}{f.isRequired ? <span className="text-rose-500"> *</span> : null}
        </label>
        {f.fieldType === "textarea" ? (
          <textarea
            rows={5}
            className={textareaCls}
            value={form[f.fieldKey] ?? ""}
            onChange={e => set(f.fieldKey, e.target.value)}
            required={f.isRequired}
            placeholder={
              f.fieldKey === "coverLetter"
                ? "Tell us a bit about yourself, what you're looking for, and why NB Media…"
                : ""
            }
          />
        ) : (
          <div className="relative">
            {hasIcon && (
              <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            )}
            <input
              type={f.fieldType === "number" ? "number" : f.fieldType}
              className={hasIcon ? inputCls : inputClsNoIcon}
              value={form[f.fieldKey] ?? ""}
              onChange={e => set(f.fieldKey, e.target.value)}
              required={f.isRequired}
              min={f.fieldType === "number" ? 0 : undefined}
              placeholder={placeholderFor(f.fieldKey)}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden py-6 sm:py-10 px-3 sm:px-4"
      style={{
        background:
          "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 50%, #e9edf3 100%)",
      }}
    >
      {/* ── Decorative background ───────────────────────────────────
          Light grey / off-white canvas with very subtle grid texture,
          a thin brand accent strip across the top, and faint warm
          glow blobs for depth. Decorative only — pointer-events none. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {/* Soft warm glows kept very faint so the page reads as neutral
            grey/off-white but still has subtle on-brand depth. */}
        <div className="absolute -top-40 -left-32 h-[520px] w-[520px] rounded-full bg-[#f97316]/8 blur-[140px]" />
        <div className="absolute -top-32 -right-40 h-[520px] w-[520px] rounded-full bg-[#ef4444]/7 blur-[140px]" />
        <div className="absolute -bottom-40 left-1/3 h-[520px] w-[520px] rounded-full bg-[#fbbf24]/8 blur-[140px]" />

      </div>

      <div className="relative mx-auto w-full max-w-4xl">
        {/* Card */}
        <div className="relative bg-white border-2 border-slate-300 rounded-2xl shadow-[0_10px_40px_rgba(15,23,42,0.12)] ring-1 ring-slate-900/5 overflow-hidden">
          {/* Watermark — sits behind the upper form fields. On mobile
              we shrink it heavily and push it lower so it doesn't
              dominate the cramped header area. */}
          <img
            src="/logo.png"
            alt=""
            aria-hidden="true"
            className="pointer-events-none select-none absolute inset-x-0 mx-auto top-[42%] sm:top-[38%] -translate-y-1/2 w-[160px] sm:w-[280px] max-w-[60%] sm:max-w-[48%] opacity-[0.12] sm:opacity-[0.18]"
          />

          {/* Header box — coloured banner with NB Media branding, back link,
              and page title. Uses an indigo→blue gradient with subtle
              decorative blobs so it feels professional and on-brand. */}
          <div className="relative z-10 px-4 sm:px-7 pt-5 sm:pt-6">
            <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-white via-[#f8fafc] to-[#f1f5f9] p-4 sm:p-5 shadow-[0_4px_18px_rgba(15,23,42,0.06)]">
              {/* Soft warm brand-tinted glows — kept very subtle so the
                  card reads as professional grey/white. */}
              <div aria-hidden="true" className="pointer-events-none absolute -top-12 -right-10 h-40 w-40 rounded-full bg-[#f97316]/10 blur-2xl" />
              <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-[#ef4444]/8 blur-2xl" />
              {/* Thin brand accent line at the very bottom — ties the
                  neutral header back to the NB Media palette. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px]"
                style={{
                  background:
                    "linear-gradient(90deg, #ef4444 0%, #f97316 50%, #fbbf24 100%)",
                }}
              />

              <div className="relative flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
                  <img
                    src="/logo.png"
                    alt="NB Media"
                    className="h-9 w-9 object-contain"
                  />
                </div>
                <div>
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-slate-600">NB Media · Careers</p>
                  <p className="text-[11px] text-slate-500">Application form</p>
                </div>
              </div>

              <div className="relative mt-4 h-px bg-slate-200" />

              <a
                href="https://nbmedia.co.in/careers"
                className="relative mt-4 inline-flex items-center gap-1 text-[12px] font-semibold text-[#3b82f6] hover:text-[#2563eb]"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                Back to all job openings
              </a>
              <h1 className="relative mt-2 text-[19px] sm:text-[22px] font-bold tracking-tight text-slate-800">Apply for this job</h1>
              <p className="relative mt-1 text-[12px] sm:text-[12.5px] text-slate-500">Upload your resume — we'll auto-fill the rest in seconds.</p>
            </div>
          </div>

          {/* ── Job Details panel ─────────────────────────────────
              Shows what the candidate is applying for: title, brand,
              meta chips, downloadable JD attachment (if HR uploaded
              one), and the full description in a collapsible block.
              Only renders when ?role=<id> resolved to a published job. */}
          {job && (
            <div className="relative z-10 px-4 sm:px-7 pt-4 sm:pt-5">
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                {/* Top band */}
                <div className="px-4 sm:px-5 py-4 border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#3b82f6] mb-1">
                    {job.brand === "yt_labs" ? "YT Labs" : "NB Media"} · Job details
                  </p>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <h2 className="text-[18px] font-semibold text-slate-900 tracking-tight leading-tight">{job.title}</h2>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-[12px] text-slate-600">
                        {job.department      && <span className="inline-flex items-center gap-1.5"><Building2 size={12} className="text-slate-400" /> {job.department}</span>}
                        {job.location        && <span className="inline-flex items-center gap-1.5"><MapPin size={12} className="text-slate-400" /> {job.location}</span>}
                        {job.employmentType  && <span className="inline-flex items-center gap-1.5"><Briefcase size={12} className="text-slate-400" /> {job.employmentType}</span>}
                        {job.experienceLevel && <span className="inline-flex items-center gap-1.5"><Clock size={12} className="text-slate-400" /> {job.experienceLevel}</span>}
                        {job.salaryRange     && <span className="inline-flex items-center gap-1.5"><IndianRupee size={12} className="text-slate-400" /> {job.salaryRange}</span>}
                      </div>
                    </div>
                  </div>
                </div>
                {/* JD download moved to the public job page so applicants
                    can read the brief BEFORE clicking Apply. The apply
                    form keeps job context (title, meta) but doesn't
                    duplicate the JD download button. */}
              </div>
            </div>
          )}

          <form onSubmit={onSubmit} className="relative z-10 px-4 sm:px-7 py-5 sm:py-6 space-y-5">
            {draftRestored && (
              <div className="-mb-1 inline-flex items-center gap-2 rounded-lg bg-emerald-50 ring-1 ring-emerald-200 px-3 py-1.5 text-[11.5px] font-medium text-emerald-800">
                <Sparkles size={12} className="text-emerald-600" />
                Picked up where you left off. Your previous answers are restored — please re-upload your resume.
              </div>
            )}
            {/* ── Resume upload — single canonical control. Auto-fills
                the form AND stores the file for submission. Required. */}
            <input
              ref={smartInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.rtf,.odt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,application/vnd.oasis.opendocument.text"
              onChange={(e) => handleSmartUpload(e.target.files?.[0] ?? null)}
              required
              className="hidden"
            />
            {!resume ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => smartInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") smartInputRef.current?.click(); }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleSmartUpload(e.dataTransfer.files?.[0] ?? null); }}
                className={`cursor-pointer rounded-lg border-2 border-dashed transition-colors px-5 py-5 text-center ${
                  dragOver
                    ? "border-[#3b82f6] bg-[#3b82f6]/10"
                    : "border-[#3b82f6]/40 bg-[#3b82f6]/[0.04] hover:bg-[#3b82f6]/[0.08]"
                }`}
              >
                <p className="text-[13.5px] font-bold text-[#3b82f6]">
                  Upload resume <span className="text-rose-500">*</span>
                </p>
                <p className="mt-0.5 text-[11.5px] text-slate-500">
                  Required — also auto-fills the fields below. 5MB max file size · Allowed: .pdf, .doc, .docx, .rtf, .odt
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-[#3b82f6]/40 bg-[#3b82f6]/[0.04] px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-[#3b82f6]/10 flex items-center justify-center text-[#3b82f6] shrink-0">
                    {parsing
                      ? <span className="h-4 w-4 rounded-full border-2 border-[#3b82f6]/30 border-t-[#3b82f6] animate-spin" />
                      : <FileText size={18} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-slate-800 truncate">{resume.name}</p>
                    <p className="text-[11.5px] text-slate-500 tabular-nums">{(resume.size / 1024).toFixed(0)} KB</p>
                    {parsing && <p className="mt-1 text-[12px] font-semibold text-[#1d4ed8]">Reading your resume…</p>}
                    {!parsing && parsedFields.length > 0 && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700">
                        <CheckCircle2 size={13} /> Auto-filled {parsedFields.length} fields · {parsedFields.join(" · ")}
                      </p>
                    )}
                    {!parsing && parsedFields.length === 0 && parseWarning && (
                      <p className="mt-1 inline-flex items-start gap-1 text-[12px] font-semibold text-amber-700">
                        <AlertCircle size={13} className="mt-0.5 shrink-0" />
                        <span>{parseWarning}</span>
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setResume(null); setParsedFields([]); setParseWarning(""); if (smartInputRef.current) smartInputRef.current.value = ""; }}
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            )}

            {/* ── Name row ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Plain label="First Name" required value={form.firstName ?? ""} onChange={(v) => { set("firstName", v); set("fullName", [v, form.middleName, form.lastName].filter(Boolean).join(" ")); }} />
              <Plain label="Middle Name"          value={form.middleName ?? ""} onChange={(v) => { set("middleName", v); set("fullName", [form.firstName, v, form.lastName].filter(Boolean).join(" ")); }} />
              <Plain label="Last Name"  required value={form.lastName  ?? ""} onChange={(v) => { set("lastName",  v); set("fullName", [form.firstName, form.middleName, v].filter(Boolean).join(" ")); }} />
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
                  Mobile Phone<span className="text-rose-500"> *</span>
                </label>
                <div className="flex gap-2">
                  <SelectField
                    value={form.mobileCountryCode ?? "+91"}
                    onChange={(v) => set("mobileCountryCode", v)}
                    options={["+91","+1","+44","+61","+65","+971","+86"]}
                    className="h-10 px-2 bg-white border border-slate-200 rounded-md text-[13px] text-slate-800 flex items-center justify-between gap-1 hover:border-slate-300 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 shrink-0"
                    width={90}
                  />
                  <input
                    type="tel"
                    className={inputClsNoIcon.replace("h-11", "h-10") + " min-w-0 flex-1"}
                    value={form.phone ?? ""}
                    onChange={(e) => set("phone", e.target.value)}
                    required
                    placeholder="Mobile Phone"
                  />
                </div>
              </div>
            </div>

            {/* ── Email + Gender row ───────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Plain label="Email" required type="email" value={form.email ?? ""} onChange={(v) => set("email", v)} />
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
                  Gender<span className="text-rose-500"> *</span>
                </label>
                <SelectField
                  value={form.gender ?? ""}
                  onChange={(v) => set("gender", v)}
                  options={[
                    { value: "male",              label: "Male" },
                    { value: "female",            label: "Female" },
                    { value: "other",             label: "Other" },
                    { value: "prefer_not_to_say", label: "Prefer not to say" },
                  ]}
                  placeholder="Select an option"
                  className={inputClsNoIcon.replace("h-11", "h-10") + " flex items-center justify-between gap-2 text-left"}
                />
              </div>
            </div>

            {/* ── Additional documents (optional second file) ─────────── */}
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Additional Documents</label>
              <AdditionalDocs onChange={setAdditionalDocs} files={additionalDocs} />
            </div>

            {/* ── DOB + Experience row ─────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Date of Birth</label>
                <CalendarField
                  value={form.dateOfBirth ?? ""}
                  onChange={(v) => set("dateOfBirth", v)}
                  max={new Date().toISOString().slice(0, 10)}
                  min="1925-01-01"
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Experience (in years)</label>
                <div className="flex gap-2 items-center">
                  <div className="flex-1 min-w-0 relative">
                    <input
                      type="number" min={0} max={60}
                      className={inputClsNoIcon.replace("h-11", "h-10") + " pr-14"}
                      value={form.experienceYears ?? ""}
                      onChange={(e) => set("experienceYears", e.target.value)}
                      placeholder=""
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 pointer-events-none">Years</span>
                  </div>
                  <SelectField
                    value={form.experienceMonths ?? "0"}
                    onChange={(v) => set("experienceMonths", v)}
                    options={Array.from({ length: 12 }).map((_, i) => ({ value: String(i), label: String(i) }))}
                    className="h-10 px-2 bg-white border border-slate-200 rounded-md text-[13px] text-slate-800 flex items-center justify-between gap-1 hover:border-slate-300 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 shrink-0"
                    width={70}
                  />
                  <span className="text-[12px] text-slate-500 shrink-0">Months</span>
                </div>
              </div>
            </div>

            {/* ── Salary row ───────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SalaryField
                label="Current Salary"
                amount={form.currentSalary ?? ""}
                currency={form.currentSalaryCurrency ?? "INR"}
                freq={form.currentSalaryFreq ?? "monthly"}
                onAmount={(v) => set("currentSalary", v)}
                onCurrency={(v) => set("currentSalaryCurrency", v)}
                onFreq={(v) => set("currentSalaryFreq", v)}
              />
              <SalaryField
                label="Expected Salary"
                amount={form.expectedSalary ?? ""}
                currency={form.expectedSalaryCurrency ?? "INR"}
                // Default to annual — candidates in India typically
                // quote their expected package as LPA (e.g. "10 LPA"
                // = 10,00,000/year). Defaulting to monthly was
                // causing applicants to type their annual figure
                // while leaving the unit on "Monthly", which
                // inflated the captured expectation 12x.
                freq={form.expectedSalaryFreq ?? "annual"}
                onAmount={(v) => set("expectedSalary", v)}
                onCurrency={(v) => set("expectedSalaryCurrency", v)}
                onFreq={(v) => set("expectedSalaryFreq", v)}
              />
            </div>

            {/* ── Available + Preferred Location ──────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Available To Join (in days)</label>
                <input
                  type="number" min={0} max={365}
                  className={inputClsNoIcon.replace("h-11", "h-10")}
                  value={form.availableToJoinDays ?? ""}
                  onChange={(e) => set("availableToJoinDays", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Preferred Location</label>
                <SelectField
                  value={form.preferredLocation ?? ""}
                  onChange={(v) => set("preferredLocation", v)}
                  options={["Mohali", "Remote"]}
                  placeholder="Select an option"
                  className={inputClsNoIcon.replace("h-11", "h-10") + " flex items-center justify-between gap-2 text-left"}
                />
              </div>
            </div>

            {/* ── Current Location ─────────────────────────────────────── */}
            <Plain label="Current Location" value={form.currentLocation ?? ""} onChange={(v) => set("currentLocation", v)} />

            {/* ── Hidden Applying-For dropdown — stays visible only when
                we don't already know the role from ?role=…. Keeps the
                old apply-from-listing flow working without cluttering
                the polished form. */}
            {!form.jobOpeningId && openings.length > 0 && (
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
                  Applying For<span className="text-rose-500"> *</span>
                </label>
                <SelectField
                  value={form.jobOpeningId ?? ""}
                  onChange={(v) => set("jobOpeningId", v)}
                  options={openings.map((o) => ({
                    value: String(o.id),
                    label: `${o.title}${o.department ? ` · ${o.department}` : ""}${o.location ? ` · ${o.location}` : ""}`,
                  }))}
                  placeholder="— Pick a role —"
                  className={inputClsNoIcon.replace("h-11", "h-10") + " flex items-center justify-between gap-2 text-left"}
                />
              </div>
            )}

            {/* ── Experience Details (repeatable) ──────────────────────
                Each click of "+ Add Experience Details" appends a blank
                card with company / role / dates / location. Trash icon
                removes the card. Values are serialized to JSON on submit. */}
            <div>
              <p className="text-[13px] font-bold text-slate-800 mb-2">Experience Details</p>
              <div className="space-y-3">
                {experiences.map((exp, i) => (
                  <div
                    key={`exp-${i}`}
                    className="relative rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:p-4 pr-9 sm:pr-4"
                  >
                    <button
                      type="button"
                      onClick={() => setExperiences(arr => arr.filter((_, j) => j !== i))}
                      className="absolute top-3 right-3 text-slate-400 hover:text-red-500 transition-colors"
                      aria-label="Remove experience"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                      </svg>
                    </button>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">Company Name</label>
                        <input
                          type="text"
                          className={inputClsNoIcon}
                          placeholder="Keka"
                          value={exp.companyName}
                          onChange={(e) => setExperiences(arr => arr.map((x, j) => j === i ? { ...x, companyName: e.target.value } : x))}
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">Job Title</label>
                        <input
                          type="text"
                          className={inputClsNoIcon}
                          placeholder="Product Designer"
                          value={exp.jobTitle}
                          onChange={(e) => setExperiences(arr => arr.map((x, j) => j === i ? { ...x, jobTitle: e.target.value } : x))}
                        />
                      </div>
                      <label className="sm:col-span-2 inline-flex items-center gap-2 text-[12.5px] text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={exp.currentlyWorking}
                          onChange={(e) => setExperiences(arr => arr.map((x, j) => j === i ? { ...x, currentlyWorking: e.target.checked, dateOfRelieving: e.target.checked ? "" : x.dateOfRelieving } : x))}
                          className="h-4 w-4 rounded border-slate-300 text-[#3b82f6] focus:ring-[#3b82f6]/30"
                        />
                        Currently working here
                      </label>
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">Date of Joining</label>
                        <DatePicker
                          value={exp.dateOfJoining}
                          onChange={(v) => setExperiences(arr => arr.map((x, j) => j === i ? { ...x, dateOfJoining: v } : x))}
                          className={datePickerCls}
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">Date of Relieving</label>
                        {exp.currentlyWorking ? (
                          <input
                            type="text"
                            disabled
                            value="Currently working here"
                            className={`${inputClsNoIcon} bg-slate-100 cursor-not-allowed text-slate-500 italic`}
                          />
                        ) : (
                          <DatePicker
                            value={exp.dateOfRelieving}
                            onChange={(v) => setExperiences(arr => arr.map((x, j) => j === i ? { ...x, dateOfRelieving: v } : x))}
                            className={datePickerCls}
                          />
                        )}
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">Location</label>
                        <input
                          type="text"
                          className={inputClsNoIcon}
                          placeholder="Hyderabad"
                          value={exp.location}
                          onChange={(e) => setExperiences(arr => arr.map((x, j) => j === i ? { ...x, location: e.target.value } : x))}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {experiences.length === 0 && (
                <button
                  type="button"
                  onClick={() => setExperiences([{ ...emptyExperience }])}
                  className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-[#3b82f6] hover:text-[#2563eb] transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                  Add Experience Details
                </button>
              )}
            </div>

            {/* Education Details section intentionally not rendered.
                The `educations` state still exists in the page so the
                resume parser can populate it on upload — the JSON
                payload is sent to HR via the `educationDetails`
                column at submit time. Candidates don't see a manual
                form; if their resume has degree info it shows up on
                the HR side, otherwise the field stays empty. */}

            {/* ── Skills (tag input) ───────────────────────────────────── */}
            <div>
              <p className="text-[13px] font-bold text-slate-800 mb-1.5">Skills</p>
              <SkillsInput
                value={skills}
                onChange={(arr) => { setSkills(arr); set("skills", arr.join(", ")); }}
              />
            </div>

            {/* ── Screening questions (per-job, configured by HR) ──────
                Rendered only when the job has at least one question
                attached via Hiring Setup → Application Form. Answers
                are bundled into the form payload on submit. */}
            {screeningQuestions.length > 0 && (
              <div>
                <p className="text-[13px] font-bold text-slate-800 mb-1">Screening questions</p>
                <p className="text-[11.5px] text-slate-500 mb-3">
                  A few quick questions from the hiring team.
                </p>
                <div className="space-y-4">
                  {screeningQuestions.map((q) => {
                    const value = screeningAnswers[q.id] ?? "";
                    const setVal = (v: string) =>
                      setScreeningAnswers((prev) => ({ ...prev, [q.id]: v }));
                    return (
                      <div key={q.id}>
                        <label className="block text-[12.5px] font-semibold text-slate-800 mb-1.5">
                          {q.text}
                          {q.required && <span className="text-rose-500 ml-0.5">*</span>}
                        </label>

                        {q.type === "long_text" && (
                          <textarea
                            value={value}
                            onChange={(e) => setVal(e.target.value)}
                            rows={4}
                            required={q.required}
                            placeholder="Type your answer"
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
                          />
                        )}

                        {q.type === "short_text" && (
                          <input
                            type="text"
                            value={value}
                            onChange={(e) => setVal(e.target.value)}
                            required={q.required}
                            placeholder="Type your answer"
                            className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
                          />
                        )}

                        {q.type === "number" && (
                          <input
                            type="number"
                            value={value}
                            onChange={(e) => setVal(e.target.value)}
                            required={q.required}
                            placeholder="0"
                            className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
                          />
                        )}

                        {q.type === "date" && (
                          <input
                            type="date"
                            value={value}
                            onChange={(e) => setVal(e.target.value)}
                            required={q.required}
                            className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
                          />
                        )}

                        {q.type === "yes_no" && (
                          <div className="flex items-center gap-4">
                            {(["Yes", "No"] as const).map((opt) => (
                              <label key={opt} className="inline-flex items-center gap-2 cursor-pointer text-[13px] text-slate-700">
                                <input
                                  type="radio"
                                  name={`screen_${q.id}`}
                                  value={opt}
                                  checked={value === opt}
                                  onChange={() => setVal(opt)}
                                  required={q.required}
                                  className="h-4 w-4 text-[#3b82f6] focus:ring-[#3b82f6]"
                                />
                                {opt}
                              </label>
                            ))}
                          </div>
                        )}

                        {q.type === "multiple_choice" && Array.isArray(q.options) && (
                          <div className="space-y-1.5">
                            {q.options.map((opt) => (
                              <label key={opt} className="flex items-center gap-2 cursor-pointer text-[13px] text-slate-700">
                                <input
                                  type="radio"
                                  name={`screen_${q.id}`}
                                  value={opt}
                                  checked={value === opt}
                                  onChange={() => setVal(opt)}
                                  required={q.required}
                                  className="h-4 w-4 text-[#3b82f6] focus:ring-[#3b82f6]"
                                />
                                {opt}
                              </label>
                            ))}
                          </div>
                        )}

                        {q.type === "file" && (
                          <p className="text-[11.5px] text-slate-500 italic">
                            File-type questions aren't supported in v1 — please attach the file under "Additional documents" above and mention it in another question if needed.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Privacy consent ──────────────────────────────────────── */}
            <label className="flex items-start gap-2.5 cursor-pointer text-[12px] text-slate-600 leading-relaxed">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                required
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#3b82f6] focus:ring-[#3b82f6] shrink-0"
              />
              <span>
                By applying, you hereby accept the data processing terms under the{" "}
                <a href="#" className="text-[#3b82f6] hover:underline">Privacy Policy</a> and give
                consent to processing of the data as part of this job application.
              </span>
            </label>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[12.5px] px-3 py-2.5">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !consent || !resume}
              title={!resume ? "Upload your resume to enable Apply" : (!consent ? "Accept the privacy notice to enable Apply" : "")}
              className="w-full h-11 rounded-md bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-[13.5px] font-semibold transition-colors shadow-[0_1px_2px_rgba(59,130,246,0.25)]"
            >
              {submitting ? "Submitting…" : !resume ? "Upload resume to continue" : "Apply Now"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Tiny presentational helpers ─────────────────────────────────────

function Section({
  title, subtitle, children, className = "", first = false,
}: { title: string; subtitle?: string; children: React.ReactNode; className?: string; first?: boolean }) {
  return (
    <section className={`${first ? "" : "pt-7 mt-7 border-t border-slate-100"} ${className}`}>
      <header className="mb-4 flex items-start gap-3">
        {/* Accent bar — small brand-blue stripe to anchor each section
            visually and create rhythm down the form. */}
        <span className="mt-1 h-4 w-1 rounded-full bg-[#3b82f6]" />
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-bold text-slate-800 tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12px] text-slate-500">{subtitle}</p>}
        </div>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field2({
  label, required, icon: Icon, type = "text", value, onChange, placeholder,
}: {
  label: string;
  required?: boolean;
  icon: any;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
        {label}{required ? <span className="text-rose-500"> *</span> : null}
      </label>
      <div className="relative">
        <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type={type}
          className="w-full h-11 pl-10 pr-3.5 bg-white border border-slate-200 rounded-lg text-[14px] text-slate-800 placeholder-slate-400 transition-colors focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 hover:border-slate-300"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}

// Composite salary input — currency dropdown + amount + frequency toggle.
// Used for both Current Salary and Expected Salary so the layout stays
// consistent and the candidate doesn't have to learn it twice.
function SalaryField({
  label, amount, currency, freq,
  onAmount, onCurrency, onFreq,
}: {
  label: string;
  amount: string; currency: string; freq: string;
  onAmount: (v: string) => void; onCurrency: (v: string) => void; onFreq: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">{label}</label>
      {/* Mobile: 2-row layout — currency + amount on top, frequency
          below full-width. Desktop: single inline row. Stops the
          amount input from getting squeezed into 60px on phones. */}
      <div className="flex flex-wrap gap-2">
        <SelectField
          value={currency}
          onChange={onCurrency}
          options={["INR","USD","EUR","GBP","AED","SGD"]}
          className="h-11 px-3 bg-white border border-slate-200 rounded-lg text-[13.5px] text-slate-800 flex items-center justify-between gap-1.5 hover:border-slate-300 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 shrink-0"
          width={95}
        />
        <div className="relative flex-1 min-w-[140px]">
          <IndianRupee size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="number" min={0}
            className="w-full h-11 pl-10 pr-3.5 bg-white border border-slate-200 rounded-lg text-[14px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 hover:border-slate-300 transition-colors"
            value={amount}
            onChange={(e) => onAmount(e.target.value)}
            placeholder="Amount"
          />
        </div>
        <SelectField
          value={freq}
          onChange={onFreq}
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "annual",  label: "Annual"  },
          ]}
          className="h-11 px-3 bg-white border border-slate-200 rounded-lg text-[13.5px] text-slate-800 flex items-center justify-between gap-1.5 hover:border-slate-300 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 w-full sm:w-auto"
          width={140}
        />
      </div>
    </div>
  );
}

// Plain labelled input — no icon. Used in the slim form layout where
// fields are stacked tightly without per-field iconography.
function Plain({
  label, required, type = "text", value, onChange, placeholder,
}: {
  label: string; required?: boolean; type?: string;
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
        {label}{required ? <span className="text-rose-500"> *</span> : null}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(type === "email" ? e.target.value.toLowerCase() : e.target.value)}
        required={required}
        placeholder={placeholder}
        className="w-full h-10 px-3 bg-white border border-slate-200 rounded-md text-[13.5px] text-slate-800 placeholder-slate-400 transition-colors focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 hover:border-slate-300"
      />
    </div>
  );
}

// Tag-style skills input — Enter or comma adds a chip; backspace on
// empty input removes the last chip; click × on a chip to remove it.
function SkillsInput({
  value, onChange,
}: {
  value: string[]; onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = React.useState("");
  const commit = (s: string) => {
    const t = s.trim();
    if (!t) return;
    if (value.includes(t)) { setDraft(""); return; }
    onChange([...value, t]);
    setDraft("");
  };
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 flex flex-wrap items-center gap-1.5 focus-within:border-[#3b82f6] focus-within:ring-2 focus-within:ring-[#3b82f6]/15">
      {value.map((s) => (
        <span key={s} className="inline-flex items-center gap-1 rounded-full bg-[#3b82f6]/10 text-[#1d4ed8] text-[12px] font-semibold px-2.5 py-0.5">
          {s}
          <button
            type="button"
            onClick={() => onChange(value.filter((v) => v !== s))}
            className="text-[#3b82f6] hover:text-rose-600"
            aria-label={`Remove ${s}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(draft); }
          else if (e.key === "Backspace" && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
        placeholder={value.length === 0 ? "Add new skill" : ""}
        className="flex-1 min-w-[120px] h-7 px-1 text-[13px] text-slate-800 placeholder-slate-400 bg-transparent border-none focus:outline-none"
      />
    </div>
  );
}

// "+ Add attachment" tile for the optional Additional Documents slot.
// Single file, 10 MB cap (slightly larger than the resume's 5 MB so
// Additional documents — multi-file. Candidates can stack as many
// supporting files as they want (portfolios, certificates, sample
// scripts). Each file gets its own row with a remove button, and a
// dashed "Add another" button stays visible at the bottom.
function AdditionalDocs({
  files, onChange,
}: {
  files: File[]; onChange: (next: File[]) => void;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const ALLOWED_BYTES = 10 * 1024 * 1024;

  const onPick = (incoming: FileList | null) => {
    if (!incoming) return;
    const next: File[] = [...files];
    for (const f of Array.from(incoming)) {
      if (f.size > ALLOWED_BYTES) continue;
      // Dedup by name+size so the same file isn't added twice.
      if (next.some((e) => e.name === f.name && e.size === f.size)) continue;
      next.push(f);
    }
    onChange(next);
    if (ref.current) ref.current.value = "";
  };

  const removeAt = (i: number) => {
    const next = files.slice();
    next.splice(i, 1);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <input
        ref={ref}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => onPick(e.target.files)}
      />

      {files.map((file, i) => (
        <div key={`${file.name}-${file.size}-${i}`} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2.5">
          <FileText size={16} className="text-[#3b82f6] shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-slate-800 truncate">{file.name}</p>
            <p className="text-[11px] text-slate-500 tabular-nums">{(file.size / 1024).toFixed(0)} KB</p>
          </div>
          <button
            type="button"
            onClick={() => removeAt(i)}
            className="h-7 w-7 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50"
            title="Remove this attachment"
          ><X size={14} /></button>
        </div>
      ))}

      {/* "Add attachment" always visible — even after files are
          attached — so candidates can keep stacking documents. */}
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="w-full rounded-md border-2 border-dashed border-slate-200 hover:border-[#3b82f6]/40 bg-slate-50/40 hover:bg-[#3b82f6]/[0.04] transition-colors px-4 py-3 flex items-center gap-3 text-left"
      >
        <div className="h-9 w-9 rounded-md bg-white border border-slate-200 flex items-center justify-center text-[#3b82f6]">
          <Upload size={15} />
        </div>
        <div>
          <p className="text-[12.5px] font-semibold text-[#3b82f6]">
            {files.length === 0 ? "Add attachment" : "Add another attachment"}
          </p>
          <p className="text-[10.5px] text-slate-500">10MB max per file · pick multiple at once if you want</p>
        </div>
      </button>
    </div>
  );
}

function placeholderFor(key: string): string {
  switch (key) {
    case "phone":           return "+91 98xxxxxxxx";
    case "experienceYears": return "e.g. 3";
    case "currentCompany":  return "Where do you work right now?";
    case "noticePeriod":    return "e.g. 30 days";
    case "linkedinUrl":     return "https://linkedin.com/in/yourname";
    case "portfolioUrl":    return "https://your-portfolio.com";
    default:                return "";
  }
}
