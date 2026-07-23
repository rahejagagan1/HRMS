"use client";

// Monthly Engagement Survey — employee answer page. Reachable from
// the monthly survey email link + the in-app notification CTA.
// Renders this month's survey questions (eNPS + Likert + open
// feedback) and collects all answers in a single submit.
//
// Unlike the Weekly Pulse, the monthly survey does NOT block
// clock-out — so there's no "clock-out blocked" warning banner here.
//
// After submit, the page locks (server enforces uniqueness on
// userId + monthKey + questionId) and shows a thank-you card.

import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher } from "@/lib/swr";
import { ThumbsUp, Loader2, CheckCircle2 } from "lucide-react";
import { QuestionCard, type Q } from "../_QuestionCard";

type ThisMonth = {
  monthKey: string;
  monthLabel: string;
  questions: Q[];
  hasSubmitted: boolean;
  submittedAt: string | null;
};

export default function MonthlySurveyAnswerPage() {
  const { data, isLoading, mutate } = useSWR<ThisMonth>("/api/hr/pulse/this-month", fetcher);
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

  // Every non-text question needs a score chosen. Text is optional.
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
        // surveyType:"monthly" → the respond endpoint stores under
        // the monthKey cycle and validates against the monthly bank.
        body: JSON.stringify({ surveyType: "monthly", responses }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j?.error || `Submit failed (${res.status})`);
        return;
      }
      setJustSubmitted(true);
      await mutate();
      globalMutate("/api/hr/pulse/this-month");
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

  // No questions for this brand this month — friendly empty state
  // instead of a blank form (e.g. dev/sandbox accounts with no
  // businessUnit, or a brand whose monthly bank is empty).
  if (data.questions.length === 0 && !data.hasSubmitted) {
    return (
      <div className="min-h-screen bg-[#f4f7f8] p-6">
        <div className="max-w-2xl mx-auto">
          <header className="mb-5">
            <h1 className="text-[20px] font-semibold text-slate-900 inline-flex items-center gap-2">
              <ThumbsUp size={20} className="text-[#008CFF]" /> Monthly Survey
            </h1>
            <p className="mt-1 text-[13px] text-slate-500">{data.monthLabel}</p>
          </header>
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
            <p className="text-[13.5px] text-slate-500">
              There's no survey for you this month. Check back next month!
            </p>
          </div>
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
              <ThumbsUp size={20} className="text-[#008CFF]" /> Monthly Survey
            </h1>
            <p className="mt-1 text-[13px] text-slate-500">{data.monthLabel}</p>
          </header>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
            <CheckCircle2 size={28} className="text-emerald-600 mb-2" strokeWidth={2.25} />
            <h2 className="text-[16px] font-semibold text-emerald-900">Submitted — thank you!</h2>
            <p className="mt-1.5 text-[13px] text-emerald-800">
              Your response landed at {when}. Your honest feedback genuinely shapes what we improve next.
            </p>
            <p className="mt-3 text-[12px] text-emerald-700/80">
              The next engagement survey drops on the first Monday of next month. See you then!
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
            <ThumbsUp size={20} className="text-[#008CFF]" /> Monthly Survey
          </h1>
          <p className="mt-1 text-[13px] text-slate-500">
            {data.monthLabel} — 6 quick questions, ~3 minutes.
          </p>
        </header>

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3.5 mb-5 inline-flex items-start gap-2.5 w-full">
          <CheckCircle2 size={16} className="text-blue-700 mt-0.5 shrink-0" strokeWidth={2.25} />
          <p className="text-[12.5px] text-blue-900 leading-snug">
            <strong>Fully anonymous.</strong> Your individual answers are never shown — only aggregate trends. Clock-out is <strong>not</strong> blocked for this one.
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
            {submitting ? "Submitting…" : "Submit Survey"}
          </button>
        </div>
      </div>
    </div>
  );
}
