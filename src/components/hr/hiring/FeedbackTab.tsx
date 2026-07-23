"use client";

// Feedback tab — one card per interview round. Each card shows:
//   • Round metadata (title, date, panel, status, outcome)
//   • Submitted scorecards (one per panelist) with ratings + recommendation
//   • An "Add my feedback" / "Edit my feedback" CTA — current user only
//     submits THEIR OWN scorecard (HR-admins can record on anyone's
//     behalf via the same form, choosing the panelist).
//
// Data shape comes from GET /api/hr/hiring/candidates/[id] which now
// returns interviews[].scorecards[] inline.

import { useState } from "react";
import {
  Star, MessageSquare, ThumbsUp, ThumbsDown, Calendar, MapPin, X,
  Save, AlertCircle, CheckCircle2, Pencil, CalendarClock, Ban,
  AlertTriangle, Users, Clock, Video, Mail,
} from "lucide-react";
import { DateField } from "@/components/ui/date-field";

type Scorecard = {
  id: number;
  interviewerId: number;
  interviewerName: string;
  interviewerPic: string | null;
  technicalScore: number | null;
  communicationScore: number | null;
  cultureScore: number | null;
  problemSolvingScore: number | null;
  recommendation: "strong_yes" | "yes" | "no" | "strong_no" | null;
  strengths: string | null;
  weaknesses: string | null;
  notes: string | null;
  submittedAt: string | null;
};

type Panelist = { id: number; name: string; pic: string | null };

type Interview = {
  id: number;
  roundNumber: number;
  title: string;
  scheduledAt: string | null;
  durationMinutes: number;
  location: string | null;
  status: string;
  outcome: string | null;
  notes: string | null;
  panel: Panelist[];
  scorecards: Scorecard[];
};

const REC_LABEL: Record<string, string> = {
  strong_yes: "Strong yes",
  yes:        "Yes",
  no:         "No",
  strong_no:  "Strong no",
};
const REC_TONE: Record<string, string> = {
  strong_yes: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  yes:        "bg-emerald-50  text-emerald-700 ring-emerald-100",
  no:         "bg-rose-50     text-rose-700    ring-rose-100",
  strong_no:  "bg-rose-100    text-rose-700    ring-rose-200",
};

export default function FeedbackTab({
  interviews, currentUserId, isHRAdmin, onMutated,
}: {
  interviews: Interview[];
  /** Logged-in user — used to figure out whether the "Add my feedback" CTA shows. */
  currentUserId: number | null;
  /** When true, HR can submit feedback on behalf of any panelist. */
  isHRAdmin: boolean;
  /** Called after a scorecard is saved so the parent refetches. */
  onMutated: () => void;
}) {
  const [editing,        setEditing]        = useState<{ interviewId: number; existing?: Scorecard; targetUserId?: number } | null>(null);
  const [rescheduling,   setRescheduling]   = useState<Interview | null>(null);
  const [cancelling,     setCancelling]     = useState<Interview | null>(null);

  if (interviews.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
        <Calendar size={28} className="mx-auto text-slate-300 mb-3" />
        <h3 className="text-[14px] font-semibold text-slate-800">No interviews yet</h3>
        <p className="text-[12px] text-slate-500 mt-1 max-w-md mx-auto">
          Schedule an interview from the action bar above. Once a round is set up, panelists can submit scorecards here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {interviews.map((iv) => {
        const myCard = currentUserId != null
          ? iv.scorecards.find((s) => s.interviewerId === currentUserId)
          : undefined;
        const onPanel = currentUserId != null && iv.panel.some((p) => p.id === currentUserId);

        return (
          <div key={iv.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center justify-center h-5 px-2 rounded-md bg-blue-50 text-[#1d4ed8] text-[10.5px] font-bold uppercase tracking-wider">
                    Round {iv.roundNumber}
                  </span>
                  <h3 className="text-[14px] font-semibold text-slate-900 truncate">{iv.title}</h3>
                  <StatusPill status={iv.status} outcome={iv.outcome} />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-slate-500">
                  {iv.scheduledAt && (
                    <span className="inline-flex items-center gap-1">
                      <Calendar size={11} />
                      {new Date(iv.scheduledAt).toLocaleString("en-IN", {
                        weekday: "short", day: "2-digit", month: "short", year: "numeric",
                        hour: "numeric", minute: "2-digit", hour12: true,
                      })}
                      <span className="text-slate-400">· {iv.durationMinutes}min</span>
                    </span>
                  )}
                  {iv.location && (
                    <a
                      href={/^https?:/.test(iv.location) ? iv.location : undefined}
                      target={/^https?:/.test(iv.location) ? "_blank" : undefined}
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-1 ${
                        /^https?:/.test(iv.location) ? "text-[#3b82f6] hover:underline" : ""
                      }`}
                    >
                      <MapPin size={11} />
                      {/^https?:/.test(iv.location) ? "Join meeting" : iv.location}
                    </a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {isHRAdmin && iv.status === "scheduled" && (
                  <>
                    <button
                      onClick={() => setRescheduling(iv)}
                      title="Reschedule"
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-[11.5px] font-semibold"
                    >
                      <CalendarClock size={12} /> Reschedule
                    </button>
                    <button
                      onClick={() => setCancelling(iv)}
                      title="Cancel interview"
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-rose-700 text-[11.5px] font-semibold"
                    >
                      <Ban size={12} /> Cancel
                    </button>
                  </>
                )}
                {(onPanel || isHRAdmin) && (
                  <button
                    onClick={() => setEditing({ interviewId: iv.id, existing: myCard, targetUserId: currentUserId ?? undefined })}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[11.5px] font-semibold shadow-sm"
                  >
                    {myCard ? <><Pencil size={12} /> Edit my feedback</> : <><Save size={12} /> Add my feedback</>}
                  </button>
                )}
              </div>
            </div>

            {/* Panel chips */}
            {iv.panel.length > 0 && (
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-2">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mr-1">Panel</span>
                {iv.panel.map((p) => {
                  const card = iv.scorecards.find((s) => s.interviewerId === p.id);
                  return (
                    <span
                      key={p.id}
                      className={`inline-flex items-center gap-1.5 h-7 pl-1 pr-2.5 rounded-full bg-white ring-1 text-[11.5px] font-medium ${
                        card ? "ring-emerald-200 text-emerald-800" : "ring-slate-200 text-slate-600"
                      }`}
                    >
                      <Avatar name={p.name} src={p.pic} size={20} />
                      {p.name}
                      {card
                        ? <CheckCircle2 size={11} className="text-emerald-600" />
                        : <span className="text-[9.5px] uppercase tracking-wider text-amber-600">pending</span>}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Scorecard list */}
            <div className="p-5">
              {iv.scorecards.length === 0 ? (
                <p className="text-[12.5px] text-slate-500 text-center py-6">
                  No feedback submitted yet.
                  {onPanel && " Click \"Add my feedback\" above to start."}
                </p>
              ) : (
                <ul className="space-y-4">
                  {iv.scorecards.map((s) => (
                    <ScorecardView key={s.id} card={s} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })}

      {editing && (
        <ScorecardModal
          interviewId={editing.interviewId}
          targetUserId={editing.targetUserId ?? null}
          panel={interviews.find((i) => i.id === editing.interviewId)?.panel ?? []}
          existing={editing.existing}
          isHRAdmin={isHRAdmin}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onMutated(); }}
        />
      )}

      {rescheduling && (
        <RescheduleModal
          interview={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={() => { setRescheduling(null); onMutated(); }}
        />
      )}

      {cancelling && (
        <CancelModal
          interview={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => { setCancelling(null); onMutated(); }}
        />
      )}
    </div>
  );
}

// ── Reschedule modal ────────────────────────────────────────────
// Pre-fills with the current schedule; HR tweaks date/time/duration
// and we PATCH the interview row + Google Calendar event.
function RescheduleModal({
  interview, onClose, onDone,
}: {
  interview: Interview;
  onClose: () => void;
  onDone: () => void;
}) {
  const initial = interview.scheduledAt ? new Date(interview.scheduledAt) : new Date();
  const [date, setDate]         = useState(initial.toISOString().slice(0, 10));
  const [time, setTime]         = useState(
    initial.toTimeString().slice(0, 5),
  );
  const [duration, setDuration] = useState(interview.durationMinutes);
  const [title, setTitle]       = useState(interview.title);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!date || !time) return setError("Date and time required");
    const scheduledAt = new Date(`${date}T${time}`);
    if (isNaN(scheduledAt.getTime())) return setError("Invalid date/time");
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/hiring/interviews/${interview.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reschedule",
          scheduledAt: scheduledAt.toISOString(),
          durationMinutes: duration,
          title: title.trim() || interview.title,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Reschedule failed");
      }
      onDone();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[14.5px] font-semibold text-slate-900">Reschedule interview</h3>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">{interview.title}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100">
            <X size={15} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <FieldLabel label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
          </FieldLabel>
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-5">
              <FieldLabel label="Date">
                <DateField value={date} onChange={setDate} />
              </FieldLabel>
            </div>
            <div className="col-span-4">
              <FieldLabel label="Time">
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
              </FieldLabel>
            </div>
            <div className="col-span-3">
              <FieldLabel label="Mins">
                <input type="number" min={5} step={5} value={duration}
                  onChange={(e) => setDuration(Math.max(5, Number(e.target.value) || 45))}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
              </FieldLabel>
            </div>
          </div>
          {interview.location && /^https?:/.test(interview.location) && (
            <p className="text-[10.5px] text-slate-500 inline-flex items-center gap-1.5">
              <CheckCircle2 size={11} className="text-emerald-600" />
              The Google Meet link is preserved — only the time is updated.
            </p>
          )}
          {error && (
            <div className="text-[12px] text-rose-600 inline-flex items-center gap-1">
              <AlertCircle size={12} /> {error}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 rounded-b-2xl flex items-center justify-end gap-2">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-slate-700 hover:bg-white">Cancel</button>
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-slate-300 text-white text-[12.5px] font-semibold">
            <CalendarClock size={13} /> {saving ? "Saving…" : "Reschedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cancel confirm ──────────────────────────────────────────────
// Deliberate 2-step: HR clicks Cancel on the card → this modal makes
// them confirm. Soft-deletes (status='cancelled') so the panel +
// scorecards stay accessible for audit.
function CancelModal({
  interview, onClose, onDone,
}: {
  interview: Interview;
  onClose: () => void;
  onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const confirm = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/hiring/interviews/${interview.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Cancel failed");
      }
      onDone();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  };

  const when = interview.scheduledAt ? new Date(interview.scheduledAt) : null;
  const isOnline = interview.location ? /^https?:/.test(interview.location) : false;
  const hasFeedback = interview.scorecards.length > 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">

        {/* ── Hero strip with warning icon ─────────────────── */}
        <div className="relative px-6 pt-7 pb-5 bg-gradient-to-br from-rose-50 via-white to-white border-b border-rose-100/60">
          {/* Decorative blob */}
          <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-rose-100/50 blur-2xl pointer-events-none" />

          <button onClick={onClose}
            className="absolute top-3 right-3 h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-white/80 transition-colors">
            <X size={15} />
          </button>

          <div className="relative flex items-start gap-4">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 ring-4 ring-white shadow-sm">
              <AlertTriangle size={22} className="text-rose-600" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <h3 className="text-[16px] font-semibold text-slate-900 leading-tight">
                Cancel this interview?
              </h3>
              <p className="mt-1 text-[12.5px] text-slate-500 leading-snug">
                This action notifies the candidate and panel. The interview stays on file as <span className="font-semibold text-slate-700">cancelled</span> — you won&apos;t lose any data.
              </p>
            </div>
          </div>
        </div>

        {/* ── Interview snapshot ───────────────────────────── */}
        <div className="px-6 py-4 bg-white">
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-600 shrink-0">
                {isOnline ? <Video size={15} /> : <Calendar size={15} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-slate-900 truncate">{interview.title}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-slate-500">
                  {when && (
                    <span className="inline-flex items-center gap-1">
                      <Clock size={11} className="text-slate-400" />
                      {when.toLocaleString("en-IN", {
                        weekday: "short", day: "2-digit", month: "short",
                        hour: "numeric", minute: "2-digit", hour12: true,
                      })}
                      <span className="text-slate-400">· {interview.durationMinutes}m</span>
                    </span>
                  )}
                  {interview.panel.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Users size={11} className="text-slate-400" />
                      {interview.panel.length} panelist{interview.panel.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Consequence checklist ──────────────────────── */}
          <ul className="mt-4 space-y-2">
            <ConsequenceLine
              icon={<Mail size={12} />}
              text={<>Google Calendar invite to <span className="font-semibold text-slate-700">{isOnline ? "candidate + panel" : "candidate"}</span> will be removed.</>}
              tone="info"
            />
            {hasFeedback && (
              <ConsequenceLine
                icon={<CheckCircle2 size={12} />}
                text={<><span className="font-semibold text-slate-700">{interview.scorecards.length} scorecard{interview.scorecards.length === 1 ? "" : "s"}</span> already submitted stay on file for audit.</>}
                tone="success"
              />
            )}
            <ConsequenceLine
              icon={<AlertCircle size={12} />}
              text="If you change your mind later, you'll need to schedule a new round."
              tone="warn"
            />
          </ul>

          {error && (
            <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-[12px] text-rose-700 inline-flex items-center gap-1.5">
              <AlertCircle size={13} /> {error}
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────── */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between gap-2">
          <p className="text-[10.5px] text-slate-400 hidden sm:block">
            Press <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-200 font-mono text-[9.5px]">Esc</kbd> to dismiss
          </p>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={onClose}
              className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-slate-700 hover:bg-white border border-transparent hover:border-slate-200 transition-colors">
              Keep interview
            </button>
            <button onClick={confirm} disabled={saving}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white text-[12.5px] font-semibold shadow-sm shadow-rose-600/20 transition-colors">
              <Ban size={13} /> {saving ? "Cancelling…" : "Yes, cancel"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Single line in the consequence checklist — bullet + colored icon
// + body text. Tone drives the icon colour so HR can scan info /
// success / warning at a glance.
function ConsequenceLine({
  icon, text, tone,
}: { icon: React.ReactNode; text: React.ReactNode; tone: "info" | "success" | "warn" }) {
  const tones = {
    info:    { bg: "bg-blue-50",    fg: "text-blue-600",    ring: "ring-blue-100" },
    success: { bg: "bg-emerald-50", fg: "text-emerald-600", ring: "ring-emerald-100" },
    warn:    { bg: "bg-amber-50",   fg: "text-amber-600",   ring: "ring-amber-100" },
  }[tone];
  return (
    <li className="flex items-start gap-2.5">
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md ${tones.bg} ${tones.fg} ring-1 ${tones.ring} shrink-0 mt-0.5`}>
        {icon}
      </span>
      <span className="text-[12px] text-slate-600 leading-snug">{text}</span>
    </li>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// ── Read-only scorecard row ────────────────────────────────────────

function ScorecardView({ card }: { card: Scorecard }) {
  return (
    <li className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={card.interviewerName} src={card.interviewerPic} size={28} />
          <div>
            <p className="text-[13px] font-semibold text-slate-900">{card.interviewerName}</p>
            {card.submittedAt && (
              <p className="text-[10.5px] text-slate-500">
                Submitted {new Date(card.submittedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
        </div>
        {card.recommendation && (
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full ring-1 text-[10.5px] font-bold uppercase tracking-wider ${REC_TONE[card.recommendation]}`}>
            {card.recommendation.startsWith("strong_yes") || card.recommendation === "yes" ? <ThumbsUp size={11} /> : <ThumbsDown size={11} />}
            {REC_LABEL[card.recommendation]}
          </span>
        )}
      </div>

      {/* Ratings grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-3">
        <Rating label="Technical"       value={card.technicalScore} />
        <Rating label="Communication"   value={card.communicationScore} />
        <Rating label="Culture fit"     value={card.cultureScore} />
        <Rating label="Problem solving" value={card.problemSolvingScore} />
      </div>

      {/* Strengths / weaknesses / notes */}
      {(card.strengths || card.weaknesses || card.notes) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
          {card.strengths && (
            <TextBlock label="Strengths"  text={card.strengths}  tone="emerald" />
          )}
          {card.weaknesses && (
            <TextBlock label="Concerns"   text={card.weaknesses} tone="rose" />
          )}
          {card.notes && (
            <TextBlock label="Notes"      text={card.notes}      tone="slate" />
          )}
        </div>
      )}
    </li>
  );
}

function Rating({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-md bg-white border border-slate-200 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <div className="mt-1 flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            size={13}
            className={
              value != null && n <= value
                ? "fill-amber-400 text-amber-400"
                : "text-slate-300"
            }
          />
        ))}
        <span className="ml-1.5 text-[11px] font-semibold text-slate-700">
          {value != null ? `${value}/5` : "—"}
        </span>
      </div>
    </div>
  );
}

function TextBlock({ label, text, tone }: { label: string; text: string; tone: "emerald" | "rose" | "slate" }) {
  const ring = tone === "emerald" ? "ring-emerald-100" : tone === "rose" ? "ring-rose-100" : "ring-slate-100";
  const bg   = tone === "emerald" ? "bg-emerald-50/60" : tone === "rose" ? "bg-rose-50/60" : "bg-slate-50";
  const labelTone = tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-slate-500";
  return (
    <div className={`rounded-md ${bg} ring-1 ${ring} px-3 py-2`}>
      <p className={`text-[10px] font-bold uppercase tracking-wider ${labelTone}`}>{label}</p>
      <p className="mt-1 text-[12.5px] text-slate-800 leading-[1.55] whitespace-pre-wrap">{text}</p>
    </div>
  );
}

function StatusPill({ status, outcome }: { status: string; outcome: string | null }) {
  // Outcome wins over status when the interview's completed and has a
  // pass/fail/hold call recorded.
  const pill = outcome
    ? { label: outcome.replace(/^./, (c) => c.toUpperCase()), tone:
        outcome === "pass" ? "bg-emerald-100 text-emerald-700"
        : outcome === "fail" ? "bg-rose-100 text-rose-700"
        : "bg-amber-100 text-amber-700" }
    : { label: status,
        tone: status === "completed" ? "bg-blue-100 text-blue-700"
            : status === "cancelled" || status === "no_show" ? "bg-slate-200 text-slate-600"
            : "bg-amber-100 text-amber-700" };
  return (
    <span className={`inline-flex items-center h-5 px-2 rounded-md ${pill.tone} text-[10.5px] font-bold uppercase tracking-wider`}>
      {pill.label}
    </span>
  );
}

function Avatar({ name, src, size = 24 }: { name: string; src: string | null; size?: number }) {
  if (src) {
    return <img src={src} alt={name} width={size} height={size} className="rounded-full object-cover" />;
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-slate-200 text-slate-700 font-bold"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

// ── Scorecard form modal ──────────────────────────────────────────

function ScorecardModal({
  interviewId, targetUserId, panel, existing, isHRAdmin, onClose, onSaved,
}: {
  interviewId: number;
  targetUserId: number | null;
  panel: Panelist[];
  existing?: Scorecard;
  isHRAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [technicalScore,      setTechnical]      = useState<number | null>(existing?.technicalScore ?? null);
  const [communicationScore,  setCommunication]  = useState<number | null>(existing?.communicationScore ?? null);
  const [cultureScore,        setCulture]        = useState<number | null>(existing?.cultureScore ?? null);
  const [problemSolvingScore, setProblemSolving] = useState<number | null>(existing?.problemSolvingScore ?? null);
  const [recommendation,      setRecommendation] = useState<Scorecard["recommendation"]>(existing?.recommendation ?? null);
  const [strengths,           setStrengths]      = useState(existing?.strengths ?? "");
  const [weaknesses,          setWeaknesses]     = useState(existing?.weaknesses ?? "");
  const [notes,               setNotes]          = useState(existing?.notes ?? "");
  const [savedFor, setSavedFor] = useState<number | null>(targetUserId);
  const [saving, setSaving]   = useState(false);
  const [error,  setError]    = useState<string | null>(null);

  const save = async () => {
    setError(null); setSaving(true);
    try {
      const res = await fetch(`/api/hr/hiring/interviews/${interviewId}/scorecard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewerId: isHRAdmin ? savedFor : undefined,
          technicalScore, communicationScore, cultureScore, problemSolvingScore,
          recommendation, strengths, weaknesses, notes,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Couldn't save feedback");
      }
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <h3 className="text-[15px] font-semibold text-slate-900">
            {existing ? "Edit feedback" : "Add feedback"}
          </h3>
          <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* HR override: pick which panelist's card we're filling */}
          {isHRAdmin && (
            <div>
              <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">
                Submitting feedback for
              </label>
              <select
                value={savedFor ?? ""}
                onChange={(e) => setSavedFor(e.target.value ? Number(e.target.value) : null)}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
              >
                <option value="">Myself</option>
                {panel.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <p className="mt-1 text-[10.5px] text-slate-400">
                HR can record verbal feedback on a panelist's behalf — they'll see it attributed to them.
              </p>
            </div>
          )}

          {/* Ratings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <RatingPicker label="Technical"       value={technicalScore}      onChange={setTechnical} />
            <RatingPicker label="Communication"   value={communicationScore}  onChange={setCommunication} />
            <RatingPicker label="Culture fit"     value={cultureScore}        onChange={setCulture} />
            <RatingPicker label="Problem solving" value={problemSolvingScore} onChange={setProblemSolving} />
          </div>

          {/* Recommendation */}
          <div>
            <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">Recommendation</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(["strong_yes", "yes", "no", "strong_no"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRecommendation(recommendation === r ? null : r)}
                  className={`h-10 px-3 rounded-lg border text-[12px] font-semibold transition-colors ${
                    recommendation === r
                      ? `${REC_TONE[r]} ring-2`
                      : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
                  }`}
                >
                  {REC_LABEL[r]}
                </button>
              ))}
            </div>
          </div>

          <TextField label="Strengths"  value={strengths}  onChange={setStrengths}  placeholder="What did they do well? Specific examples help." />
          <TextField label="Concerns"   value={weaknesses} onChange={setWeaknesses} placeholder="Gaps, red flags, or areas to probe further." />
          <TextField label="Other notes" value={notes}     onChange={setNotes}      placeholder="Anything else the team should know. Optional." />

          {error && (
            <div className="inline-flex items-center gap-1.5 text-[12px] text-rose-600">
              <AlertCircle size={13} /> {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-end gap-2">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-slate-700 hover:bg-white">Cancel</button>
          <button
            onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 h-9 px-5 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-slate-300 text-white text-[12.5px] font-semibold shadow-sm"
          >
            <Save size={13} /> {saving ? "Saving…" : existing ? "Update feedback" : "Submit feedback"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RatingPicker({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">{label}</label>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(value === n ? null : n)}
            aria-label={`${n} of 5`}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-amber-50 transition-colors"
          >
            <Star size={18} className={value != null && n <= value ? "fill-amber-400 text-amber-400" : "text-slate-300"} />
          </button>
        ))}
        {value != null && (
          <button
            onClick={() => onChange(null)}
            className="ml-1 text-[10.5px] text-slate-400 hover:text-slate-700 underline"
          >clear</button>
        )}
      </div>
    </div>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
      />
    </div>
  );
}
