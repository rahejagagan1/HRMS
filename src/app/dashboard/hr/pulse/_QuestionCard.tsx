"use client";

// Shared question renderer for the employee pulse / survey forms.
// Used by both the Weekly Pulse page (../page.tsx) and the Monthly
// Survey page (./monthly/page.tsx). Extracted so the two forms stay
// pixel-identical and we don't maintain two copies of the emoji /
// rating / likert / enps / text widgets.

import { Activity, ThumbsUp, Star, Smile, MessageSquareText } from "lucide-react";

export type QType = "emoji" | "rating" | "likert" | "enps" | "text";
export type Q = {
  id: number;
  order: number;
  text: string;
  type: QType;
  emojis: string[] | null;
};

export const LIKERT_LABELS = ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"];

export function QuestionCard({
  q, answer, onScore, onComment,
}: {
  q: Q;
  answer?: { score: number | null; comment: string };
  onScore: (s: number) => void;
  onComment: (c: string) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[11.5px] font-bold tabular-nums mt-0.5">
          {q.order}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] text-slate-900 font-medium leading-snug">{q.text}</p>
          <p className="mt-1 text-[10.5px] uppercase tracking-[0.08em] font-semibold text-slate-400 inline-flex items-center gap-1.5">
            {q.type === "emoji"  && <><Smile size={11} className="text-slate-500" /> Pick one</>}
            {q.type === "rating" && <><Star size={11} className="text-slate-500" /> Star rating</>}
            {q.type === "likert" && <><Activity size={11} className="text-slate-500" /> Strongly Disagree → Strongly Agree</>}
            {q.type === "enps"   && <><ThumbsUp size={11} className="text-slate-500" /> 0–10 likelihood</>}
            {q.type === "text"   && <><MessageSquareText size={11} className="text-slate-500" /> Free text (optional)</>}
          </p>

          <div className="mt-3">
            {q.type === "emoji" && (
              <div className="inline-flex items-center gap-1.5 flex-wrap">
                {(q.emojis ?? ["😡", "😟", "😐", "🙂", "😄"]).map((e, idx) => {
                  const active = answer?.score === idx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onScore(idx)}
                      className={`h-10 w-10 rounded-md text-[20px] border transition-all ${
                        active
                          ? "bg-[#008CFF]/10 border-[#008CFF] ring-2 ring-[#008CFF]/30 scale-110"
                          : "bg-white border-slate-200 hover:border-slate-300"
                      }`}
                    >{e}</button>
                  );
                })}
              </div>
            )}

            {q.type === "rating" && (
              <div className="inline-flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => {
                  const filled = (answer?.score ?? 0) >= n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => onScore(n)}
                      className="p-1 transition-transform hover:scale-110"
                    >
                      <Star size={28} strokeWidth={1.5}
                        className={filled ? "text-amber-400 fill-amber-400" : "text-slate-300"} />
                    </button>
                  );
                })}
              </div>
            )}

            {q.type === "likert" && (
              <div className="max-w-md">
                <div className="grid grid-cols-5 gap-1.5">
                  {LIKERT_LABELS.map((label, idx) => {
                    const val = idx + 1;
                    const active = answer?.score === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => onScore(val)}
                        className={`h-14 rounded-md border text-[11px] font-semibold leading-tight px-1 transition-all flex flex-col items-center justify-center gap-0.5 ${
                          active
                            ? "bg-[#008CFF]/10 border-[#008CFF] text-[#008CFF] ring-2 ring-[#008CFF]/30"
                            : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
                        }`}
                      >
                        <span className="text-[14px] font-bold">{val}</span>
                        <span className="text-[9.5px] text-slate-500 leading-tight">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {q.type === "enps" && (
              <div>
                <div className="grid grid-cols-11 gap-1 max-w-md">
                  {Array.from({ length: 11 }).map((_, n) => {
                    const active = answer?.score === n;
                    const palette =
                      n <= 6 ? "rose"
                      : n <= 8 ? "amber"
                      : "emerald";
                    const baseColor =
                      palette === "rose"   ? (active ? "bg-rose-500 text-white border-rose-500"     : "bg-white text-rose-700 border-rose-200 hover:bg-rose-50")
                    : palette === "amber"  ? (active ? "bg-amber-500 text-white border-amber-500"   : "bg-white text-amber-700 border-amber-200 hover:bg-amber-50")
                    :                        (active ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50");
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => onScore(n)}
                        className={`h-9 rounded-md text-[12px] font-bold border transition-all ${baseColor} ${active ? "ring-2 ring-offset-1 ring-current/30 scale-105" : ""}`}
                      >{n}</button>
                    );
                  })}
                </div>
                <div className="mt-1.5 max-w-md flex items-center justify-between text-[10.5px] text-slate-400">
                  <span>Not at all likely</span>
                  <span>Extremely likely</span>
                </div>
              </div>
            )}

            {q.type === "text" && (
              <textarea
                value={answer?.comment ?? ""}
                onChange={(e) => onComment(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Optional — share what's on your mind"
                className="w-full max-w-md px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#008CFF] resize-none"
              />
            )}
          </div>

          {/* Optional comment box on non-text questions — collapsed by
              default so the answer flow stays fast; users can expand
              if they want to add context. */}
          {q.type !== "text" && (
            <details className="mt-2.5">
              <summary className="text-[11.5px] font-semibold text-slate-500 hover:text-slate-700 cursor-pointer select-none">
                + Add a note (optional)
              </summary>
              <textarea
                value={answer?.comment ?? ""}
                onChange={(e) => onComment(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="What's behind this answer? (kept anonymous in aggregate reports)"
                className="mt-2 w-full max-w-md px-3 py-2 border border-slate-200 rounded-lg text-[12.5px] bg-white focus:outline-none focus:border-[#008CFF] resize-none"
              />
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
