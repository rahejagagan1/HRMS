"use client";

// HR Hiring console — Keka-style redesign.
//
// Top-level tabs:
//   1. Dashboard   — KPIs + offer pipeline
//   2. Jobs        — list of openings → click into per-job kanban/list
//                    of that opening's applicants. The cross-job
//                    applicant list lives here too, accessed via the
//                    job view (no separate "Candidates" tab — every
//                    applicant belongs to a job).
//   3. Preboarding — accepted offers awaiting onboarding
//   4. Settings    — email templates + pipeline stages + form fields
//   5. Reports     — funnel, time-to-hire, source breakdown
//
// Each tab is its own component under src/components/hr/hiring/*
// so this file stays small and the tabs can be iterated
// independently. Drag-and-drop on the kanban uses native HTML5 DnD
// — no new dependency added.

import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { isHRAdmin } from "@/lib/access";
import { useUrlTab } from "@/lib/hooks/useUrlTab";
import { Briefcase, Settings, BarChart3, LayoutDashboard, UserPlus } from "lucide-react";

import DashboardTab    from "@/components/hr/hiring/DashboardTab";
import JobsTab         from "@/components/hr/hiring/JobsTab";
import PreboardingTab  from "@/components/hr/hiring/PreboardingTab";
import SettingsTab     from "@/components/hr/hiring/SettingsTab";
import ReportsTab      from "@/components/hr/hiring/ReportsTab";

type TabKey = "dashboard" | "jobs" | "preboarding" | "settings" | "reports";

const TABS: { key: TabKey; label: string; Icon: any }[] = [
  { key: "dashboard",   label: "Dashboard",    Icon: LayoutDashboard },
  { key: "jobs",        label: "Jobs",         Icon: Briefcase       },
  { key: "preboarding", label: "Preboarding",  Icon: UserPlus        },
  { key: "settings",    label: "Settings",     Icon: Settings        },
  { key: "reports",     label: "Reports",      Icon: BarChart3       },
];
const TAB_KEYS = TABS.map((t) => t.key) as readonly TabKey[];

export default function HiringPage() {
  const { data: session } = useSession();
  const me = session?.user as any;
  const canManage = isHRAdmin(me);
  // URL-synced so refresh / share-link returns to the same tab.
  const [tab, setTab] = useUrlTab<TabKey>("tab", "dashboard", TAB_KEYS);

  // Brand scope from `?brand=` — the HR Dashboard sidebar flyout
  // ships kebab-case slugs ("nb-media" / "yt-labs"). The hiring
  // schema stores them with underscores ("nb_media" / "yt_labs"),
  // so we convert once here and pass the underscore form down to
  // JobsTab. Empty string = no scope (same as old behaviour).
  const searchParams = useSearchParams();
  const brandSlug = (searchParams?.get("brand") || "").toLowerCase();
  const initialBrand =
    brandSlug === "yt-labs" || brandSlug === "yt"      ? "yt_labs" :
    brandSlug === "nb-media" || brandSlug === "nb"     ? "nb_media" :
    "";
  const brandBadge =
    initialBrand === "yt_labs" ? "YT Labs" :
    initialBrand === "nb_media" ? "NB Media" :
    null;

  if (!canManage) {
    return (
      <div className="px-6 py-12 text-center text-slate-500 text-[14px]">
        You don't have access to the Hiring console.
      </div>
    );
  }

  return (
    <div className="px-6 py-6 max-w-[1400px]">
      {/* Header */}
      <header className="mb-5">
        <h1 className="text-[20px] font-bold text-slate-800 inline-flex items-center gap-2">
          <Briefcase size={20} className="text-[#008CFF]" /> Hiring
          {brandBadge && (
            <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#008CFF]/10 text-[#008CFF]">
              {brandBadge}
            </span>
          )}
        </h1>
        <p className="mt-1 text-[12.5px] text-slate-500">
          Manage job openings, candidate pipelines, interviews, offers, and email automation — all in one console.
        </p>
      </header>

      {/* Tab strip — fixed (non-scrolling). Tabs auto-fit on every
          viewport size we care about; if you ever add more tabs and
          they collide on narrow screens, switch to flex-wrap rather
          than re-enabling overflow-x-auto so the bar stays single-row
          on common widths but wraps cleanly below 600px. */}
      <div className="mb-5 flex gap-0 border-b border-slate-200">
        {TABS.map(({ key, label, Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-[12.5px] font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
                active
                  ? "border-[#008CFF] text-[#008CFF]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Active tab content */}
      {tab === "dashboard"   && <DashboardTab />}
      {tab === "jobs"        && <JobsTab initialBrand={initialBrand} />}
      {tab === "preboarding" && <PreboardingTab />}
      {tab === "settings"    && <SettingsTab />}
      {tab === "reports"     && <ReportsTab />}
    </div>
  );
}
