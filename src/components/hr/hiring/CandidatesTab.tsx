"use client";

// All-candidates view — Keka-parity layout in the dashboard's blue
// palette. Chevron funnel up top with live counts, section title bar,
// filter rail, then a rich row table. Click a row → CandidateDrawer.

import { useMemo, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { showToast } from "@/components/ui/Toast";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import {
  Search, Star, Mail, ChevronDown, ChevronRight, Phone, Plus,
  Download, MoreHorizontal, Users, CheckCircle2, XCircle,
  ExternalLink, MessageSquare, LayoutList, Columns3, Filter,
  ArrowRightCircle, Calendar, ClipboardList, MessageCircle, Archive,
  Send, UserCog, Tag, X, Check,
} from "lucide-react";
import CandidateDrawer from "./CandidateDrawer";
import CandidateActionModal, { type CandidateAction } from "./CandidateActionModal";
import ArchiveCandidateModal from "./ArchiveCandidateModal";

type Stage = { id: number; key: string; label: string; color: string; kind: string; sortOrder?: number };
type Candidate = {
  id: number; fullName: string; email: string; phone: string | null;
  /** Gravatar URL resolved from the candidate's email (null if not set). */
  photoUrl?: string | null;
  experienceYears: number | null; currentCompany: string | null;
  resumeUrl: string | null; source: string | null; overallRating: number | null;
  currentStage: Stage | null; enteredStageAt: string | null;
  jobOpeningId: number; roleTitle: string | null; createdAt: string;
  ownerName?: string | null;
  recruiterOwnerId?: number | null;
  tags?: string[] | null;
  expectedSalary?: number | null;
  availableToJoinDays?: number | null;
  /** ISO timestamp of the most recent rejection email send, if any.
   *  Drives the "Email sent" badge in the candidate row. */
  rejectionEmailSentAt?: string | null;
};

// Initials + deterministic colour for the avatar circle. Same name
// always lands on the same hue across reloads.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Candidate avatar — renders the Gravatar photo for the email when
// one exists, falls back to initials on a 404/onError. The fallback
// is the same coloured circle the page rendered before, so a missing
// photo is visually indistinguishable from the previous version.
function CandidateAvatar({
  name, photoUrl, size = 36,
}: {
  name: string;
  photoUrl?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const dim = `${size}px`;
  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={name}
        onError={() => setFailed(true)}
        loading="lazy"
        className="flex-shrink-0 rounded-full object-cover"
        style={{ width: dim, height: dim }}
      />
    );
  }
  return (
    <span
      className={`flex-shrink-0 inline-flex items-center justify-center rounded-full text-white font-bold ${avatarTone(name)}`}
      style={{ width: dim, height: dim, fontSize: Math.round(size * 0.32) }}
    >
      {initials(name)}
    </span>
  );
}
const AVATAR_TONES = [
  "bg-[#3b82f6]", "bg-violet-500", "bg-rose-500", "bg-amber-500",
  "bg-emerald-500", "bg-cyan-500", "bg-fuchsia-500", "bg-indigo-500",
];
function avatarTone(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function daysBetween(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export default function CandidatesTab() {
  const { data: stagesData }     = useSWR<{ stages: Stage[] }>("/api/hr/hiring/stages", fetcher);
  const { data: candidatesData, isLoading, mutate: mutateCandidates } = useSWR<{ candidates: Candidate[] }>("/api/hr/hiring/candidates", fetcher);
  const stages    = stagesData?.stages ?? [];
  const candidates = candidatesData?.candidates ?? [];

  const [stageFilter, setStageFilter] = useState<string>("");
  const [search, setSearch]           = useState("");
  // Filter keys off the debounced value so typing stays smooth on a big
  // candidate list (the input itself updates instantly).
  const debouncedSearch = useDebouncedValue(search, 250);
  const [source, setSource]           = useState("");
  const [experience, setExperience]   = useState("");
  const [salary, setSalary]           = useState("");
  const [availableIn, setAvailableIn] = useState("");
  const [selected, setSelected]       = useState<Set<number>>(new Set());
  const [activeId, setActiveId]       = useState<number | null>(null);
  // Candidate being archived via the row menu's "Move to → Rejected"
  // submenu. Same modal/flow as the drawer Archive button + Kanban drag
  // into the Rejected column — keeps the reason + email enforcement
  // consistent across every entry point.
  const [archivingCandidate, setArchivingCandidate] = useState<Candidate | null>(null);
  // The drawer emits a CustomEvent when the user clicks its prev/next
  // pipeline-nav arrows. We listen here so we can swap activeId
  // without unmounting the drawer.
  useEffect(() => {
    function onNav(e: Event) {
      const id = (e as CustomEvent<number>).detail;
      if (Number.isInteger(id)) setActiveId(id);
    }
    window.addEventListener("nb:candidateDrawer:navigate", onNav as any);
    return () => window.removeEventListener("nb:candidateDrawer:navigate", onNav as any);
  }, []);
  const [view, setView]               = useState<"list" | "kanban">("list");
  const [savedView, setSavedView]     = useState("All candidates");
  const [bulkOpen, setBulkOpen]       = useState(false);
  const [savedOpen, setSavedOpen]     = useState(false);
  const [rowMenuFor, setRowMenuFor]   = useState<{ id: number; x: number; y: number } | null>(null);
  const [tagPopFor,  setTagPopFor]    = useState<{ id: number; x: number; y: number } | null>(null);
  const [actionModal, setActionModal] = useState<{ id: number; action: CandidateAction } | null>(null);

  // Split stages into active funnel vs terminal (hired/rejected).
  const activeStages = useMemo(
    () => stages.filter((s) => s.kind === "active").sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [stages],
  );
  const hiredStage    = stages.find((s) => s.kind === "hired");
  const rejectedStage = stages.find((s) => s.kind === "rejected");

  const stageCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of candidates) {
      const k = c.currentStage?.key ?? "_unstaged";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [candidates]);

  const sourceOpts = useMemo(() => unique(candidates.map((c) => c.source)), [candidates]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return candidates.filter((c) => {
      if (stageFilter && (c.currentStage?.key ?? "") !== stageFilter) return false;
      if (source && (c.source ?? "") !== source) return false;
      if (experience) {
        const yr = c.experienceYears ?? -1;
        if (experience === "0-2"  && !(yr >= 0 && yr <= 2)) return false;
        if (experience === "2-5"  && !(yr > 2 && yr <= 5)) return false;
        if (experience === "5-10" && !(yr > 5 && yr <= 10)) return false;
        if (experience === "10+"  && !(yr > 10))            return false;
      }
      if (salary && c.expectedSalary != null) {
        const lpa = c.expectedSalary / 100_000;
        if (salary === "0-5"   && !(lpa <= 5))   return false;
        if (salary === "5-10"  && !(lpa > 5 && lpa <= 10)) return false;
        if (salary === "10-20" && !(lpa > 10 && lpa <= 20)) return false;
        if (salary === "20+"   && !(lpa > 20))             return false;
      }
      if (availableIn && c.availableToJoinDays != null) {
        const d = c.availableToJoinDays;
        if (availableIn === "0-15"  && !(d <= 15))            return false;
        if (availableIn === "15-30" && !(d > 15 && d <= 30))  return false;
        if (availableIn === "30-60" && !(d > 30 && d <= 60))  return false;
        if (availableIn === "60+"   && !(d > 60))             return false;
      }
      if (!q) return true;
      const hay = `${c.fullName} ${c.email} ${c.phone ?? ""} ${c.currentCompany ?? ""} ${c.roleTitle ?? ""} ${c.source ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [candidates, stageFilter, source, experience, salary, availableIn, debouncedSearch]);

  const anyFilterActive = !!(stageFilter || source || experience || salary || availableIn || search);
  const clearAll = () => {
    setStageFilter(""); setSource(""); setExperience(""); setSalary(""); setAvailableIn(""); setSearch("");
  };

  const toggleSelect = (id: number) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () =>
    setSelected((s) => s.size === filtered.length ? new Set() : new Set(filtered.map((c) => c.id)));

  // Section title text + email-sourced shortcut label follow the
  // currently-selected stage so the page reads naturally.
  const selectedStageLabel =
    stageFilter === "" ? "All candidates"
    : activeStages.find((s) => s.key === stageFilter)?.label
      ?? (hiredStage?.key === stageFilter ? hiredStage.label
        : rejectedStage?.key === stageFilter ? "Archived"
        : "Candidates");

  return (
    <div className="space-y-4">
      {/* ── Top bar: saved-view dropdown · view toggle ───────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SavedViewPicker
          value={savedView}
          onChange={setSavedView}
          open={savedOpen}
          setOpen={setSavedOpen}
        />
        <ViewToggle value={view} onChange={setView} />
      </div>

      {/* ── Stage chevron funnel ─────────────────────────────── */}
      <ChevronFunnel
        activeStages={activeStages}
        hiredStage={hiredStage}
        rejectedStage={rejectedStage}
        stageCounts={stageCounts}
        stageFilter={stageFilter}
        setStageFilter={setStageFilter}
      />

      {/* ── Section title bar ────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
        <div className="flex items-baseline gap-2.5">
          <h3 className="text-[18px] font-semibold text-slate-900 tracking-tight">{selectedStageLabel}</h3>
          <span className="text-[12px] font-semibold text-slate-500 tabular-nums">
            ({filtered.length})
          </span>
          {anyFilterActive && (
            <button onClick={clearAll} className="text-[11.5px] font-medium text-slate-500 hover:text-[#3b82f6] ml-1">
              Clear filters
            </button>
          )}
        </div>
        <button className="text-[12px] font-semibold text-[#3b82f6] hover:text-[#2563eb]">
          Profiles-Sourced via Email (0)
        </button>
      </div>

      {/* ── Filter rail ──────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <FilterSelect placeholder="Source"       value={source}      onChange={setSource}      options={sourceOpts.map(v => ({ value: v, label: v }))} />
        <FilterSelect placeholder="Experience"   value={experience}  onChange={setExperience}  options={[
          { value: "0-2",  label: "0 – 2 yrs" },
          { value: "2-5",  label: "2 – 5 yrs" },
          { value: "5-10", label: "5 – 10 yrs" },
          { value: "10+",  label: "10+ yrs" },
        ]} />
        <FilterSelect placeholder="Expected Salary" value={salary} onChange={setSalary} options={[
          { value: "0-5",   label: "Up to 5 LPA" },
          { value: "5-10",  label: "5 – 10 LPA" },
          { value: "10-20", label: "10 – 20 LPA" },
          { value: "20+",   label: "20+ LPA" },
        ]} />
        <FilterSelect placeholder="Available To Join (In Days)" value={availableIn} onChange={setAvailableIn} options={[
          { value: "0-15",  label: "Immediate (≤15 days)" },
          { value: "15-30", label: "15 – 30 days" },
          { value: "30-60", label: "30 – 60 days" },
          { value: "60+",   label: "60+ days" },
        ]} />
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 bg-white text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
          />
        </div>
        <button
          onClick={clearAll}
          disabled={!anyFilterActive}
          className={`h-10 w-10 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white transition-colors ${anyFilterActive ? "text-[#3b82f6] hover:bg-blue-50" : "text-slate-300 cursor-not-allowed"}`}
          title="Clear all filters"
        >
          <Filter size={14} />
        </button>
      </div>

      {/* ── Bulk actions row ─────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <BulkActionsDropdown
          open={bulkOpen}
          setOpen={setBulkOpen}
          disabled={selected.size === 0}
          count={selected.size}
          onClear={() => setSelected(new Set())}
        />
        <div className="flex items-center gap-1">
          <button
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-[#3b82f6] hover:bg-blue-50"
            title="Export"
          ><Download size={14} /></button>
          <button
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100"
            title="More"
          ><MoreHorizontal size={16} /></button>
        </div>
      </div>

      {/* ── Candidates table ─────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        {isLoading ? (
          <div className="py-16 text-center">
            <div className="inline-block h-7 w-7 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Users size={26} className="mx-auto text-slate-300 mb-3" />
            <p className="text-[13.5px] font-semibold text-slate-700">No candidates match these filters</p>
            <p className="text-[12px] text-slate-500 mt-1">Try clearing a filter or add candidates from the +Add button.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3.5 w-10">
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 rounded border-slate-300 accent-[#3b82f6]"
                  />
                </th>
                {["CANDIDATE", "SOURCE", "APPLIED / ADDED ON", "TAGS", "OWNER", "DAYS IN CURRENT", "CONTACT"].map((h) => (
                  <th key={h} className="px-3 py-3.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-500 whitespace-nowrap">{h}</th>
                ))}
                <th className="px-3 py-3.5 w-[140px]" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const days = daysBetween(c.enteredStageAt);
                const isSelected = selected.has(c.id);
                return (
                  <tr
                    key={c.id}
                    className={`group border-b border-slate-100 last:border-b-0 transition-colors ${isSelected ? "bg-blue-50/50" : "hover:bg-slate-50/70"}`}
                  >
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(c.id)}
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-[#3b82f6]"
                      />
                    </td>
                    <td className="px-3 py-3.5 cursor-pointer" onClick={() => setActiveId(c.id)}>
                      <div className="flex items-center gap-3 min-w-0">
                        <CandidateAvatar name={c.fullName} photoUrl={c.photoUrl} size={36} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="text-[13px] font-semibold text-slate-900 uppercase tracking-wide truncate">{c.fullName}</p>
                            {/* "Email sent" badge — appears only when
                                the Candidate Rejection email has been
                                sent to this applicant (either via the
                                auto-send pipeline on stage change OR
                                manually from the drawer). Same source
                                of truth: CandidateActivity. */}
                            {c.rejectionEmailSentAt && (
                              <span
                                className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-emerald-700 ring-1 ring-inset ring-emerald-200 shrink-0"
                                title={`Rejection email sent ${new Date(c.rejectionEmailSentAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`}
                              >
                                <Check size={8} strokeWidth={3} />
                                Email sent
                              </span>
                            )}
                          </div>
                          {(c.roleTitle || c.overallRating != null) && (
                            <p className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5 truncate">
                              {c.overallRating != null && (
                                <span className="inline-flex items-center gap-0.5 text-amber-600 font-semibold">
                                  <Star size={9} fill="currentColor" /> {c.overallRating}
                                </span>
                              )}
                              {c.roleTitle && <span className="truncate">{c.roleTitle}</span>}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 cursor-pointer" onClick={() => setActiveId(c.id)}>
                      {c.source ? (
                        <div>
                          <p className="text-[12.5px] font-medium text-slate-800">{c.source}</p>
                          <p className="text-[10.5px] text-slate-400 mt-0.5">{sourceCategory(c.source)}</p>
                        </div>
                      ) : (
                        <NA />
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-[12.5px] text-slate-700 cursor-pointer whitespace-nowrap" onClick={() => setActiveId(c.id)}>
                      {new Date(c.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-3 py-3.5">
                      {c.tags && c.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {c.tags.slice(0, 3).map((t) => (
                            <TagChip
                              key={t}
                              label={t}
                              tone={tagTone(t)}
                              onRemove={async () => {
                                mutateCandidates(
                                  candidatesData && {
                                    candidates: candidatesData.candidates.map((x) =>
                                      x.id === c.id ? { ...x, tags: (x.tags ?? []).filter((y) => y !== t) } : x),
                                  },
                                  false,
                                );
                                await fetch(`/api/hr/hiring/candidates/${c.id}`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "removeTag", tag: t }),
                                });
                                mutateCandidates();
                              }}
                            />
                          ))}
                          {c.tags.length > 3 && (
                            <span className="text-[10px] text-slate-400 self-center">+{c.tags.length - 3}</span>
                          )}
                        </div>
                      ) : <NA />}
                    </td>
                    <td className="px-3 py-3.5 text-[12.5px] text-slate-700 cursor-pointer" onClick={() => setActiveId(c.id)}>
                      {c.ownerName ? c.ownerName : <NA />}
                    </td>
                    <td className="px-3 py-3.5 text-[12.5px] cursor-pointer" onClick={() => setActiveId(c.id)}>
                      {days != null ? (
                        <span className={`tabular-nums font-semibold ${days > 14 ? "text-rose-600" : days > 7 ? "text-amber-600" : "text-slate-700"}`}>
                          {days}
                        </span>
                      ) : <NA />}
                    </td>
                    <td className="px-3 py-3.5 cursor-pointer" onClick={() => setActiveId(c.id)}>
                      <div className="space-y-0.5">
                        {c.phone && (
                          <p className="text-[12.5px] font-medium text-slate-800 tabular-nums">
                            {c.phone}
                          </p>
                        )}
                        <p className="text-[11px] text-slate-500 truncate max-w-[200px]">
                          {c.email}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <RowActionButton
                          title="Open candidate"
                          icon={ArrowRightCircle}
                          onClick={(e) => { e.stopPropagation(); setActiveId(c.id); }}
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setTagPopFor(
                              tagPopFor?.id === c.id
                                ? null
                                : { id: c.id, x: r.right, y: r.bottom + 4 },
                            );
                          }}
                          className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
                            tagPopFor?.id === c.id
                              ? "bg-blue-50 text-[#3b82f6]"
                              : "text-slate-500 hover:text-[#3b82f6] hover:bg-blue-50"
                          }`}
                          title="Add tag"
                        ><Tag size={14} /></button>
                        {safeUrl(c.resumeUrl) && (
                          <a
                            href={safeUrl(c.resumeUrl)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-[#3b82f6] hover:bg-blue-50"
                            title="View resume"
                          ><ExternalLink size={14} /></a>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            // Pop the menu just below the button, aligned to
                            // its right edge so the dropdown grows leftwards
                            // and stays inside the viewport.
                            setRowMenuFor(
                              rowMenuFor?.id === c.id
                                ? null
                                : { id: c.id, x: r.right, y: r.bottom + 4 },
                            );
                          }}
                          className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
                            rowMenuFor?.id === c.id
                              ? "bg-slate-200 text-slate-900"
                              : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                          }`}
                          title="More"
                        ><MoreHorizontal size={15} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination footer ────────────────────────────────── */}
      {!isLoading && filtered.length > 0 && (
        <div className="flex items-center justify-end gap-4 text-[12px] text-slate-600">
          <span>1 to {filtered.length} of {filtered.length}</span>
          <div className="flex items-center gap-1">
            <button className="h-7 px-2 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-[16px]">‹</button>
            <span className="px-2 font-semibold">1 of 1</span>
            <button className="h-7 px-2 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-[16px]">›</button>
          </div>
        </div>
      )}

      {activeId != null && (
        <CandidateDrawer candidateId={activeId} onClose={() => setActiveId(null)} />
      )}

      {tagPopFor && (
        <TagPopover
          candidate={candidates.find((c) => c.id === tagPopFor.id) ?? null}
          existing={candidates.find((c) => c.id === tagPopFor.id)?.tags ?? []}
          x={tagPopFor.x}
          y={tagPopFor.y}
          onClose={() => setTagPopFor(null)}
          onAdded={(tag) => {
            mutateCandidates(
              candidatesData && {
                candidates: candidatesData.candidates.map((x) =>
                  x.id === tagPopFor.id
                    ? { ...x, tags: Array.from(new Set([...(x.tags ?? []), tag])) }
                    : x),
              },
              false,
            );
            fetch(`/api/hr/hiring/candidates/${tagPopFor.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "addTag", tag }),
            })
              .then((r) => {
                if (!r.ok) return r.json().then((j) => Promise.reject(j));
              })
              .catch((j) => showToast(j?.error || "Couldn't add tag", "error"))
              .finally(() => mutateCandidates());
          }}
        />
      )}

      {rowMenuFor && (
        <RowActionsMenu
          candidate={candidates.find((c) => c.id === rowMenuFor.id) ?? null}
          stages={[
            ...activeStages,
            ...(hiredStage    ? [hiredStage]                                    : []),
            ...(rejectedStage ? [{ ...rejectedStage, label: "Archived" }]       : []),
          ]}
          archiveStage={rejectedStage ?? null}
          x={rowMenuFor.x}
          y={rowMenuFor.y}
          onClose={() => setRowMenuFor(null)}
          onMutated={() => mutateCandidates()}
          onOpenDrawer={() => { setActiveId(rowMenuFor.id); setRowMenuFor(null); }}
          onOpenAction={(action) => {
            const id = rowMenuFor.id;
            setRowMenuFor(null);
            setActionModal({ id, action });
          }}
          onOpenTagPopover={() => {
            // Anchor the tag popover where the kebab menu was sitting
            // — keeps the click target visually anchored even though
            // we're switching popovers.
            setTagPopFor({ id: rowMenuFor.id, x: rowMenuFor.x, y: rowMenuFor.y });
            setRowMenuFor(null);
          }}
          onArchive={(cand) => {
            setArchivingCandidate(cand);
            setRowMenuFor(null);
          }}
        />
      )}

      {actionModal && (() => {
        const c = candidates.find((x) => x.id === actionModal.id);
        if (!c) return null;
        return (
          <CandidateActionModal
            action={actionModal.action}
            candidate={{
              id: c.id,
              fullName: c.fullName,
              email: c.email,
              roleTitle: c.roleTitle,
              ownerName: c.ownerName ?? null,
              recruiterOwnerId: c.recruiterOwnerId ?? null,
              currentStageKey: c.currentStage?.key ?? null,
            }}
            onClose={() => setActionModal(null)}
            onDone={() => mutateCandidates()}
          />
        );
      })()}

      {archivingCandidate && (
        <ArchiveCandidateModal
          candidate={{
            id: archivingCandidate.id,
            fullName: archivingCandidate.fullName,
            email: archivingCandidate.email,
            roleTitle: archivingCandidate.roleTitle,
          }}
          onClose={() => setArchivingCandidate(null)}
          onDone={() => mutateCandidates()}
        />
      )}
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────

function SavedViewPicker({
  value, onChange, open, setOpen,
}: { value: string; onChange: (v: string) => void; open: boolean; setOpen: (b: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, setOpen]);

  const options = ["All candidates", "Sourced this week", "Top rated", "Pending interview"];
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 text-[20px] font-semibold text-slate-900 tracking-tight hover:text-[#3b82f6] transition-colors"
      >
        {value}
        <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-slate-100 text-slate-500">
          <ChevronDown size={14} />
        </span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 z-30 w-56 rounded-xl border border-slate-200 bg-white shadow-lg p-1.5">
          {options.map((o) => (
            <button
              key={o}
              onClick={() => { onChange(o); setOpen(false); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-[12.5px] font-medium transition-colors ${o === value ? "bg-blue-50 text-[#1d4ed8]" : "text-slate-700 hover:bg-slate-50"}`}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ViewToggle({ value, onChange }: { value: "list" | "kanban"; onChange: (v: "list" | "kanban") => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 p-1 rounded-lg border border-slate-200 bg-white">
      <button
        onClick={() => onChange("list")}
        className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-all ${value === "list" ? "bg-blue-50 text-[#3b82f6] ring-1 ring-[#3b82f6]/30" : "text-slate-400 hover:text-slate-700"}`}
        title="List view"
      ><LayoutList size={15} /></button>
      <button
        onClick={() => onChange("kanban")}
        className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-all ${value === "kanban" ? "bg-blue-50 text-[#3b82f6] ring-1 ring-[#3b82f6]/30" : "text-slate-400 hover:text-slate-700"}`}
        title="Kanban view"
      ><Columns3 size={15} /></button>
    </div>
  );
}

function ChevronFunnel({
  activeStages, hiredStage, rejectedStage, stageCounts, stageFilter, setStageFilter,
}: {
  activeStages: Stage[];
  hiredStage: Stage | undefined;
  rejectedStage: Stage | undefined;
  stageCounts: Map<string, number>;
  stageFilter: string;
  setStageFilter: (k: string) => void;
}) {
  // Keka-style: chevron-shaped tiles flow left-to-right with interlocking
  // notches, then a vertical divider, then terminal Hired/Archived pills.
  return (
    <div className="flex items-stretch flex-wrap gap-2">
      <div className="flex items-stretch min-w-0 flex-wrap">
        {activeStages.map((s, i) => (
          <ChevronTile
            key={s.id}
            label={s.label}
            count={stageCounts.get(s.key) ?? 0}
            active={stageFilter === s.key}
            onClick={() => setStageFilter(stageFilter === s.key ? "" : s.key)}
            position={i === 0 ? "first" : i === activeStages.length - 1 ? "last" : "middle"}
          />
        ))}
      </div>
      {(hiredStage || rejectedStage) && (
        <>
          <div className="self-stretch w-px bg-slate-200 mx-2" />
          <div className="flex items-stretch gap-2">
            {hiredStage && (
              <TerminalTile
                label={hiredStage.label}
                count={stageCounts.get(hiredStage.key) ?? 0}
                active={stageFilter === hiredStage.key}
                onClick={() => setStageFilter(stageFilter === hiredStage.key ? "" : hiredStage.key)}
                tone="emerald"
                icon={CheckCircle2}
              />
            )}
            {rejectedStage && (
              <TerminalTile
                label="Archived"
                count={stageCounts.get(rejectedStage.key) ?? 0}
                active={stageFilter === rejectedStage.key}
                onClick={() => setStageFilter(stageFilter === rejectedStage.key ? "" : rejectedStage.key)}
                tone="rose"
                icon={XCircle}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ChevronTile({
  label, count, active, onClick, position,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  position: "first" | "middle" | "last";
}) {
  // clip-path creates the chevron silhouette. We use a 14px notch on
  // the left edge (skipped on `first`) and a 14px point on the right
  // edge so adjacent tiles interlock. -ml-3.5 stitches the seam.
  const NOTCH = "14px";
  const clip =
    position === "first"
      ? `polygon(0 0, calc(100% - ${NOTCH}) 0, 100% 50%, calc(100% - ${NOTCH}) 100%, 0 100%)`
      : `polygon(0 0, calc(100% - ${NOTCH}) 0, 100% 50%, calc(100% - ${NOTCH}) 100%, 0 100%, ${NOTCH} 50%)`;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ clipPath: clip }}
      className={`relative min-w-[148px] h-[72px] pr-6 pl-6 first:pl-4 -ml-3.5 first:ml-0 text-left transition-colors ${
        active
          ? "bg-[#dbeafe] text-[#1d4ed8] ring-1 ring-[#3b82f6]/40"
          : "bg-white border border-slate-200 text-slate-700 hover:bg-blue-50/40"
      }`}
    >
      <div className="flex flex-col items-start justify-center h-full">
        <span className="text-[11.5px] font-semibold text-slate-600 whitespace-nowrap">
          {label}
        </span>
        <span className={`text-[22px] font-bold leading-tight tabular-nums ${active ? "text-[#1d4ed8]" : "text-slate-900"}`}>
          {count}
        </span>
      </div>
    </button>
  );
}

function TerminalTile({
  label, count, active, onClick, tone, icon: Icon,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone: "emerald" | "rose";
  icon: any;
}) {
  const TONE: Record<string, { idle: string; active: string; iconColor: string; countActive: string; countIdle: string }> = {
    emerald: {
      idle:        "bg-white border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/30",
      active:      "bg-emerald-50 border border-emerald-300 ring-1 ring-emerald-300/60",
      iconColor:   "text-emerald-600",
      countActive: "text-emerald-700",
      countIdle:   "text-slate-900",
    },
    rose: {
      idle:        "bg-white border border-slate-200 hover:border-rose-300 hover:bg-rose-50/30",
      active:      "bg-rose-50 border border-rose-300 ring-1 ring-rose-300/60",
      iconColor:   "text-rose-600",
      countActive: "text-rose-700",
      countIdle:   "text-slate-900",
    },
  };
  const t = TONE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-[110px] h-[72px] px-5 rounded-xl text-left transition-colors ${active ? t.active : t.idle}`}
    >
      <div className="flex flex-col items-start justify-center h-full">
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-700 whitespace-nowrap">
          <Icon size={13} className={t.iconColor} />
          {label}
        </span>
        <span className={`text-[22px] font-bold leading-tight tabular-nums ${active ? t.countActive : t.countIdle}`}>
          {count}
        </span>
      </div>
    </button>
  );
}

function FilterSelect({
  placeholder, value, onChange, options,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`appearance-none h-10 pl-3.5 pr-9 rounded-lg border bg-white text-[12.5px] font-medium focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6] min-w-[170px] ${value ? "border-[#3b82f6]/40 text-[#1d4ed8]" : "border-slate-200 text-slate-600"}`}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}

function BulkActionsDropdown({
  open, setOpen, disabled, count, onClear,
}: { open: boolean; setOpen: (b: boolean) => void; disabled: boolean; count: number; onClear: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, setOpen]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`inline-flex items-center gap-2 h-9 px-4 rounded-lg text-[12.5px] font-semibold transition-colors ${disabled
          ? "bg-slate-100 text-slate-400 cursor-not-allowed"
          : "bg-[#3b82f6] text-white hover:bg-[#2563eb] shadow-sm"
        }`}
      >
        Bulk Actions
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-white/25 text-[11px] font-bold tabular-nums">
            {count}
          </span>
        )}
        <ChevronDown size={13} />
      </button>
      {open && !disabled && (
        <div className="absolute left-0 top-full mt-2 z-30 w-52 rounded-xl border border-slate-200 bg-white shadow-lg p-1.5">
          <BulkOption label="Move to stage" />
          <BulkOption label="Send email" />
          <BulkOption label="Add tag" />
          <BulkOption label="Assign owner" />
          <BulkOption label="Archive" tone="rose" />
          <div className="my-1 border-t border-slate-100" />
          <button
            onClick={() => { onClear(); setOpen(false); }}
            className="w-full text-left px-3 py-2 rounded-lg text-[12px] font-medium text-slate-500 hover:bg-slate-50"
          >Clear selection</button>
        </div>
      )}
    </div>
  );
}

function BulkOption({ label, tone }: { label: string; tone?: "rose" }) {
  return (
    <button className={`w-full text-left px-3 py-2 rounded-lg text-[12.5px] font-medium transition-colors ${tone === "rose" ? "text-rose-600 hover:bg-rose-50" : "text-slate-700 hover:bg-blue-50"}`}>
      {label}
    </button>
  );
}

function RowActionButton({
  title, icon: Icon, onClick,
}: {
  title: string;
  icon: any;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      onClick={onClick ?? ((e) => e.stopPropagation())}
      className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-[#3b82f6] hover:bg-blue-50"
      title={title}
    >
      <Icon size={14} />
    </button>
  );
}

// ── Row actions kebab menu ────────────────────────────────────────
// Portal-rendered so it escapes the table's overflow-x-auto clip and
// any sticky-row stacking contexts. Anchored to the kebab button's
// bounding rect (x = right edge, y = bottom edge).
//
// Each action either:
//   • triggers a one-shot mutation (Archive Candidate, Move to)
//   • opens the unified CandidateActionModal via onOpenAction
//   • opens the TagPopover via onOpenTagPopover
//   • opens the candidate drawer via onOpenDrawer (Add Feedback)
//   • or fires a side-effect like WhatsApp deep-link
function RowActionsMenu({
  candidate, stages, archiveStage, x, y,
  onClose, onMutated, onOpenDrawer, onOpenAction, onOpenTagPopover, onArchive,
}: {
  candidate: Candidate | null;
  stages: Stage[];
  archiveStage: Stage | null;
  x: number;
  y: number;
  onClose: () => void;
  onMutated: () => void;
  onOpenDrawer: () => void;
  onOpenAction: (action: CandidateAction) => void;
  onOpenTagPopover: () => void;
  /**
   * Called when HR picks the Rejected stage from the Move-to submenu.
   * Parent opens the ArchiveCandidateModal so HR captures a reason +
   * sends the closing email instead of a silent stage flip.
   */
  onArchive: (candidate: Candidate) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [mounted, setMounted]   = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    function onMouse(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!mounted || !candidate) return null;

  // Menu width is fixed at 240px; align its right edge with the
  // button's right edge so it grows leftwards.
  const MENU_W = 240;
  const left   = Math.max(8, x - MENU_W);

  // Viewport-aware vertical placement. y is the kebab's bottom edge
  // (already + 4px gap, set by the caller). When the menu drops
  // down we anchor by `top`; when it flips above we anchor by
  // `bottom` so the menu hugs the kebab regardless of how short the
  // actual content turns out to be. maxHeight is capped to the
  // available space so the inner list scrolls instead of overflowing.
  const viewportH   = window.innerHeight;
  const KEBAB_H     = 32;
  const GUTTER      = 12;
  const ESTIMATED_H = 420;
  const kebabTop    = y - 4 - KEBAB_H;
  const spaceBelow  = viewportH - y - GUTTER;
  const spaceAbove  = kebabTop - GUTTER;
  const dropDown    = spaceBelow >= ESTIMATED_H || spaceBelow >= spaceAbove;

  const style: React.CSSProperties = { left, width: MENU_W };
  if (dropDown) {
    style.top       = y;
    style.maxHeight = spaceBelow;
  } else {
    style.bottom    = viewportH - kebabTop + 4;
    style.maxHeight = spaceAbove;
  }

  const archive = async () => {
    if (!archiveStage) {
      showToast("No archive stage configured on this pipeline yet.", "error");
      return;
    }
    if (!confirm(`Archive ${candidate.fullName}? They'll move to the "${archiveStage.label}" stage and disappear from the active pipeline.`)) return;
    try {
      const res = await fetch(`/api/hr/hiring/candidates/${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "moveStage", stageId: archiveStage.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast(j?.error || "Couldn't archive candidate", "error");
        return;                       // keep the menu open so they can retry
      }
      onMutated();                    // refresh the list so the row leaves the active pipeline
      onClose();
    } catch {
      showToast("Network error — couldn't archive.", "error");
    }
  };

  const moveTo = async (stage: Stage) => {
    // Funnel "Move to Rejected" through the Archive modal so HR captures
    // a reason + sends a closing email — same gate as the drawer
    // dropdown and the Kanban drag-into-Rejected path.
    if (stage.kind === "rejected" && candidate) {
      onArchive(candidate);
      return;
    }
    try {
      const res = await fetch(`/api/hr/hiring/candidates/${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "moveStage", stageId: stage.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast(j?.error || `Couldn't move to ${stage.label}`, "error");
        return;                       // keep the menu open on failure
      }
      onMutated();                    // refresh so the row reflects its new stage
      onClose();
    } catch {
      showToast("Network error — couldn't move stage.", "error");
    }
  };

  return createPortal(
    <div
      ref={ref}
      style={style}
      className="fixed z-50 rounded-xl border border-slate-200 bg-white shadow-[0_10px_30px_-6px_rgba(15,23,42,0.18)] py-1.5 text-[13px] overflow-y-auto overscroll-contain"
      onClick={(e) => e.stopPropagation()}
    >
      <MenuRow icon={Calendar}        label="Schedule Interview" onClick={() => { onOpenAction("scheduleInterview"); onClose(); }} />
      <MenuRow icon={ClipboardList}   label="Send Assessment"    onClick={() => { onOpenAction("sendAssessment");    onClose(); }} />
      <MenuRow icon={MessageSquare}   label="Add Feedback"       onClick={onOpenDrawer} />
      <MenuRow icon={Archive}         label="Archive Candidate"  tone="rose" onClick={archive} />
      <MenuDivider />
      <MenuRow icon={Send}            label="Send Email"         onClick={() => { onOpenAction("sendEmail"); onClose(); }} />
      <MenuRow icon={MessageCircle}   label="Message on WhatsApp" onClick={() => {
        const phone = (candidate.phone ?? "").replace(/\D/g, "");
        if (!phone) { showToast("No phone number on file.", "error"); return; }
        window.open(`https://wa.me/${phone}`, "_blank", "noopener,noreferrer");
        onClose();
      }} />
      <MenuDivider />
      <MoveToRow
        stages={stages}
        candidate={candidate}
        moveOpen={moveOpen}
        setMoveOpen={setMoveOpen}
        onMove={moveTo}
      />
      <MenuRow icon={UserCog} label="Update owner" onClick={() => { onOpenAction("updateOwner"); onClose(); }} />
      <MenuRow icon={Tag}     label="Add Tags"    onClick={onOpenTagPopover} />
    </div>,
    document.body,
  );
}

function MenuRow({
  icon: Icon, label, onClick, tone, trailing,
}: {
  icon: any;
  label: string;
  onClick: () => void;
  tone?: "rose";
  trailing?: React.ReactNode;
}) {
  const color = tone === "rose"
    ? "text-rose-600 hover:bg-rose-50"
    : "text-slate-700 hover:bg-blue-50 hover:text-[#1d4ed8]";
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left font-medium transition-colors ${color}`}
    >
      <span className="inline-flex items-center gap-2.5">
        <Icon size={14} className="opacity-70" />
        {label}
      </span>
      {trailing}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 border-t border-slate-100" />;
}

// Move-to row + its submenu. The submenu is portal'd so it escapes
// the parent menu's overflow-y-auto clip context. Position is fixed
// to the row's bounding rect, with a viewport-aware flip if it would
// overflow to the right.
function MoveToRow({
  stages, candidate, moveOpen, setMoveOpen, onMove,
}: {
  stages: Stage[];
  candidate: Candidate;
  moveOpen: boolean;
  setMoveOpen: (b: boolean) => void;
  onMove: (s: Stage) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Capture the row's rect just before the submenu mounts so the
  // portal knows where to anchor.
  useEffect(() => {
    if (moveOpen) {
      const r = rowRef.current?.getBoundingClientRect();
      if (r) setRect(r);
    }
  }, [moveOpen]);

  return (
    <div
      ref={rowRef}
      onMouseEnter={() => setMoveOpen(true)}
      onMouseLeave={() => setMoveOpen(false)}
    >
      <MenuRow
        icon={ArrowRightCircle}
        label="Move to"
        trailing={<ChevronRight size={13} />}
        onClick={() => setMoveOpen(!moveOpen)}
      />
      {moveOpen && rect && stages.length > 0 && (
        <MoveSubmenu
          stages={stages}
          rect={rect}
          currentStageKey={candidate.currentStage?.key ?? null}
          onMove={onMove}
          onClose={() => setMoveOpen(false)}
        />
      )}
    </div>
  );
}

function MoveSubmenu({
  stages, rect, currentStageKey, onMove, onClose,
}: {
  stages: Stage[];
  rect: DOMRect;
  currentStageKey: string | null;
  onMove: (s: Stage) => void;
  onClose: () => void;
}) {
  const SUB_W = 208; // w-52
  const GUTTER = 12;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  // Prefer opening to the RIGHT of the Move to row. Flip left if it
  // would overflow the viewport.
  const wantsRight = rect.right + 4 + SUB_W <= viewportW - GUTTER;
  const left = wantsRight ? rect.right + 4 : Math.max(GUTTER, rect.left - 4 - SUB_W);

  // Vertically: align top with row top, but clamp to viewport so
  // long stage lists stay visible.
  const SUB_MAX_H = Math.min(viewportH - 2 * GUTTER, 360);
  let top = rect.top;
  if (top + SUB_MAX_H > viewportH - GUTTER) {
    top = Math.max(GUTTER, viewportH - SUB_MAX_H - GUTTER);
  }

  return createPortal(
    <div
      style={{ top, left, width: SUB_W, maxHeight: SUB_MAX_H }}
      onMouseEnter={(e) => e.stopPropagation()}
      className="fixed z-[60] rounded-xl border border-slate-200 bg-white shadow-[0_10px_30px_-6px_rgba(15,23,42,0.18)] py-1.5 overflow-y-auto overscroll-contain"
      onClick={(e) => e.stopPropagation()}
    >
      {stages.map((s, i) => {
        const isTerminal = s.kind === "hired" || s.kind === "rejected";
        const prevIsActive = i > 0 && stages[i - 1].kind === "active";
        const showDivider = isTerminal && prevIsActive;
        const dotColor =
          s.kind === "hired"    ? "bg-emerald-500" :
          s.kind === "rejected" ? "bg-rose-500"    :
                                  "bg-[#3b82f6]";
        const hoverTone =
          s.kind === "hired"    ? "hover:bg-emerald-50 hover:text-emerald-700" :
          s.kind === "rejected" ? "hover:bg-rose-50 hover:text-rose-700"       :
                                  "hover:bg-blue-50 hover:text-[#1d4ed8]";
        return (
          <div key={s.id}>
            {showDivider && <div className="my-1 border-t border-slate-100" />}
            <button
              onClick={() => { onMove(s); onClose(); }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] font-medium text-slate-700 ${hoverTone}`}
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} />
                <span className="truncate">{s.label}</span>
              </span>
              {currentStageKey === s.key && (
                <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
              )}
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

function NA() {
  return <span className="text-[11.5px] text-slate-400">Not available</span>;
}

// Scheme allowlist for any user-provided URL we render into an
// anchor. Stored candidate URLs (resume, portfolio, LinkedIn) flow
// in from external input, so blindly trusting them risks XSS via
// `javascript:` or `data:` schemes. Returns the URL when safe,
// otherwise null so the caller can skip rendering the link entirely.
function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const v = u.trim();
  if (!v) return null;
  // Absolute http(s) or site-relative paths only. Server-uploaded
  // resumes are served as `/uploads/resumes/<uuid>.pdf` — that
  // matches the leading-slash branch.
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("/"))       return v;
  return null;
}

// ── Tag chip + add-tag popover ────────────────────────────────────
// Tags live on JobApplication.tags (TEXT[]). The chip shows in the
// row's TAGS column with an × on hover to remove. Add is a portal
// popover anchored to the row's tag button so it escapes overflow
// clipping (per the overlays auto-memory).

const TAG_TONES = [
  "bg-blue-50 text-[#1d4ed8] ring-[#3b82f6]/20",
  "bg-violet-50 text-violet-700 ring-violet-200/60",
  "bg-amber-50 text-amber-700 ring-amber-200/60",
  "bg-emerald-50 text-emerald-700 ring-emerald-200/60",
  "bg-rose-50 text-rose-700 ring-rose-200/60",
  "bg-cyan-50 text-cyan-700 ring-cyan-200/60",
  "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200/60",
];
function tagTone(t: string): string {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return TAG_TONES[h % TAG_TONES.length];
}
const QUICK_TAGS = [
  "High potential", "Fast tracker", "Hold", "Referral",
  "Top 5%", "Underqualified", "Recall later",
];

function TagChip({ label, tone, onRemove }: { label: string; tone: string; onRemove: () => void }) {
  return (
    <span className={`group/chip inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold ring-1 ${tone}`}>
      {label}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="opacity-0 group-hover/chip:opacity-100 transition-opacity hover:text-slate-900"
        aria-label={`Remove tag ${label}`}
      ><X size={10} /></button>
    </span>
  );
}

function TagPopover({
  candidate, existing, x, y, onClose, onAdded,
}: {
  candidate: Candidate | null;
  existing: string[];
  x: number;
  y: number;
  onClose: () => void;
  onAdded: (tag: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    inputRef.current?.focus();
    function onMouse(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!mounted || !candidate) return null;

  const POP_W = 240;
  const left  = Math.max(8, x - POP_W);
  const top   = y;

  const submit = () => {
    const t = value.trim().slice(0, 40);
    if (!t) return;
    if (existing.includes(t)) { onClose(); return; }
    onAdded(t);
    onClose();
  };

  // Quick suggestions: built-ins + tags already used on OTHER
  // candidates (so HR's vocabulary builds organically). Filtered
  // by what they're typing.
  const q = value.trim().toLowerCase();
  const suggestions = QUICK_TAGS
    .filter((t) => !existing.includes(t))
    .filter((t) => !q || t.toLowerCase().includes(q))
    .slice(0, 6);

  return createPortal(
    <div
      ref={ref}
      style={{ top, left, width: POP_W }}
      className="fixed z-50 rounded-xl border border-slate-200 bg-white shadow-[0_10px_30px_-6px_rgba(15,23,42,0.18)] p-2.5"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 px-1">
        Add tag
      </p>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(); }
        }}
        placeholder="Type and press Enter"
        maxLength={40}
        className="w-full h-9 px-3 rounded-lg border border-slate-200 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
      />
      {existing.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {existing.map((t) => (
            <span key={t} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${tagTone(t)}`}>
              {t}
            </span>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-3 mb-1.5 px-1">
            Suggestions
          </p>
          <div className="flex flex-wrap gap-1">
            {suggestions.map((t) => (
              <button
                key={t}
                onClick={() => { onAdded(t); onClose(); }}
                className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold ring-1 ${tagTone(t)} hover:brightness-95`}
              >
                + {t}
              </button>
            ))}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

function unique(arr: (string | null | undefined)[]): string[] {
  return Array.from(new Set(arr.filter((v): v is string => !!v && v.trim() !== "")))
    .sort((a, b) => a.localeCompare(b));
}

// Best-guess category label for a free-text source string. Lets HR
// see "Job Board" vs "Career Portal" hints under the source name
// without forcing a separate enum field on the schema.
function sourceCategory(s: string): string {
  const x = s.toLowerCase();
  if (/indeed|naukri|linkedin|monster|shine/i.test(x)) return "Job Boards";
  if (/referral/i.test(x))                              return "Referral";
  if (/career|portal|website|page/i.test(x))            return "Career Portal";
  if (/agency|consult/i.test(x))                        return "Agency";
  if (/walk\s*in/i.test(x))                             return "Walk-in";
  return "Other";
}
