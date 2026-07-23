"use client";

// Per-job detail page — Keka layout. Top tab bar mirrors what HR
// expects coming from Keka:
//   Job Info · Hiring Setup · Candidates · Workflow · Publish · Analytics
//
// For v1 the only fully-built tabs are Job Info (summary) and Hiring
// Setup (Application Form sub-tab with screening questions + field
// config). The rest stub a friendly "coming soon" while wiring is
// in place. Keep this file thin and let each tab live in its own
// component for parallel iteration.

import { useState, use, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher } from "@/lib/swr";
import { isHRAdmin } from "@/lib/access";
import {
  Briefcase, ArrowLeft, Users, FileText, Settings2,
  Workflow, Globe, BarChart3, ExternalLink, Pencil,
} from "lucide-react";

import JobInfoTab     from "@/components/hr/hiring/jobs/JobInfoTab";
import HiringSetupTab from "@/components/hr/hiring/jobs/HiringSetupTab";
import StubTab        from "@/components/hr/hiring/jobs/StubTab";
import EditJobModal, { EditableJob } from "@/components/hr/hiring/EditJobModal";

type TabKey = "info" | "setup" | "candidates" | "workflow" | "publish" | "analytics";

const TABS: { key: TabKey; label: string; Icon: any }[] = [
  { key: "info",       label: "Job Info",       Icon: Briefcase },
  { key: "setup",      label: "Hiring Setup",   Icon: Settings2 },
  { key: "candidates", label: "Candidates",     Icon: Users     },
  { key: "workflow",   label: "Workflow",       Icon: Workflow  },
  { key: "publish",    label: "Publish",        Icon: Globe     },
  { key: "analytics",  label: "Analytics",      Icon: BarChart3 },
];

interface JobDetail {
  id: number; title: string; department: string | null; location: string | null;
  status: string; publicSlug: string | null; isPriority: boolean;
  brand: string | null; employmentType: string | null; experienceLevel: string | null;
  salaryRange: string | null; vacancies: number;
  description: string | null; internalNotes: string | null; closesAt: string | null;
}

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();
  const canManage = isHRAdmin(session?.user as any);

  const jobKey = canManage ? `/api/hr/hiring/jobs/${id}` : null;
  const { data, isLoading, mutate } = useSWR<{ job: JobDetail }>(jobKey, fetcher);
  const job = data?.job;

  const [tab, setTab] = useState<TabKey>("setup");
  const [editOpen, setEditOpen] = useState(false);

  // `?edit=1` deep-link from the Jobs-list dropdown opens the edit
  // modal automatically. Strips the param so a page-refresh doesn't
  // re-open it after the modal is closed.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams?.get("edit") === "1") {
      setEditOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("edit");
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams]);

  if (!canManage) {
    return (
      <div className="px-6 py-12 text-center text-slate-500 text-[14px]">
        You don't have access to the Hiring console.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Page header ──────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-[1400px] mx-auto px-6 py-4">
          <button
            onClick={() => router.push("/dashboard/hr/hiring")}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-500 hover:text-[#3b82f6] mb-3"
          >
            <ArrowLeft size={13} /> Back to Hiring
          </button>
          {isLoading ? (
            <div className="h-10 w-1/2 bg-slate-100 rounded animate-pulse" />
          ) : !job ? (
            <p className="text-[13px] text-rose-600">Job not found.</p>
          ) : (
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-[22px] font-bold text-slate-900 tracking-tight">
                    {job.title}
                  </h1>
                  <StatusPill status={job.status} />
                </div>
                <div className="flex items-center gap-3 mt-2 flex-wrap text-[12.5px] text-slate-500">
                  {job.department && <span>{job.department}</span>}
                  {job.location && <span>· {job.location}</span>}
                  {job.employmentType && <span>· {job.employmentType}</span>}
                  {job.experienceLevel && <span>· {job.experienceLevel}</span>}
                  {job.vacancies > 0 && <span>· {job.vacancies} position{job.vacancies === 1 ? "" : "s"}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setEditOpen(true)}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white hover:border-[#3b82f6] hover:text-[#3b82f6] text-slate-700 text-[12px] font-semibold"
                >
                  <Pencil size={12} /> Edit details
                </button>
                {job.publicSlug && (
                  <a
                    href={`/jobs/${job.publicSlug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white hover:border-[#3b82f6] text-slate-700 text-[12px] font-semibold"
                  >
                    View public page <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="max-w-[1400px] mx-auto px-6">
          <div className="flex items-center gap-6 -mb-px overflow-x-auto">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`inline-flex items-center gap-2 px-1 py-3 border-b-2 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                    active
                      ? "border-[#3b82f6] text-[#3b82f6]"
                      : "border-transparent text-slate-500 hover:text-slate-900"
                  }`}
                >
                  <t.Icon size={14} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Tab body ─────────────────────────────────────────── */}
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {!job ? null : (
          <>
            {tab === "info"       && <JobInfoTab jobId={job.id} />}
            {tab === "setup"      && <HiringSetupTab jobId={job.id} />}
            {tab === "candidates" && <StubTab title="Candidates"        message="The cross-job Candidates view lives in the main Hiring tab. Per-job Candidates view is coming next."/>}
            {tab === "workflow"   && <StubTab title="Workflow Automation" message="Auto-actions on stage change (send email, assign owner, post to Slack) — coming next."/>}
            {tab === "publish"    && <StubTab title="Publish Options"   message="Choose which channels this job posts to: Career site, Indeed, LinkedIn, Naukri."/>}
            {tab === "analytics"  && <StubTab title="Analytics"         message="Funnel conversion, time-to-hire, source breakdown for this opening."/>}
          </>
        )}
      </div>

      {editOpen && job && (
        <EditJobModal
          job={job as unknown as EditableJob}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            // Refresh both the page header (this SWR key) AND the
            // JobInfoTab's separate fetch, plus the parent Jobs list
            // cache so the row in the Hiring tab updates too.
            mutate();
            globalMutate(`/api/hr/hiring/jobs/${job.id}`);
            globalMutate((key) => typeof key === "string" && key.startsWith("/api/hr/hiring/jobs"), undefined, { revalidate: true });
          }}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const TONE: Record<string, { dot: string; bg: string; text: string }> = {
    published: { dot: "bg-emerald-500", bg: "bg-emerald-50",  text: "text-emerald-700" },
    draft:     { dot: "bg-slate-400",   bg: "bg-slate-100",   text: "text-slate-600" },
    on_hold:   { dot: "bg-amber-500",   bg: "bg-amber-50",    text: "text-amber-700" },
    closed:    { dot: "bg-rose-500",    bg: "bg-rose-50",     text: "text-rose-700" },
  };
  const t = TONE[status] ?? TONE.draft;
  const label = status === "on_hold" ? "On hold" : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-semibold ${t.bg} ${t.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {label}
    </span>
  );
}
