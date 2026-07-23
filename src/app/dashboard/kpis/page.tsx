"use client";

// Department-scoped KPI dashboard. The /api/kpis endpoint decides which
// departments the caller can see (their own / all). Each department
// surface shows the uploaded KPI doc (or an empty state) plus a small
// preview of who's in that department.

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { BarChart3, FileText, Users, Building2, Download } from "lucide-react";

type Member = {
  id: number;
  name: string | null;
  profilePictureUrl: string | null;
  designation: string | null;
};
type DepartmentEntry = {
  brand: string;
  department: string;
  fileName: string | null;
  fileUrl: string | null;
  uploadedAt: string | null;
  members: Member[];
};
type ApiData = {
  scope: "all" | "self";
  myDepartment: string | null;
  myBrand?: string;
  departments: DepartmentEntry[];
};

function Avatar({ name, url, size = 30 }: { name: string | null; url?: string | null; size?: number }) {
  const display = name || "?";
  const initials = display.split(" ").map(p => p[0] || "").join("").slice(0, 2).toUpperCase();
  const palette = ["#4f46e5","#0891b2","#059669","#d97706","#dc2626","#7c3aed","#0f6ecd"];
  const bg = palette[display.charCodeAt(0) % palette.length];
  if (url) return <img src={url} alt={display} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white shrink-0"
      style={{ width: size, height: size, background: bg, fontSize: Math.round(size * 0.36) }}
    >
      {initials}
    </div>
  );
}

function DepartmentCard({ entry }: { entry: DepartmentEntry }) {
  const hasDoc = !!entry.fileUrl;
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#3b82f6]/10 text-[#3b82f6]">
            <Building2 size={16} />
          </div>
          <div>
            <h2 className="text-[15px] font-bold text-slate-800">{entry.department}</h2>
            <p className="mt-0.5 text-[11.5px] text-slate-500">
              {entry.members.length} {entry.members.length === 1 ? "member" : "members"}
              {entry.uploadedAt && ` · Updated ${new Date(entry.uploadedAt).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}`}
            </p>
          </div>
        </div>
        {hasDoc && (
          <a
            href={entry.fileUrl!}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#3b82f6] px-3 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[#2563eb]"
          >
            <Download size={13} />
            View KPI doc
          </a>
        )}
      </div>

      {/* Body */}
      <div className="px-5 py-4">
        {hasDoc ? (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12.5px]">
            <FileText size={14} className="shrink-0 text-[#3b82f6]" />
            <span className="truncate text-slate-700">{entry.fileName}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-[12.5px] text-slate-500">
            <FileText size={14} className="opacity-60" />
            <span>KPI document not uploaded yet</span>
          </div>
        )}

        {/* Member preview — small avatar strip */}
        {entry.members.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">
              Team
            </p>
            <ul className="flex flex-wrap gap-2">
              {entry.members.slice(0, 12).map((m) => (
                <li
                  key={m.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-1.5 py-1 pr-2.5 text-[11.5px] text-slate-700"
                  title={`${m.name ?? "—"}${m.designation ? ` · ${m.designation}` : ""}`}
                >
                  <Avatar name={m.name} url={m.profilePictureUrl} size={20} />
                  <span className="truncate max-w-[160px]">{m.name ?? "—"}</span>
                </li>
              ))}
              {entry.members.length > 12 && (
                <li className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11.5px] text-slate-500">
                  +{entry.members.length - 12} more
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

export default function KpisPage() {
  const { data, error, isLoading } = useSWR<ApiData>("/api/kpis", fetcher);
  const { data: session } = useSession();
  const sessionUser = session?.user as any;

  // Brand scope — "" / "nb-media" / "yt-labs". Filters the department
  // list using the canonical brand catalogues (DEPARTMENTS for NB
  // Media, DEPARTMENTS_YT_LABS for YT Labs) since the /api/kpis
  // payload only carries department NAMES, not businessUnit.
  //
  // Default seeded from the viewer's own businessUnit so a YT Labs
  // HR Manager / employee lands on YT Labs by default and an NB
  // Media one lands on NB Media. CEO / developer (super-admins) get
  // "all" so they can scan both brands. Pills hidden when the API
  // scoped them to a single department (scope='self') — there's
  // nothing to narrow.
  const [brand, setBrand] = useState<"" | "nb-media" | "yt-labs">("");
  const [brandTouched, setBrandTouched] = useState<boolean>(false);
  const { data: viewerProfile } = useSWR<any>(
    sessionUser ? "/api/hr/profile" : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  useEffect(() => {
    if (brandTouched) return;
    const isSuperAdmin = sessionUser?.orgLevel === "ceo" || sessionUser?.isDeveloper;
    if (isSuperAdmin) { setBrand(""); return; }
    const bu = viewerProfile?.employeeProfile?.businessUnit;
    if (bu === "YT Labs") setBrand("yt-labs");
    else if (bu === "NB Media" || bu == null) setBrand("nb-media");
  }, [viewerProfile, sessionUser, brandTouched]);

  // Filter by the entry's explicit `brand` — authoritative now that
  // the API tags each row, instead of inferring brand from department
  // catalogue membership. Handles the shared "HR Operations & TA"
  // case cleanly: the same name produces two entries, one per brand.
  const filteredDepartments = useMemo(() => {
    const all = data?.departments ?? [];
    if (!brand) return all;
    const wanted = brand === "yt-labs" ? "YT Labs" : "NB Media";
    return all.filter((d) => d.brand === wanted);
  }, [data?.departments, brand]);

  const brandPickerVisible = data?.scope === "all";

  const scopeBlurb = (() => {
    if (!data) return "";
    if (data.scope === "all") {
      if (brand === "yt-labs") return "Showing YT Labs department KPI documents.";
      if (brand === "nb-media") return "Showing NB Media department KPI documents.";
      return "Showing every department's KPI document.";
    }
    if (data.myDepartment)    return `Showing your department's KPI document (${data.myDepartment}).`;
    return "Your department isn't set on your profile yet — KPIs can't be loaded.";
  })();

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8">
      <div className="mx-auto max-w-5xl">
        {/* Header — admin "Manage KPIs" entry point lives in the HR
            Dashboard rail, not here, to keep the public listing clean. */}
        <div className="mb-6 flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3b82f6]/10 text-[#3b82f6]">
            <BarChart3 size={20} />
          </div>
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-slate-800 inline-flex items-center gap-2">
              KPIs
              {brand && brandPickerVisible && (
                <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#3b82f6]/10 text-[#3b82f6]">
                  {brand === "yt-labs" ? "YT Labs" : "NB Media"}
                </span>
              )}
            </h1>
            <p className="mt-0.5 text-[13px] text-slate-500">{scopeBlurb || "Loading…"}</p>
          </div>
        </div>

        {/* Brand scope — pill toggle strip. Hidden when the API
            scoped to a single department (regular employees), since
            there's only one row and the pills would just hide it. */}
        {brandPickerVisible && (
          <div className="mb-5 flex items-center gap-1.5 flex-wrap">
            {([
              { key: "",         label: "All brands" },
              { key: "nb-media", label: "NB Media" },
              { key: "yt-labs",  label: "YT Labs" },
            ] as const).map((opt) => {
              const active = brand === opt.key;
              return (
                <button
                  key={opt.key || "all"}
                  type="button"
                  onClick={() => { setBrand(opt.key as "" | "nb-media" | "yt-labs"); setBrandTouched(true); }}
                  className={`px-3.5 h-8 rounded-lg text-[12px] font-semibold transition-colors inline-flex items-center gap-2 ${
                    active
                      ? "bg-[#3b82f6] text-white shadow-sm"
                      : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
            Failed to load KPIs.
          </div>
        )}

        {isLoading && !data && (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[140px] animate-pulse rounded-xl border border-slate-200 bg-white" />
            ))}
          </div>
        )}

        {data && filteredDepartments.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
            <Users className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-[14px] font-semibold text-slate-700">
              {data.scope === "all"
                ? (brand ? `No departments in ${brand === "yt-labs" ? "YT Labs" : "NB Media"}` : "No KPI documents yet")
                : "Nothing to show"}
            </p>
            <p className="mt-1 text-[12.5px] text-slate-500">
              {data.scope === "all"
                ? (brand
                    ? "Switch to All brands to see the rest, or upload a KPI document for this brand from the Manage KPIs panel."
                    : "Upload your first KPI document from the Manage KPIs panel.")
                : data.myDepartment
                  ? "Your department doesn't have a KPI document uploaded yet."
                  : "Ask HR to set your department on your profile."}
            </p>
          </div>
        )}

        <div className="space-y-5">
          {filteredDepartments.map((entry) => (
            <DepartmentCard key={entry.department} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  );
}
