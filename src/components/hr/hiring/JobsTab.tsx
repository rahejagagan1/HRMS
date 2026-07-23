"use client";

// Jobs tab — Keka-parity layout in the dashboard's blue palette.
//
// Two view modes:
//   • Grid  (default) — cards with priority star, top-line stats, and
//                       a NEW / ARCHIVED footer per Keka's layout.
//   • List           — the original table view kept for power users
//                       who want to scan many jobs at once.
//
// Filters: Status / Brand (Business Unit) / Department / Hiring
// Manager / Recruiter / Location — populated from the data so empty
// values aren't surfaced. Plus a full-width search bar matching the
// "Search for jobs by title, department, job id" treatment.
//
// Publish workflow is unchanged: status pill + Publish / Pause /
// Close transitions route through /api/hr/hiring/jobs/[id]/publish.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher } from "@/lib/swr";
import { stripLeadingCompanyContent, looksLikeKnownTitle } from "@/lib/hr/jd-format";
import { mergeSoftWrappedJdParagraphs } from "@/lib/jd-html";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { showToast } from "@/components/ui/Toast";
import {
  Plus, Briefcase, MapPin, Users, Search,
  Share2, Send, Pause, CheckCircle2, FileEdit, Pencil, MoreHorizontal,
  ExternalLink, Star, LayoutGrid, List, Calendar, Filter,
  ChevronDown, ChevronLeft, Circle, BriefcaseBusiness,
  FileText, Trash2, Settings2, Eye, Upload, X, Maximize2, Minimize2,
} from "lucide-react";
import Link from "next/link";
import KanbanBoard from "./KanbanBoard";
import JobApplicantList from "./JobApplicantList";
import CreateJobWizard from "./CreateJobWizard";
import JobShareDialog from "./JobShareDialog";
import { useUrlTab } from "@/lib/hooks/useUrlTab";
import { useUrlState } from "@/lib/hooks/useUrlState";
import dynamic from "next/dynamic";
import "react-quill-new/dist/quill.snow.css";

// ReactQuill must be dynamically imported with ssr:false — its
// constructor accesses `window` at import time.
const ReactQuill = dynamic(
  async () => (await import("react-quill-new")).default,
  { ssr: false, loading: () => <div className="px-5 py-4 text-[12.5px] text-slate-400">Loading editor…</div> },
);

// Full-featured Quill toolbar — gives HR Bold / Italic / Underline /
// font size / headings / lists / alignment, the MS-Word feature set
// most JD authors actually use. The NB Media letterhead + watermark
// in the rendered PDF come from the DOCX template (not the editor
// content), so any toolbar action affects ONLY the body text — the
// branded chrome stays intact across edits.
const JD_QUILL_MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    [{ size: ["small", false, "large", "huge"] }],
    ["bold", "italic", "underline", "strike"],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ align: [] }],
    ["clean"],
  ],
};
const JD_QUILL_FORMATS = [
  "header", "size", "bold", "italic", "underline", "strike",
  "list", "bullet", "align",
];

/** Convert plain text (as extracted from an uploaded PDF / DOCX)
 *  into Quill-compatible HTML — preserves line breaks and applies
 *  light auto-formatting:
 *    • Lines ending with ":" (≤60 chars) → <h3>
 *    • Lines starting with "-", "*", "•" → <li> wrapped in <ul>
 *    • Lines starting with "1.", "2." …  → <li> wrapped in <ol>
 *    • Everything else                   → <p>
 *  Lines that already look like HTML (start with "<") pass through. */
function plainTextToQuillHtml(input: string, knownTitle?: string): string {
  if (!input) return "";
  const trimmed = input.trim();
  // Already HTML — likely a re-edit of a stored JD. Merge soft-wrapped
  // <p> fragments (older JDs saved one <p> per PDF line) so the editor
  // shows real flowing paragraphs and the next save persists them.
  if (trimmed.startsWith("<")) return mergeSoftWrappedJdParagraphs(input);
  // Drop a pasted company letterhead from the top so it can't double the
  // .docx template's own letterhead (and drag in a typo'd email).
  const lines = stripLeadingCompanyContent(input).replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let bulletBuf: string[] = [];
  let numberedBuf: string[] = [];
  // Consecutive plain lines are soft wraps from PDF-to-text extraction
  // (one line per visual line) — buffer and join them into ONE <p> so
  // the paragraph reflows naturally in the editor and on the careers
  // page. Blank lines / bullets / numbers / headings break the flow.
  // Mirrors parseJdBlocks (careers page) + buildBodyXml (saved PDF).
  let paraBuf: string[] = [];
  let sawTitle = false;
  let sawContent = false; // true once the first real body line is emitted
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const flushB = () => {
    if (bulletBuf.length) {
      out.push(`<ul>${bulletBuf.map((b) => `<li>${escape(b)}</li>`).join("")}</ul>`);
      bulletBuf = [];
    }
  };
  const flushN = () => {
    if (numberedBuf.length) {
      out.push(`<ol>${numberedBuf.map((b) => `<li>${escape(b)}</li>`).join("")}</ol>`);
      numberedBuf = [];
    }
  };
  const flushP = () => {
    if (paraBuf.length) {
      out.push(`<p>${escape(paraBuf.join(" "))}</p>`);
      paraBuf = [];
    }
  };
  const flushAll = () => { flushB(); flushN(); flushP(); };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushAll(); out.push("<p><br></p>"); continue; }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) { flushN(); flushP(); bulletBuf.push(bullet[1]); continue; }
    const num = line.match(/^\d+[.)]\s+(.*)$/);
    if (num) { flushB(); flushP(); numberedBuf.push(num[1]); continue; }
    flushB(); flushN();
    // The .docx template prints "Job Description - {{JobTitle}}" itself —
    // drop a title line from the body so it isn't duplicated.
    if (!sawTitle) {
      const titleMatch = line.match(/^(?:Job\s+Description|Job\s+Title)\s*[-–—:]\s*(.+)$/i);
      if (titleMatch) { sawTitle = true; continue; }
      // Bare title (no label): drop a leading body line that IS the job
      // title — the template/careers/preview print it from the Title field.
      // Anchored to the known title, so a real opening sentence is safe.
      if (!sawContent && knownTitle && looksLikeKnownTitle(line, knownTitle)) { sawTitle = true; continue; }
    }
    sawContent = true; // bare-title strip above is first-content-line only
    if (/:\s*$/.test(line) && line.length <= 60) {
      flushP();
      out.push(`<h3>${escape(line.replace(/:\s*$/, ""))}</h3>`);
    } else {
      paraBuf.push(line);
    }
  }
  flushAll();
  return out.join("");
}

type JobStatus = "draft" | "published" | "on_hold" | "closed";
type ViewMode  = "grid" | "list";

type Job = {
  id: number;
  title: string;
  department: string | null;
  location: string | null;
  description?: string | null;  // not returned by the list projection (perf) — fetched per-job when needed
  isOpen: boolean;
  status: JobStatus;
  publicSlug: string | null;
  publishedAt: string | null;
  vacancies: number;
  isPriority: boolean;
  brand: string | null;
  employmentType: string | null;
  experienceLevel: string | null;
  salaryRange: string | null;
  recruiterName: string | null;
  hiringManagerName: string | null;
  applicationCount: number;
  activeCount: number;
  hiredCount: number;
  rejectedCount: number;
  newCount: number;       // still SOURCED, applied within last 48h
  recentCount: number;    // still SOURCED, applied > 48h ago
  createdAt: string;
  closesAt: string | null;
  jdFileUrl: string | null;
  jdFileName: string | null;
};

const BRAND_OPTIONS = [
  { value: "",         label: "All brands" },
  { value: "nb_media", label: "NB Media" },
  { value: "yt_labs",  label: "YT Labs" },
];
const STATUS_OPTIONS: { value: "all" | JobStatus; label: string }[] = [
  { value: "all",       label: "All status" },
  { value: "published", label: "Published" },
  { value: "draft",     label: "Draft" },
  { value: "on_hold",   label: "On hold" },
  { value: "closed",    label: "Closed" },
];

const STATUS_LABEL: Record<JobStatus, string> = {
  draft:     "Draft",
  published: "Published",
  on_hold:   "On hold",
  closed:    "Closed",
};
const STATUS_PILL: Record<JobStatus, string> = {
  draft:     "bg-slate-100 text-slate-600",
  published: "bg-emerald-50 text-emerald-700",
  on_hold:   "bg-amber-50 text-amber-700",
  closed:    "bg-rose-50 text-rose-700",
};
// Matching ring colours for the larger detail-header pill so the
// shape reads as a contained tag and not a smear of fill.
const STATUS_PILL_RING: Record<JobStatus, string> = {
  draft:     "ring-slate-200",
  published: "ring-emerald-200/70",
  on_hold:   "ring-amber-200/70",
  closed:    "ring-rose-200/70",
};
const STATUS_DOT: Record<JobStatus, string> = {
  draft:     "text-slate-400",
  published: "text-emerald-500",
  on_hold:   "text-amber-500",
  closed:    "text-rose-400",
};
export default function JobsTab({
  initialBrand,
}: {
  /** Seeds the Brand filter from the parent page's `?brand=` URL
   *  param. The value uses the schema's underscore form
   *  ("nb_media" / "yt_labs") to match `BRAND_OPTIONS`; empty string
   *  means "no initial scope". */
  initialBrand?: string;
} = {}) {
  // ── Filters ─────────────────────────────────────────────────────
  const [brand, setBrand]    = useState(initialBrand ?? "");
  // Sync to URL-driven changes (sidebar flyout navigating between
  // brand variants of the same hiring page).
  useEffect(() => {
    if (initialBrand !== undefined) setBrand(initialBrand);
  }, [initialBrand]);
  const [status, setStatus]  = useState<"all" | JobStatus>("all");
  const [department, setDepartment]   = useState("");
  const [hiringManager, setHM]        = useState("");
  const [recruiter, setRecruiter]     = useState("");
  const [location, setLocation]       = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [showPriorityOnly, setShowPriorityOnly] = useState(false);

  // ── View state ──────────────────────────────────────────────────
  // URL-synced so refresh returns to the same view. Distinct param
  // names ("jobs" vs "pipeline") so the two toggles don't collide
  // when both apply (jobs index → click a job → drawer opens).
  const [view,         setView]         = useUrlTab<ViewMode>("jobs",     "grid",   ["grid", "list"] as const);
  // List is the default — HR sees every applicant in one scrollable
  // table (including archived ones with the badge). Kanban is opt-in
  // for HR who want the visual pipeline.
  const [pipelineView, setPipelineView] = useUrlTab<"kanban" | "list">("pipeline", "list", ["kanban", "list"] as const);
  // activeJob is URL-derived (`?job=<id>`) so reloading the page
  // returns HR to the same job detail view. The setter accepts a
  // Job object (or null to close) — internally we write only the
  // id to the URL and re-derive the full Job from the jobs list.
  const [activeJobIdUrl, setActiveJobIdUrl] = useUrlState("job");
  const [showCreate, setShowCreate] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [shareJob, setShareJob]     = useState<Job | null>(null);
  const [menuJobId, setMenuJobId]   = useState<number | null>(null);
  const [busyJobId, setBusyJobId]   = useState<number | null>(null);

  // ── Data ────────────────────────────────────────────────────────
  const url = `/api/hr/hiring/jobs?brand=${encodeURIComponent(brand)}${
    status === "all" ? "" : `&statusFilter=${status}`
  }`;
  const { data, isLoading } = useSWR<{ jobs: Job[] }>(url, fetcher);
  const jobs = data?.jobs ?? [];
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  // Derive the full Job object from the URL-stored id, then wrap the
  // setter so every existing call site (`setActiveJob(jobObj)` /
  // `setActiveJob(null)`) keeps the same signature — internally we
  // only write the id to the URL.
  const activeJob = useMemo<Job | null>(
    () => activeJobIdUrl ? (jobs.find((j) => String(j.id) === activeJobIdUrl) ?? null) : null,
    [activeJobIdUrl, jobs],
  );
  const setActiveJob = useCallback((j: Job | null) => {
    setActiveJobIdUrl(j ? String(j.id) : null);
  }, [setActiveJobIdUrl]);

  // ── Filter options derived from the data ────────────────────────
  // We populate Department / HM / Recruiter / Location from what
  // actually shows up in the current result set so empty selects
  // never offer dead values.
  const departmentOpts   = useMemo(() => uniqueSorted(jobs.map(j => j.department)),       [jobs]);
  const hiringMgrOpts    = useMemo(() => uniqueSorted(jobs.map(j => j.hiringManagerName)), [jobs]);
  const recruiterOpts    = useMemo(() => uniqueSorted(jobs.map(j => j.recruiterName)),     [jobs]);
  const locationOpts     = useMemo(() => uniqueSorted(jobs.map(j => j.location)),          [jobs]);

  // ── Apply remaining client-side filters & search ────────────────
  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return jobs.filter(j => {
      if (showPriorityOnly && !j.isPriority) return false;
      if (department   && j.department         !== department)   return false;
      if (hiringManager && j.hiringManagerName !== hiringManager) return false;
      if (recruiter    && j.recruiterName      !== recruiter)    return false;
      if (location     && j.location           !== location)     return false;
      if (!q) return true;
      return [j.title, j.department, j.location, j.recruiterName, j.hiringManagerName, String(j.id)]
        .filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [jobs, debouncedSearch, department, hiringManager, recruiter, location, showPriorityOnly]);

  // Header count shows the count for the currently-displayed filter
  // (matches Keka's "Active Jobs (5)" treatment which updates as you
  // narrow).
  const headerLabel = status === "all" ? "All Jobs" :
                      status === "published" ? "Active Jobs" :
                      `${STATUS_LABEL[status]} Jobs`;

  // ── Status transitions ──────────────────────────────────────────
  const transition = async (job: Job, action: "publish" | "unpublish" | "hold" | "close") => {
    setBusyJobId(job.id);
    setMenuJobId(null);
    try {
      const res = await fetch(`/api/hr/hiring/jobs/${job.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast(j?.error || "Could not update the job status.", "error");
        return;
      }
      globalMutate(url);
      if (activeJob?.id === job.id) {
        const updated = await fetch(url).then(r => r.json()).catch(() => null);
        if (updated?.jobs) {
          const next = updated.jobs.find((j: Job) => j.id === job.id);
          if (next) setActiveJob(next);
        }
      }
    } finally {
      setBusyJobId(null);
    }
  };

  // Hard-delete with a confirm flow. First attempt (no ?force=1) lets
  // the server gate the action when applicants exist; if the server
  // returns needsForce:true, we re-prompt the user with the applicant
  // count, then retry with ?force=1 if confirmed.
  const deleteJob = async (job: Job) => {
    setMenuJobId(null);
    if (!confirm(`Delete "${job.title}"?\n\nThis is permanent. Use "Close role" if you want to keep candidate history instead.`)) return;
    setBusyJobId(job.id);
    try {
      let res = await fetch(`/api/hr/hiring/jobs/${job.id}`, { method: "DELETE" });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        if (body?.needsForce) {
          if (!confirm(`${body.error}\n\nProceed and permanently delete the job AND all ${body.applicantCount} applicants?`)) {
            return;
          }
          res = await fetch(`/api/hr/hiring/jobs/${job.id}?force=1`, { method: "DELETE" });
        }
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(body?.error || "Could not delete the job.", "error");
        return;
      }
      // If we were viewing the just-deleted job, close the detail view.
      if (activeJob?.id === job.id) setActiveJob(null);
      globalMutate(url);
    } finally {
      setBusyJobId(null);
    }
  };

  const togglePriority = async (job: Job) => {
    // Optimistic update — the user wants instant feedback on a star.
    const next = !job.isPriority;
    globalMutate(url,
      (cur: { jobs: Job[] } | undefined) => cur
        ? { jobs: cur.jobs.map(x => x.id === job.id ? { ...x, isPriority: next } : x) }
        : cur,
      { revalidate: false },
    );
    try {
      const res = await fetch(`/api/hr/hiring/jobs/${job.id}/priority`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPriority: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // Revert on failure
      globalMutate(url);
    }
  };

  // ── Detail view (per-job applicants — kanban OR list) ───────────
  // pipelineView is component-state, not URL-synced, because HR
  // typically wants the toggle to reset between jobs. Default to
  // kanban — the visual pipeline is the more common workflow.
  // const noop reference removes the "unused" lint when this is
  // the first state declaration in the closure.
  if (activeJob) {
    const st = (activeJob.status ?? (activeJob.isOpen ? "published" : "closed")) as JobStatus;
    return (
      <div>
        <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setActiveJob(null)}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 text-slate-600 hover:text-slate-900 text-[12px] font-semibold transition-colors"
              title="Back to all jobs"
            ><ChevronLeft size={13} /> All jobs</button>
            <span className="text-slate-300">/</span>
            <h2 className="text-[16px] font-semibold text-slate-800 truncate">{activeJob.title}</h2>
            <span className={`inline-flex items-center gap-1.5 ml-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.08em] ring-1 ${STATUS_PILL_RING[st]} ${STATUS_PILL[st]}`}>
              <span className="relative inline-flex h-1.5 w-1.5">
                {st === "published" && (
                  <span className="absolute inset-0 rounded-full bg-emerald-400/70 animate-ping" />
                )}
                <span className={`relative inline-block h-1.5 w-1.5 rounded-full ${
                  st === "published" ? "bg-emerald-500" :
                  st === "draft"     ? "bg-slate-400"   :
                  st === "on_hold"   ? "bg-amber-500"   :
                                       "bg-rose-500"
                }`} />
              </span>
              {STATUS_LABEL[st]}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/dashboard/hr/hiring/jobs/${activeJob.id}`}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 hover:border-[#3b82f6] hover:text-[#3b82f6] text-[11.5px] font-semibold text-slate-700"
              title="Open hiring setup, application form, scorecard, and more"
            ><Settings2 size={12} /> Hiring Setup</Link>
            <JdButton
              jobId={activeJob.id}
              jobTitle={activeJob.title}
              hasJd={!!(activeJob as any).jdFileUrl}
              jdName={(activeJob as any).jdFileName as string | null}
              onChange={async () => {
                const fresh = await fetch(url).then(r => r.json()).catch(() => null);
                if (fresh?.jobs) {
                  const next = fresh.jobs.find((j: Job) => j.id === activeJob.id);
                  if (next) setActiveJob(next);
                }
                globalMutate(url);
              }}
            />
            {st === "draft" && (
              <button
                disabled={busyJobId === activeJob.id}
                onClick={() => transition(activeJob, "publish")}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11.5px] font-semibold disabled:opacity-50"
              ><Send size={12} /> Publish</button>
            )}
            {st === "published" && activeJob.publicSlug && (
              <>
                <a
                  href={`/jobs/${activeJob.publicSlug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 hover:border-slate-300 text-[11.5px] font-semibold text-slate-700"
                ><ExternalLink size={12} /> Preview</a>
                <button
                  onClick={() => setShareJob(activeJob)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[11.5px] font-semibold"
                ><Share2 size={12} /> Share &amp; embed</button>
              </>
            )}
            {st === "on_hold" && (
              <button
                disabled={busyJobId === activeJob.id}
                onClick={() => transition(activeJob, "publish")}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11.5px] font-semibold disabled:opacity-50"
              ><Send size={12} /> Resume</button>
            )}
          </div>
        </div>
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11.5px] text-slate-500 flex items-center gap-3 flex-wrap">
            {activeJob.department && <span className="inline-flex items-center gap-1"><Briefcase size={11} /> {activeJob.department}</span>}
            {activeJob.location   && <span className="inline-flex items-center gap-1"><MapPin   size={11} /> {activeJob.location}</span>}
            <span className="inline-flex items-center gap-1"><Users size={11} /> {activeJob.applicationCount} applicants</span>
            {activeJob.vacancies > 1 && <span>· {activeJob.vacancies} positions</span>}
          </div>
          {/* Kanban / List toggle — same data either way. */}
          <div className="inline-flex p-1 rounded-lg border border-slate-200 bg-slate-50">
            <button
              onClick={() => setPipelineView("kanban")}
              className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-[11.5px] font-semibold transition-colors ${
                pipelineView === "kanban"
                  ? "bg-white text-[#3b82f6] shadow-sm"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              <LayoutGrid size={12} /> Kanban
            </button>
            <button
              onClick={() => setPipelineView("list")}
              className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-[11.5px] font-semibold transition-colors ${
                pipelineView === "list"
                  ? "bg-white text-[#3b82f6] shadow-sm"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              <List size={12} /> List
            </button>
          </div>
        </div>
        {pipelineView === "kanban"
          ? <KanbanBoard      jobId={activeJob.id} />
          : <JobApplicantList jobId={activeJob.id} jobTitle={activeJob.title} />}
        {shareJob && (
          <JobShareDialog
            job={{ id: shareJob.id, title: shareJob.title, slug: shareJob.publicSlug, brand: shareJob.brand }}
            baseUrl={baseUrl}
            onClose={() => setShareJob(null)}
          />
        )}
      </div>
    );
  }

  // Are any filters active? Used to enable/show the Clear button + a
  // small "filtered" hint next to the count.
  const anyFilterActive = !!(brand || status !== "all" || department || hiringManager || recruiter || location || search || showPriorityOnly);

  // ── Index view ──────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* ── Page module: header + toolbar + filters in one card ──
          Everything that controls the result set lives in a single
          elevated card so the visual hierarchy is title → toolbar →
          filters → results. Cleaner than three loose strips of UI. */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        {/* Title row */}
        <div className="px-6 py-5 flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="hidden sm:flex h-11 w-11 items-center justify-center rounded-xl bg-[#3b82f6]/10 text-[#3b82f6] flex-shrink-0">
              <BriefcaseBusiness size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h2 className="text-[20px] font-semibold text-slate-900 tracking-tight leading-tight">{headerLabel}</h2>
                <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded-full bg-slate-100 text-slate-700 text-[12px] font-semibold">
                  {filtered.length}
                </span>
                {anyFilterActive && (
                  <span className="text-[11px] font-medium text-slate-400">filtered</span>
                )}
              </div>
              <p className="text-[12.5px] text-slate-500 mt-1 leading-relaxed">
                Manage every job opening — create, publish, share with your careers page, and review applicants.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Priority toggle */}
            <label className="inline-flex items-center gap-2 cursor-pointer select-none h-9 px-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300 transition-colors">
              <span className="relative inline-block h-4 w-7">
                <input
                  type="checkbox"
                  checked={showPriorityOnly}
                  onChange={(e) => setShowPriorityOnly(e.target.checked)}
                  className="peer sr-only"
                />
                <span className="absolute inset-0 rounded-full bg-slate-200 peer-checked:bg-[#3b82f6] transition-colors" />
                <span className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform peer-checked:translate-x-3" />
              </span>
              <span className="text-[12px] font-medium text-slate-700">Show only priority</span>
            </label>

            {/* View switcher */}
            <div className="inline-flex h-9 rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                onClick={() => setView("grid")}
                title="Grid view"
                className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
                  view === "grid" ? "bg-[#3b82f6]/10 text-[#3b82f6]" : "text-slate-400 hover:text-slate-700"
                }`}
              ><LayoutGrid size={14} /></button>
              <button
                onClick={() => setView("list")}
                title="List view"
                className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
                  view === "list" ? "bg-[#3b82f6]/10 text-[#3b82f6]" : "text-slate-400 hover:text-slate-700"
                }`}
              ><List size={14} /></button>
            </div>

            {/* Split button — primary creates a new job, chevron opens
                a secondary menu with re-open / bulk-upload options. */}
            <CreateJobSplitButton
              onCreate={() => setShowCreate(true)}
              menuOpen={createMenuOpen}
              setMenuOpen={setCreateMenuOpen}
              onReopenArchived={() => {
                setCreateMenuOpen(false);
                setStatus("closed");
              }}
              onBulkUpload={() => {
                setCreateMenuOpen(false);
                showToast("Bulk upload jobs — coming next. We'll accept a CSV with title, department, location, brand and create draft openings.", "info");
              }}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-slate-100" />

        {/* Filter rail — grouped under the same card so it reads as
            "tools for this list" rather than a free-floating control. */}
        <div className="px-6 py-4 bg-slate-50/70">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-2.5">Filters</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <FilterSelect placeholder="Status"          value={status === "all" ? "" : status}
                          onChange={(v) => setStatus((v as "" | JobStatus) || "all")}
                          options={STATUS_OPTIONS.filter(o => o.value !== "all").map(o => ({ value: o.value, label: o.label }))} />
            <FilterSelect placeholder="Business Unit"  value={brand}        onChange={setBrand}     options={BRAND_OPTIONS.filter(o => o.value)} />
            <FilterSelect placeholder="Department"     value={department}   onChange={setDepartment} options={departmentOpts.map(v => ({ value: v, label: v }))} />
            <FilterSelect placeholder="Hiring Manager" value={hiringManager} onChange={setHM}        options={hiringMgrOpts.map(v => ({ value: v, label: v }))} />
            <FilterSelect placeholder="Recruiter"      value={recruiter}    onChange={setRecruiter} options={recruiterOpts.map(v => ({ value: v, label: v }))} />
            <FilterSelect placeholder="Location"       value={location}     onChange={setLocation}  options={locationOpts.map(v => ({ value: v, label: v }))} />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search for jobs by title, department, or job id"
                className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 bg-white text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6] transition-shadow"
              />
            </div>
            {anyFilterActive && (
              <button
                onClick={() => {
                  setBrand(""); setStatus("all"); setDepartment(""); setHM(""); setRecruiter(""); setLocation(""); setSearch(""); setShowPriorityOnly(false);
                }}
                className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-slate-200 bg-white text-[12px] font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900 transition-colors"
                title="Clear all filters"
              ><Filter size={13} /> Clear</button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="py-20 text-center">
          <div className="inline-block h-7 w-7 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white py-16 text-center">
          <Briefcase size={26} className="mx-auto text-slate-300 mb-3" />
          <p className="text-[13.5px] font-semibold text-slate-700">No jobs match these filters</p>
          <p className="text-[12px] text-slate-500 mt-1">Try clearing a filter or click "New job" to add one.</p>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((j) => (
            <JobCard
              key={j.id}
              job={j}
              busy={busyJobId === j.id}
              menuOpen={menuJobId === j.id}
              onMenuToggle={() => setMenuJobId((c) => (c === j.id ? null : j.id))}
              onTransition={(action) => transition(j, action)}
              onShare={() => { setShareJob(j); setMenuJobId(null); }}
              onPriorityToggle={() => togglePriority(j)}
              onOpen={() => setActiveJob(j)}
              onDelete={() => deleteJob(j)}
            />
          ))}
        </div>
      ) : (
        <ListView
          jobs={filtered}
          busyJobId={busyJobId}
          menuJobId={menuJobId}
          onMenuToggle={(id) => setMenuJobId((c) => (c === id ? null : id))}
          onTransition={transition}
          onShare={(j) => { setShareJob(j); setMenuJobId(null); }}
          onPriorityToggle={togglePriority}
          onOpen={setActiveJob}
          onDelete={deleteJob}
        />
      )}

      {showCreate && (
        <CreateJobWizard
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); globalMutate(url); }}
        />
      )}
      {shareJob && (
        <JobShareDialog
          job={{ id: shareJob.id, title: shareJob.title, slug: shareJob.publicSlug, brand: shareJob.brand }}
          baseUrl={baseUrl}
          onClose={() => setShareJob(null)}
        />
      )}
    </div>
  );
}

// ── JobCard (grid view) ─────────────────────────────────────────────
// Keka-parity card. Title + dept|location + an icon stats row
// (applicants • hired/vacancies • close date) and a NEW CANDIDATES /
// ARCHIVED footer with the online status dot. Priority star tucked
// top-right.
function JobCard({
  job, busy, menuOpen, onMenuToggle, onTransition, onShare, onPriorityToggle, onOpen, onDelete,
}: {
  job: Job;
  busy: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onTransition: (action: "publish" | "unpublish" | "hold" | "close") => void;
  onShare: () => void;
  onPriorityToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const st = (job.status ?? (job.isOpen ? "published" : "closed")) as JobStatus;
  const brandName = job.brand === "yt_labs" ? "YT Labs" : "NB Media";

  // overdue close-date — render in red so HR notices unfilled requisitions.
  const overdue = job.closesAt && new Date(job.closesAt) < new Date();
  const dateLabel = job.closesAt
    ? overdue
      ? `Overdue by ${Math.floor((Date.now() - new Date(job.closesAt).getTime()) / 86400000)} days`
      : new Date(job.closesAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;

  // Mark the green check colour only when the role is fully filled —
  // matches Keka where the check goes green once hired === vacancies.
  const fullyFilled = job.vacancies > 0 && job.hiredCount >= job.vacancies;

  // Coloured left accent strip per status — adds identity without
  // shouting like a full coloured header would.
  const ACCENT_BAR: Record<JobStatus, string> = {
    published: "bg-emerald-500",
    draft:     "bg-slate-300",
    on_hold:   "bg-amber-500",
    closed:    "bg-rose-500",
  };

  // Status pill colour — light tint + dot per state. Used in the
  // header so the chip reads as a real status badge rather than a
  // bare uppercase label.
  const STATUS_CHIP: Record<JobStatus, { wrap: string; dot: string; label: string }> = {
    published: { wrap: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",  dot: "bg-emerald-500", label: "Online" },
    draft:     { wrap: "bg-slate-100 text-slate-600 ring-slate-200",          dot: "bg-slate-400",   label: "Draft"  },
    on_hold:   { wrap: "bg-amber-50 text-amber-700 ring-amber-200/70",        dot: "bg-amber-500",   label: "On hold" },
    closed:    { wrap: "bg-rose-50 text-rose-700 ring-rose-200/70",           dot: "bg-rose-500",    label: "Closed" },
  };
  const chip = STATUS_CHIP[st];

  return (
    <div
      onClick={onOpen}
      className="
        group relative flex cursor-pointer overflow-hidden
        bg-white rounded-2xl border border-slate-200
        shadow-[0_1px_3px_rgba(15,23,42,0.04)]
        transition-all duration-200
        hover:-translate-y-0.5 hover:border-[#3b82f6]/50
        hover:shadow-[0_8px_24px_-6px_rgba(15,23,42,0.10)]
      "
    >
      {/* Left status accent bar — 3px coloured stripe that doubles as
          the at-a-glance status indicator. */}
      <div aria-hidden="true" className={`w-[3px] flex-shrink-0 ${ACCENT_BAR[st]}`} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* ── Header: status chip + id (left), actions (right) ── */}
        <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`inline-flex items-center gap-1.5 h-[22px] pl-2 pr-2.5 rounded-full ring-1 text-[10.5px] font-semibold tracking-[0.02em] ${chip.wrap}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${chip.dot}`} />
              {chip.label}
            </span>
            <span className="text-[11px] font-medium tabular-nums text-slate-400">#{job.id}</span>
          </div>
          {/* Action cluster — star + ⋯, ALWAYS visible. Stops click
              propagation so the card's onOpen doesn't fire when
              hitting these. */}
          <div
            className="flex items-center gap-0.5 flex-shrink-0 -mr-1"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => { e.stopPropagation(); onPriorityToggle(); }}
              title={job.isPriority ? "Remove from priority" : "Mark as priority"}
              className={`h-7 w-7 inline-flex items-center justify-center rounded-full transition-colors ${
                job.isPriority
                  ? "bg-amber-400 text-white shadow-[0_2px_6px_rgba(251,191,36,0.35)] hover:bg-amber-500"
                  : "text-slate-300 hover:text-amber-500 hover:bg-slate-50"
              }`}
            >
              <Star size={13} strokeWidth={2} className={job.isPriority ? "fill-white" : ""} />
            </button>
            <CardActionsMenu
              job={job}
              status={st}
              busy={busy}
              menuOpen={menuOpen}
              onMenuToggle={onMenuToggle}
              onTransition={onTransition}
              onShare={onShare}
              onDelete={onDelete}
            />
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────── */}
        <div className="px-4 pb-4 flex-1 min-w-0">
          <h3 className="text-[15.5px] font-semibold text-slate-900 group-hover:text-[#3b82f6] transition-colors tracking-[-0.012em] leading-[1.3] line-clamp-2">
            {job.title}
          </h3>
          <p className="text-[12px] text-slate-500 mt-1.5 truncate flex items-center gap-1.5">
            <span className="font-medium text-slate-600">{job.department || brandName}</span>
            {job.location && (
              <>
                <span className="h-[3px] w-[3px] rounded-full bg-slate-300" />
                <span>{job.location}</span>
              </>
            )}
          </p>

          {/* Stats — inline metrics ledger. Consistent icon size +
              tabular numerics for a tidy column read. */}
          <div className="mt-3.5 flex items-center gap-x-4 gap-y-1.5 text-[12px] flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-slate-700" title="Applicants">
              <Users size={13} className="text-slate-400" strokeWidth={2.25} />
              <span className="font-semibold tabular-nums">{job.applicationCount}</span>
              <span className="text-slate-400">applicants</span>
            </span>
            <span className="inline-flex items-center gap-1.5" title={`${job.hiredCount} hired of ${job.vacancies} positions`}>
              <CheckCircle2 size={13} className={fullyFilled ? "text-emerald-500" : "text-slate-400"} strokeWidth={2.25} />
              <span className={`font-semibold tabular-nums ${fullyFilled ? "text-emerald-700" : "text-slate-700"}`}>
                {job.hiredCount}/{job.vacancies}
              </span>
              <span className="text-slate-400">hired</span>
            </span>
            {dateLabel && (
              <span className="inline-flex items-center gap-1.5" title={overdue ? "Past the close date" : "Closes on"}>
                <Calendar size={13} className={overdue ? "text-rose-500" : "text-slate-400"} strokeWidth={2.25} />
                <span className={`font-semibold tabular-nums ${overdue ? "text-rose-600" : "text-slate-700"}`}>
                  {dateLabel}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-2.5 flex items-center justify-between gap-2">
          <p className="text-[10.5px] font-semibold tracking-[0.04em] text-slate-500">
            <span className={`tabular-nums ${job.newCount > 0 ? "text-[#3b82f6] font-bold" : "text-slate-700"}`}>
              {job.newCount}
            </span>
            <span className="ml-1 uppercase">new</span>
            <span className="mx-1.5 text-slate-300">·</span>
            <span className={`tabular-nums ${job.recentCount > 0 ? "text-amber-600 font-bold" : "text-slate-700"}`}>
              {job.recentCount}
            </span>
            <span className="ml-1 uppercase">recent</span>
            <span className="mx-1.5 text-slate-300">·</span>
            <span className="text-slate-700 tabular-nums">{job.rejectedCount}</span>
            <span className="ml-1 uppercase">archived</span>
          </p>
          <p className="text-[10.5px] font-medium text-slate-400 tabular-nums">
            {job.vacancies > 1 ? `${job.vacancies} positions` : "1 position"}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── List view ───────────────────────────────────────────────────────
function ListView({
  jobs, busyJobId, menuJobId, onMenuToggle, onTransition, onShare, onPriorityToggle, onOpen, onDelete,
}: {
  jobs: Job[];
  busyJobId: number | null;
  menuJobId: number | null;
  onMenuToggle: (id: number) => void;
  onTransition: (job: Job, action: "publish" | "unpublish" | "hold" | "close") => void;
  onShare: (job: Job) => void;
  onPriorityToggle: (job: Job) => void;
  onOpen: (job: Job) => void;
  onDelete: (job: Job) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-100">
          <tr>
            {["", "JOB", "BRAND", "TYPE", "RECRUITER", "HIRING MANAGER", "APPLICANTS", "STATUS", ""].map((h, i) => (
              <th key={i} className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const st = (j.status ?? (j.isOpen ? "published" : "closed")) as JobStatus;
            return (
              <tr
                key={j.id}
                className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors"
              >
                <td className="px-3 py-3.5">
                  <button
                    onClick={() => onPriorityToggle(j)}
                    className="inline-flex items-center justify-center"
                  >
                    <Star
                      size={14}
                      className={j.isPriority ? "text-[#3b82f6] fill-[#3b82f6]" : "text-slate-300 hover:text-slate-500"}
                    />
                  </button>
                </td>
                <td className="px-3 py-3.5 cursor-pointer" onClick={() => onOpen(j)}>
                  <p className="text-[13px] font-semibold text-slate-800">{j.title}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {j.department && <span>{j.department}</span>}
                    {j.location && <span> · {j.location}</span>}
                  </p>
                </td>
                <td className="px-3 py-3.5 text-[12px] text-slate-700 cursor-pointer" onClick={() => onOpen(j)}>
                  {j.brand === "yt_labs" ? "YT Labs" : "NB Media"}
                </td>
                <td className="px-3 py-3.5 text-[12px] text-slate-700 cursor-pointer" onClick={() => onOpen(j)}>{j.employmentType || "—"}</td>
                <td className="px-3 py-3.5 text-[12px] text-slate-700 cursor-pointer" onClick={() => onOpen(j)}>{j.recruiterName    || "—"}</td>
                <td className="px-3 py-3.5 text-[12px] text-slate-700 cursor-pointer" onClick={() => onOpen(j)}>{j.hiringManagerName || "—"}</td>
                <td className="px-3 py-3.5 cursor-pointer" onClick={() => onOpen(j)}>
                  <div className="flex items-center gap-2 text-[11.5px]">
                    <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold">{j.activeCount} active</span>
                    {j.hiredCount > 0 && (<span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold">{j.hiredCount} hired</span>)}
                  </div>
                </td>
                <td className="px-3 py-3.5 cursor-pointer" onClick={() => onOpen(j)}>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${STATUS_PILL[st]}`}>
                    {STATUS_LABEL[st]}
                  </span>
                </td>
                <td className="px-3 py-3.5">
                  <CardActionsMenu
                    job={j}
                    status={st}
                    busy={busyJobId === j.id}
                    menuOpen={menuJobId === j.id}
                    onMenuToggle={() => onMenuToggle(j.id)}
                    onTransition={(action) => onTransition(j, action)}
                    onShare={() => onShare(j)}
                    onDelete={() => onDelete(j)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Shared inline action menu (grid + list) ─────────────────────────
// The dropdown panel is portaled to document.body so it escapes the
// card's overflow-hidden (the card needs it for the rounded-corner
// status accent strip on the left). See feedback_overlays in memory:
// never rely on parent overflow-visible — always portal floating UI.
function CardActionsMenu({
  job, status, busy, menuOpen, onMenuToggle, onTransition, onShare, onDelete,
}: {
  job: Job;
  status: JobStatus;
  busy: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onTransition: (action: "publish" | "unpublish" | "hold" | "close") => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  // ?edit=1 deep-link tells the job detail page to auto-open the
  // edit modal so HR doesn't have to click twice.
  const editHref = `/dashboard/hr/hiring/jobs/${job.id}?edit=1`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Recompute the menu position whenever it opens — anchored to the
  // trigger button's bounding rect so the panel always lands flush
  // against it, regardless of the menu's actual height. When the
  // trigger sits near the bottom of the viewport (last card in the
  // grid, scrolled-to-end list view), opening downward would clip
  // the lower menu items — we flip to opening UPWARD in that case.
  //
  // To handle both cases without measuring the menu height, we use
  // CSS bottom-anchoring on the upward open: the panel's bottom edge
  // sits 4px above the trigger, so however tall it ends up it
  // remains visually attached. (The earlier estimate-based approach
  // floated the menu ~80px above the trigger because the estimate
  // overshot the real height.)
  const [menuPos, setMenuPos] = useState<
    | { mode: "down"; top: number; right: number }
    | { mode: "up";   bottom: number; right: number }
    | null
  >(null);
  // 240px is a conservative "this menu won't fit below" threshold —
  // tight enough to flip when really needed, loose enough to NOT
  // flip when there's plenty of room (avoids unnecessary flipping
  // mid-card-grid).
  const FLIP_THRESHOLD = 240;
  useLayoutEffect(() => {
    if (!menuOpen) { setMenuPos(null); setPos(null); return; }
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const vh = window.innerHeight;
      const spaceBelow = vh - r.bottom;
      const spaceAbove = r.top;
      const openUp = spaceBelow < FLIP_THRESHOLD && spaceAbove > spaceBelow;
      const right = window.innerWidth - r.right;
      if (openUp) {
        setMenuPos({ mode: "up", bottom: vh - r.top + 4, right });
      } else {
        setMenuPos({ mode: "down", top: r.bottom + 4, right });
      }
      // Keep the legacy `pos` boolean so the existing render path
      // (which checks `pos` truthiness before rendering the portal)
      // continues to work — its actual values are no longer read.
      setPos({ top: 0, right });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [menuOpen]);

  return (
    <div className="flex items-center gap-1.5 justify-end relative" onClick={(e) => e.stopPropagation()}>
      {status === "draft" && (
        <button
          disabled={busy}
          onClick={() => onTransition("publish")}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold disabled:opacity-50"
          title="Publish to careers page"
        ><Send size={11} /> Publish</button>
      )}
      {/* No inline primary action for already-published jobs — Share
          and the rest of the actions are reachable via the ⋯ menu so
          the card surface stays clean on hover. */}
      {status === "on_hold" && (
        <button
          disabled={busy}
          onClick={() => onTransition("publish")}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold disabled:opacity-50"
          title="Resume publishing"
        ><Send size={11} /> Resume</button>
      )}
      {status === "closed" && (
        <button
          disabled={busy}
          onClick={() => onTransition("publish")}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-slate-200 hover:border-slate-300 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
          title="Reopen"
        ><Send size={11} /> Reopen</button>
      )}
      <button
        ref={triggerRef}
        onClick={onMenuToggle}
        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
        title="More actions"
      ><MoreHorizontal size={14} /></button>

      {/* Portaled dropdown — escapes the card's overflow-hidden. */}
      {mounted && menuOpen && pos && createPortal(
        <>
          {/* Click-outside scrim — full viewport */}
          <div
            className="fixed inset-0 z-[200]"
            onClick={(e) => { e.stopPropagation(); onMenuToggle(); }}
          />
          <div
            className="fixed z-[201] w-48 rounded-lg border border-slate-200 bg-white shadow-lg py-0.5 overflow-y-auto"
            style={
              menuPos?.mode === "up"
                ? { bottom: menuPos.bottom, right: menuPos.right, maxHeight: "calc(100vh - 16px)" }
                : { top: menuPos?.top ?? pos.top, right: menuPos?.right ?? pos.right, maxHeight: "calc(100vh - 16px)" }
            }
            onClick={(e) => e.stopPropagation()}
          >
            <a
              href={editHref}
              className="flex items-center gap-2.5 px-3 h-7 text-[12px] text-slate-700 hover:bg-slate-50"
              onClick={(e) => e.stopPropagation()}
            ><Pencil size={12} strokeWidth={2} className="text-slate-400" /> Edit details</a>
            <div className="my-0.5 h-px bg-slate-100" />
            {status !== "published" && (
              <MenuItem icon={Send}        label="Publish"        onClick={() => onTransition("publish")} />
            )}
            {status === "published" && (
              <>
                <MenuItem icon={Share2}    label="Share & embed"  onClick={onShare} />
                <MenuItem icon={Pause}     label="Put on hold"    onClick={() => onTransition("hold")} />
                <MenuItem icon={FileEdit}  label="Move to draft"  onClick={() => onTransition("unpublish")} />
              </>
            )}
            {status !== "closed" && (
              <MenuItem icon={CheckCircle2} label="Close role"   onClick={() => onTransition("close")} />
            )}
            {job.publicSlug && (
              <a
                href={`/jobs/${job.publicSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 px-3 h-7 text-[12px] text-slate-700 hover:bg-slate-50"
                onClick={(e) => e.stopPropagation()}
              ><ExternalLink size={12} className="text-slate-400" /> View role page</a>
            )}
            {/* Always show "View careers page" so HR can quickly hop
                to the public landing where this role is listed —
                useful for verifying it appears under the right brand. */}
            <a
              href="/jobs"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 px-3 h-7 text-[12px] text-slate-700 hover:bg-slate-50"
              onClick={(e) => e.stopPropagation()}
            ><ExternalLink size={12} className="text-slate-400" /> View careers page</a>
            <div className="my-0.5 h-px bg-slate-100" />
            <MenuItem icon={Trash2} label="Delete job" onClick={onDelete} danger />
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// ── JD attach/replace button for the active-job header ─────────────
// Opens a hidden file picker, uploads to /api/hr/hiring/jobs/[id]/jd,
// then calls onChange so the parent can refresh the active job.
function JdButton({
  jobId, jobTitle, hasJd, jdName, onChange,
}: {
  jobId: number;
  jobTitle: string;
  hasJd: boolean;
  jdName: string | null;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // File picked but not yet uploaded — held while HR previews + edits
  // the extracted text inside the modal. Confirming the modal does
  // the actual upload (with edited text), cancelling discards.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // Edit mode: the existing JD's HTML, loaded on demand for in-place editing.
  const [editHtml, setEditHtml] = useState<string | null>(null);

  // Load the current JD text and open the editor for in-place editing.
  const openEdit = async () => {
    setMenuOpen(false);
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/hiring/jobs/${jobId}/jd`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(j?.error || "Couldn't load the JD to edit", "error"); return; }
      setEditHtml(String(j?.jdText ?? ""));
    } finally { setBusy(false); }
  };

  // Save an edited JD (text only) — re-renders the PDF server-side.
  const saveEdit = async (jdText: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/hiring/jobs/${jobId}/jd`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jdText }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast(j?.error || "JD save failed", "error");
        return false;
      }
      onChange();
      return true;
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setMenuOpen(false);
    setBusy(true);
    try {
      await fetch(`/api/hr/hiring/jobs/${jobId}/jd`, { method: "DELETE" });
      onChange();
    } finally { setBusy(false); }
  };

  const upload = async (file: File, jdText: string | null) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (jdText && jdText.trim()) fd.append("jdText", jdText);
      const res = await fetch(`/api/hr/hiring/jobs/${jobId}/jd`, { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast(j?.error || "JD upload failed", "error");
        return false;
      }
      onChange();
      return true;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <input
        ref={ref}
        type="file"
        accept=".pdf,.doc,.docx,.rtf,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          // Open the preview modal instead of uploading directly.
          // HR can extract + edit text, then confirm.
          if (f) setPendingFile(f);
          if (ref.current) ref.current.value = "";
        }}
      />
      {!hasJd ? (
        <button
          onClick={() => ref.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 hover:border-slate-300 text-[11.5px] font-semibold text-slate-700 disabled:opacity-50"
          title="Attach a JD file (PDF, DOC, DOCX)"
        ><FileText size={12} /> {busy ? "Uploading…" : "Attach JD"}</button>
      ) : (
        <>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 hover:border-slate-300 text-[11.5px] font-semibold text-slate-700 disabled:opacity-50"
            title={jdName || "Job Description attached"}
          >
            <FileText size={12} className="text-[#3b82f6]" />
            <span className="max-w-[120px] truncate">{jdName || "JD attached"}</span>
            <ChevronDown size={12} className="text-slate-400" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-[100]" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-9 z-[101] w-44 rounded-lg border border-slate-200 bg-white shadow-lg py-1.5">
                <button
                  onClick={openEdit}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50"
                ><Pencil size={12} className="text-slate-400" /> Edit JD</button>
                <button
                  onClick={() => { setMenuOpen(false); ref.current?.click(); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50"
                ><FileText size={12} className="text-slate-400" /> Replace file</button>
                <button
                  onClick={remove}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-rose-600 hover:bg-slate-50"
                ><Trash2 size={12} className="text-rose-400" /> Remove JD</button>
              </div>
            </>
          )}
        </>
      )}

      {pendingFile && (
        <JdReplaceModal
          file={pendingFile}
          jobTitle={jobTitle}
          saving={busy}
          onCancel={() => setPendingFile(null)}
          onConfirm={async (edited) => {
            const ok = await upload(pendingFile, edited);
            if (ok) setPendingFile(null);
          }}
        />
      )}

      {editHtml !== null && (
        <JdReplaceModal
          initialHtml={editHtml}
          confirmLabel="Save JD"
          jobTitle={jobTitle}
          saving={busy}
          onCancel={() => setEditHtml(null)}
          onConfirm={async (edited) => {
            const ok = await saveEdit(edited);
            if (ok) setEditHtml(null);
          }}
        />
      )}
    </div>
  );
}

// JdReplaceModal — preview + edit the freshly picked JD before
// committing the upload. Mirrors the wizard's inline JD editor, but
// scoped to a single modal so HR can replace an existing JD without
// leaving the job-detail page.
function JdReplaceModal({
  file, initialHtml, confirmLabel, jobTitle, saving, onCancel, onConfirm,
}: {
  file?: File | null;
  initialHtml?: string;       // edit mode: load existing JD HTML instead of a file
  confirmLabel?: string;      // edit mode: "Save JD" instead of "Replace JD"
  jobTitle: string;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (jdText: string) => Promise<void>;
}) {
  const [text, setText]             = useState(file ? "" : (initialHtml ?? ""));
  const [extracting, setExtracting] = useState(!!file);
  const [error, setError]           = useState<string | null>(null);
  // Website-style preview — renders the current editor HTML inside a
  // replica of the careers page's JD panel (letterhead + watermark +
  // the same global .jd-prose CSS), so HR sees EXACTLY what a
  // candidate will see. Purely client-side: no PDF round-trip.
  const [previewOpen, setPreviewOpen] = useState(false);
  // Maximised mode lets HR expand the modal to nearly fullscreen so
  // long JDs are easier to scan + edit. Toggles via the header icon.
  const [expanded, setExpanded]     = useState(false);

  // Esc-to-close while not actively saving.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, saving]);

  // Extract text from the picked file on mount. In EDIT mode (no file) there's
  // nothing to extract — the existing JD HTML is already loaded into `text`.
  useEffect(() => {
    if (!file) { setExtracting(false); setError(null); return; }
    let cancelled = false;
    const ctrl = new AbortController();
    const timeoutId = window.setTimeout(() => ctrl.abort(), 30_000);
    setExtracting(true);
    setError(null);
    (async () => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/hr/hiring/jd-extract", {
          method: "POST",
          body: fd,
          signal: ctrl.signal,
        });
        const j = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(j?.error || `Couldn't read the file (HTTP ${res.status})`);
        // Extractor returns plain text — Quill needs HTML. Apply the
        // light auto-formatting so the first paint already shows
        // headings / lists, then HR can refine with the toolbar.
        setText(plainTextToQuillHtml(String(j?.text ?? "").trim(), jobTitle));
      } catch (e: any) {
        if (cancelled || e?.name === "AbortError") return;
        setError(e?.message ?? "Couldn't read the file");
      } finally {
        window.clearTimeout(timeoutId);
        if (!cancelled) setExtracting(false);
      }
    })();
    return () => { cancelled = true; window.clearTimeout(timeoutId); ctrl.abort(); };
  }, [file]);

  // Strip HTML tags before counting words — Quill emits "<p>hello</p>"
  // and we want a real human-readable count of body text, not markup.
  const plainText = text.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").trim();
  const wordCount = plainText ? plainText.split(/\s+/).length : 0;

  // Same &nbsp; normalisation + soft-wrap paragraph merging the careers
  // page applies before render (JdHtmlPanel in src/app/jobs/[slug]/
  // page.tsx) so wrapping behaves identically in the preview.
  const previewHtml = mergeSoftWrappedJdParagraphs(
    text
      .split("&nbsp;").join(" ")
      .split("&#160;").join(" ")
      .split(String.fromCharCode(160)).join(" "),
  );

  return (
    <div
      // Backdrop click DOES NOT close the modal — HR can edit a long
      // JD for several minutes and accidental outside-clicks were
      // wiping the work. The close button (X) in the header + the
      // Cancel button at the bottom + Esc are the explicit dismiss
      // paths.
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden transition-all duration-150 ${
          expanded ? "max-w-[96vw] h-[96vh]" : "max-w-3xl max-h-[92vh]"
        }`}
      >
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-slate-900">{file ? "Replace Job Description" : "Edit Job Description"}</h3>
            <p className="text-[11.5px] text-slate-500 truncate">
              {file
                ? <>Reading <span className="font-semibold text-slate-700">{file.name}</span> — edit any line; the cleaned-up text is what gets saved as the new PDF.</>
                : <>Edit the current JD below — the cleaned-up text is saved as the new PDF.</>}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setExpanded((v) => !v)}
              disabled={saving}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50"
              aria-label={expanded ? "Restore" : "Maximise"}
              title={expanded ? "Restore size" : "Maximise"}
            >
              {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50"
              aria-label="Cancel"
            ><X size={15} /></button>
          </div>
        </div>

        {error && (
          <div className="px-5 py-2.5 text-[12px] text-rose-700 bg-rose-50 border-b border-rose-200">
            {error}
          </div>
        )}

        {/* Full WYSIWYG editor. Times New Roman matches the PDF
            output so what HR sees in the editor reads exactly the
            same as the final document. The NB Media letterhead +
            watermark live in the DOCX template (public/templates/
            jd-template.docx), NOT in this content — formatting
            applied here only affects the body region of the
            generated PDF. */}
        <div
          className={`jd-quill-wrap flex-1 overflow-auto bg-white ${extracting || saving ? "opacity-60 pointer-events-none" : ""}`}
          style={{ fontFamily: '"Times New Roman", Georgia, serif' }}
        >
          {/* Non-editable title header — matches the .docx {{JobTitle}} +
              careers <h1>; lives outside ReactQuill so it never enters the
              saved body (the matching title line is stripped above). */}
          {jobTitle && jobTitle.trim() ? (
            <div
              contentEditable={false}
              aria-hidden="true"
              style={{ fontSize: "20px", fontWeight: 700, textAlign: "center", margin: "18px 20px 14px", color: "#0f172a" }}
            >
              {jobTitle}
            </div>
          ) : null}
          <ReactQuill
            theme="snow"
            value={text}
            onChange={setText}
            modules={JD_QUILL_MODULES}
            formats={JD_QUILL_FORMATS}
            placeholder={
              extracting
                ? "Reading file content…"
                : error
                  ? "Couldn't extract the file's text — paste or type the JD here."
                  : "Edit the extracted JD here — use the toolbar to bold, resize, or list items."
            }
            readOnly={extracting || saving}
          />
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[11px] text-slate-500">
            {extracting ? "Reading file…" : `${wordCount} word${wordCount === 1 ? "" : "s"}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              disabled={extracting || saving || !text.trim()}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-slate-200 hover:border-[#3b82f6] hover:text-[#3b82f6] text-slate-700 text-[11.5px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Eye size={12} /> Preview
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="h-8 px-3 rounded-md text-[12px] font-semibold text-slate-600 hover:bg-white disabled:opacity-50"
            >Cancel</button>
            <button
              type="button"
              onClick={() => onConfirm(text)}
              disabled={extracting || saving || !text.trim()}
              className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-slate-300 text-white text-[12px] font-semibold shadow-sm"
            >
              <Upload size={12} /> {saving ? "Saving…" : (confirmLabel ?? "Replace JD")}
            </button>
          </div>
        </div>
      </div>

      {previewOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl h-[92vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
          >
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
              <h3 className="text-[14px] font-semibold text-slate-900">
                Website preview
                <span className="ml-2 text-[11.5px] font-medium text-slate-400">how candidates see it on the careers page</span>
              </h3>
              <button
                onClick={() => setPreviewOpen(false)}
                className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100"
                aria-label="Close preview"
              ><X size={15} /></button>
            </div>
            {/* Replica of JdHtmlPanel on /jobs/[slug] — same letterhead
                strip, watermark, Times body, and the SAME global
                .jd-prose CSS, so this preview cannot drift from the
                real careers-page render. */}
            <div className="flex-1 overflow-y-auto bg-slate-100 p-3 sm:p-5">
              <div className="relative max-w-3xl mx-auto rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.12)]">
                <div className="relative flex items-start justify-between gap-4 px-5 sm:px-8 pt-5 sm:pt-7 pb-3 border-b border-slate-100 bg-gradient-to-b from-white to-slate-50/40">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#3b82f6]">NB Media</p>
                    <p className="mt-1 text-[12px] sm:text-[13px] text-slate-600 leading-snug">YT Money Productions Pvt. Ltd.</p>
                    <p className="text-[10.5px] sm:text-[11.5px] text-slate-400 leading-snug">HRD@nbmediaproductions.com · +91&nbsp;81468&nbsp;91380</p>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo.png" alt="NB Media" className="h-10 sm:h-12 w-auto shrink-0" />
                </div>
                <div className="relative">
                  <div aria-hidden="true" className="pointer-events-none select-none absolute inset-0 flex items-center justify-center overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo.png" alt="" className="w-[60%] max-w-[460px] opacity-[0.05]" style={{ filter: "grayscale(20%)" }} />
                  </div>
                  <div className="relative px-5 sm:px-10 py-6 sm:py-8">
                    <div className="text-slate-800" style={{ fontFamily: '"Times New Roman", Georgia, serif' }}>
                      <div className="jd-prose" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon, label, onClick, danger,
}: { icon: any; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 h-7 text-[12px] hover:bg-slate-50 ${
        danger ? "text-rose-600" : "text-slate-700"
      }`}
    ><Icon size={12} strokeWidth={2} className={danger ? "text-rose-400" : "text-slate-400"} /> {label}</button>
  );
}

// ── Create job split button ─────────────────────────────────────────
// Main button creates a new job. The chevron half opens a small menu
// with Re-open archived / Bulk upload — matches the Keka pattern.
// Both ends share the same blue pill and round-cap visually as one
// unit so it doesn't look like two buttons crammed together.
function CreateJobSplitButton({
  onCreate, menuOpen, setMenuOpen, onReopenArchived, onBulkUpload,
}: {
  onCreate: () => void;
  menuOpen: boolean;
  setMenuOpen: (b: boolean) => void;
  onReopenArchived: () => void;
  onBulkUpload: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen, setMenuOpen]);

  return (
    <div ref={ref} className="relative inline-flex items-stretch">
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 h-9 pl-4 pr-3.5 rounded-l-lg bg-[#3b82f6] text-white text-[12.5px] font-semibold hover:bg-[#2563eb] transition-colors shadow-sm"
      >
        <Plus size={14} /> New job
      </button>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="h-9 w-8 inline-flex items-center justify-center rounded-r-lg bg-[#3b82f6] text-white border-l border-white/25 hover:bg-[#2563eb] transition-colors shadow-sm"
        title="More options"
        aria-label="More create options"
      >
        <ChevronDown size={13} className={`transition-transform ${menuOpen ? "rotate-180" : ""}`} />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-1.5 z-30 w-60 rounded-xl border border-slate-200 bg-white shadow-[0_10px_30px_-6px_rgba(15,23,42,0.18)] py-1.5">
          <button
            onClick={onReopenArchived}
            className="w-full text-left px-3 py-2.5 text-[12.5px] font-medium text-slate-700 hover:bg-blue-50 hover:text-[#1d4ed8]"
          >
            Re-open an archived job
          </button>
          <button
            onClick={onBulkUpload}
            className="w-full text-left px-3 py-2.5 text-[12.5px] font-medium text-slate-700 hover:bg-blue-50 hover:text-[#1d4ed8]"
          >
            Bulk upload jobs
          </button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────
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
        className="appearance-none w-full h-9 pl-3 pr-8 rounded-lg border border-slate-200 bg-white text-[12.5px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
      <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}

function uniqueSorted(values: (string | null)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v && v.trim() !== "")))
    .sort((a, b) => a.localeCompare(b));
}
