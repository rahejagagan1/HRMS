"use client";

// Upload a resume → parse via the VPS Ollama model → review the pulled
// fields → apply them to the onboarding form (steps 1-3). The form itself
// is the final review; this just saves typing.

import { useRef, useState } from "react";
import { X, UploadCloud, FileText, Loader2, Check } from "lucide-react";
import type { ResumePatch } from "@/lib/resume-parse";

const ACCEPT = ".pdf,.doc,.docx,.txt,.rtf";

const FIELD_LABELS: { key: keyof ResumePatch; label: string }[] = [
  { key: "displayName", label: "Name" },
  { key: "workEmail", label: "Email" },
  { key: "jobTitle", label: "Designation" },
  { key: "department", label: "Department" },
  { key: "gender", label: "Gender" },
  { key: "dateOfBirth", label: "Date of birth" },
];

export default function ImportResumeModal({
  open, onClose, onParsed,
}: {
  open: boolean;
  onClose: () => void;
  onParsed: (patch: ResumePatch, fileName: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ patch: ResumePatch; fileName: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const reset = () => { setFile(null); setError(null); setResult(null); setBusy(false); setDragOver(false); };
  const close = () => { if (!busy) { reset(); onClose(); } };
  const pick = (f: File | undefined) => {
    if (!f) return;
    setError(null); setResult(null);
    if (f.size > 5 * 1024 * 1024) { setError("File must be 5 MB or smaller."); return; }
    setFile(f);
  };
  const parse = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/hr/onboard/parse-resume", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j?.error || `Couldn't parse the resume (${res.status}).`); return; }
      setResult({ patch: j.patch || {}, fileName: j.fileName || file.name });
    } catch (e: any) {
      setError(e?.message || "Couldn't parse the resume.");
    } finally {
      setBusy(false);
    }
  };
  const apply = () => { if (result) { onParsed(result.patch, result.fileName); reset(); onClose(); } };

  const mobile = result?.patch.mobileNumber
    ? `${result.patch.mobileCountry || ""} ${result.patch.mobileNumber}`.trim()
    : "";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={close} />
      <div className="fixed left-1/2 top-1/2 z-50 w-[460px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">Import Resume</h3>
            <p className="mt-0.5 text-[11.5px] text-slate-500">Upload a resume — we pull the details to pre-fill the form.</p>
          </div>
          <button onClick={close} disabled={busy} aria-label="Close" className="text-slate-400 hover:text-slate-700 disabled:opacity-50"><X size={18} /></button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {!result ? (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]); }}
                onClick={() => !busy && inputRef.current?.click()}
                className={`rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${busy ? "opacity-60" : "cursor-pointer"} ${dragOver ? "border-[#008CFF] bg-[#008CFF]/[0.04]" : "border-slate-200 bg-slate-50/60 hover:border-slate-300"}`}
              >
                {file ? <FileText size={26} className="mx-auto mb-2 text-[#008CFF]" /> : <UploadCloud size={26} className="mx-auto mb-2 text-slate-300" strokeWidth={1.5} />}
                {file ? (
                  <>
                    <p className="text-[13px] font-semibold text-slate-800">{file.name}</p>
                    <p className="mt-0.5 text-[11.5px] text-slate-500">{(file.size / 1024).toFixed(0)} KB · click to replace</p>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] font-semibold text-slate-700">Drop a resume here or click to pick</p>
                    <p className="mt-0.5 text-[11.5px] text-slate-500">PDF, Word (.docx/.doc), or text · up to 5 MB</p>
                  </>
                )}
                <input ref={inputRef} type="file" accept={ACCEPT} className="hidden"
                  onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
              </div>
              {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</div>}
              <p className="text-[11px] text-slate-400">Image / scanned resumes aren&apos;t supported yet — use a text-based PDF or Word doc.</p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-700 ring-1 ring-emerald-200">
                <Check size={15} /> Details pulled from <span className="font-semibold">{result.fileName}</span>
              </div>
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                {FIELD_LABELS.map(({ key, label }) => {
                  const v = (result.patch[key] as string) || "";
                  return (
                    <div key={key} className="flex items-start justify-between gap-3 px-3 py-2">
                      <span className="text-[11.5px] font-medium text-slate-400">{label}</span>
                      <span className={`text-right text-[12.5px] ${v ? "text-slate-800" : "text-slate-300"}`}>{v || "—"}</span>
                    </div>
                  );
                })}
                <div className="flex items-start justify-between gap-3 px-3 py-2">
                  <span className="text-[11.5px] font-medium text-slate-400">Phone</span>
                  <span className={`text-right text-[12.5px] ${mobile ? "text-slate-800" : "text-slate-300"}`}>{mobile || "—"}</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400">These fill steps 1-3 — verify everything in the form before saving. Salary is never auto-filled.</p>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          {!result ? (
            <>
              <button onClick={close} disabled={busy} className="h-9 rounded-lg px-4 text-[13px] text-slate-500 hover:text-slate-800 disabled:opacity-50">Cancel</button>
              <button onClick={parse} disabled={!file || busy}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#008CFF] px-4 text-[13px] font-semibold text-white hover:bg-[#0070cc] disabled:opacity-60">
                {busy ? <><Loader2 size={14} className="animate-spin" /> Reading resume…</> : "Parse resume"}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setResult(null)} className="h-9 rounded-lg px-4 text-[13px] text-slate-500 hover:text-slate-800">Back</button>
              <button onClick={apply} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#008CFF] px-4 text-[13px] font-semibold text-white hover:bg-[#0070cc]">
                <Check size={14} /> Fill the form
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
