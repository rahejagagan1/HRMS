"use client";

// Employee Referrals — open to EVERY logged-in employee, not just
// HR. Two tabs:
//
//  • Open Jobs    — published roles where HR ticked the "referral"
//                   channel. Each card has a "Refer a candidate"
//                   button that opens a slide-in form.
//
//  • My Referrals — candidates THIS employee has referred, with
//                   the current pipeline stage so they can see
//                   their referral's progress.
//
// The refer form parses the resume server-side (heuristic + OCR +
// LLM) and auto-fills name / email / phone. Source is hardwired
// to "referral" and referredById is the session userId — set on
// the server, so the client can't spoof it.

import { useEffect, useRef, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher } from "@/lib/swr";
import { Users, UserPlus, MapPin, Briefcase, X, Upload, FileText, Loader2 } from "lucide-react";

type ReferralJob = {
  id: number;
  title: string;
  department: string | null;
  businessUnit: string | null;
  publicSlug: string | null;
  experienceLevel: string | null;
  employmentType: string | null;
  isPriority: boolean;
  locations: string;
};

type MyReferral = {
  id: number;
  fullName: string;
  email: string | null;
  createdAt: string;
  jobTitle: string;
  jobId: number;
  stageKey: string | null;
  stageLabel: string | null;
  stageKind: string | null;
  stageColor: string | null;
};

export default function ReferralsPage() {
  const [tab, setTab] = useState<"jobs" | "mine">("jobs");
  const { data: jobsData,  mutate: mutateJobs }     = useSWR<{ jobs: ReferralJob[] }>("/api/hr/jobs/referrals", fetcher);
  const { data: mineData,  mutate: mutateMine }     = useSWR<{ referrals: MyReferral[] }>("/api/hr/jobs/referrals?my=1", fetcher);
  const jobs       = jobsData?.jobs ?? [];
  const referrals  = mineData?.referrals ?? [];
  const [referFor, setReferFor] = useState<ReferralJob | null>(null);

  return (
    <div className="max-w-6xl mx-auto px-5 py-6">
      <header className="mb-5">
        <h1 className="text-[20px] font-semibold text-slate-900 flex items-center gap-2">
          <UserPlus size={20} className="text-[#008CFF]" />
          Refer & Earn
        </h1>
        <p className="mt-1 text-[13px] text-slate-500">
          Help us grow the team. Refer someone from your network and earn a referral bonus when they're hired and clear probation.
        </p>
      </header>

      {/* Tab strip */}
      <div className="border-b border-slate-200 mb-5 flex items-end gap-1">
        {([
          { key: "jobs",  label: "Open Jobs",     count: jobs.length },
          { key: "mine",  label: "My Referrals",  count: referrals.length },
        ] as const).map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5 ${
                active ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
              <span className={`inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full text-[11px] font-bold ${
                active ? "bg-[#008CFF]/15 text-[#008CFF]" : "bg-slate-200/70 text-slate-500"
              }`}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {tab === "jobs" && (
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {jobs.length === 0 && (
            <div className="col-span-full rounded-xl border border-slate-200 bg-white p-8 text-center">
              <Users size={32} className="mx-auto text-slate-300 mb-2" strokeWidth={1.5} />
              <h3 className="text-[14px] font-semibold text-slate-700">No open referral jobs right now</h3>
              <p className="mt-1 text-[12.5px] text-slate-500">
                When HR opens a role for employee referrals, it'll appear here. You'll also get an email + notification.
              </p>
            </div>
          )}
          {jobs.map((j) => {
            const brandColor = j.businessUnit === "YT Labs" ? "#d4143d" : "#008CFF";
            return (
              <div
                key={j.id}
                className={`group relative overflow-hidden rounded-2xl border bg-white transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(15,23,42,0.18)] ${
                  j.isPriority
                    ? "border-amber-200 bg-gradient-to-br from-amber-50/40 via-white to-white"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                {/* Left brand accent strip — coloured per business unit
                    so YT Labs cards stand out from NB Media at a glance. */}
                <span
                  aria-hidden
                  className="absolute left-0 top-0 bottom-0 w-1"
                  style={{ background: brandColor }}
                />

                <div className="pl-5 pr-5 py-5">
                  {/* Header row — title + priority/brand chips on the right */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      {j.department && (
                        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-1">
                          {j.department}
                        </p>
                      )}
                      <h3 className="text-[15.5px] font-semibold text-slate-900 leading-snug">
                        {j.title}
                      </h3>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      {j.isPriority && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold uppercase tracking-wider shadow-sm">
                          ★ Priority
                        </span>
                      )}
                      {j.businessUnit && (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider"
                          style={{ background: `${brandColor}15`, color: brandColor }}
                        >
                          {j.businessUnit}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Metadata chips — location / employment / experience */}
                  <div className="flex items-center gap-1.5 flex-wrap mb-4">
                    {j.locations && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100/80 text-slate-700 text-[11.5px] font-medium">
                        <MapPin size={11} className="text-slate-500" /> {j.locations}
                      </span>
                    )}
                    {j.employmentType && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100/80 text-slate-700 text-[11.5px] font-medium">
                        <Briefcase size={11} className="text-slate-500" /> {j.employmentType}
                      </span>
                    )}
                    {j.experienceLevel && (
                      <span className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100/80 text-slate-700 text-[11.5px] font-medium">
                        {j.experienceLevel}
                      </span>
                    )}
                  </div>

                  {/* Bottom action bar — View JD link + primary CTA */}
                  <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100">
                    {j.publicSlug ? (
                      <a
                        href={`/jobs/${j.publicSlug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12px] font-semibold text-slate-600 hover:text-[#008CFF] inline-flex items-center gap-1 group/jd"
                      >
                        View full JD
                        <span className="transition-transform group-hover/jd:translate-x-0.5">↗</span>
                      </a>
                    ) : <span />}
                    <button
                      type="button"
                      onClick={() => setReferFor(j)}
                      className="h-9 px-4 rounded-lg bg-[#008CFF] hover:bg-[#0070cc] active:bg-[#005ea3] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 shadow-sm transition-colors"
                    >
                      <UserPlus size={13} strokeWidth={2.25} />
                      Refer a candidate
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {tab === "mine" && (
        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          {referrals.length === 0 ? (
            <div className="p-8 text-center">
              <Users size={32} className="mx-auto text-slate-300 mb-2" strokeWidth={1.5} />
              <h3 className="text-[14px] font-semibold text-slate-700">No referrals yet</h3>
              <p className="mt-1 text-[12.5px] text-slate-500">
                Once you refer someone, they'll appear here with their current pipeline stage.
              </p>
            </div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="bg-slate-50/60 border-b border-slate-200">
                <tr className="text-left text-slate-500 uppercase text-[11px] tracking-wider">
                  <th className="px-4 py-2.5 font-semibold">Candidate</th>
                  <th className="px-4 py-2.5 font-semibold">Role</th>
                  <th className="px-4 py-2.5 font-semibold">Stage</th>
                  <th className="px-4 py-2.5 font-semibold">Referred</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/40">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{r.fullName}</p>
                      {r.email && <p className="text-[11px] text-slate-500">{r.email}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{r.jobTitle}</td>
                    <td className="px-4 py-3">
                      {r.stageLabel ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
                          style={{
                            background: r.stageColor ? `${r.stageColor}1f` : "#e2e8f0",
                            color:      r.stageColor ?? "#475569",
                          }}
                        >{r.stageLabel}</span>
                      ) : <span className="text-slate-400 text-[11px]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-[11.5px]">
                      {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {referFor && (
        <ReferModal
          job={referFor}
          onClose={() => setReferFor(null)}
          onSuccess={() => { mutateJobs(); mutateMine(); setTab("mine"); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ReferModal — slide-in drawer with resume upload + auto-fill.
// Mirrors the HR-side AddApplicantModal but submits to
// /api/hr/jobs/refer instead of /api/hr/hiring/candidates.
// ─────────────────────────────────────────────────────────────────
function ReferModal({
  job, onClose, onSuccess,
}: {
  job: ReferralJob;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [file,       setFile]       = useState<File | null>(null);
  const [fullName,   setFullName]   = useState("");
  const [email,      setEmail]      = useState("");
  const [phone,      setPhone]      = useState("");
  const [note,       setNote]       = useState("");
  const [parsing,    setParsing]    = useState(false);
  const [parseHint,  setParseHint]  = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [dragOver,   setDragOver]   = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const pickFile = async (f: File) => {
    setError(null);
    if (f.size > 8 * 1024 * 1024) {
      setError("Resume must be 8 MB or smaller.");
      return;
    }
    setFile(f);
    setParsing(true); setParseHint(null);
    try {
      const fd = new FormData();
      fd.append("resume", f);
      const res = await fetch("/api/hr/hiring/parse-resume", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      const p = j?.parsed ?? {};
      if (p.fullName && !fullName) setFullName(p.fullName);
      if (p.email    && !email)    setEmail(p.email);
      if (p.phone    && !phone)    setPhone(p.phone);
      if (j?.warning) setParseHint(j.warning);
    } catch {
      setParseHint("Couldn't read the file — please fill in the fields manually.");
    } finally { setParsing(false); }
  };

  const submit = async () => {
    if (!file) { setError("Pick a resume first."); return; }
    if (!fullName.trim() && !email.trim()) {
      setError("We need at least the candidate's name or email.");
      return;
    }
    setSubmitting(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("jobOpeningId", String(job.id));
      fd.append("resume", file);
      if (fullName.trim()) fd.append("fullName", fullName.trim());
      if (email.trim())    fd.append("email",    email.trim());
      if (phone.trim())    fd.append("phone",    phone.trim());
      if (note.trim())     fd.append("note",     note.trim());
      const res = await fetch("/api/hr/jobs/refer", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j?.error || `Submit failed (${res.status})`);
        return;
      }
      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e?.message || "Submit failed");
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white border-l border-slate-200 z-50 flex flex-col shadow-2xl">
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-[16px] font-semibold text-slate-900">Refer a candidate</h2>
            <p className="mt-0.5 text-[11.5px] text-slate-500">
              For <span className="font-medium text-slate-700">{job.title}</span>{job.businessUnit && <> · {job.businessUnit}</>}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Close" className="text-slate-400 hover:text-slate-700 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="block text-[11.5px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">Resume *</label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) pickFile(f);
              }}
              onClick={() => inputRef.current?.click()}
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
                  <p className="text-[13px] font-semibold text-slate-700">Drop the candidate's resume</p>
                  <p className="mt-0.5 text-[11.5px] text-slate-500">PDF / DOC / DOCX, up to 8 MB. We'll auto-fill the details from it.</p>
                </>
              )}
              <input
                ref={inputRef}
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
                Reading the resume…
              </p>
            )}
            {!parsing && parseHint && (
              <p className="mt-2 text-[11.5px] text-amber-700">{parseHint}</p>
            )}
            {!parsing && !parseHint && file && (fullName || email || phone) && (
              <p className="mt-2 text-[11.5px] text-emerald-700">Auto-filled — review the fields below.</p>
            )}
          </div>

          <div className="space-y-2.5 pt-1">
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">Full name *</span>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Auto-detect from resume"
                className="w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#008CFF]"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">Email *</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value.toLowerCase())}
                placeholder="candidate@example.com"
                className="w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#008CFF]"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">Phone</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91…"
                className="w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#008CFF]"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">Why are they a fit? (optional, ≤500 chars)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="Worked with them on…, strong in…, …"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white resize-none focus:outline-none focus:border-[#008CFF]"
              />
              <span className="block text-right text-[11px] text-slate-400 mt-0.5">{note.length}/500</span>
            </label>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>
          )}
        </div>

        <div className="border-t border-slate-200 px-6 py-3 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className="h-9 px-4 rounded-lg border border-slate-200 hover:border-slate-300 text-[12.5px] font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !file}
            className="h-9 px-4 rounded-lg bg-[#008CFF] hover:bg-[#0070cc] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && <Loader2 size={13} className="animate-spin" />}
            {submitting ? "Submitting…" : "Submit referral"}
          </button>
        </div>
      </div>
    </>
  );
}
