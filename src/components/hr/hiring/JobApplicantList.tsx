"use client";

// Per-job applicant LIST view — the flat-table counterpart to
// KanbanBoard. Same data source (`/api/hr/hiring/candidates?openingId`)
// so HR can flip between Kanban + List with no perceived data delta.
//
// Each row opens the CandidateDrawer on click. Stage can be moved
// inline via the stage select — same backend action as the kanban
// drag-and-drop. Sortable by name, stage, applied-on, and source.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUrlState } from "@/lib/hooks/useUrlState";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher } from "@/lib/swr";
import {
  Mail, Phone, Briefcase, Star, Clock, ChevronUp, ChevronDown, FileText, Users, Archive,
  Search, X,
} from "lucide-react";
import CandidateDrawer from "./CandidateDrawer";
import AddApplicantModal from "./AddApplicantModal";
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
  resumeFileName?: string | null;
  source: string | null;
  // Set when source === "referral" — { id, name } of the
  // employee who referred this candidate.
  referredBy?: { id: number; name: string } | null;
  overallRating: number | null;
  currentStage: Stage | null;
  enteredStageAt: string | null;
  jobOpeningId: number;
  roleTitle: string | null;
  createdAt: string;
  /** Set by ArchiveCandidateModal — null until HR archives them. */
  archivedAt:    string | null;
  archiveReason: string | null;
};

// A candidate is "archived" when HR explicitly archived them OR the
// stage they sit in is terminal-rejected. Either way, the list view
// flags them with the badge so HR can see they're out of the
// pipeline at a glance.
function isArchived(c: Candidate): boolean {
  return !!c.archivedAt || c.currentStage?.kind === "rejected";
}

type SortKey = "name" | "stage" | "applied" | "source";
type SortDir = "asc" | "desc";

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}
function daysSince(d: string | null): string {
  if (!d) return "—";
  const ms = Date.now() - new Date(d).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// Two-channel tone — the chip body (subtle bg + text) and the left
// accent dot (saturated). Gives stages a distinct visual anchor
// without screaming.
const STAGE_TONE: Record<string, { chip: string; dot: string; ring: string }> = {
  slate:   { chip: "bg-slate-50   text-slate-700",   dot: "bg-slate-400",   ring: "ring-slate-200"   },
  blue:    { chip: "bg-blue-50    text-blue-700",    dot: "bg-blue-500",    ring: "ring-blue-200"    },
  cyan:    { chip: "bg-cyan-50    text-cyan-700",    dot: "bg-cyan-500",    ring: "ring-cyan-200"    },
  violet:  { chip: "bg-violet-50  text-violet-700",  dot: "bg-violet-500",  ring: "ring-violet-200"  },
  amber:   { chip: "bg-amber-50   text-amber-700",   dot: "bg-amber-500",   ring: "ring-amber-200"   },
  pink:    { chip: "bg-pink-50    text-pink-700",    dot: "bg-pink-500",    ring: "ring-pink-200"    },
  emerald: { chip: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", ring: "ring-emerald-200" },
  rose:    { chip: "bg-rose-50    text-rose-700",    dot: "bg-rose-500",    ring: "ring-rose-200"    },
};

export default function JobApplicantList({ jobId, jobTitle = "this job" }: { jobId: number; jobTitle?: string }) {
  // Candidates mid-move. Declared above the fetch so we can PAUSE polling
  // during a move — otherwise an in-flight poll could revert the
  // optimistic stage change before its PATCH commits.
  const [moving, setMoving] = useState<Set<number>>(new Set());
  // Candidate being archived via the per-row stage dropdown. When set,
  // the ArchiveCandidateModal renders so HR picks a reason + closing
  // email — same flow as the drawer dropdown / Kanban drop / row menu.
  const [archivingCandidate, setArchivingCandidate] = useState<Candidate | null>(null);
  const { data: stagesData } = useSWR<{ stages: Stage[] }>("/api/hr/hiring/stages", fetcher);
  const { data: candidatesData, isLoading } = useSWR<{ candidates: Candidate[] }>(
    `/api/hr/hiring/candidates?openingId=${jobId}`,
    fetcher,
    // Auto-refresh so stage moves made elsewhere (Kanban view, the
    // candidate drawer, or another HR user) surface here without a manual
    // reload. Paused mid-move; SWR also revalidates on tab focus.
    { refreshInterval: moving.size > 0 ? 0 : 8000 },
  );
  const stages     = stagesData?.stages ?? [];
  const candidates = candidatesData?.candidates ?? [];

  const [sortKey, setSortKey] = useState<SortKey>("applied");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Add-applicant drawer toggle — opened from the tab strip
  // "+ Add applicant" button.
  const [addOpen, setAddOpen] = useState(false);
  // selectedId is URL-derived (`?candidate=<id>`) so a hard reload
  // reopens the same candidate's drawer. Stored as string in the
  // URL; we coerce to number at the React boundary.
  const [selectedIdUrl, setSelectedIdUrl] = useUrlState("candidate");
  const selectedId = selectedIdUrl ? Number(selectedIdUrl) : null;
  const setSelectedId = useCallback(
    (n: number | null) => setSelectedIdUrl(n != null ? String(n) : null),
    [setSelectedIdUrl],
  );

  // CandidateDrawer's "1 of N" pager dispatches this event when HR
  // clicks the prev/next chevrons. We listen here so the drawer can
  // switch to the next sibling without remounting. The matching
  // listener lives in CandidatesTab too (the global candidates
  // page) — same event, same intent, two consumers.
  useEffect(() => {
    function onNav(e: Event) {
      const id = (e as CustomEvent<number>).detail;
      if (Number.isInteger(id)) setSelectedId(Number(id));
    }
    window.addEventListener("nb:candidateDrawer:navigate", onNav as any);
    return () => window.removeEventListener("nb:candidateDrawer:navigate", onNav as any);
  }, [setSelectedId]);

  // Tab filter — lets HR slice the candidate list by lifecycle
  // bucket without scrolling/searching. Buckets:
  //   • "all"          — everyone (default)
  //   • "new"          — currentStage.key === "sourced" AND not archived
  //                       (i.e. just applied, hasn't been screened yet)
  //   • "in_progress"  — past sourcing AND not archived AND not hired
  //                       (screening / interview / offer / etc.)
  //   • "archived"     — explicit archive OR stage.kind === "rejected"
  type TabKey = "all" | "new" | "in_progress" | "archived";
  const [tab, setTab] = useState<TabKey>("all");
  // Free-text filter — matches name / email / phone, case-insensitive.
  // Combines with the active tab (search within the current bucket).
  const [query, setQuery] = useState("");
  const bucketOf = (c: Candidate): Exclude<TabKey, "all"> => {
    if (isArchived(c)) return "archived";
    if (c.currentStage?.key === "sourced") return "new";
    return "in_progress";
  };
  const counts = useMemo(() => {
    const b = { all: candidates.length, new: 0, in_progress: 0, archived: 0 };
    for (const c of candidates) b[bucketOf(c)]++;
    return b;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const byTab = tab === "all"
      ? candidates
      : candidates.filter((c) => bucketOf(c) === tab);
    const q = query.trim().toLowerCase();
    const filtered = q
      ? byTab.filter((c) =>
          c.fullName.toLowerCase().includes(q) ||
          (c.email ?? "").toLowerCase().includes(q) ||
          (c.phone ?? "").toLowerCase().includes(q))
      : byTab;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "name":   return a.fullName.localeCompare(b.fullName) * dir;
        case "stage":  return ((a.currentStage?.sortOrder ?? 0) - (b.currentStage?.sortOrder ?? 0)) * dir;
        case "source": return ((a.source ?? "").localeCompare(b.source ?? "")) * dir;
        case "applied":
        default:       return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, sortKey, sortDir, tab, query]);

  const moveStage = async (candidateId: number, stageId: number) => {
    const curr = candidates.find((c) => c.id === candidateId);
    if (!curr || curr.currentStage?.id === stageId) return;
    // Stage → Rejected funnels through the Archive modal (reason + closing
    // email) instead of a silent stage flip. Matches the same gate on the
    // drawer dropdown / Kanban drop / row context-menu.
    const target = stages.find((s) => s.id === stageId);
    if (target?.kind === "rejected") {
      setArchivingCandidate(curr);
      return;
    }
    setMoving((p) => new Set(p).add(candidateId));
    const targetStage = stages.find((s) => s.id === stageId) ?? null;
    // Optimistic patch.
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
      await fetch(`/api/hr/hiring/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "moveStage", stageId }),
      });
    } finally {
      setMoving((p) => { const n = new Set(p); n.delete(candidateId); return n; });
      globalMutate(`/api/hr/hiring/candidates?openingId=${jobId}`);
    }
  };

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "applied" ? "desc" : "asc"); }
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 border-b border-slate-100 bg-slate-50/40 animate-pulse" />
        ))}
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
        <Users size={28} className="mx-auto text-slate-300 mb-3" />
        <h3 className="text-[14px] font-semibold text-slate-800">No applicants yet</h3>
        <p className="text-[12px] text-slate-500 mt-1 max-w-md mx-auto">
          When candidates apply to this job, they&apos;ll show up here. Share the public link to start receiving applications.
        </p>
      </div>
    );
  }

  // Glanceable counts now live inside the tab strip below — each
  // tab shows its own bucket count chip. No separate header
  // counter needed.

  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {/* Tab strip — bucket the list by lifecycle so HR doesn't
            scroll past archived/sourced candidates to find the ones
            actively moving. Counts mirror the buckets exactly. */}
        <div className="px-4 pt-3 pb-0 border-b border-slate-200 bg-slate-50/40 flex items-end justify-between gap-3 flex-wrap">
          <div className="flex items-end gap-0 -mb-px" role="tablist">
            {(([
              { key: "all",          label: "All",          n: counts.all },
              { key: "new",          label: "New",          n: counts.new },
              { key: "in_progress",  label: "In Progress",  n: counts.in_progress },
              { key: "archived",     label: "Archived",     n: counts.archived },
            ] as const)).map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className={`px-3.5 py-2 text-[12px] font-semibold inline-flex items-center gap-1.5 border-b-2 transition-colors ${
                    active
                      ? "border-[#008CFF] text-[#008CFF]"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {t.label}
                  <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] font-bold ${
                    active ? "bg-[#008CFF]/15 text-[#008CFF]" : "bg-slate-200/70 text-slate-500"
                  }`}>{t.n}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3 mb-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, email, phone…"
                className="h-7 w-44 md:w-56 pl-7 pr-7 rounded-md border border-slate-300 bg-white text-[11.5px] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/20 focus:border-[#93c5fd]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full text-slate-400 hover:text-slate-700 flex items-center justify-center"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="h-7 px-3 rounded-md bg-[#008CFF] hover:bg-[#0070cc] text-white text-[11.5px] font-semibold inline-flex items-center gap-1"
              title="Manually source a candidate into this job"
            >+ Add applicant</button>
            <p className="text-[11px] text-slate-500 inline-flex items-center gap-1.5">
              <ChevronDown size={11} className="text-slate-400" />
              Click the stage chip on any row to move a candidate
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-white border-b border-slate-200">
              <tr className="text-left text-slate-500">
                <Th sortable onClick={() => toggleSort("name")} active={sortKey === "name"} dir={sortDir}>Applicant</Th>
                <Th>Contact</Th>
                <Th sortable onClick={() => toggleSort("stage")} active={sortKey === "stage"} dir={sortDir}>Stage</Th>
                <Th sortable onClick={() => toggleSort("applied")} active={sortKey === "applied"} dir={sortDir}>Applied</Th>
                <Th sortable onClick={() => toggleSort("source")} active={sortKey === "source"} dir={sortDir}>Source</Th>
                <Th className="text-right">Resume</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[12.5px] text-slate-400">
                    {query.trim()
                      ? `No applicants match "${query.trim()}".`
                      : "No candidates in this bucket yet."}
                  </td>
                </tr>
              )}
              {sorted.map((c) => {
                const archived = isArchived(c);
                return (
                <tr
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`border-b border-slate-100 last:border-b-0 hover:bg-blue-50/40 cursor-pointer transition-colors ${
                    moving.has(c.id) ? "opacity-60" : ""
                  } ${archived ? "bg-slate-50/60" : ""}`}
                >
                  {/* Applicant */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-[11.5px] font-bold ${
                        archived
                          ? "bg-slate-200 text-slate-500"
                          : "bg-[#008CFF]/10 text-[#008CFF]"
                      }`}>
                        {initials(c.fullName)}
                      </span>
                      <div className="min-w-0">
                        <p className={`font-semibold truncate flex items-center gap-1.5 ${
                          archived ? "text-slate-500" : "text-slate-900"
                        }`}>
                          {c.fullName}
                          {c.overallRating != null && (
                            <span className="inline-flex items-center gap-0.5 text-[10.5px] text-amber-600">
                              <Star size={10} fill="currentColor" />
                              {c.overallRating}
                            </span>
                          )}
                          {archived && (
                            <span
                              title={c.archiveReason ?? "Archived"}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-600 text-[9.5px] font-bold uppercase tracking-wider ring-1 ring-slate-300"
                            >
                              <Archive size={9} /> Archived
                            </span>
                          )}
                        </p>
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10.5px] text-slate-500">
                          {c.currentCompany && (
                            <span className="inline-flex items-center gap-1 truncate">
                              <Briefcase size={10} /> {c.currentCompany}
                            </span>
                          )}
                          {c.experienceYears != null && (
                            <span>{c.experienceYears} yrs exp</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  {/* Contact — stacked email + phone, icons aligned
                      in a fixed-width gutter so multi-row entries
                      line up vertically. */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex flex-col gap-1 text-[11.5px] text-slate-600 min-w-0">
                      <a
                        href={`mailto:${c.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 hover:text-[#3b82f6] min-w-0 group"
                        title={c.email}
                      >
                        <Mail size={11} className="text-slate-400 shrink-0 group-hover:text-[#3b82f6]" />
                        <span className="truncate group-hover:underline underline-offset-2">{c.email}</span>
                      </a>
                      {c.phone && (
                        <a
                          href={`tel:${c.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-2 text-slate-500 hover:text-[#3b82f6] group"
                          title={c.phone}
                        >
                          <Phone size={11} className="text-slate-400 shrink-0 group-hover:text-[#3b82f6]" />
                          <span className="font-mono tabular-nums group-hover:underline underline-offset-2">{c.phone}</span>
                        </a>
                      )}
                    </div>
                  </td>
                  {/* Stage — visible chip + chevron makes it obviously
                      clickable / interactive. Native <select> sits on
                      top invisibly so HR gets the OS picker for free
                      (works on mobile, accessible to screen readers). */}
                  <td className="px-4 py-3 align-middle">
                    {c.currentStage ? (
                      <StageDropdown
                        current={c.currentStage}
                        stages={stages}
                        disabled={moving.has(c.id)}
                        onChange={(stageId) => moveStage(c.id, stageId)}
                      />
                    ) : (
                      <span className="inline-flex items-center gap-1 h-6 px-2 rounded bg-amber-50 text-amber-700 ring-1 ring-amber-200 text-[10px] font-semibold uppercase tracking-wide">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Unassigned
                      </span>
                    )}
                  </td>
                  {/* Applied */}
                  <td className="px-4 py-3 align-middle text-slate-600 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 text-[11.5px]">
                      <Clock size={11} className="text-slate-400" /> {daysSince(c.createdAt)}
                    </span>
                  </td>
                  {/* Source — if it's a referral, show WHO referred them.
                      Emerald accent so referrals visually stand out from
                      generic Indeed/Naukri/LinkedIn sources. */}
                  <td className="px-4 py-3 align-middle">
                    {c.source === "referral" ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10.5px] font-semibold ring-1 ring-inset ring-emerald-200">
                          ⭐ Referral
                        </span>
                        {c.referredBy?.name && (
                          <span className="text-[10.5px] text-slate-500 font-medium pl-0.5">
                            by {c.referredBy.name}
                          </span>
                        )}
                      </div>
                    ) : c.source ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10.5px] font-medium">
                        {c.source}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">—</span>
                    )}
                  </td>
                  {/* Resume */}
                  <td className="px-4 py-3 align-middle text-right">
                    {c.resumeUrl ? (
                      <a
                        href={c.resumeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-slate-200 hover:border-[#3b82f6] hover:text-[#3b82f6] text-slate-700 text-[10.5px] font-semibold"
                        title={c.resumeFileName ?? "Open resume"}
                      >
                        <FileText size={11} /> View
                      </a>
                    ) : (
                      <span className="text-[10.5px] text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
        {/* Footer count */}
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500">
          {candidates.length} applicant{candidates.length === 1 ? "" : "s"}
        </div>
      </div>

      {selectedId != null && (
        <CandidateDrawer
          candidateId={selectedId}
          onClose={() => setSelectedId(null)}
          onChange={() => globalMutate(`/api/hr/hiring/candidates?openingId=${jobId}`)}
        />
      )}

      {addOpen && (
        <AddApplicantModal
          jobId={jobId}
          jobTitle={jobTitle}
          onClose={() => setAddOpen(false)}
          onCreated={(id) => {
            // Auto-open the new candidate's drawer so HR can
            // immediately verify the parser's auto-fill and edit
            // education/skills if needed.
            if (id) setSelectedId(id);
          }}
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

// StageDropdown — visible chip with a dropdown chevron + colored
// status dot. The native <select> sits on top with opacity 0 to
// preserve the OS-native picker UX (mobile-friendly + accessible)
// while we render our own styled surface underneath.
function StageDropdown({
  current, stages, disabled, onChange,
}: {
  current: Stage;
  stages: Stage[];
  disabled: boolean;
  onChange: (stageId: number) => void;
}) {
  const tone = STAGE_TONE[current.color] || STAGE_TONE.slate;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`relative inline-flex items-center gap-1 h-6 pl-1.5 pr-1 rounded ${tone.chip} ring-1 ${tone.ring} text-[10px] font-semibold uppercase tracking-wide transition-colors hover:brightness-95 ${
        disabled ? "opacity-60 pointer-events-none" : "cursor-pointer"
      }`}
      title="Click to change stage"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot} shrink-0`} />
      <span className="whitespace-nowrap leading-none">{current.label}</span>
      <ChevronDown size={11} className="opacity-70 shrink-0 -mr-0.5" />
      <select
        value={current.id}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        aria-label={`Move to stage (currently ${current.label})`}
        className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
    </div>
  );
}

function Th({
  children, sortable, active, dir, onClick, className,
}: {
  children: React.ReactNode;
  sortable?: boolean;
  active?: boolean;
  dir?: SortDir;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <th
      onClick={onClick}
      className={`px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-wider ${
        sortable ? "cursor-pointer hover:text-slate-800 select-none" : ""
      } ${active ? "text-slate-800" : ""} ${className ?? ""}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortable && active && (dir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
      </span>
    </th>
  );
}
