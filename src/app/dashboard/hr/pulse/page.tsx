"use client";

// Weekly Pulse — employee answer page. Visible to every employee,
// reachable from the email link / in-app notification CTA / the
// "blocked clock-out" banner. Renders this week's 5 questions and
// collects all answers in a single submit.
//
// After submit, the page locks (server enforces uniqueness on
// userId + weekKey + questionId) and shows a confirmation card
// telling the user they can now clock out.

import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher } from "@/lib/swr";
import { Activity, Loader2, CheckCircle2, ShieldAlert } from "lucide-react";
import { QuestionCard, type Q } from "./_QuestionCard";

type ThisWeek = {
  weekKey: string;
  activeWeek: number;
  theme: string;
  questions: Q[];
  hasSubmitted: boolean;
  submittedAt: string | null;
};

export default function WeeklyPulseAnswerPage() {
  const { data, isLoading, mutate } = useSWR<ThisWeek>("/api/hr/pulse/this-week", fetcher);
  // Local state keyed by questionId — { score: number | null, comment: string }
  const [answers, setAnswers] = useState<Record<number, { score: number | null; comment: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);

  // Seed the answer map whenever the question list arrives.
  useEffect(() => {
    if (!data?.questions) return;
    const seeded: Record<number, { score: number | null; comment: string }> = {};
    for (const q of data.questions) {
      seeded[q.id] = { score: null, comment: "" };
    }
    setAnswers(seeded);
  }, [data?.questions]);

  // Validation: every non-text question needs a score chosen. Text
  // questions are optional — we don't gate submit on them.
  const canSubmit = useMemo(() => {
    if (!data?.questions) return false;
    return data.questions.every((q) =>
      q.type === "text" ? true : answers[q.id]?.score != null
    );
  }, [answers, data?.questions]);

  const setScore = (qid: number, score: number) =>
    setAnswers((a) => ({ ...a, [qid]: { ...a[qid], score } }));
  const setComment = (qid: number, comment: string) =>
    setAnswers((a) => ({ ...a, [qid]: { ...a[qid], comment: comment.slice(0, 500) } }));

  const submit = async () => {
    if (!data?.questions) return;
    setSubmitting(true); setError(null);
    try {
      const responses = data.questions
        .map((q) => {
          const a = answers[q.id];
          if (!a) return null;
          if (q.type === "text") {
            return { questionId: q.id, comment: a.comment || null };
          }
          return { questionId: q.id, score: a.score, comment: a.comment || null };
        })
        .filter(Boolean);
      const res = await fetch("/api/hr/pulse/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j?.error || `Submit failed (${res.status})`);
        return;
      }
      setJustSubmitted(true);
      await mutate();
      globalMutate("/api/hr/pulse/this-week");
    } catch (e: any) {
      setError(e?.message || "Submit failed");
    } finally { setSubmitting(false); }
  };

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-[#f4f7f8] p-8">
        <div className="max-w-2xl mx-auto rounded-xl border border-slate-200 bg-white p-10 text-center">
          <Loader2 size={20} className="mx-auto animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  if (data.hasSubmitted || justSubmitted) {
    const when = data.submittedAt ? new Date(data.submittedAt).toLocaleString("en-IN") : "just now";
    return (
      <div className="min-h-screen bg-[#f4f7f8] p-6">
        <div className="max-w-2xl mx-auto">
          <header className="mb-5">
            <h1 className="text-[20px] font-semibold text-slate-900 inline-flex items-center gap-2">
              <Activity size={20} className="text-[#008CFF]" /> Weekly Pulse
            </h1>
            <p className="mt-1 text-[13px] text-slate-500">
              Week {data.activeWeek} — {data.theme}
            </p>
          </header>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
            <CheckCircle2 size={28} className="text-emerald-600 mb-2" strokeWidth={2.25} />
            <h2 className="text-[16px] font-semibold text-emerald-900">Submitted — thank you!</h2>
            <p className="mt-1.5 text-[13px] text-emerald-800">
              Your response landed at {when}. You can now clock out as usual whenever you're done for the day.
            </p>
            <p className="mt-3 text-[12px] text-emerald-700/80">
              The next pulse drops at 10:30 AM IST next Friday. See you then!
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f7f8] p-6">
      <div className="max-w-2xl mx-auto">
        <header className="mb-5">
          <h1 className="text-[20px] font-semibold text-slate-900 inline-flex items-center gap-2">
            <Activity size={20} className="text-[#008CFF]" /> Weekly Pulse
          </h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Week {data.activeWeek} — {data.theme}. Takes about 30 seconds.
          </p>
        </header>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 mb-5 inline-flex items-start gap-2.5 w-full">
          <ShieldAlert size={16} className="text-amber-700 mt-0.5 shrink-0" strokeWidth={2.25} />
          <p className="text-[12.5px] text-amber-900 leading-snug">
            <strong>Clock-out is blocked</strong> until you submit. The lock lifts the moment this lands — promise.
          </p>
        </div>

        <div className="space-y-3">
          {data.questions.map((q) => (
            <QuestionCard
              key={q.id}
              q={q}
              answer={answers[q.id]}
              onScore={(s) => setScore(q.id, s)}
              onComment={(c) => setComment(q.id, c)}
            />
          ))}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>
        )}

        <div className="mt-5 flex items-center justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !canSubmit}
            className="h-10 px-5 rounded-lg bg-[#008CFF] hover:bg-[#0070cc] active:bg-[#005ea3] text-white text-[13px] font-semibold inline-flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting && <Loader2 size={13} className="animate-spin" />}
            {submitting ? "Submitting…" : "Submit Pulse"}
          </button>
        </div>
      </div>
    </div>
  );
}
