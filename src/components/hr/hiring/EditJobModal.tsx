// Inline edit modal for the job detail page. Lets HR update the
// freely-editable fields (title, brand, department, location,
// employment type, experience level, salary range, vacancies,
// internal notes, closes-at) without going back through the full
// Create-Job wizard. The `description` column intentionally is
// NOT exposed — the public careers page no longer renders a short
// "About the role" summary, so HR doesn't have a reason to edit it
// inline. Existing description values stay untouched in the DB.
//
// PATCH /api/hr/hiring/jobs/[id] accepts each field independently
// and only writes the keys that are present in the body, so we
// send the whole form even though most fields didn't change. On
// success we call onSaved() — the parent triggers an SWR mutate
// to refresh the displayed details.

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Save } from "lucide-react";
import { DateField } from "@/components/ui/date-field";

const BRANDS = [
  { value: "nb_media", label: "NB Media" },
  { value: "yt_labs",  label: "YT Labs"  },
];
const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Remote", "Internship", "Contract"];
const EXPERIENCE_LEVELS = [
  "Entry-level (0-2 yrs)",
  "Mid-level (2-5 yrs)",
  "Senior (5-8 yrs)",
  "Lead (8+ yrs)",
];

export interface EditableJob {
  id: number;
  title: string;
  brand: string | null;
  department: string | null;
  location: string | null;
  employmentType: string | null;
  experienceLevel: string | null;
  salaryRange: string | null;
  vacancies: number;
  internalNotes: string | null;
  closesAt: string | null;
}

export default function EditJobModal({
  job, onClose, onSaved,
}: {
  job: EditableJob;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title:           job.title ?? "",
    brand:           job.brand ?? "nb_media",
    department:      job.department ?? "",
    location:        job.location ?? "",
    employmentType:  job.employmentType ?? "",
    experienceLevel: job.experienceLevel ?? "",
    salaryRange:     job.salaryRange ?? "",
    vacancies:       String(job.vacancies ?? 1),
    internalNotes:   job.internalNotes ?? "",
    closesAt:        job.closesAt ? job.closesAt.slice(0, 10) : "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Close on Esc; lock body scroll while open. Useful enough to be
  // worth the few lines vs. relying on bubbling clicks alone.
  const scrollLockRef = useRef("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    scrollLockRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = scrollLockRef.current;
    };
  }, [onClose]);

  function update<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSave() {
    setErr(null);
    const vac = parseInt(form.vacancies, 10);
    if (!form.title.trim()) { setErr("Title is required."); return; }
    if (!Number.isInteger(vac) || vac < 1) { setErr("Vacancies must be a positive whole number."); return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/hr/hiring/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:           form.title.trim(),
          brand:           form.brand || null,
          department:      form.department.trim() || null,
          location:        form.location.trim() || null,
          employmentType:  form.employmentType || null,
          experienceLevel: form.experienceLevel || null,
          salaryRange:     form.salaryRange.trim() || null,
          internalNotes:   form.internalNotes.trim() || null,
          vacancies:       vac,
          closesAt:        form.closesAt || null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `Save failed (${r.status})`);
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      {/* Scrim */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-[17px] font-bold text-slate-900">Edit job details</h2>
            <p className="text-[12px] text-slate-500 mt-0.5">Update package, vacancies, location and other job metadata.</p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          ><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <Field label="Job title">
            <input
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              className={INPUT}
              placeholder="e.g. Artificial Intelligence Research Specialist"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Brand">
              <select
                value={form.brand}
                onChange={(e) => update("brand", e.target.value)}
                className={INPUT}
              >
                {BRANDS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </Field>
            <Field label="Department">
              <input
                value={form.department}
                onChange={(e) => update("department", e.target.value)}
                className={INPUT}
                placeholder="e.g. AI"
              />
            </Field>
            <Field label="Location">
              <input
                value={form.location}
                onChange={(e) => update("location", e.target.value)}
                className={INPUT}
                placeholder="e.g. Mohali, Remote"
              />
            </Field>
            <Field label="Vacancies">
              <input
                type="number"
                min={1}
                value={form.vacancies}
                onChange={(e) => update("vacancies", e.target.value)}
                className={INPUT}
              />
            </Field>
            <Field label="Employment type">
              <select
                value={form.employmentType}
                onChange={(e) => update("employmentType", e.target.value)}
                className={INPUT}
              >
                <option value="">— Select —</option>
                {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Experience">
              <select
                value={form.experienceLevel}
                onChange={(e) => update("experienceLevel", e.target.value)}
                className={INPUT}
              >
                <option value="">— Select —</option>
                {EXPERIENCE_LEVELS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Salary range" hint="Free-form: ₹5-8 LPA, $80k-100k, etc.">
              <input
                value={form.salaryRange}
                onChange={(e) => update("salaryRange", e.target.value)}
                className={INPUT}
                placeholder="e.g. 5-8 LPA"
              />
            </Field>
            <Field label="Closes on" hint="Application deadline">
              <DateField
                value={form.closesAt}
                onChange={(v) => update("closesAt", v || "")}
              />
            </Field>
          </div>

          <Field label="Internal notes" hint="Only visible to HR — not shown to candidates">
            <textarea
              value={form.internalNotes}
              onChange={(e) => update("internalNotes", e.target.value)}
              rows={3}
              style={{ fontFamily: '"Times New Roman", Georgia, serif' }}
              className={`${INPUT} resize-y leading-relaxed text-[14px]`}
              placeholder="Anything the team should know about this requisition."
            />
          </Field>

          {err && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
              {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-slate-200 bg-slate-50/60">
          <button
            onClick={onClose}
            disabled={saving}
            className="inline-flex items-center justify-center h-9 px-4 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[12.5px] font-semibold disabled:opacity-50"
          >Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[12.5px] font-semibold disabled:opacity-50"
          >
            <Save size={13} /> {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const INPUT =
  "w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/30 focus:border-[#3b82f6]";

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11.5px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      {hint && <span className="ml-2 text-[11px] font-normal normal-case text-slate-400">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
