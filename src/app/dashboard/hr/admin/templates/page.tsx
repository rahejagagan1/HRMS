"use client";

// Templates landing — lists every LetterTemplate from the DB.
// Clicking a card routes to the per-template editor, which lets
// HR pick an employee, fill custom inputs, preview, and generate
// the PDF (which also auto-saves under the employee's Documents).

import Link from "next/link";
import useSWR from "swr";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { isLeadershipOrHR } from "@/lib/access";
import { FileText, FileSignature, Briefcase, Award, BadgeCheck, Sparkles, FileCheck2 } from "lucide-react";

// Map the URL ?brand= slug to the LetterTemplate.businessUnit value
// stored in the DB. The HR Dashboard's brand-switcher sends slugs
// (nb-media / yt-labs / all); the API expects the proper case.
function slugToBrand(slug: string | null | undefined): string | null {
  if (slug === "yt-labs") return "YT Labs";
  if (slug === "nb-media") return "NB Media";
  if (slug === "all") return null; // developer "all brands" view
  return null;
}

const CATEGORY_META: Record<string, { label: string; icon: any; bg: string; text: string }> = {
  onboarding:   { label: "Onboarding",   icon: Briefcase,    bg: "bg-emerald-50",   text: "text-emerald-700" },
  offboarding:  { label: "Offboarding",  icon: FileSignature,bg: "bg-amber-50",     text: "text-amber-700"   },
  appraisal:    { label: "Appraisal",    icon: Award,        bg: "bg-violet-50",    text: "text-violet-700"  },
  general:      { label: "General",      icon: FileText,     bg: "bg-slate-50",     text: "text-slate-700"   },
};

const TEMPLATE_ICONS: Record<string, any> = {
  fnf_settlement:        FileSignature,
  internship_completion: BadgeCheck,
  probation_confirmation:Award,
  relieving_service:     FileCheck2,
  revised_offer_letter:  Briefcase,
};

export default function TemplatesPage() {
  // Next.js 16 + Turbopack require a Suspense boundary around any
  // useSearchParams() consumer for the page to prerender. Wrap the
  // body so the chrome (sidebar, header) doesn't depend on it.
  return (
    <Suspense fallback={null}>
      <TemplatesPageInner />
    </Suspense>
  );
}

function TemplatesPageInner() {
  const { data: session } = useSession();
  const me = session?.user as any;
  // Brand context comes from ?brand= in the URL (set by the
  // HR-Dashboard brand-switcher). If absent, fall back to the
  // viewer's profile.businessUnit (default NB Media when null).
  const searchParams = useSearchParams();
  const brandSlug = searchParams?.get("brand") ?? null;
  const urlBrand = slugToBrand(brandSlug);                       // YT Labs | NB Media | null (for "all")
  const sessionBrand: string = me?.businessUnit || "NB Media";   // legacy fallback
  // If the URL says "all", we WANT cross-brand listing → pass
  // `all=1` to the API. Otherwise use the URL brand if set, else
  // the session brand.
  const effectiveBrand = brandSlug === "all" ? null : (urlBrand ?? sessionBrand);
  const apiUrl = brandSlug === "all"
    ? "/api/hr/letter-templates?all=1"
    : `/api/hr/letter-templates?brand=${encodeURIComponent(effectiveBrand ?? "NB Media")}`;

  const { data: templates = [], isLoading, mutate } = useSWR<any[]>(apiUrl, fetcher);

  if (!isLeadershipOrHR(me)) {
    return (
      <div className="p-6">
        <p className="text-[13px] text-slate-500">You don't have access to this page.</p>
      </div>
    );
  }

  // First-time bootstrap — if the table is empty, prompt to seed.
  const empty = !isLoading && templates.length === 0;

  return (
    <div className="px-6 py-5 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-[11.5px] text-slate-500 mb-2">
            <Link href="/dashboard/hr/admin" className="hover:text-slate-800 transition-colors">HR Dashboard</Link>
            <span>/</span>
            <span className="text-slate-700 font-medium">Templates</span>
          </div>
          <h1 className="text-[22px] font-semibold text-slate-800 tracking-tight">Letter Templates</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Pick a template, search the employee, fill the few custom fields, and generate a branded letter.
            The PDF auto-saves under the employee's Documents.
          </p>
        </div>
        {/* Sync button — idempotent re-seed. Inserts any template
            present in the code seeds but missing from the DB (e.g.
            a newly-added letter type). Existing rows are never
            touched, so HR's edits stay intact. */}
        {!empty && !isLoading && (
          <button
            type="button"
            onClick={async () => {
              const res = await fetch("/api/hr/letter-templates", { method: "POST" });
              if (!res.ok) { alert("Sync failed"); return; }
              const j = await res.json().catch(() => ({}));
              await mutate();
              alert(`Sync complete — ${j?.inserted ?? 0} added, ${j?.skipped ?? 0} already present.`);
            }}
            className="inline-flex items-center gap-1.5 h-9 px-3 border border-slate-200 hover:border-slate-300 rounded-lg text-[12.5px] font-medium text-slate-600 hover:text-slate-800 transition-colors"
            title="Insert any new template definitions from the code seeds into the DB. Existing rows are skipped."
          >
            <Sparkles className="w-3.5 h-3.5" /> Sync templates
          </button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-32">
          <div className="w-7 h-7 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {empty && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center">
          <p className="text-[14px] font-semibold text-slate-700">No templates yet.</p>
          <p className="mt-1 text-[12.5px] text-slate-500">Click below to seed the standard NB Media letters (FnF, Internship Completion, Probation, Revised Offer).</p>
          <button
            type="button"
            onClick={async () => {
              const res = await fetch("/api/hr/letter-templates", { method: "POST" });
              if (!res.ok) { alert("Seed failed"); return; }
              await mutate();
            }}
            className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold"
          >
            Seed default templates
          </button>
        </div>
      )}

      {!empty && !isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t: any) => {
            const cat  = CATEGORY_META[t.category] ?? CATEGORY_META.general;
            const Icon = TEMPLATE_ICONS[t.key] ?? cat.icon ?? FileText;
            return (
              <Link
                key={`${t.key}:${t.businessUnit ?? "any"}`}
                // Carry the current brand context into the editor
                // so opening a card from the YT Labs dashboard
                // opens the YT Labs variant. Falls back to the
                // viewer's session brand when the URL doesn't
                // specify one.
                href={`/dashboard/hr/admin/templates/${t.key}${brandSlug ? `?brand=${brandSlug}` : ""}`}
                className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] hover:border-[#008CFF]/40 hover:shadow-[0_4px_18px_rgba(15,23,42,0.06)] transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#008CFF]/10 text-[#008CFF]`}>
                    <Icon className="w-5 h-5" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[14px] font-semibold text-slate-800">{t.title}</h3>
                    <p className="mt-1 text-[11.5px] text-slate-500 flex flex-wrap items-center gap-1.5">
                      <span className={`inline-block px-1.5 py-px rounded ${cat.bg} ${cat.text} text-[10px] font-bold uppercase tracking-wider`}>{cat.label}</span>
                      {/* Brand badge — shows which business unit
                          this template variant is for. Lets HR see
                          at a glance whether YT Labs has its own
                          version or is still falling back. */}
                      {t.businessUnit ? (
                        <span className={`inline-block px-1.5 py-px rounded text-[10px] font-bold uppercase tracking-wider ${
                          t.businessUnit === "YT Labs"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-cyan-50 text-cyan-700"
                        }`}>
                          {t.businessUnit}
                        </span>
                      ) : (
                        <span className="inline-block px-1.5 py-px rounded bg-slate-100 text-slate-600 text-[10px] font-bold uppercase tracking-wider">
                          Universal
                        </span>
                      )}
                      {Array.isArray(t.customFields) && t.customFields.length > 0 && (
                        <span className="text-slate-400">· {t.customFields.length} custom field{t.customFields.length === 1 ? "" : "s"}</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-end text-[12px] font-medium text-[#008CFF] group-hover:translate-x-0.5 transition-transform">
                  Generate
                  <svg className="ml-1 w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
