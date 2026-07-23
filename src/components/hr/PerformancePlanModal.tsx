"use client";

// "Place on Performance Plan" (PIP) form, opened from the profile ⋯ menu.
// Auto-fills the employee (name / designation / HRM no.) and their current
// reporting manager from the profile already loaded on the page — read-only.
// HR picks who's raising the plan via a searchable "Reported by" dropdown,
// scoped to the employee's brand (NB Media employee → only NB Media
// colleagues; YT Labs → only YT Labs). States the concern, sets the plan
// start + review dates, optionally attaches one or more files, and saves —
// which stamps the pip* columns (drives the ON PIP badge) and stores the
// attachments as EmployeeDocument rows.

import { useState, useRef } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { X, ClipboardList, Paperclip, FileText } from "lucide-react";
import SelectField from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/date-field";
import { showToast } from "@/components/ui/Toast";

export type PerformancePlanEmployee = {
  id: number;
  name: string;
  designation: string | null;
  employeeCode: string | null;
  managerName: string | null;
};

async function fileToAttachment(f: File): Promise<{ name: string; contentType: string; contentBase64: string }> {
  const buf = await f.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return { name: f.name, contentType: f.type || "application/octet-stream", contentBase64: btoa(binary) };
}

export default function PerformancePlanModal({
  open,
  onClose,
  employee,
  brand,
  defaultReportedById,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  employee: PerformancePlanEmployee;
  /** "NB Media" | "YT Labs" — scopes the Reported-by list to one brand. */
  brand: string;
  defaultReportedById?: number | null;
  onSaved?: () => void;
}) {
  const [reportedById, setReportedById] = useState<string>(
    defaultReportedById != null ? String(defaultReportedById) : "",
  );
  const [reason, setReason] = useState("");
  const [startDate, setStartDate] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  // Reported-by list, scoped to the employee's brand. YT Labs is an exact
  // match; "NB Media" is everything-not-YT-Labs (mirrors the employees API).
  const { data: empData } = useSWR<any[]>(
    open ? `/api/hr/employees?isActive=true&brand=${encodeURIComponent(brand)}` : null,
    fetcher,
  );

  if (!open) return null;

  const reportedByOpts = (empData ?? []).map((u: any) => ({ value: String(u.id), label: u.name }));

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length) setFiles((prev) => [...prev, ...picked]);
    e.target.value = ""; // reset so the same file can be re-picked after removal
  };
  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    if (!reportedById) return showToast("Select who's reporting this", "error");
    if (!reason.trim()) return showToast("Add the reason / area of concern", "error");
    setBusy(true);
    try {
      const attachments = await Promise.all(files.map(fileToAttachment));
      const res = await fetch(`/api/hr/people/${employee.id}/performance-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportedById: Number(reportedById),
          reason: reason.trim(),
          startDate: startDate || null,
          reviewDate: reviewDate || null,
          attachments,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(j?.error || "Couldn't save the plan", "error"); setBusy(false); return; }
      showToast("Employee placed on performance plan", "success");
      onSaved?.();
      onClose();
    } catch {
      showToast("Network error — try again", "error");
    }
    setBusy(false);
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <ClipboardList size={18} />
            </span>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-slate-900">Place on Performance Plan</h3>
              <p className="text-[11.5px] text-slate-500">Start a performance improvement plan for this employee.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {/* Auto-filled employee summary (read-only) */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-100">
            <ReadOnly label="Employee" value={employee.name} />
            <ReadOnly label="Designation" value={employee.designation} />
            <ReadOnly label="HRM No." value={employee.employeeCode} />
            <ReadOnly label="Reporting Manager" value={employee.managerName} />
          </div>

          {/* Reported by — searchable, scoped to the employee's brand */}
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-slate-600">Reported by</label>
            <SelectField
              value={reportedById}
              onChange={setReportedById}
              options={reportedByOpts}
              placeholder="Select employee"
            />
          </div>

          {/* Reason / concern */}
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-slate-600">Reason / area of concern</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="What performance concern is this plan addressing?"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15"
            />
          </div>

          {/* Plan dates */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-slate-600">Plan start date</label>
              <DateField value={startDate} onChange={setStartDate} className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-slate-600">Review date</label>
              <DateField value={reviewDate} onChange={setReviewDate} min={startDate || undefined} className="w-full" />
            </div>
          </div>

          {/* Attachments — one or more files */}
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-slate-600">Attachments</label>
            <input ref={fileRef} type="file" multiple onChange={onPickFiles} className="hidden" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 text-[12.5px] font-medium text-slate-600 hover:border-[#3b82f6] hover:text-[#3b82f6]"
            >
              <Paperclip size={14} /> Attach files
            </button>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${f.size}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-[12px] text-slate-700">
                      <FileText size={13} className="shrink-0 text-slate-400" />
                      <span className="truncate">{f.name}</span>
                      <span className="shrink-0 text-[11px] text-slate-400">{formatBytes(f.size)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label={`Remove ${f.name}`}
                      className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg px-4 text-[12.5px] font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-4 text-[12.5px] font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-50"
          >
            <ClipboardList size={13} /> {busy ? "Saving…" : "Place on Plan"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ReadOnly({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-medium text-slate-800">{value || "—"}</p>
    </div>
  );
}
