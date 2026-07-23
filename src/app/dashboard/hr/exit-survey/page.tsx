"use client";

// Employee-facing Exit Survey. Shown to leaving employees (filed exit,
// last working day within the window). Must be submitted before they can
// clock out — the clock-out route enforces that; this is where they do it.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Check, ClipboardList, ArrowLeft } from "lucide-react";
import { EXIT_SURVEY, ALL_EXIT_QUESTIONS, validateExitResponses, type ExitQuestion } from "@/lib/hr/exit-survey-spec";

type Answers = Record<string, string | number>;

// NOTE: these (and Shell) are module-scope ON PURPOSE. Defining a
// component inside the page body gives it a new identity every render,
// so React remounts the whole subtree on each keystroke — which stole
// focus and scrolled the form to the top while typing. Keeping them out
// here fixes that.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f4f7fb]">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}

function RatingScale({ max, value, onChange, lowLabel, highLabel }: {
  max: number; value: number | undefined; onChange: (n: number) => void; lowLabel?: string; highLabel?: string;
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${n} of ${max}`}
            className={`h-9 min-w-[36px] rounded-lg text-[13px] font-semibold ring-1 transition-all ${
              value === n
                ? "bg-[#008CFF] text-white ring-[#008CFF] shadow-sm"
                : "bg-white text-slate-600 ring-slate-200 hover:text-[#008CFF] hover:ring-[#008CFF]/50"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      {(lowLabel || highLabel) && (
        <div className="mt-1.5 flex justify-between text-[10.5px] text-slate-400">
          <span>{lowLabel}</span><span>{highLabel}</span>
        </div>
      )}
    </div>
  );
}

function Choice({ options, value, onChange }: { options: string[]; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded-lg px-3.5 py-2 text-[12.5px] font-medium ring-1 transition-all ${
            value === o
              ? "bg-[#008CFF] text-white ring-[#008CFF] shadow-sm"
              : "bg-white text-slate-600 ring-slate-200 hover:text-[#008CFF] hover:ring-[#008CFF]/50"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function fmtDate(d: string) {
  return new Date(`${d.length <= 10 ? d + "T00:00:00Z" : d}`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export default function ExitSurveyPage() {
  const [loading, setLoading] = useState(true);
  const [inWindow, setInWindow] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [lastWorkingDay, setLastWorkingDay] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/hr/exit-survey");
        const j = await r.json().catch(() => ({}));
        setInWindow(!!j.inWindow);
        setSubmitted(!!j.submitted);
        setLastWorkingDay(j.lastWorkingDay ?? null);
        if (j.answers && typeof j.answers === "object") setAnswers(j.answers);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = (id: string, v: string | number) => setAnswers((a) => ({ ...a, [id]: v }));
  const visible = (q: ExitQuestion) => !q.showIf || String(answers[q.showIf.id] ?? "") === q.showIf.equals;
  const valid = useMemo(() => validateExitResponses(answers).ok, [answers]);

  // Progress over the currently-required (visible) questions.
  const { answeredRequired, requiredTotal, pct } = useMemo(() => {
    const req = ALL_EXIT_QUESTIONS.filter((q) => q.required && (!q.showIf || String(answers[q.showIf.id] ?? "") === q.showIf.equals));
    const done = req.filter((q) => { const v = answers[q.id]; return v !== undefined && v !== null && String(v).trim() !== ""; }).length;
    return { answeredRequired: done, requiredTotal: req.length, pct: req.length ? Math.round((done / req.length) * 100) : 0 };
  }, [answers]);

  const submit = async () => {
    const v = validateExitResponses(answers);
    if (!v.ok) { setError(v.error); return; }
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/hr/exit-survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j?.error || `Submit failed (${r.status})`); return; }
      setSubmitted(true); setJustSubmitted(true);
    } catch (e: any) {
      setError(e?.message || "Submit failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-slate-400"><Loader2 className="animate-spin" /></div>;
  }

  if (!inWindow) {
    return (
      <Shell>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <ClipboardList className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <h1 className="text-[16px] font-semibold text-slate-800">No exit survey pending</h1>
          <p className="mt-1 text-[13px] text-slate-500">You don&apos;t have an exit survey to fill right now.</p>
          <Link href="/dashboard/hr/home" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#008CFF] hover:underline"><ArrowLeft size={14} /> Back to dashboard</Link>
        </div>
      </Shell>
    );
  }

  if (submitted) {
    return (
      <Shell>
        <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Check size={24} /></div>
          <h1 className="text-[16px] font-semibold text-slate-800">Thank you — exit survey submitted</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            {justSubmitted ? "Your feedback has been shared with HR. You can now clock out." : "You've already completed your exit survey."}
          </p>
          <Link href="/dashboard/hr/home" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#008CFF] hover:underline"><ArrowLeft size={14} /> Back to dashboard</Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Hero header + live progress */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
        <div className="flex items-start gap-3 bg-gradient-to-r from-[#008CFF] to-[#0061c3] bg-[#008CFF] px-6 py-5 text-white">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20"><ClipboardList size={20} /></span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[18px] font-semibold leading-tight">Exit Survey</h1>
            <p className="mt-0.5 text-[12.5px] text-white/85">Your honest feedback helps us improve. It takes about 5 minutes.</p>
          </div>
          {lastWorkingDay && (
            <span className="hidden shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium sm:inline-block">
              Last day · {fmtDate(lastWorkingDay)}
            </span>
          )}
        </div>
        <div className="px-6 py-3">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-slate-500">{answeredRequired} of {requiredTotal} required answered</span>
            <span className="font-semibold text-[#008CFF]">{pct}%</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-[#008CFF] transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {EXIT_SURVEY.map((section, si) => (
          <section key={section.title} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#008CFF]/10 text-[12px] font-bold text-[#008CFF]">{si + 1}</span>
              <div className="min-w-0">
                <h2 className="text-[14px] font-semibold text-slate-800">{section.title}</h2>
                {section.description && <p className="text-[11.5px] text-slate-500">{section.description}</p>}
              </div>
            </header>
            <div className="divide-y divide-slate-50">
              {section.questions.filter(visible).map((q) => (
                <div key={q.id} className="px-5 py-3.5">
                  <label className="mb-2 block text-[13px] font-medium text-slate-700">
                    {q.label}{q.required && <span className="ml-0.5 text-rose-500">*</span>}
                  </label>
                  {q.type === "rating5"     && <RatingScale max={5}  value={answers[q.id] as number} onChange={(n) => set(q.id, n)} lowLabel="Very dissatisfied" highLabel="Very satisfied" />}
                  {q.type === "rating10"    && <RatingScale max={10} value={answers[q.id] as number} onChange={(n) => set(q.id, n)} lowLabel="Not likely" highLabel="Very likely" />}
                  {q.type === "single"      && <Choice options={q.options || []} value={answers[q.id] as string} onChange={(v) => set(q.id, v)} />}
                  {q.type === "yesno"       && <Choice options={["Yes", "No"]} value={answers[q.id] as string} onChange={(v) => set(q.id, v)} />}
                  {q.type === "yesnomaybe"  && <Choice options={["Yes", "No", "Maybe"]} value={answers[q.id] as string} onChange={(v) => set(q.id, v)} />}
                  {q.type === "text"        && (
                    <textarea
                      value={(answers[q.id] as string) || ""}
                      onChange={(e) => set(q.id, e.target.value)}
                      rows={3}
                      className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#008CFF]/50 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/15"
                      placeholder="Type your answer…"
                    />
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {error && <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</div>}

      <div className="sticky bottom-3 mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 px-5 py-3 shadow-[0_4px_16px_-4px_rgba(15,23,42,0.12)] backdrop-blur">
        <p className="text-[11.5px] text-slate-500">{valid ? "✓ All required questions answered." : `${requiredTotal - answeredRequired} required left`}</p>
        <button
          onClick={submit}
          disabled={busy || !valid}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#008CFF] px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#0070cc] disabled:opacity-60"
        >
          {busy ? <><Loader2 size={15} className="animate-spin" /> Submitting…</> : "Submit exit survey"}
        </button>
      </div>
    </Shell>
  );
}
