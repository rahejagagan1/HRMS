"use client";

// Talent Pool — placeholder for v1. Surfaces past candidates whose
// applications were rejected or whose role closed but who looked
// strong. Backed by JobApplication rows with status in
// ("rejected", "hired" for past roles). Full talent-pool model with
// tags + saved-search comes in a follow-up.

import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { Bookmark, Star, Mail } from "lucide-react";
import { useState } from "react";
import CandidateDrawer from "./CandidateDrawer";

type Candidate = {
  id: number; fullName: string; email: string;
  experienceYears: number | null; currentCompany: string | null;
  overallRating: number | null; roleTitle: string | null;
  source: string | null; createdAt: string;
  currentStage: { key: string; label: string } | null;
};

export default function TalentPoolTab() {
  const { data, isLoading } = useSWR<{ candidates: Candidate[] }>("/api/hr/hiring/candidates", fetcher);
  const candidates = data?.candidates ?? [];

  // Talent pool heuristic for v1: candidates who were rejected but had
  // overallRating >= 3 (HR liked them but didn't fit THIS role). HR can
  // reach out for future openings.
  const pool = candidates.filter(
    (c) => (c.currentStage?.key === "rejected" || c.currentStage?.key === "hired") && (c.overallRating ?? 0) >= 3,
  );

  const [activeId, setActiveId] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-violet-50/30 px-4 py-3 flex items-start gap-2.5">
        <Bookmark size={14} className="text-violet-500 mt-0.5 shrink-0" />
        <div className="text-[12px] text-violet-700">
          <strong>Talent Pool (v1)</strong> — Candidates rated 3+ stars on a past role. Reach out when a similar role opens. Saved searches + tagging coming in the next iteration.
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        {isLoading ? (
          <div className="py-16 text-center"><div className="inline-block h-7 w-7 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" /></div>
        ) : pool.length === 0 ? (
          <p className="py-16 text-center text-[12.5px] text-slate-400">No talent pool candidates yet. Rate strong candidates 3+ stars before rejecting them and they'll appear here.</p>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {["CANDIDATE", "RATING", "EXPERIENCE", "PAST ROLE", "STATUS", "EMAIL"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pool.map((c) => (
                <tr key={c.id} onClick={() => setActiveId(c.id)} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 cursor-pointer transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-[12.5px] font-semibold text-slate-800">{c.fullName}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{c.currentCompany || "—"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-0.5 text-amber-600 font-semibold text-[12px]">
                      <Star size={11} fill="currentColor" /> {c.overallRating}/5
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-slate-700">{c.experienceYears != null ? `${c.experienceYears} yrs` : "—"}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-700">{c.roleTitle || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      c.currentStage?.key === "hired" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                    }`}>{c.currentStage?.label || "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-[11.5px]">
                    <a className="text-[#008CFF] hover:underline inline-flex items-center gap-1" href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()}>
                      <Mail size={10} /> Reach out
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {activeId != null && (<CandidateDrawer candidateId={activeId} onClose={() => setActiveId(null)} />)}
    </div>
  );
}
