"use client";

// Create-job modal — minimal, professional form. Posts to
// /api/hr/hiring/jobs then attaches an optional JD file. Flat layout
// (no decorative section headers), 2-column grid on desktop, native
// selects styled consistently across the form.

import { useState, useMemo, useRef } from "react";
import { X, Paperclip, FileText, Trash2, AlertCircle, CheckCircle2, Upload } from "lucide-react";
import { JOB_TITLES } from "@/lib/job-titles";
import { JOB_TITLES_YT_LABS } from "@/lib/job-titles-yt-labs";
import { DEPARTMENTS } from "@/lib/departments";
import { DEPARTMENTS_YT_LABS } from "@/lib/departments-yt-labs";
import { departmentForTitle } from "@/lib/job-title-department-map";
import CustomSelect from "@/components/ui/CustomSelect";

const BRAND_OPTIONS = [
  { value: "nb_media", label: "NB Media" },
  { value: "yt_labs",  label: "YT Labs" },
];
const EMPLOYMENT_TYPES = ["Full-time", "Intern"];
const LOCATIONS = ["Mohali", "Remote"];
const EXPERIENCE_LEVELS = ["Entry-level (0-2 yrs)", "Mid-level (2-5 yrs)", "Senior (5-8 yrs)", "Lead (8+ yrs)"];

export default function CreateJobModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    title: "",
    department: "",
    location: "",
    brand: "nb_media",
    employmentType: "Full-time",
    experienceLevel: "Mid-level (2-5 yrs)",
    salaryRange: "",
    vacancies: "1",
    description: "",
    internalNotes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // JD attachment — selected client-side; uploaded after the job is
  // created (we need the new job id for the upload endpoint).
  const [jdFile, setJdFile] = useState<File | null>(null);
  const jdInputRef = useRef<HTMLInputElement>(null);
  const JD_MAX_BYTES = 5 * 1024 * 1024;
  const JD_ALLOWED_EXTS = [".pdf", ".doc", ".docx", ".rtf", ".txt"];

  const titleOptions = useMemo(
    () => (form.brand === "yt_labs" ? JOB_TITLES_YT_LABS : JOB_TITLES),
    [form.brand],
  );
  const deptOptions = useMemo(
    () => (form.brand === "yt_labs" ? DEPARTMENTS_YT_LABS : DEPARTMENTS),
    [form.brand],
  );

  const pickJd = (file: File | null) => {
    if (!file) { setJdFile(null); return; }
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (!JD_ALLOWED_EXTS.includes(ext)) {
      setError("JD must be a PDF, DOC, DOCX, RTF, or TXT"); return;
    }
    if (file.size > JD_MAX_BYTES) {
      setError("JD must be 5 MB or smaller"); return;
    }
    setError("");
    setJdFile(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { setError("Job title is required"); return; }
    // JD is required — every job must have a brief that candidates
    // can download from the apply form.
    if (!jdFile) { setError("Please upload the Job Description (PDF/DOC) — it's required."); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/hr/hiring/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error || "Failed to create job");
        return;
      }
      const created = await res.json().catch(() => ({}));
      const newId: number | undefined = created?.id;
      // JD is required — fail the whole flow if the upload doesn't
      // land. The job is already in DB at this point but as a draft,
      // so HR can re-try the upload from the job detail view.
      if (newId) {
        try {
          const fd = new FormData();
          fd.append("file", jdFile!);
          const up = await fetch(`/api/hr/hiring/jobs/${newId}/jd`, { method: "POST", body: fd });
          if (!up.ok) {
            const j = await up.json().catch(() => ({}));
            setError(j?.error || "JD upload failed — open the job and try uploading again.");
            return;
          }
        } catch (err) {
          console.error("JD upload failed:", err);
          setError("JD upload failed — open the job and try uploading again.");
          return;
        }
      }
      onCreated();
    } finally { setBusy(false); }
  };

  const brandLabel = form.brand === "yt_labs" ? "YT Labs" : "NB Media";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-2xl rounded-xl bg-white shadow-2xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* Header — clean, no gradients */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[16px] font-semibold text-slate-900 tracking-tight">New job</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">Saved as draft. Publish from the Jobs list when ready.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Close"
          ><X size={15} /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
            {/* Brand & Job Title — top row, title spans 2 columns */}
            <Field label="Brand" required>
              <Select
                value={form.brand}
                onChange={(v) => {
                  const nextTitleOpts = v === "yt_labs" ? JOB_TITLES_YT_LABS : JOB_TITLES;
                  const nextDeptOpts  = v === "yt_labs" ? DEPARTMENTS_YT_LABS : DEPARTMENTS;
                  setForm((f) => ({
                    ...f,
                    brand: v,
                    title:      (nextTitleOpts as readonly string[]).includes(f.title) ? f.title : "",
                    department: (nextDeptOpts  as readonly string[]).includes(f.department) ? f.department : "",
                  }));
                }}
                options={BRAND_OPTIONS}
              />
            </Field>
            <Field label="Employment type" required>
              <Select
                value={form.employmentType}
                onChange={(v) => setForm((f) => ({ ...f, employmentType: v }))}
                options={EMPLOYMENT_TYPES.map((o) => ({ value: o, label: o }))}
              />
            </Field>

            <Field label="Job title" required full>
              <CustomSelect
                listKey={form.brand === "yt_labs" ? "jobTitle_yt_labs" : "jobTitle"}
                defaults={titleOptions as unknown as string[]}
                value={form.title}
                onChange={(v) => {
                  const guess = departmentForTitle(v, form.brand as "nb_media" | "yt_labs");
                  setForm((f) => ({
                    ...f,
                    title: v,
                    department: guess ?? f.department,
                  }));
                }}
                placeholder={`Select a job title for ${brandLabel}`}
                required
              />
            </Field>

            <Field label="Department">
              <CustomSelect
                listKey={form.brand === "yt_labs" ? "department_yt_labs" : "department"}
                defaults={deptOptions as unknown as string[]}
                value={form.department}
                onChange={(v) => setForm((f) => ({ ...f, department: v }))}
                placeholder="Select department"
              />
            </Field>

            <Field label="Location">
              <Select
                value={form.location}
                onChange={(v) => setForm((f) => ({ ...f, location: v }))}
                options={[{ value: "", label: "Select location" }, ...LOCATIONS.map((l) => ({ value: l, label: l }))]}
              />
            </Field>

            <Field label="Experience level">
              <Select
                value={form.experienceLevel}
                onChange={(v) => setForm((f) => ({ ...f, experienceLevel: v }))}
                options={EXPERIENCE_LEVELS.map((o) => ({ value: o, label: o }))}
              />
            </Field>

            <Field label="Vacancies">
              <Input
                type="number"
                min={1}
                value={form.vacancies}
                onChange={(v) => setForm((f) => ({ ...f, vacancies: v }))}
              />
            </Field>

            <Field label="Salary range" full>
              <Input
                value={form.salaryRange}
                onChange={(v) => setForm((f) => ({ ...f, salaryRange: v }))}
                placeholder="e.g. ₹8–12 LPA"
              />
            </Field>

            <Field label="Job description" full hint="What the role does and the must-haves. Candidates see this on the careers page.">
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={5}
                placeholder="Describe the role, responsibilities, and required skills…"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 resize-y leading-relaxed transition-colors"
              />
            </Field>

            <Field label="Internal notes" full hint="Hidden from candidates.">
              <textarea
                value={form.internalNotes}
                onChange={(e) => setForm((f) => ({ ...f, internalNotes: e.target.value }))}
                rows={2}
                placeholder="Budget approval status, urgency, etc."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 resize-y leading-relaxed transition-colors"
              />
            </Field>

            <Field label="Job description PDF" required full hint="Required — candidates see a Download JD button on the apply form.">
              <input
                ref={jdInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.rtf,.txt"
                onChange={(e) => pickJd(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              {!jdFile ? (
                <button
                  type="button"
                  onClick={() => jdInputRef.current?.click()}
                  className="group w-full inline-flex items-center justify-center gap-2 h-10 rounded-lg border border-dashed border-slate-300 bg-white hover:border-[#3b82f6]/60 hover:bg-[#3b82f6]/[0.03] text-[12.5px] font-medium text-slate-600 hover:text-[#3b82f6] transition-colors"
                >
                  <Upload size={13} />
                  Upload JD file
                  <span className="text-slate-400 font-normal">· PDF, DOC, DOCX up to 5 MB</span>
                </button>
              ) : (
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50">
                  <FileText size={14} className="text-[#3b82f6] flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium text-slate-800 truncate">{jdFile.name}</p>
                    <p className="text-[10.5px] text-slate-500 inline-flex items-center gap-1">
                      <CheckCircle2 size={10} className="text-emerald-500" /> Ready · {(jdFile.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => jdInputRef.current?.click()}
                    className="text-[11px] font-medium text-slate-600 hover:text-slate-900 transition-colors"
                  >Replace</button>
                  <button
                    type="button"
                    onClick={() => { setJdFile(null); if (jdInputRef.current) jdInputRef.current.value = ""; }}
                    className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    title="Remove file"
                  ><Trash2 size={12} /></button>
                </div>
              )}
            </Field>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="border-t border-rose-100 bg-rose-50 px-6 py-2.5 flex items-center gap-2 text-[12.5px] text-rose-700">
            <AlertCircle size={13} className="flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-slate-100 px-6 py-3 flex items-center justify-end gap-2 bg-slate-50/40">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[12.5px] font-semibold text-slate-700 transition-colors"
          >Cancel</button>
          <button
            type="submit"
            disabled={busy || !form.title.trim() || !jdFile}
            title={!jdFile ? "Upload the JD file to enable saving" : ""}
            className="h-9 px-5 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[12.5px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
          >
            {busy ? (
              <><span className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
            ) : (
              <>Save as draft</>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Building blocks ───────────────────────────────────────────────

function Field({ label, required, full, hint, children }: {
  label: string;
  required?: boolean;
  full?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="block text-[11.5px] font-semibold text-slate-700 mb-1.5">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{hint}</p>}
    </div>
  );
}

function Input({
  value, onChange, placeholder, type = "text", min,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  min?: number;
}) {
  return (
    <input
      type={type}
      value={value}
      min={min}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 transition-colors"
    />
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
        className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-9 text-[13px] text-slate-800 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 transition-colors"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <svg
        className="absolute right-3 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 pointer-events-none"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      ><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
    </div>
  );
}
