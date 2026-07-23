"use client";

// Hiring Setup tab — Keka layout with four sub-tabs (Application
// Form, Hiring Team, Hiring Flow, Scorecard). Only Application Form
// is fully built; the others stub a friendly placeholder so HR can
// see what's coming.

import { FileText, Users, Workflow, ClipboardList } from "lucide-react";
import ApplicationFormPanel from "./ApplicationFormPanel";
import StubTab from "./StubTab";
import { useUrlTab } from "@/lib/hooks/useUrlTab";

type SetupTabKey = "form" | "team" | "flow" | "scorecard";

const SUB_TABS: { key: SetupTabKey; label: string; Icon: any }[] = [
  { key: "form",      label: "Application Form", Icon: FileText      },
  { key: "team",      label: "Hiring Team",      Icon: Users         },
  { key: "flow",      label: "Hiring Flow",      Icon: Workflow      },
  { key: "scorecard", label: "Scorecard",        Icon: ClipboardList },
];
const SUB_KEYS = SUB_TABS.map((t) => t.key) as readonly SetupTabKey[];

export default function HiringSetupTab({ jobId }: { jobId: number }) {
  // URL-synced via "setup" param — distinct from outer "tab" param.
  const [sub, setSub] = useUrlTab<SetupTabKey>("setup", "form", SUB_KEYS);
  return (
    <div className="space-y-5">
      {/* Sub-tab pills */}
      <div className="inline-flex items-center gap-1 p-1 rounded-xl border border-slate-200 bg-white">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSub(t.key)}
            className={`inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[12.5px] font-semibold transition-colors ${
              sub === t.key
                ? "bg-[#3b82f6]/10 text-[#1d4ed8] ring-1 ring-[#3b82f6]/30"
                : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <t.Icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {sub === "form"      && <ApplicationFormPanel jobId={jobId} />}
      {sub === "team"      && <StubTab title="Hiring Team"   message="Recruiter, hiring manager, and interviewer panel — coming next."/>}
      {sub === "flow"      && <StubTab title="Hiring Flow"   message="Per-job pipeline override (skip rounds, add custom stages). Today the global pipeline applies."/>}
      {sub === "scorecard" && <StubTab title="Scorecard"     message="Define what interviewers score (skills, traits) per round. Coming next."/>}
    </div>
  );
}
