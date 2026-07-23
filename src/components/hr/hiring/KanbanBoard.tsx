"use client";

// Per-job kanban pipeline. Renders one column per HiringStage with
// candidate cards stacked inside. HTML5 drag-and-drop moves cards
// between columns and PATCHes /api/hr/hiring/candidates/[id]
// { action: "moveStage", stageId }.
//
// Click a card → opens the CandidateDrawer for that candidate.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUrlState } from "@/lib/hooks/useUrlState";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher } from "@/lib/swr";
import { showToast } from "@/components/ui/Toast";
import { Star, Clock, Mail, Phone, Briefcase, ExternalLink, MessageSquare, ChevronDown } from "lucide-react";
import CandidateDrawer from "./CandidateDrawer";
import ArchiveCandidateModal from "./ArchiveCandidateModal";

type Stage = { id: number; key: string; label: string; sortOrder: number; kind: string; color: string };
type Candidate = {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  experienceYears: number | null;
  currentCompany: string | null;
  resumeUrl: string | null;
  source: string | null;
  overallRating: number | null;
  currentStage: Stage | null;
  enteredStageAt: string | null;
  jobOpeningId: number;
  roleTitle: string | null;
  createdAt: string;
};

const ACCENTS: Record<string, string> = {
  slate:    "border-t-slate-400  bg-slate-50",
  blue:     "border-t-blue-400   bg-blue-50",
  cyan:     "border-t-cyan-400   bg-cyan-50",
  violet:   "border-t-violet-400 bg-violet-50",
  amber:    "border-t-amber-400  bg-amber-50",
  pink:     "border-t-pink-400   bg-pink-50",
  emerald:  "border-t-emerald-400 bg-emerald-50",
  rose:     "border-t-rose-400   bg-rose-50",
};

function daysSince(d: string | null): string {
  if (!d) return "";
  const ms = Date.now() - new Date(d).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

export default function KanbanBoard({ jobId }: { jobId: number }) {
  // Cards mid-move. Declared above the fetch so we can PAUSE polling
  // during a drag — otherwise an in-flight poll could revert the
  // optimistic move before its PATCH commits.
  const [moving, setMoving] = useState<Set<number>>(new Set());
  const { data: stagesData } = useSWR<{ stages: Stage[] }>("/api/hr/hiring/stages", fetcher);
  const { data: candidatesData, isLoading } = useSWR<{ candidates: Candidate[] }>(
    `/api/hr/hiring/candidates?openingId=${jobId}`,
    fetcher,
    // Auto-refresh so moves made in the List view, the candidate drawer,
    // or by another HR user surface here without a reload. Paused mid-move;
    // SWR also revalidates on tab focus.
    { refreshInterval: moving.size > 0 ? 0 : 8000 },
  );
  const stages = stagesData?.stages ?? [];
  const candidates = candidatesData?.candidates ?? [];

  const byStage = useMemo(() => {
    const m = new Map<number, Candidate[]>();
    for (const s of stages) m.set(s.id, []);
    const orphan: Candidate[] = [];
    for (const c of candidates) {
      const sid = c.currentStage?.id;
      if (sid && m.has(sid)) m.get(sid)!.push(c);
      else orphan.push(c);
    }
    return { m, orphan };
  }, [stages, candidates]);

  const [dragOver, setDragOver] = useState<number | null>(null);
  // Candidate currently being archived via drag-into-Rejected. When set,
  // the ArchiveCandidateModal renders so HR picks a reason + emails the
  // candidate, instead of the drag silently flipping the stage.
  const [archivingCandidate, setArchivingCandidate] = useState<Candidate | null>(null);
  // selectedId is URL-derived (`?candidate=<id>`) so reload reopens
  // the same drawer. Shared key with JobApplicantList — switching
  // Kanban <-> List preserves the open drawer.
  const [selectedIdUrl, setSelectedIdUrl] = useUrlState("candidate");
  const selectedId = selectedIdUrl ? Number(selectedIdUrl) : null;
  const setSelectedId = useCallback(
    (n: number | null) => setSelectedIdUrl(n != null ? String(n) : null),
    [setSelectedIdUrl],
  );

  // CandidateDrawer's "1 of N" pager dispatches this event when HR
  // clicks the prev/next chevrons. Mirror listener from
  // JobApplicantList + CandidatesTab so the pager works in Kanban
  // view too.
  useEffect(() => {
    function onNav(e: Event) {
      const id = (e as CustomEvent<number>).detail;
      if (Number.isInteger(id)) setSelectedId(Number(id));
    }
    window.addEventListener("nb:candidateDrawer:navigate", onNav as any);
    return () => window.removeEventListener("nb:candidateDrawer:navigate", onNav as any);
  }, [setSelectedId]);

  const onDrop = async (stageId: number, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const candidateId = Number(e.dataTransfer.getData("text/candidate-id"));
    if (!Number.isFinite(candidateId)) return;
    const curr = candidates.find((c) => c.id === candidateId);
    if (!curr || curr.currentStage?.id === stageId) return;
    // Already moving this card — ignore a second drag so two PATCHes can't
    // race and land out of order.
    if (moving.has(candidateId)) return;

    // Drop into the "Rejected" column → funnel HR into the Archive
    // modal (reason + email) instead of a silent stage flip. The
    // modal does its own backend call to move the card to rejected.
    const target = stages.find((s) => s.id === stageId);
    if (target?.kind === "rejected") {
      setArchivingCandidate(curr);
      return;
    }

    setMoving((prev) => new Set(prev).add(candidateId));
    // Optimistic patch — update SWR cache first so the card jumps
    // instantly, then the API call reconciles.
    const targetStage = stages.find((s) => s.id === stageId) ?? null;
    globalMutate(
      `/api/hr/hiring/candidates?openingId=${jobId}`,
      (prev: any) => prev
        ? {
            ...prev,
            candidates: prev.candidates.map((c: Candidate) =>
              c.id === candidateId
                ? { ...c, currentStage: targetStage, enteredStageAt: new Date().toISOString() }
                : c,
            ),
          }
        : prev,
      { revalidate: false },
    );
    try {
      const res = await fetch(`/api/hr/hiring/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "moveStage", stageId }),
      });
      if (!res.ok) showToast("Couldn't move the candidate — reverting.", "error");
    } catch {
      showToast("Couldn't move the candidate — reverting.", "error");
    } finally {
      setMoving((prev) => {
        const next = new Set(prev); next.delete(candidateId); return next;
      });
      // Revalidate so server is the source of truth.
      globalMutate(`/api/hr/hiring/candidates?openingId=${jobId}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="shrink-0 w-[280px] h-[400px] rounded-xl bg-slate-100 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((s) => {
          const items = byStage.m.get(s.id) ?? [];
          const accent = ACCENTS[s.color] || ACCENTS.slate;
          const isHover = dragOver === s.id;
          return (
            <div
              key={s.id}
              onDragOver={(e) => { e.preventDefault(); setDragOver(s.id); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => onDrop(s.id, e)}
              className={`shrink-0 w-[300px] rounded-xl border-t-4 ${accent} bg-white border border-slate-200 transition-shadow ${
                isHover ? "ring-2 ring-[#008CFF]/40 shadow-lg" : "shadow-sm"
              }`}
            >
              {/* Column header */}
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] font-bold uppercase tracking-wider text-slate-700">{s.label}</span>
                  <span className="inline-flex items-center justify-center min-w-[22px] h-[18px] px-1.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                    {items.length}
                  </span>
                </div>
              </div>

              {/* Cards */}
              <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
                {items.length === 0 && (
                  <p className="text-[11px] text-slate-400 text-center py-6">No candidates</p>
                )}
                {items.map((c) => {
                  const isMoving = moving.has(c.id);
                  return (
                    <button
                      key={c.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/candidate-id", String(c.id))}
                      onClick={() => setSelectedId(c.id)}
                      className={`group block w-full text-left bg-white rounded-lg border border-slate-200 hover:border-[#008CFF]/40 hover:shadow-md transition-all p-3 ${
                        isMoving ? "opacity-50" : ""
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="h-8 w-8 shrink-0 rounded-full bg-[#008CFF]/10 text-[#008CFF] flex items-center justify-center text-[11px] font-bold">
                          {initials(c.fullName)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12.5px] font-semibold text-slate-800 truncate">{c.fullName}</p>
                          {c.currentCompany && (
                            <p className="text-[11px] text-slate-500 truncate flex items-center gap-1 mt-0.5">
                              <Briefcase size={10} /> {c.currentCompany}
                            </p>
                          )}
                          {c.experienceYears != null && (
                            <p className="text-[11px] text-slate-400 mt-0.5">{c.experienceYears} yrs exp</p>
                          )}
                        </div>
                        {c.overallRating && (
                          <div className="flex items-center gap-0.5 text-[10px] text-amber-600">
                            <Star size={11} fill="currentColor" />
                            <span className="font-semibold">{c.overallRating}</span>
                          </div>
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <Clock size={10} /> {daysSince(c.enteredStageAt)}
                        </span>
                        {c.source && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                            {c.source}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Orphan candidates (no stage assigned yet — legacy rows) */}
      {byStage.orphan.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/40 px-4 py-2 text-[11px] text-amber-700">
          {byStage.orphan.length} candidate(s) haven't been assigned a stage yet — drag them into the right column or reassign via the candidate drawer.
        </div>
      )}

      {selectedId != null && (
        <CandidateDrawer
          candidateId={selectedId}
          onClose={() => setSelectedId(null)}
          onChange={() => globalMutate(`/api/hr/hiring/candidates?openingId=${jobId}`)}
        />
      )}

      {archivingCandidate && (
        <ArchiveCandidateModal
          candidate={{
            id: archivingCandidate.id,
            fullName: archivingCandidate.fullName,
            email: archivingCandidate.email,
            roleTitle: archivingCandidate.roleTitle,
          }}
          onClose={() => setArchivingCandidate(null)}
          onDone={() => globalMutate(`/api/hr/hiring/candidates?openingId=${jobId}`)}
        />
      )}
    </>
  );
}
