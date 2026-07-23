"use client";

// Schedule Interview — Keka-parity modal.
//
//   Three interview modes:
//     • online        — Meet/Zoom/Teams link; defaults to {{MeetingLink}}
//                       placeholder until the Google Calendar integration
//                       is wired (see GOOGLE_MEET_SETUP.md in repo root).
//     • face_to_face  — On-site; HR enters the address as the location.
//     • self_schedule — Sends the candidate a slot picker (placeholder
//                       for now — just emails a "pick a time" link).
//
// On submit:
//   1. POST /api/hr/hiring/candidates/[id] with action=scheduleInterview
//      (existing backend path — captures the Interview row + activity).
//   2. POST /api/hr/hiring/candidates/[id] with action=sendEmail to mail
//      the candidate the schedule + meeting link.
//
// The two calls are sequential because the Interview row is the
// source of truth and we want to email the candidate only after it
// lands. If the email fails the row stays — HR can resend later.

import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { showToast } from "@/components/ui/Toast";
import { fetcher } from "@/lib/swr";
import { DateField } from "@/components/ui/date-field";
import { technicalRoundEmail, finalRoundEmail, stageToInterviewRound } from "@/lib/email/hr-templates";
import EmailComposer, { type EmailComposerPayload } from "./EmailComposer";
import {
  X, Calendar, Clock, Users, Video, MapPin, Send, Eye, ChevronDown,
  Paperclip, FileText, Check,
} from "lucide-react";

type InterviewKind = "online" | "face_to_face" | "self_schedule";
type InterviewRound = "technical" | "final";

interface UserRow { id: number; name: string; email?: string }
interface Candidate {
  id: number;
  fullName: string;
  email: string;
  roleTitle: string | null;
  jobOpeningId: number;
  /** HiringStage.key — drives Round picker default (technical vs final).
   *  Optional so older callers fall back to "technical". */
  currentStageKey?: string | null;
}

const DURATIONS = [15, 30, 45, 60, 90, 120];

export default function ScheduleInterviewModal({
  candidate, defaultKind, onClose, onDone,
}: {
  candidate: Candidate;
  defaultKind?: InterviewKind;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [kind, setKind] = useState<InterviewKind>(defaultKind ?? "online");
  // Round defaults from the candidate's current hiring stage:
  //   Manager Round / Offer → "final"
  //   anything else         → "technical"
  // HR can still flip it via the Round toggle in the modal.
  const [round, setRound] = useState<InterviewRound>(stageToInterviewRound(candidate.currentStageKey));
  const [panelIds, setPanelIds] = useState<number[]>([]);
  // Default: tomorrow 10:30 AM.
  const tomorrow = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 30, 0, 0);
    return d;
  }, []);
  const [date, setDate]         = useState(tomorrow.toISOString().slice(0, 10));
  const [time, setTime]         = useState("10:30");
  const [duration, setDuration] = useState(60);
  const [title, setTitle]       = useState(`${kind === "online" ? "Online" : kind === "face_to_face" ? "On-site" : "Self-schedule"} Interview`);
  const [location, setLocation] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  // Synchronously-derived defaults — recomputed on every render so
  // the values are always fresh when EmailComposer remounts (the
  // EmailComposer is keyed on round+kind, so it remounts whenever
  // either changes). Earlier we kept subject + body in useState
  // and updated them in a useEffect, but that meant the new
  // EmailComposer mounted BEFORE the effect ran — reading STALE
  // (previous-round) values. Symptom: clicking "Technical Round"
  // produced an email whose subject/body still said "Final Round".
  // The memo dependency list keeps the result fresh without
  // wasting renders.
  const defaults = useMemo(
    () => defaultBody(candidate, kind, round, date, time, duration),
    [candidate, kind, round, date, time, duration],
  );

  const [paneTab, setPaneTab]   = useState<"email" | "note">("email");
  const [noteToPanel, setNoteToPanel] = useState("");
  const [saving, setSaving]     = useState(false);

  // Refresh the title chip when kind OR round changes — keeps the
  // visible string in sync with the active toggles.
  useEffect(() => {
    setTitle(
      `${round === "technical" ? "Technical" : "Final"} Interview — ${
        kind === "online" ? "Online" : kind === "face_to_face" ? "On-site" : "Self-schedule"
      }`,
    );
  }, [kind, round]);

  // ?all=true → include regular employees in the panel picker.
  const { data: usersData } = useSWR<{ users?: UserRow[] } | UserRow[]>("/api/users?all=true", fetcher);
  const users: UserRow[] = Array.isArray(usersData)
    ? usersData : Array.isArray((usersData as any)?.users) ? (usersData as any).users : [];

  // Used by the Note tab (schedule without sending an email).
  const scheduleOnly = async () => {
    if (!title.trim())                  return showToast("Title required", "error");
    if (!date || !time)                 return showToast("Date and time required", "error");
    const scheduledAt = new Date(`${date}T${time}`);
    if (isNaN(scheduledAt.getTime()))   return showToast("Invalid date/time", "error");
    setSaving(true);
    try {
      const r1 = await fetch(`/api/hr/hiring/candidates/${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "scheduleInterview",
          kind,
          title: title.trim(),
          scheduledAt: scheduledAt.toISOString(),
          durationMinutes: duration,
          location: kind === "online" ? (meetingLink || "{{MeetingLink}}") : location.trim() || null,
          note: noteToPanel.trim() || null,
        }),
      });
      if (!r1.ok) {
        const j = await r1.json().catch(() => ({}));
        throw new Error(j?.error || "Couldn't schedule interview");
      }
      globalMutate("/api/hr/hiring/candidates");
      onDone?.();
      onClose();
    } catch (e: any) {
      showToast(e?.message || "Failed to schedule", "error");
    } finally {
      setSaving(false);
    }
  };

  // EmailComposer drives this — runs after HR confirms the preview.
  // Schedules the interview row first (so the Meet link is minted),
  // then sends the email with the link substituted into the body.
  const scheduleAndSend = async (p: EmailComposerPayload) => {
    if (!title.trim())  throw new Error("Title required");
    if (!date || !time) throw new Error("Date and time required");
    const scheduledAt = new Date(`${date}T${time}`);
    if (isNaN(scheduledAt.getTime())) throw new Error("Invalid date/time");

    // Step 1 — schedule the interview (auto-mints Google Meet if online).
    const r1 = await fetch(`/api/hr/hiring/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "scheduleInterview",
        kind,
        title: title.trim(),
        scheduledAt: scheduledAt.toISOString(),
        durationMinutes: duration,
        location: kind === "online" ? (meetingLink || "{{MeetingLink}}") : location.trim() || null,
        note: noteToPanel.trim() || null,
      }),
    });
    if (!r1.ok) {
      const j = await r1.json().catch(() => ({}));
      throw new Error(j?.error || "Couldn't schedule interview");
    }
    const r1Json: any = await r1.json().catch(() => ({}));
    const autoMeetUrl: string | null = r1Json?.interview?.meetingUrl ?? null;

    // Step 2 — substitute placeholders and send the email.
    const linkForBody = meetingLink || autoMeetUrl || "{{MeetingLink — fill in before sending}}";
    const whenStr = scheduledAt.toLocaleString("en-IN", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
    const finalHtml = p.bodyHtml
      .replaceAll("{{CandidateName}}",     candidate.fullName)
      .replaceAll("{{JobTitle}}",          candidate.roleTitle ?? "your application")
      .replaceAll("{{InterviewDateTime}}", whenStr)
      .replaceAll("{{InterviewDate}}",     whenStr)
      .replaceAll("{{MeetingLink}}",       linkForBody);
    // Resolve panel member emails and CC them on the candidate's
    // invite so every interviewer also gets the Meet link + time
    // without HR having to forward it manually. Dedup against any
    // emails HR explicitly typed in the CC field.
    const panelEmails = users
      .filter((u) => panelIds.includes(u.id))
      .map((u) => u.email?.trim())
      .filter((e): e is string => !!e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    const ccLower    = new Set(p.cc.map((e) => e.toLowerCase()));
    const mergedCc   = [...p.cc, ...panelEmails.filter((e) => !ccLower.has(e.toLowerCase()))];
    const r2 = await fetch(`/api/hr/hiring/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "sendEmail",
        to:      p.to || candidate.email,
        cc:      mergedCc, bcc: p.bcc,
        subject: p.subject,
        body:    finalHtml,
        attachments: p.attachments.map(({ filename, contentType, contentBase64 }) =>
          ({ filename, contentType, contentBase64 })),
      }),
    });
    if (!r2.ok) {
      const j = await r2.json().catch(() => ({}));
      throw new Error(`Interview scheduled, but email failed: ${j?.error || "unknown error"}`);
    }
    globalMutate("/api/hr/hiring/candidates");
    onDone?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-[720px] bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-slate-900 truncate">
              Schedule {kind === "online" ? "Online" : kind === "face_to_face" ? "Face-to-Face" : "Self-schedule"} Interview with {candidate.fullName}
            </h3>
            {candidate.roleTitle && <p className="text-[11.5px] text-slate-500 truncate">{candidate.roleTitle}</p>}
          </div>
          <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100">
            <X size={15} />
          </button>
        </div>

        {/* Round + Kind toggles */}
        <div className="px-5 pt-4 flex flex-wrap items-center gap-3">
          <div className="inline-flex p-1 rounded-lg border border-slate-200 bg-slate-50">
            <KindButton active={round === "technical"} onClick={() => setRound("technical")} Icon={FileText} label="Technical Round" />
            <KindButton active={round === "final"}     onClick={() => setRound("final")}     Icon={Check}    label="Final Round" />
          </div>
          <div className="inline-flex p-1 rounded-lg border border-slate-200 bg-slate-50">
            <KindButton active={kind === "online"}       onClick={() => setKind("online")}       Icon={Video}   label="Online" />
            <KindButton active={kind === "face_to_face"} onClick={() => setKind("face_to_face")} Icon={MapPin}  label="Face to Face" />
            <KindButton active={kind === "self_schedule"} onClick={() => setKind("self_schedule")} Icon={Calendar} label="Self-schedule" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Panel + schedule */}
          <Field label="Panel Members">
            <UserMultiPicker
              all={users}
              selected={panelIds}
              onChange={setPanelIds}
              placeholder="Select interviewers"
            />
          </Field>

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-4">
              <Field label="Interview Date">
                <DateField value={date} onChange={setDate} />
              </Field>
            </div>
            <div className="col-span-4">
              <Field label="Start Time">
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
              </Field>
            </div>
            <div className="col-span-4">
              <Field label="Duration">
                <div className="relative">
                  <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}
                    className="appearance-none w-full h-10 pl-3 pr-9 rounded-lg border border-slate-200 bg-white text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]">
                    {DURATIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </Field>
            </div>
          </div>

          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
          </Field>

          {kind === "online" && (
            <Field label="Meeting link (Google Meet / Zoom / Teams)">
              <input value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)}
                placeholder="Leave blank to auto-create a Google Meet link"
                className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
              <p className="mt-1 text-[10.5px] text-slate-400">
                Leave blank and a Google Meet link is created automatically. Or paste your own (Zoom / Teams / custom Meet).
              </p>
            </Field>
          )}
          {kind === "face_to_face" && (
            <Field label="Location / address">
              <input value={location} onChange={(e) => setLocation(e.target.value)}
                placeholder="NB Media Office, Mohali (Floor 4, Room 402)"
                className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
            </Field>
          )}

          {/* Email / Note tabs */}
          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-center gap-5 border-b border-slate-200 -mb-px">
              {(["email", "note"] as const).map((t) => (
                <button key={t} onClick={() => setPaneTab(t)}
                  className={`py-2.5 border-b-2 text-[12.5px] font-semibold transition-colors ${
                    paneTab === t ? "border-[#3b82f6] text-[#3b82f6]" : "border-transparent text-slate-500 hover:text-slate-900"
                  }`}
                >{t === "email" ? "Email to candidate" : "Note for Interview Panel"}</button>
              ))}
            </div>

            {paneTab === "email" ? (
              <div className="pt-4">
                <p className="mb-3 text-[11px] text-slate-500">
                  Body comes from the <strong>{round === "technical" ? "Technical" : "Final"} Round</strong> template.
                  Edit freely; <code>{`{{MeetingLink}}`}</code> is swapped in at send time.
                </p>

                {/* Panel-members-as-CC notice. We resolve panelIds →
                    emails right here so HR can SEE who's getting the
                    invite before clicking Send. The actual CC merge
                    happens inside scheduleAndSend so a late panel
                    change still picks up correctly. */}
                {(() => {
                  const panel = users.filter((u) => panelIds.includes(u.id));
                  const withEmail    = panel.filter((u) => u.email);
                  const withoutEmail = panel.filter((u) => !u.email);
                  if (panel.length === 0) {
                    return (
                      <div className="mb-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-[11.5px] text-amber-800">
                        ⚠ No panel members selected — only the candidate will receive the Meet link.
                        Add interviewers in the Panel Members field above so they get the invite too.
                      </div>
                    );
                  }
                  return (
                    <div className="mb-3 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-[11.5px] text-blue-900">
                      <p className="font-semibold mb-0.5">
                        ✓ {withEmail.length} panel member{withEmail.length === 1 ? "" : "s"} will be CC&apos;d on this invite:
                      </p>
                      <p className="text-blue-800">
                        {withEmail.map((u) => u.name).join(", ")}
                      </p>
                      {withoutEmail.length > 0 && (
                        <p className="mt-1 text-amber-700">
                          ⚠ Skipping (no email on file): {withoutEmail.map((u) => u.name).join(", ")}
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* key on round+kind so toggling re-mounts with fresh body. */}
                <EmailComposer
                  key={`${round}-${kind}`}
                  candidateName={candidate.fullName}
                  jobRole={candidate.roleTitle ?? "your application"}
                  defaultTo={candidate.email}
                  initialSubject={defaults.subject}
                  initialBody={defaults.body}
                  showTemplatePicker={false}
                  context="interview"
                  submitLabel="Schedule & send"
                  onCancel={onClose}
                  onSend={scheduleAndSend}
                />
              </div>
            ) : (
              <div className="pt-4">
                <Field label="Note (visible to the interview panel)">
                  <textarea value={noteToPanel} onChange={(e) => setNoteToPanel(e.target.value)} rows={4}
                    placeholder="Anything the panel should know before the interview — strengths, gaps, what to probe."
                    style={{ fontFamily: '"Times New Roman", Georgia, serif' }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
                </Field>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button onClick={onClose} className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-slate-700 hover:bg-white">Cancel</button>
                  <button onClick={scheduleOnly} disabled={saving}
                    className="inline-flex items-center gap-1.5 h-9 px-5 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-slate-300 text-white text-[12.5px] font-semibold shadow-sm">
                    <Calendar size={13} /> {saving ? "Scheduling…" : "Schedule (no email)"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KindButton({ active, onClick, Icon, label }: { active: boolean; onClick: () => void; Icon: any; label: string }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded text-[12px] font-semibold transition-colors ${
        active ? "bg-white text-[#3b82f6] shadow-sm" : "text-slate-600 hover:text-slate-900"
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// Build subject + body using the verbatim HR templates (Technical Round /
// Final Round). Self-schedule falls back to the Technical Round wording
// but with the meeting link replaced by a "pick a time" placeholder.
function defaultBody(
  c: Candidate,
  kind: InterviewKind,
  round: InterviewRound,
  date: string,
  time: string,
  _duration: number,
): { subject: string; body: string } {
  const when = new Date(`${date}T${time}`);
  const whenStr = isNaN(when.getTime())
    ? "{{InterviewDateTime}}"
    : when.toLocaleString("en-IN", {
        weekday: "long", day: "2-digit", month: "long", year: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
      });
  const role = c.roleTitle ?? "your application";

  if (round === "final") {
    return finalRoundEmail({
      candidateName: c.fullName,
      jobRole: role,
      interviewDateTime: whenStr,
      mode: kind === "face_to_face" ? "onsite" : "online",
    });
  }
  // Technical (default)
  return technicalRoundEmail({
    candidateName: c.fullName,
    jobRole: role,
    interviewDateTime: whenStr,
  });
}

// ── User multi-picker (lightweight inline version) ─────────────────

function UserMultiPicker({
  all, selected, onChange, placeholder,
}: { all: UserRow[]; selected: number[]; onChange: (ids: number[]) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ]       = useState("");
  const selectedUsers   = all.filter((u) => selected.includes(u.id));
  const filtered = q.trim()
    ? all.filter((u) => (u.name ?? "").toLowerCase().includes(q.toLowerCase()) ||
                        (u.email ?? "").toLowerCase().includes(q.toLowerCase()))
        .filter((u) => !selected.includes(u.id))
    : all.filter((u) => !selected.includes(u.id)).slice(0, 30);

  return (
    <div className="relative">
      <div className="flex flex-wrap gap-1.5 mb-2">
        {selectedUsers.map((u) => (
          <span key={u.id} className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-full bg-blue-50 text-[#1d4ed8] text-[11.5px] font-semibold ring-1 ring-[#3b82f6]/20">
            {u.name}
            <button onClick={() => onChange(selected.filter((id) => id !== u.id))}
              className="inline-flex items-center justify-center h-5 w-5 rounded-full hover:bg-[#3b82f6]/20">
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <button onClick={() => setOpen(!open)} type="button"
        className="w-full text-left inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-dashed border-slate-300 text-[12.5px] text-slate-500 hover:border-[#3b82f6] hover:text-[#3b82f6]">
        <Users size={13} /> {placeholder}
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-xl border border-slate-200 bg-white shadow-lg p-2">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search interviewers"
            className="w-full h-9 px-3 rounded-lg border border-slate-200 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
          <div className="mt-2 max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-[12px] text-slate-400">No users.</p>
            ) : filtered.map((u) => (
              <button key={u.id} onClick={() => { onChange([...selected, u.id]); setQ(""); }}
                className="w-full text-left flex items-center gap-2.5 px-2 py-1.5 rounded text-[12.5px] hover:bg-blue-50 hover:text-[#1d4ed8]">
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
