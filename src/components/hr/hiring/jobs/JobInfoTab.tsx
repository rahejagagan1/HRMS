// Job Info tab — read-only summary card of the job's metadata. For
// editing we still funnel through the existing CreateJobModal /
// publish workflow elsewhere; this tab just gives HR a glance at
// what's currently saved on the requisition.

"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr";

interface JobDetail {
  id: number;
  title: string;
  description: string | null;
  department: string | null;
  location: string | null;
  brand: string | null;
  employmentType: string | null;
  experienceLevel: string | null;
  salaryRange: string | null;
  vacancies: number;
  internalNotes: string | null;
  recruiterName: string | null;
  hiringManagerName: string | null;
  jdFileName: string | null;
  jdFileUrl: string | null;
}

interface Interviewer {
  id: number; name: string; profilePictureUrl: string | null;
}

export default function JobInfoTab({ jobId }: { jobId: number }) {
  const { data } = useSWR<{ job: JobDetail; interviewers: Interviewer[] }>(
    `/api/hr/hiring/jobs/${jobId}`, fetcher,
  );
  const job = data?.job;
  const interviewers = data?.interviewers ?? [];

  if (!job) {
    return <div className="h-40 rounded-xl border border-slate-200 bg-white animate-pulse" />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <Card title="Description">
          {job.description ? (
            <div className="prose prose-sm max-w-none text-[13px] text-slate-700 whitespace-pre-wrap">
              {job.description}
            </div>
          ) : (
            <Empty msg="No description added yet." />
          )}
        </Card>
        <Card title="Internal notes">
          {job.internalNotes ? (
            <p className="text-[13px] text-slate-700 whitespace-pre-wrap">{job.internalNotes}</p>
          ) : (
            <Empty msg="No internal notes." />
          )}
        </Card>
      </div>
      <div className="space-y-4">
        <Card title="Details">
          <dl className="space-y-2.5">
            <Detail label="Brand"            value={job.brand} />
            <Detail label="Department"       value={job.department} />
            <Detail label="Location"         value={job.location} />
            <Detail label="Employment type"  value={job.employmentType} />
            <Detail label="Experience"       value={job.experienceLevel} />
            <Detail label="Salary range"     value={job.salaryRange} />
            <Detail label="Vacancies"        value={String(job.vacancies)} />
          </dl>
        </Card>
        <Card title="Hiring team">
          <dl className="space-y-2.5">
            <Detail label="Recruiter"        value={job.recruiterName} />
            <Detail label="Hiring manager"   value={job.hiringManagerName} />
          </dl>
          {interviewers.length > 0 && (
            <>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Interviewers</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {interviewers.map((i) => (
                  <span key={i.id} className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-slate-100 text-[11px] font-medium text-slate-700">
                    {i.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </Card>
        {job.jdFileUrl && (
          <Card title="Job description file">
            <a
              href={job.jdFileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12.5px] font-semibold text-[#3b82f6] hover:underline"
            >
              {job.jdFileName ?? "Download JD"}
            </a>
          </Card>
        )}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-[13px] font-semibold text-slate-800 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12.5px]">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800 font-medium text-right truncate">{value || "—"}</dd>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <p className="text-[12px] text-slate-400 italic">{msg}</p>;
}
