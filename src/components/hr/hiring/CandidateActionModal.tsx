"use client";

// Unified candidate-action modal — one shell, four dialog flows:
//   sendEmail / sendAssessment   → subject + body
//   scheduleInterview            → title, date, time, duration, location, note
//   updateOwner                  → searchable user picker
//
// Each flow POSTs to /api/hr/hiring/candidates/[id] via the existing
// action-based PATCH endpoint and revalidates the candidate list on
// success. Keep this file the only place these modals live — adding
// another flow means another case in the switch, not a new component.

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { showToast } from "@/components/ui/Toast";
import { fetcher } from "@/lib/swr";
import { X, Search, Mail, Calendar, ClipboardList, UserCog, Send, UserCircle2, Save, ChevronDown } from "lucide-react";
import { DateField } from "@/components/ui/date-field";
import { type HRTemplateKey, stageToTemplate } from "@/lib/email/hr-templates";
import EmailComposer, { type EmailComposerPayload } from "./EmailComposer";

export type CandidateAction =
  | "sendEmail"
  | "sendAssessment"
  | "scheduleInterview"
  | "updateOwner"
  | "editProfile";

interface Candidate {
  id: number;
  fullName: string;
  email: string;
  phone?: string | null;
  ownerName?: string | null;
  recruiterOwnerId?: number | null;
  roleTitle?: string | null;
  /** HiringStage.key — drives stage-aware template defaults. Optional
   *  so older callers that don't pass it just get the "custom" fallback. */
  currentStageKey?: string | null;
}

const TITLES: Record<CandidateAction, string> = {
  sendEmail:         "Send email",
  sendAssessment:    "Send assessment",
  scheduleInterview: "Schedule interview",
  updateOwner:       "Update owner",
  editProfile:       "Edit candidate details",
};
const ICONS: Record<CandidateAction, any> = {
  sendEmail:         Mail,
  sendAssessment:    ClipboardList,
  scheduleInterview: Calendar,
  updateOwner:       UserCog,
  editProfile:       UserCircle2,
};

export default function CandidateActionModal({
  action, candidate, onClose, onDone,
}: {
  action: CandidateAction;
  candidate: Candidate;
  onClose: () => void;
  onDone?: () => void;
}) {
  // Close on Escape so the modal is keyboard-friendly.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const Icon = ICONS[action];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-[#3b82f6]">
              <Icon size={15} />
            </span>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-slate-900 truncate">{TITLES[action]}</h3>
              <p className="text-[11.5px] text-slate-500 truncate">
                {candidate.fullName}{candidate.roleTitle ? ` · ${candidate.roleTitle}` : ""}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          ><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {action === "sendEmail"         && <EmailForm        candidate={candidate} kind="email"      onClose={onClose} onDone={onDone} />}
          {action === "sendAssessment"   && <EmailForm        candidate={candidate} kind="assessment" onClose={onClose} onDone={onDone} />}
          {action === "scheduleInterview" && <InterviewForm   candidate={candidate} onClose={onClose} onDone={onDone} />}
          {action === "updateOwner"       && <OwnerPicker     candidate={candidate} onClose={onClose} onDone={onDone} />}
          {action === "editProfile"       && <EditProfileForm candidate={candidate} onClose={onClose} onDone={onDone} />}
        </div>
      </div>
    </div>
  );
}

// ── Email form (also used for "send assessment" with prefilled body) ─

function EmailForm({
  candidate, kind, onClose, onDone,
}: {
  candidate: Candidate;
  kind: "email" | "assessment";
  onClose: () => void;
  onDone?: () => void;
}) {
  const role = candidate.roleTitle ?? "your application";

  // Default template selection — three-layer cascade:
  //   1. "Send Assessment" kebab → always Portfolio Required.
  //   2. "Send Email" + candidate has a hiring stage → stage-aware pick
  //      (e.g. Screening → Portfolio, Offer → Documents Request).
  //   3. Fallback → "custom" blank canvas for HR to draft freely.
  const defaultKey: HRTemplateKey =
    kind === "assessment"
      ? "portfolio_request"
      : stageToTemplate(candidate.currentStageKey ?? null);

  const handleSend = async (p: EmailComposerPayload) => {
    const res = await fetch(`/api/hr/hiring/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: kind === "assessment" ? "sendAssessment" : "sendEmail",
        to: p.to, subject: p.subject,
        body: p.bodyHtml,
        cc: p.cc, bcc: p.bcc,
        attachments: p.attachments.map(({ filename, contentType, contentBase64 }) =>
          ({ filename, contentType, contentBase64 })),
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error || "Couldn't send email");
    }
    globalMutate("/api/hr/hiring/candidates");
    onDone?.();
    onClose();
  };

  return (
    <div className="p-5">
      <EmailComposer
        candidateName={candidate.fullName}
        jobRole={role}
        defaultTo={candidate.email ?? ""}
        defaultTemplateKey={defaultKey}
        context={kind === "assessment" ? "assessment" : "email"}
        onCancel={onClose}
        onSend={handleSend}
      />
    </div>
  );
}

// ── Interview form ───────────────────────────────────────────────────

function InterviewForm({
  candidate, onClose, onDone,
}: {
  candidate: Candidate;
  onClose: () => void;
  onDone?: () => void;
}) {
  // Default schedule = tomorrow at 11:00 IST. Easier than asking HR
  // to pick a sane default themselves.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(11, 0, 0, 0);
  const defaultDate = tomorrow.toISOString().slice(0, 10);
  const defaultTime = "11:00";

  const [title, setTitle] = useState(`${candidate.roleTitle ?? "Hiring"} — Round 1`);
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);
  const [durationMinutes, setDuration] = useState(45);
  const [location, setLocation] = useState("");
  const [note, setNote]         = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return showToast("Title required", "error");
    if (!date || !time) return showToast("Date and time required", "error");
    const scheduledAt = new Date(`${date}T${time}`);
    if (isNaN(scheduledAt.getTime())) return showToast("Invalid date/time", "error");
    setSaving(true);
    const res = await fetch(`/api/hr/hiring/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "scheduleInterview",
        title: title.trim(),
        scheduledAt: scheduledAt.toISOString(),
        durationMinutes,
        location: location.trim() || null,
        note: note.trim() || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(j?.error || "Couldn't schedule interview", "error");
      return;
    }
    globalMutate("/api/hr/hiring/candidates");
    onDone?.();
    onClose();
  };

  return (
    <div className="p-5 space-y-3">
      <Field label="Title">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Date">
          <DateField value={date} onChange={setDate} />
        </Field>
        <Field label="Time">
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
          />
        </Field>
        <Field label="Duration (min)">
          <select
            value={durationMinutes}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
          >
            {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Location / link">
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Zoom link or On-site address"
          className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
        />
      </Field>
      <Field label="Note (optional)">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Anything the panel should know before the call"
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
        />
      </Field>
      <FormFooter
        onClose={onClose}
        onSubmit={submit}
        submitLabel={saving ? "Scheduling…" : "Schedule interview"}
        submitIcon={<Calendar size={13} />}
        disabled={saving}
      />
    </div>
  );
}

// ── Owner picker ─────────────────────────────────────────────────────

interface UserRow { id: number; name: string; email?: string; profilePictureUrl?: string | null }

function OwnerPicker({
  candidate, onClose, onDone,
}: {
  candidate: Candidate;
  onClose: () => void;
  onDone?: () => void;
}) {
  // ?all=true → include regular employees so HR can assign any user
  // as the owner, not just the HR / manager tier.
  const { data, isLoading } = useSWR<{ users?: UserRow[] } | UserRow[]>("/api/users?all=true", fetcher);
  const allUsers: UserRow[] = useMemo(() => {
    if (!data) return [];
    return Array.isArray(data) ? data : Array.isArray((data as any).users) ? (data as any).users : [];
  }, [data]);

  const [q, setQ] = useState("");
  const [saving, setSaving] = useState<number | "clear" | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return allUsers.slice(0, 80);
    return allUsers.filter((u) =>
      (u.name ?? "").toLowerCase().includes(needle) ||
      (u.email ?? "").toLowerCase().includes(needle),
    ).slice(0, 80);
  }, [allUsers, q]);

  const setOwner = async (ownerId: number | null) => {
    setSaving(ownerId == null ? "clear" : ownerId);
    const res = await fetch(`/api/hr/hiring/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setOwner", ownerId }),
    });
    setSaving(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(j?.error || "Couldn't update owner", "error");
      return;
    }
    globalMutate("/api/hr/hiring/candidates");
    onDone?.();
    onClose();
  };

  return (
    <div className="p-5">
      <Field label="Search">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name or email"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
          />
        </div>
      </Field>

      {candidate.recruiterOwnerId != null && (
        <button
          disabled={saving === "clear"}
          onClick={() => setOwner(null)}
          className="mt-3 w-full text-left px-3 py-2 rounded-lg text-[12.5px] font-semibold text-rose-600 hover:bg-rose-50"
        >
          Clear current owner ({candidate.ownerName ?? `#${candidate.recruiterOwnerId}`})
        </button>
      )}

      <div className="mt-3 max-h-[40vh] overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-100">
        {isLoading ? (
          <div className="py-8 text-center text-[12px] text-slate-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-slate-400">No matching users</div>
        ) : (
          filtered.map((u) => {
            const isCurrent = u.id === candidate.recruiterOwnerId;
            return (
              <button
                key={u.id}
                disabled={saving === u.id}
                onClick={() => setOwner(u.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                  isCurrent
                    ? "bg-blue-50/60 text-[#1d4ed8]"
                    : "hover:bg-slate-50 text-slate-800"
                }`}
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                  {u.name?.slice(0, 1).toUpperCase() ?? "?"}
                </span>
                <span className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-semibold truncate">{u.name}</p>
                  {u.email && <p className="text-[10.5px] text-slate-500 truncate">{u.email}</p>}
                </span>
                {isCurrent && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#3b82f6]">Current</span>
                )}
                {saving === u.id && (
                  <span className="text-[10.5px] text-slate-400">Saving…</span>
                )}
              </button>
            );
          })
        )}
      </div>

      <div className="mt-4 flex items-center justify-end">
        <button
          onClick={onClose}
          className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-slate-700 hover:bg-slate-100"
        >Done</button>
      </div>
    </div>
  );
}

// ── Edit profile ─────────────────────────────────────────────────────
// HR-side inline edit for the candidate's identity fields. Used when
// the resume parser mislabels someone (e.g. their cover sheet title
// gets parsed as their name) or when contact info needs correcting.

function EditProfileForm({
  candidate, onClose, onDone,
}: {
  candidate: Candidate;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [fullName, setFullName] = useState(candidate.fullName);
  const [email,    setEmail]    = useState(candidate.email);
  const [phone,    setPhone]    = useState(candidate.phone ?? "");
  const [saving,   setSaving]   = useState(false);

  const save = async () => {
    if (!fullName.trim()) return showToast("Name is required", "error");
    if (!email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      return showToast("Valid email is required", "error");
    }
    setSaving(true);
    const res = await fetch(`/api/hr/hiring/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "updateProfile",
        fullName: fullName.trim(),
        email:    email.trim(),
        phone:    phone.trim() || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(j?.error || "Couldn't save profile", "error");
      return;
    }
    globalMutate(`/api/hr/hiring/candidates/${candidate.id}`);
    globalMutate("/api/hr/hiring/candidates");
    onDone?.();
    onClose();
  };

  return (
    <div className="p-5 space-y-3">
      <p className="text-[11.5px] text-slate-500">
        Correct any wrong info parsed from the resume. Changes are logged in the candidate's activity feed.
      </p>
      <Field label="Full name">
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoFocus
          maxLength={200}
          className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
        />
      </Field>
      <Field label="Email">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value.toLowerCase())}
          className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
        />
      </Field>
      <Field label="Phone (optional)">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+91 9876543210"
          className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
        />
      </Field>
      <FormFooter
        onClose={onClose}
        onSubmit={save}
        submitLabel={saving ? "Saving…" : "Save changes"}
        submitIcon={<Save size={13} />}
        disabled={saving}
      />
    </div>
  );
}

// ── Form scaffolding ─────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function FormFooter({
  onClose, onSubmit, submitLabel, submitIcon, disabled,
}: {
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  submitIcon?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="-mx-5 -mb-5 mt-2 px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-end gap-2">
      <button
        onClick={onClose}
        className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-slate-700 hover:bg-white"
      >Cancel</button>
      <button
        onClick={onSubmit}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-slate-300 text-white text-[12.5px] font-semibold shadow-sm"
      >
        {submitIcon}{submitLabel}
      </button>
    </div>
  );
}
