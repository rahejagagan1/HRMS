"use client";

// HR-side "Add applicant" dialog. Used from the per-job applicant
// list (JobApplicantList) to manually source a candidate HR found
// outside the candidate-facing apply form — e.g. a referral, a
// resume forwarded over email, a LinkedIn DM, a Naukri export.
//
// UX: drop a resume PDF, pick a source from the dropdown, click
// Save. The server parses the resume to auto-fill name/email/phone
// before insert; the async backfill then populates education /
// skills / URLs in the candidate drawer. HR sees the new row on
// the next list refresh (we SWR-mutate the candidates cache).

import { useRef, useState } from "react";
import { mutate as globalMutate } from "swr";
import { X, Upload, FileText, Loader2 } from "lucide-react";

// Curated list of typical sourcing channels NB Media + YT Labs HR
// use. "direct" / "other" are catch-alls for anything that doesn't
// fit. Order is by approximate frequency so the most common picks
// (Indeed / Naukri / LinkedIn / Referral) sit at the top.
const SOURCES = [
  { value: "indeed",        label: "Indeed" },
  { value: "naukri",        label: "Naukri" },
  { value: "linkedin",      label: "LinkedIn" },
  { value: "referral",      label: "Referral" },
  { value: "career_site",   label: "Career site" },
  { value: "instagram",     label: "Instagram" },
  { value: "whatsapp",      label: "WhatsApp / Group" },
  { value: "agency",        label: "Recruitment Agency" },
  { value: "direct",        label: "Direct / Forwarded" },
  { value: "other",         label: "Other" },
] as const;

type Props = {
  jobId: number;
  jobTitle: string;
  onClose: () => void;
  onCreated?: (id: number) => void;
};

export default function AddApplicantModal({ jobId, jobTitle, onClose, onCreated }: Props) {
  const [file,       setFile]       = useState<File | null>(null);
  const [source,     setSource]     = useState<string>("naukri");
  const [fullName,   setFullName]   = useState("");
  const [email,      setEmail]      = useState("");
  const [phone,      setPhone]      = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [dragOver,   setDragOver]   = useState(false);
  // Parsing status — shows a spinner / hint under the resume drop-
  // zone so HR knows the form is fetching their values from the
  // file. Cleared when the parse completes (success or failure).
  const [parsing,    setParsing]    = useState(false);
  const [parseHint,  setParseHint]  = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pickFile = async (f: File) => {
    setError(null);
    if (f.size > 8 * 1024 * 1024) {
      setError("Resume must be 8 MB or smaller.");
      return;
    }
    setFile(f);
    // Kick off the FULL HR-side parse pipeline so HR sees the
    // parser's best result immediately:
    //   heuristic → OCR → Ollama / Llama 3.2 3B LLM fallback.
    // Different endpoint from the candidate-facing apply form
    // (/api/jobs/parse-resume) which is heuristic-only — the
    // LLM is too slow for unauthenticated public traffic but is
    // perfect for HR-admin one-off sources. Failures are
    // non-blocking — HR can still type the override fields.
    setParsing(true);
    setParseHint(null);
    try {
      const fd = new FormData();
      fd.append("resume", f);
      const res = await fetch("/api/hr/hiring/parse-resume", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      const p = j?.parsed ?? {};
      // Auto-fill ONLY when the field is currently empty so a
      // second file-pick after a manual edit doesn't clobber.
      if (p.fullName && !fullName) setFullName(p.fullName);
      if (p.email    && !email)    setEmail(p.email);
      if (p.phone    && !phone)    setPhone(p.phone);
      if (j?.warning) setParseHint(j.warning);
      else if (!p.fullName && !p.email && !p.phone) {
        setParseHint("Couldn't read the resume — please fill in the override fields manually.");
      }
    } catch {
      setParseHint("Couldn't reach the parser — please fill in the override fields manually.");
    } finally {
      setParsing(false);
    }
  };

  const submit = async () => {
    if (!file) { setError("Pick a resume to continue."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("jobOpeningId", String(jobId));
      fd.append("source", source);
      fd.append("resume", file);
      if (fullName.trim()) fd.append("fullName", fullName.trim());
      if (email.trim())    fd.append("email",    email.trim());
      if (phone.trim())    fd.append("phone",    phone.trim());

      const res = await fetch("/api/hr/hiring/candidates", {
        method: "POST",
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j?.error || `Add failed (${res.status})`);
        return;
      }
      // Refresh both the per-job list (CandidatesTab) and any global views
      // (HR Dashboard) that subscribe to the same SWR keys. Best-effort —
      // a mutate that throws must NOT fall through to the catch and make a
      // successfully-created candidate look like a failed add.
      try {
        await globalMutate(`/api/hr/hiring/candidates?openingId=${jobId}`);
        await globalMutate("/api/hr/hiring/candidates");
      } catch { /* refresh is best-effort */ }
      onCreated?.(j?.id);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Add failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white border-l border-slate-200 z-50 flex flex-col shadow-2xl">
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-[16px] font-semibold text-slate-900">Add applicant</h2>
            <p className="mt-0.5 text-[11.5px] text-slate-500">
              Sourcing into <span className="font-medium text-slate-700">{jobTitle}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-700 -mt-0.5 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Resume — required; drag-and-drop or click-to-pick. The
              server parses this to pre-fill name/email/phone before
              the row lands, and runs the full extractor async so
              skills / education / URLs are populated by the time
              HR opens the drawer. */}
          <div>
            <label className="block text-[11.5px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">Resume *</label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) pickFile(f);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed py-7 px-4 text-center cursor-pointer transition-colors ${
                dragOver ? "border-[#008CFF] bg-[#008CFF]/[0.04]" : file ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 hover:border-slate-300 bg-white"
              }`}
            >
              {file ? (
                <>
                  <FileText size={26} className="mx-auto text-emerald-600 mb-2" strokeWidth={1.5} />
                  <p className="text-[13px] font-semibold text-slate-800">{file.name}</p>
                  <p className="mt-0.5 text-[11.5px] text-slate-500">{(file.size / 1024).toFixed(1)} KB · click to replace</p>
                </>
              ) : (
                <>
                  <Upload size={26} className="mx-auto text-slate-400 mb-2" strokeWidth={1.5} />
                  <p className="text-[13px] font-semibold text-slate-700">Drop a resume or click to pick</p>
                  <p className="mt-0.5 text-[11.5px] text-slate-500">PDF / DOC / DOCX, up to 8 MB. We auto-fill name + email + phone from the file.</p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) pickFile(f);
                }}
              />
            </div>
            {parsing && (
              <p className="mt-2 text-[11.5px] text-slate-500 inline-flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin text-[#008CFF]" />
                Reading the resume and auto-filling name / email / phone…
              </p>
            )}
            {!parsing && parseHint && (
              <p className="mt-2 text-[11.5px] text-amber-700">{parseHint}</p>
            )}
            {!parsing && !parseHint && file && (fullName || email || phone) && (
              <p className="mt-2 text-[11.5px] text-emerald-700">
                Auto-filled from resume — review the override fields below.
              </p>
            )}
          </div>

          {/* Source — required field on the JobApplication row. */}
          <div>
            <label className="block text-[11.5px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">Source *</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full h-10 px-3 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#008CFF]"
            >
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">Where did you find this applicant? Drives source-attribution reports on the dashboard.</p>
          </div>

          {/* Manual overrides — optional. Filled defaults come from
              the resume parser server-side. */}
          <div className="pt-2 border-t border-slate-100">
            <p className="text-[11.5px] font-semibold text-slate-500 mb-2 uppercase tracking-wider">Override (optional)</p>
            <p className="text-[11px] text-slate-400 mb-3">Leave blank to use whatever the resume parser detects. Fill in if the parser misses or you want a specific value.</p>
            <div className="space-y-2.5">
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">Full name</span>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Auto-detect from resume"
                  className="w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#008CFF]"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value.toLowerCase())}
                  placeholder="Auto-detect from resume"
                  className="w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#008CFF]"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">Phone</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Auto-detect from resume"
                  className="w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#008CFF]"
                />
              </label>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-6 py-3 flex items-center justify-end gap-2 bg-white">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-9 px-4 rounded-lg border border-slate-200 hover:border-slate-300 text-[12.5px] font-semibold text-slate-700 disabled:opacity-50"
          >Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !file}
            className="h-9 px-4 rounded-lg bg-[#008CFF] hover:bg-[#0070cc] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && <Loader2 size={13} className="animate-spin" />}
            {submitting ? "Adding…" : "Add applicant"}
          </button>
        </div>
      </div>
    </>
  );
}
