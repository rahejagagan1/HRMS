"use client";

// Pulse & Surveys — question bank manager. Lives inside the HR
// Dashboard → Pulse & Surveys tab. Two sub-tabs:
//
//   • Weekly Pulse   — rotating 4-week × 5-question bank. Sent
//                      every Friday. Quick mood + manager + workload
//                      + growth check.
//
//   • Monthly Survey — single ~6-question deeper survey. Sent
//                      the last working day of each month. Includes
//                      eNPS (0-10) and Likert (1-5) engagement
//                      drivers + open feedback.
//
// HR can edit / add / delete any question. Renamed from the
// original WeeklyPulsePanel — the Add / Edit / Delete buttons
// here use visible text labels (not just icons) so HR isn't
// guessing what the three tiny icons mean.

import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher } from "@/lib/swr";
import {
  Loader2, Plus, Pencil, Trash2, Check, X, Smile, Star, MessageSquareText,
  Activity, ThumbsUp, Send, BarChart3, ListChecks,
} from "lucide-react";
import PulseResponsesView from "@/components/hr/PulseResponsesView";

type QType = "emoji" | "rating" | "likert" | "enps" | "text";

type Q = {
  id: number;
  week: number | null;
  order: number;
  text: string;
  type: QType;
  emojis: string[] | null;
  isActive: boolean;
  surveyType: "weekly" | "monthly";
  brand: "NB Media" | "YT Labs";
};

const WEEK_LABELS: Record<number, { title: string; subtitle: string }> = {
  1: { title: "Week 1 — Mood & Wellbeing",       subtitle: "How the team is feeling overall" },
  2: { title: "Week 2 — Manager & Team",         subtitle: "Relationships, support, feedback" },
  3: { title: "Week 3 — Workload & Resources",   subtitle: "Capacity, tools, focus, blockers" },
  4: { title: "Week 4 — Growth & Engagement",    subtitle: "Learning, alignment, advocacy" },
};

const DEFAULT_EMOJIS: Record<string, string[]> = {
  neutral:    ["😡", "😟", "😐", "🙂", "😄"],
  motivation: ["😟", "😐", "🙂", "😄", "🤩"],
  workload:   ["😩", "😟", "😐", "🙂", "😌"],
};

const LIKERT_LABELS = [
  "Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree",
];

export default function PulseSurveysPanel({ initialBrand }: { initialBrand?: "NB Media" | "YT Labs" | "all" | null } = {}) {
  const [outer, setOuter] = useState<"questions" | "responses">("questions");
  const [view, setView] = useState<"weekly" | "monthly">("weekly");
  // Brand is derived entirely from the URL (?brand=…). No inline
  // switcher in this panel — the outer HR Dashboard brand tab
  // (header chip) is the single brand control. NB Media tab →
  // NB Media everywhere; YT Labs tab → YT Labs everywhere.
  const brand: "NB Media" | "YT Labs" =
    initialBrand === "YT Labs" ? "YT Labs" : "NB Media";

  return (
    <div className="space-y-5">
      {/* Section header */}
      <div>
        <h2 className="text-[18px] font-semibold text-slate-900 dark:text-white">Pulse &amp; Surveys</h2>
        <p className="mt-1 text-[13px] text-slate-500">
          Manage the question bank and view anonymous responses for our weekly mood pulse and monthly engagement survey.
        </p>
      </div>

      {/* Outer tab strip — Questions vs Responses */}
      <div className="border-b border-slate-200 flex items-end gap-1">
        <button
          type="button"
          onClick={() => setOuter("questions")}
          className={`px-4 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5 ${
            outer === "questions" ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <ListChecks size={13} /> Questions
        </button>
        <button
          type="button"
          onClick={() => setOuter("responses")}
          className={`px-4 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5 ${
            outer === "responses" ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <BarChart3 size={13} /> Responses
        </button>
      </div>

      {outer === "responses" ? (
        <PulseResponsesView initialBrand={initialBrand} />
      ) : (
        <>
          {/* Weekly / Monthly switcher (Questions only) */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={() => setView("weekly")}
              className={`px-4 py-1.5 rounded-md text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
                view === "weekly" ? "bg-white text-[#008CFF] shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Activity size={13} /> Weekly Pulse
            </button>
            <button
              type="button"
              onClick={() => setView("monthly")}
              className={`px-4 py-1.5 rounded-md text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
                view === "monthly" ? "bg-white text-[#008CFF] shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <ThumbsUp size={13} /> Monthly Survey
            </button>
          </div>

          {/* (Brand picker removed — the active brand is driven by
              the HR Dashboard's outer brand tab via ?brand=….) */}

          {view === "weekly" ? <WeeklyView brand={brand} /> : <MonthlyView brand={brand} />}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Weekly view — 4 week-tabs, each shows that week's questions.
// ─────────────────────────────────────────────────────────────────
function WeeklyView({ brand }: { brand: "NB Media" | "YT Labs" }) {
  const [week, setWeek] = useState<1 | 2 | 3 | 4>(1);
  // Brand is always set under strict separation; include it in
  // the URL so each brand tab cache-busts independently.
  const apiKey = `/api/hr/pulse/questions?surveyType=weekly&week=${week}&brand=${encodeURIComponent(brand)}`;
  const { data, isLoading, mutate } = useSWR<{ questions: Q[] }>(apiKey, fetcher);
  const questions = data?.questions ?? [];
  const refresh = () => { mutate(); globalMutate(apiKey); };

  return (
    <div className="space-y-4">
      {/* Week tabs */}
      <div className="border-b border-slate-200 flex items-end gap-1">
        {([1, 2, 3, 4] as const).map((w) => {
          const active = week === w;
          return (
            <button
              key={w}
              type="button"
              onClick={() => setWeek(w)}
              className={`px-4 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${
                active ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Week {w}
            </button>
          );
        })}
      </div>

      {/* Week heading + count */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-slate-900">{WEEK_LABELS[week].title}</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">{WEEK_LABELS[week].subtitle}</p>
        </div>
        <span className="text-[11.5px] text-slate-500">
          {questions.length} question{questions.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Question list */}
      <QuestionList questions={questions} loading={isLoading} onChange={refresh} />

      <AddQuestionButton
        surveyType="weekly"
        week={week}
        brand={brand}
        onAdded={refresh}
        label={`Add question to ${brand} · Week ${week}`}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Monthly view — single list, no week buckets.
// ─────────────────────────────────────────────────────────────────
function MonthlyView({ brand }: { brand: "NB Media" | "YT Labs" }) {
  const apiKey = `/api/hr/pulse/questions?surveyType=monthly&brand=${encodeURIComponent(brand)}`;
  const { data, isLoading, mutate } = useSWR<{ questions: Q[] }>(apiKey, fetcher);
  const questions = data?.questions ?? [];
  const refresh = () => { mutate(); globalMutate(apiKey); };
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [sendError, setSendError]   = useState<string | null>(null);

  const sendNow = async () => {
    const employeesNote = questions.length === 0
      ? "There are no active questions to send."
      : `This will email and notify EVERY active employee. Continue?`;
    if (questions.length === 0 || !confirm(employeesNote)) return;
    setSending(true); setSendResult(null); setSendError(null);
    try {
      const res = await fetch("/api/hr/pulse/send-monthly", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Send failed (${res.status})`);
      setSendResult(`Sent ✓ ${j.emailsSent} emails to ${j.recipients} employee${j.recipients === 1 ? "" : "s"} (${j.notifications} notifications). Month: ${j.monthLabel}.`);
    } catch (e: any) {
      setSendError(e?.message || "Send failed");
    } finally { setSending(false); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3">
        <p className="text-[12.5px] text-slate-700">
          <span className="font-semibold text-blue-700">Monthly Survey</span> — a deeper engagement check. Mix of <span className="font-semibold">eNPS</span> (0-10 recommend-us slider) and <span className="font-semibold">Likert</span> (Strongly Disagree → Strongly Agree) questions. <strong>You send this on demand</strong> (no cron), typically on the last working day of the month or after an all-hands.
        </p>
      </div>

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-[15px] font-semibold text-slate-900">Active questions</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            {questions.length} question{questions.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          onClick={sendNow}
          disabled={sending || questions.length === 0}
          className="h-10 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} strokeWidth={2.25} />}
          {sending ? "Sending…" : "Send Monthly Survey now"}
        </button>
      </div>

      {sendResult && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">
          {sendResult}
        </div>
      )}
      {sendError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
          {sendError}
        </div>
      )}

      <QuestionList questions={questions} loading={isLoading} onChange={refresh} />

      <AddQuestionButton
        surveyType="monthly"
        week={null}
        brand={brand}
        onAdded={refresh}
        label={`Add question to ${brand} Monthly Survey`}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
function QuestionList({ questions, loading, onChange }: { questions: Q[]; loading: boolean; onChange: () => void }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
        <Loader2 size={20} className="mx-auto animate-spin text-slate-400" />
      </div>
    );
  }
  if (questions.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-[13px] text-slate-500">
        No questions yet. Click "Add question" below to create one.
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      {questions.map((q) => <QuestionCard key={q.id} q={q} onChange={onChange} />)}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// QuestionCard — visible Edit / Delete buttons (text + icon, not
// just hover tooltips on tiny icons). Click Edit to inline-edit;
// Save / Cancel to commit / drop. Delete confirms first.
// ─────────────────────────────────────────────────────────────────
function QuestionCard({ q, onChange }: { q: Q; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(q.text);
  const [draftType, setDraftType] = useState<QType>(q.type);
  const [draftEmojis, setDraftEmojis] = useState<string[]>(q.emojis ?? DEFAULT_EMOJIS.neutral);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setDraftText(q.text); setDraftType(q.type);
    setDraftEmojis(q.emojis ?? DEFAULT_EMOJIS.neutral);
    setError(null);
  };
  const cancel = () => { reset(); setEditing(false); };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/hr/pulse/questions/${q.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text:   draftText.trim(),
          type:   draftType,
          emojis: draftType === "emoji" ? draftEmojis : null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Save failed (${res.status})`);
      }
      setEditing(false);
      onChange();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!confirm(`Delete this question?\n\n"${q.text}"\n\nThis can't be undone.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/pulse/questions/${q.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      onChange();
    } catch { /* swallow */ }
    finally { setSaving(false); }
  };

  if (!editing) {
    return (
      <div className="group rounded-lg border border-slate-200 bg-white hover:border-slate-300 hover:shadow-[0_2px_8px_-2px_rgba(15,23,42,0.06)] transition-all">
        <div className="px-5 py-4">
          <div className="flex items-start gap-4">
            {/* Numbered badge — clean, professional, replaces the
                "#1" text + type-pill stacked layout with a single
                left-rail indicator. */}
            <div className="shrink-0 w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[11.5px] font-bold tabular-nums mt-0.5">
              {q.order}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] text-slate-900 font-medium leading-snug">{q.text}</p>
                  <p className="mt-1 text-[10.5px] uppercase tracking-[0.08em] font-semibold text-slate-400 inline-flex items-center gap-2 flex-wrap">
                    <TypeLabel type={q.type} />
                    {/* Brand badge — coloured per brand. */}
                    {q.brand === "YT Labs" ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold normal-case tracking-normal bg-[#d4143d]/10 text-[#d4143d]">YT Labs</span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold normal-case tracking-normal bg-[#008CFF]/10 text-[#008CFF]">NB Media</span>
                    )}
                    {!q.isActive && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 normal-case tracking-normal text-[10px]">Inactive</span>
                    )}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="h-7 px-2.5 rounded-md text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-1 transition-colors"
                  >
                    <Pencil size={10.5} strokeWidth={2.25} /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={remove}
                    disabled={saving}
                    className="h-7 px-2.5 rounded-md text-[11px] font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 inline-flex items-center gap-1 disabled:opacity-50 transition-colors"
                  >
                    <Trash2 size={10.5} strokeWidth={2.25} /> Delete
                  </button>
                </div>
              </div>

              <div className="mt-3.5">
                <AnswerPreview type={q.type} emojis={q.emojis ?? DEFAULT_EMOJIS.neutral} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-[#008CFF]/40 bg-[#008CFF]/[0.03] px-4 py-3.5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wider font-bold text-[#008CFF]">Editing #{q.order}</span>
      </div>
      <textarea
        value={draftText}
        onChange={(e) => setDraftText(e.target.value)}
        rows={2}
        maxLength={400}
        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#008CFF] resize-none"
        placeholder="Question text"
      />
      <div className="flex items-center gap-3 flex-wrap">
        <label className="inline-flex items-center gap-2 text-[12px] text-slate-600">
          <span className="font-semibold">Type:</span>
          <select
            value={draftType}
            onChange={(e) => setDraftType(e.target.value as QType)}
            className="h-7 px-2 border border-slate-200 rounded-md text-[12px] bg-white focus:outline-none focus:border-[#008CFF]"
          >
            <option value="emoji">Emoji (5)</option>
            <option value="rating">Star Rating (1–5)</option>
            <option value="likert">Likert (Strongly Disagree → Strongly Agree)</option>
            <option value="enps">eNPS (0–10 slider)</option>
            <option value="text">Free Text</option>
          </select>
        </label>
        {draftType === "emoji" && (
          <div className="inline-flex items-center gap-1 flex-wrap">
            <span className="text-[11.5px] text-slate-500 mr-1">Emojis:</span>
            {draftEmojis.map((e, idx) => (
              <input
                key={idx}
                value={e}
                onChange={(ev) => {
                  const next = [...draftEmojis];
                  next[idx] = ev.target.value;
                  setDraftEmojis(next);
                }}
                maxLength={4}
                className="h-7 w-9 text-center text-[14px] border border-slate-200 rounded-md bg-white focus:outline-none focus:border-[#008CFF]"
              />
            ))}
            <div className="inline-flex items-center gap-1 ml-2">
              <span className="text-[10.5px] text-slate-400">Presets:</span>
              {Object.entries(DEFAULT_EMOJIS).map(([k, v]) => (
                <button key={k} type="button" onClick={() => setDraftEmojis(v)}
                  className="h-6 px-1.5 text-[11px] text-slate-600 hover:bg-slate-100 rounded">
                  {v.join("")}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {error && <p className="text-[11.5px] text-rose-600">{error}</p>}
      <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-200/70">
        <button type="button" onClick={cancel} disabled={saving}
          className="h-8 px-3 text-[11.5px] font-semibold text-slate-600 hover:bg-slate-100 rounded-md inline-flex items-center gap-1">
          <X size={11} /> Cancel
        </button>
        <button type="button" onClick={save} disabled={saving || !draftText.trim()}
          className="h-8 px-4 rounded-md bg-[#008CFF] hover:bg-[#0070cc] text-white text-[11.5px] font-semibold inline-flex items-center gap-1 disabled:opacity-50">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function TypeLabel({ type }: { type: QType }) {
  const cfg = {
    emoji:  { Icon: Smile,             label: "Emoji reaction" },
    rating: { Icon: Star,              label: "Star rating · 1–5" },
    likert: { Icon: Activity,          label: "Likert scale · 1–5" },
    enps:   { Icon: ThumbsUp,          label: "eNPS · 0–10" },
    text:   { Icon: MessageSquareText, label: "Free text" },
  }[type];
  return (
    <span className="inline-flex items-center gap-1.5">
      <cfg.Icon size={11} strokeWidth={2.25} className="text-slate-500" />
      {cfg.label}
    </span>
  );
}

// Also keep a tiny pill variant used inside the edit form header.
function TypeBadge({ type }: { type: QType }) {
  const cfg = {
    emoji:  { label: "Emoji 5" },
    rating: { label: "Rating"  },
    likert: { label: "Likert"  },
    enps:   { label: "eNPS"    },
    text:   { label: "Text"    },
  }[type];
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-slate-600 bg-slate-100">
      {cfg.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// AnswerPreview — renders what the employee will see when answering
// each question type. Read-only on the admin panel; the actual
// answer flow is a separate page (not built yet).
// ─────────────────────────────────────────────────────────────────
function AnswerPreview({ type, emojis }: { type: QType; emojis: string[] }) {
  if (type === "emoji") {
    return (
      <div className="inline-flex items-center gap-1.5">
        {emojis.map((e, i) => (
          <span key={i} className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-50 border border-slate-200 text-[14px]">
            {e}
          </span>
        ))}
      </div>
    );
  }
  if (type === "rating") {
    return (
      <div className="inline-flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} size={16} className="text-amber-400 fill-amber-200" strokeWidth={1.5} />
        ))}
      </div>
    );
  }
  if (type === "likert") {
    // Clean horizontal scale with 5 ticks. Anchors at endpoints
    // make the meaning unambiguous without 5 chunky labelled chips.
    return (
      <div className="max-w-md">
        <div className="relative flex items-center justify-between">
          <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-px bg-slate-200" />
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n}
              className="relative z-10 inline-flex items-center justify-center h-7 w-7 rounded-full bg-white border border-slate-300 text-[11px] font-semibold text-slate-600">
              {n}
            </span>
          ))}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-slate-400">
          <span>Strongly Disagree</span>
          <span>Strongly Agree</span>
        </div>
      </div>
    );
  }
  if (type === "enps") {
    // Subdued color gradient — detractors (0-6) light rose, passives
    // (7-8) light amber, promoters (9-10) light emerald. Tighter
    // 6×6 buttons + cleaner border.
    return (
      <div className="max-w-xl">
        <div className="flex items-center gap-1">
          {Array.from({ length: 11 }).map((_, n) => {
            const color =
              n <= 6 ? "bg-rose-50 text-rose-700 border-rose-200"
              : n <= 8 ? "bg-amber-50 text-amber-700 border-amber-200"
              : "bg-emerald-50 text-emerald-700 border-emerald-200";
            return (
              <span key={n} className={`inline-flex h-6 w-6 items-center justify-center rounded text-[10.5px] font-semibold border ${color}`}>
                {n}
              </span>
            );
          })}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-slate-400">
          <span>Not at all likely</span>
          <span>Extremely likely</span>
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-md h-9 rounded-md border border-dashed border-slate-200 bg-slate-50/40 flex items-center px-3 text-[11.5px] text-slate-400 italic">
      Free-text answer (up to 500 characters)
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// AddQuestionButton — full-width dashed-border CTA. Opens inline
// form for new question. Type selector includes the full range
// (Emoji 5 / Rating / Likert / eNPS / Free Text).
// ─────────────────────────────────────────────────────────────────
function AddQuestionButton({
  surveyType, week, brand, onAdded, label,
}: {
  surveyType: "weekly" | "monthly";
  week: number | null;
  brand: "NB Media" | "YT Labs";
  onAdded: () => void;
  label: string;
}) {
  const [open, setOpen]   = useState(false);
  const [text, setText]   = useState("");
  const [type, setType]   = useState<QType>(surveyType === "monthly" ? "likert" : "emoji");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const body: any = {
        surveyType, text: text.trim(), type,
        emojis: type === "emoji" ? DEFAULT_EMOJIS.neutral : undefined,
        brand, // strict separation — always the active brand tab
      };
      if (week != null) body.week = week;

      const res = await fetch("/api/hr/pulse/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Add failed (${res.status})`);
      }
      setText(""); setOpen(false);
      onAdded();
    } catch (e: any) {
      setError(e?.message || "Add failed");
    } finally { setSaving(false); }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="w-full h-11 rounded-xl border-2 border-dashed border-slate-300 hover:border-[#008CFF] hover:bg-[#008CFF]/[0.03] text-[13px] font-semibold text-slate-600 hover:text-[#008CFF] inline-flex items-center justify-center gap-2 transition-colors">
        <Plus size={14} strokeWidth={2.5} /> {label}
      </button>
    );
  }

  return (
    <div className="rounded-xl border-2 border-[#008CFF]/40 bg-[#008CFF]/[0.04] p-4 space-y-3">
      <p className="text-[12px] uppercase tracking-wider font-bold text-[#008CFF]">
        New question — {surveyType === "weekly" ? `Week ${week}` : "Monthly Survey"}
      </p>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={400}
        placeholder={surveyType === "monthly"
          ? "e.g. My manager genuinely supports my growth and wellbeing."
          : "e.g. How was your week overall?"}
        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#008CFF] resize-none"
      />
      <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-2 text-[12px] text-slate-600">
          <span className="font-semibold">Type:</span>
          <select value={type} onChange={(e) => setType(e.target.value as QType)}
            className="h-7 px-2 border border-slate-200 rounded-md text-[12px] bg-white">
            <option value="emoji">Emoji (5)</option>
            <option value="rating">Star Rating (1–5)</option>
            <option value="likert">Likert (Strongly Disagree → Strongly Agree)</option>
            <option value="enps">eNPS (0–10 slider)</option>
            <option value="text">Free Text</option>
          </select>
        </label>
      </div>
      {error && <p className="text-[11.5px] text-rose-600">{error}</p>}
      <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-200/70">
        <button type="button" onClick={() => { setOpen(false); setText(""); setError(null); }} disabled={saving}
          className="h-8 px-3 text-[11.5px] font-semibold text-slate-600 hover:bg-slate-100 rounded-md inline-flex items-center gap-1">
          <X size={11} /> Cancel
        </button>
        <button type="button" onClick={submit} disabled={saving || !text.trim()}
          className="h-8 px-4 rounded-md bg-[#008CFF] hover:bg-[#0070cc] text-white text-[11.5px] font-semibold inline-flex items-center gap-1 disabled:opacity-50">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          {saving ? "Adding…" : "Add question"}
        </button>
      </div>
    </div>
  );
}
