"use client";

// HR-side responses viewer. Lives inside PulseSurveysPanel under the
// "Responses" sub-tab. Shows aggregated stats — never individual
// answers. The API enforces this; this component just renders what
// comes back.

import { useEffect, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { Loader2, Users, TrendingUp, Smile, Star, Activity, ThumbsUp, MessageSquareText, ShieldCheck, Calendar } from "lucide-react";
import SelectField from "@/components/ui/SelectField";

type QStats = {
  id: number;
  order: number;
  text: string;
  type: "emoji" | "rating" | "likert" | "enps" | "text";
  emojis: string[] | null;
  stats: {
    count: number;
    average: number | null;
    distribution: Record<string, number> | null;
    enpsScore: number | null;
  };
  comments: string[];
};

type ResponsesPayload = {
  cycleKey: string;
  surveyType: "weekly" | "monthly";
  brand: "NB Media" | "YT Labs";
  participation: { responded: number; totalActiveUsers: number; percent: number };
  questions: QStats[];
};

const LIKERT_LABELS = ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"];

export default function PulseResponsesView({ initialBrand }: { initialBrand?: "NB Media" | "YT Labs" | "all" | null } = {}) {
  const [surveyType, setSurveyType] = useState<"weekly" | "monthly">("weekly");
  // Which cycle to view. "" = the live week/month (the API default);
  // any past cycleKey shows that week's/month's aggregates.
  const [cycleKey, setCycleKey] = useState<string>("");
  // Brand derived entirely from URL ?brand=… (passed via
  // initialBrand). No inline switcher — outer HR Dashboard brand
  // tab is the single source of truth.
  const brand: "NB Media" | "YT Labs" =
    initialBrand === "YT Labs" ? "YT Labs" : "NB Media";

  // Available cycles (newest first) for the past-weeks picker.
  const { data: cyclesData } = useSWR<{
    current: string;
    cycles: { key: string; label: string; responded: number; isCurrent: boolean }[];
  }>(
    `/api/hr/pulse/cycles?surveyType=${surveyType}&brand=${encodeURIComponent(brand)}`,
    fetcher,
  );

  const { data, isLoading } = useSWR<ResponsesPayload>(
    `/api/hr/pulse/responses?surveyType=${surveyType}&brand=${encodeURIComponent(brand)}${cycleKey ? `&cycleKey=${encodeURIComponent(cycleKey)}` : ""}`,
    fetcher,
  );

  // Switching survey type resets to that type's current cycle.
  const switchType = (t: "weekly" | "monthly") => { setSurveyType(t); setCycleKey(""); };

  const cycleOptions = (cyclesData?.cycles ?? []).map((c) => ({
    value: c.key,
    label: `${c.label}${c.isCurrent ? " · current" : ""}${c.responded ? ` · ${c.responded} responded` : ""}`,
  }));
  // Value shown in the picker: explicit pick, else the live cycle.
  const selectedCycle = cycleKey || cyclesData?.current || "";

  // The weekly pulse goes out Fridays, so the live week is often empty
  // mid-week. If HR hasn't picked a cycle and the current one has zero
  // responses, auto-jump to the most recent cycle that DOES have data —
  // so the Responses tab lands on real results, not a blank week.
  useEffect(() => {
    if (cycleKey || !cyclesData) return;          // respect an explicit pick
    const cur = cyclesData.cycles.find((c) => c.isCurrent);
    if (cur && cur.responded === 0) {
      const latestWithData = cyclesData.cycles.find((c) => c.responded > 0);
      if (latestWithData) setCycleKey(latestWithData.key);
    }
  }, [cyclesData, cycleKey]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3.5 inline-flex items-start gap-2.5 w-full">
        <ShieldCheck size={16} className="text-blue-700 mt-0.5 shrink-0" strokeWidth={2.25} />
        <div className="text-[12.5px] text-blue-900 leading-snug">
          <strong>All responses are anonymous.</strong> You see aggregate counts, averages, and the raw text of optional comments — but never who said what. The clock-out enforcement uses a separate "did this person submit?" check that doesn't touch this view.
        </div>
      </div>

      {/* Weekly / Monthly switcher + past-cycle picker */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          <button
            type="button"
            onClick={() => switchType("weekly")}
            className={`px-4 py-1.5 rounded-md text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
              surveyType === "weekly" ? "bg-white text-[#008CFF] shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Activity size={13} /> Weekly Pulse
          </button>
          <button
            type="button"
            onClick={() => switchType("monthly")}
            className={`px-4 py-1.5 rounded-md text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
              surveyType === "monthly" ? "bg-white text-[#008CFF] shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <ThumbsUp size={13} /> Monthly Survey
          </button>
        </div>

        {/* Past-cycle picker — browse any prior week / month. */}
        <div className="inline-flex items-center gap-2">
          <span className="text-[11.5px] font-semibold text-slate-500 inline-flex items-center gap-1.5">
            <Calendar size={13} /> {surveyType === "weekly" ? "Week" : "Month"}
          </span>
          <div className="w-[240px]">
            <SelectField
              value={selectedCycle}
              onChange={(v) => setCycleKey(v)}
              options={cycleOptions}
              placeholder={cyclesData ? "Select…" : "Loading…"}
              width={240}
            />
          </div>
        </div>
      </div>

      {/* (Brand picker removed — outer brand tab drives this panel.) */}

      {/* Cycle header + participation + brand badge */}
      {data && (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[10.5px] uppercase tracking-[0.08em] font-bold text-slate-400 mb-0.5 inline-flex items-center gap-2">
                <span>{surveyType === "weekly" ? "Week" : "Month"}</span>
                {/* Brand badge — colour-coded to match the question
                    cards on the other tab. Tells HR at a glance
                    which brand's data they're looking at. */}
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold tracking-normal normal-case ${
                  brand === "YT Labs"
                    ? "bg-[#d4143d]/10 text-[#d4143d]"
                    : "bg-[#008CFF]/10 text-[#008CFF]"
                }`}>
                  {brand}
                </span>
              </p>
              <h3 className="text-[16px] font-semibold text-slate-900">
                {cyclesData?.cycles.find((c) => c.key === data.cycleKey)?.label ?? data.cycleKey}
              </h3>
            </div>
            <div className="text-right">
              <p className="text-[10.5px] uppercase tracking-[0.08em] font-bold text-slate-400 mb-0.5 inline-flex items-center gap-1.5">
                <Users size={11} /> Participation
              </p>
              <p className="text-[16px] font-bold text-slate-900 tabular-nums">
                {data.participation.responded}/{data.participation.totalActiveUsers}
                <span className="ml-2 text-[12px] font-semibold text-slate-500">({data.participation.percent}%)</span>
              </p>
              <p className="text-[10.5px] text-slate-400 mt-0.5">
                {brand} employees only
              </p>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <Loader2 size={20} className="mx-auto animate-spin text-slate-400" />
        </div>
      ) : !data || data.questions.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-[13px] text-slate-500">
          No responses yet for this cycle.
        </div>
      ) : (
        <div className="space-y-3">
          {data.questions.map((q) => <ResponseCard key={q.id} q={q} />)}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
function ResponseCard({ q }: { q: QStats }) {
  const { stats } = q;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[11.5px] font-bold tabular-nums mt-0.5">
          {q.order}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] text-slate-900 font-medium leading-snug">{q.text}</p>
          <p className="mt-1 text-[10.5px] uppercase tracking-[0.08em] font-semibold text-slate-400 inline-flex items-center gap-1.5">
            <TypeIcon type={q.type} />
            {q.type === "enps" ? "eNPS · 0–10" :
             q.type === "likert" ? "Likert · 1–5" :
             q.type === "rating" ? "Star rating · 1–5" :
             q.type === "emoji" ? "Emoji reaction" : "Free text"}
            <span className="text-slate-300">·</span>
            <span className="text-slate-600 normal-case tracking-normal">{stats.count} response{stats.count === 1 ? "" : "s"}</span>
          </p>

          {/* Stats panel — type-specific renderer */}
          <div className="mt-3.5">
            {q.type === "enps" && (
              <ENPSStats stats={stats} />
            )}
            {(q.type === "likert" || q.type === "rating") && (
              <NumericStats stats={stats} max={5} labels={q.type === "likert" ? LIKERT_LABELS : undefined} />
            )}
            {q.type === "emoji" && (
              <EmojiStats stats={stats} emojis={q.emojis ?? ["😡","😟","😐","🙂","😄"]} />
            )}
            {q.type === "text" && q.comments.length === 0 && (
              <p className="text-[12px] text-slate-400 italic">No comments submitted.</p>
            )}
          </div>

          {/* Comments — shown for both text questions AND non-text
              questions that received optional notes. Always anonymous. */}
          {q.comments.length > 0 && (
            <div className="mt-4">
              <p className="text-[10.5px] uppercase tracking-[0.08em] font-bold text-slate-400 mb-2 inline-flex items-center gap-1.5">
                <MessageSquareText size={11} /> Anonymous comments ({q.comments.length})
              </p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {q.comments.map((c, i) => (
                  <div key={i} className="text-[12.5px] text-slate-700 leading-snug px-3 py-2 bg-slate-50 border border-slate-200 rounded-md">
                    "{c}"
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TypeIcon({ type }: { type: QStats["type"] }) {
  const Icon = {
    emoji:  Smile,
    rating: Star,
    likert: Activity,
    enps:   ThumbsUp,
    text:   MessageSquareText,
  }[type];
  return <Icon size={11} strokeWidth={2.25} className="text-slate-500" />;
}

// ─────────────────────────────────────────────────────────────────
function ENPSStats({ stats }: { stats: QStats["stats"] }) {
  const dist = stats.distribution ?? {};
  const total = stats.count;
  let promoters = 0, passives = 0, detractors = 0;
  for (let n = 0; n <= 10; n++) {
    const c = dist[String(n)] ?? 0;
    if (n <= 6) detractors += c;
    else if (n <= 8) passives += c;
    else promoters += c;
  }
  const enps = stats.enpsScore ?? 0;
  const enpsColor = enps >= 50 ? "text-emerald-600" : enps >= 20 ? "text-blue-600" : enps >= 0 ? "text-amber-600" : "text-rose-600";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">eNPS</p>
          <p className={`text-[24px] font-bold tabular-nums leading-none ${enpsColor}`}>{enps > 0 ? `+${enps}` : enps}</p>
        </div>
        <div className="flex items-center gap-3 text-[11.5px] text-slate-600">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Promoters <strong>{promoters}</strong></span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Passives <strong>{passives}</strong></span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> Detractors <strong>{detractors}</strong></span>
        </div>
      </div>
      {/* 0-10 distribution bars */}
      <div className="grid grid-cols-11 gap-1 max-w-md">
        {Array.from({ length: 11 }).map((_, n) => {
          const c = dist[String(n)] ?? 0;
          const pct = total > 0 ? (c / total) * 100 : 0;
          const palette =
            n <= 6 ? "bg-rose-200"
            : n <= 8 ? "bg-amber-200"
            : "bg-emerald-200";
          return (
            <div key={n} className="flex flex-col items-center gap-0.5">
              <div className="h-12 w-full rounded-sm bg-slate-100 relative overflow-hidden">
                <div className={`absolute bottom-0 left-0 right-0 ${palette}`} style={{ height: `${pct}%` }} />
              </div>
              <span className="text-[9.5px] font-semibold text-slate-500 tabular-nums">{n}</span>
              <span className="text-[9px] text-slate-400 tabular-nums">{c}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NumericStats({ stats, max, labels }: { stats: QStats["stats"]; max: number; labels?: string[] }) {
  const dist = stats.distribution ?? {};
  const total = stats.count;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Avg</p>
          <p className="text-[24px] font-bold tabular-nums leading-none text-slate-900">
            {stats.average?.toFixed(2) ?? "—"}
            <span className="text-[12px] font-medium text-slate-400 ml-1">/ {max}</span>
          </p>
        </div>
      </div>
      <div className="space-y-1.5 max-w-md">
        {Array.from({ length: max }).map((_, i) => {
          const n = i + 1;
          const c = dist[String(n)] ?? 0;
          const pct = total > 0 ? (c / total) * 100 : 0;
          return (
            <div key={n} className="flex items-center gap-2">
              <span className="w-4 text-[11px] font-semibold text-slate-600 tabular-nums">{n}</span>
              <div className="flex-1 h-4 rounded-sm bg-slate-100 relative overflow-hidden">
                <div className="absolute inset-y-0 left-0 bg-violet-300" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-8 text-[11px] text-slate-600 tabular-nums text-right">{c}</span>
              {labels && (
                <span className="w-32 text-[10.5px] text-slate-500">{labels[i]}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmojiStats({ stats, emojis }: { stats: QStats["stats"]; emojis: string[] }) {
  const dist = stats.distribution ?? {};
  const total = stats.count;
  return (
    <div className="space-y-1.5 max-w-md">
      {emojis.map((emoji, idx) => {
        const c = dist[String(idx)] ?? 0;
        const pct = total > 0 ? (c / total) * 100 : 0;
        return (
          <div key={idx} className="flex items-center gap-2">
            <span className="w-6 text-[16px] text-center">{emoji}</span>
            <div className="flex-1 h-4 rounded-sm bg-slate-100 relative overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-amber-300" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-8 text-[11px] text-slate-600 tabular-nums text-right">{c}</span>
            <span className="w-12 text-[10.5px] text-slate-400 tabular-nums">{pct.toFixed(0)}%</span>
          </div>
        );
      })}
    </div>
  );
}
