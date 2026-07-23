"use client";

import Link from "next/link";
import { Clock, ExternalLink, Wrench, Subtitles, ClipboardList, History, Search, SpellCheck } from "lucide-react";

// Custom "VO" letter-mark, used in place of a Lucide glyph for the
// Extractor tool (which pulls voice-over audio). Matches the same prop
// signature as Lucide icons so it slots into the Tool.Icon field
// without changing the renderer. `strokeWidth` is accepted but
// ignored — a text mark has no stroke. The tile container handles
// colour + background; this component only paints the letters.
function VoMark({ size = 24, className }: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <span
      className={className}
      style={{
        fontSize:      Math.round(size * 0.72),
        fontWeight:    800,
        letterSpacing: "-0.04em",
        lineHeight:    1,
        fontFamily:    "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      VO
    </span>
  );
}

type Tool = {
  name: string;
  description: string;
  href: string;
  external: boolean;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  accent: string;
};

const TOOLS: Tool[] = [
  {
    name: "Timestamps",
    description: "Mark and share precise timestamps inside long-form videos.",
    href: "https://timestamps.nbmedia.co.in",
    external: true,
    Icon: Clock,
    accent: "#0f6ecd",
  },
  {
    name: "SRT",
    description: "Generate, edit, and export subtitle files for our videos.",
    href: "https://srt.nbmedia.co.in",
    external: true,
    Icon: Subtitles,
    accent: "#9b6bd1",
  },
  {
    name: "Old SRT Model",
    description: "Legacy subtitle generator hosted on Streamlit — kept for fallback / archive use.",
    href: "https://srtnbmedia.streamlit.app/",
    external: true,
    Icon: History,
    accent: "#64748b",
  },
  {
    name: "Case Tracker",
    description: "Track production cases end-to-end across the team.",
    href: "https://casetracker.nbmedia.co.in",
    external: true,
    Icon: ClipboardList,
    accent: "#16a34a",
  },
  {
    name: "Analysis Tool",
    description: "Analyse and break down content for the team.",
    href: "https://analysis.nbmedia.co.in/",
    external: true,
    Icon: VoMark,
    accent: "#0d9488",
  },
  {
    name: "Case Researcher",
    description: "Research and dig deeper into case material — internal tool hosted on the VPS.",
    href: "http://69.62.79.231.nip.io:3010",
    external: true,
    Icon: Search,
    accent: "#6366f1",
  },
  {
    name: "Proofreader",
    description: "Check scripts and copy for grammar and factual accuracy before publishing.",
    href: "https://proofreader.nbmedia.co.in/",
    external: true,
    Icon: SpellCheck,
    accent: "#e11d48",
  },
];

export default function ToolsPage() {
  return (
    <div className="min-h-screen bg-[#f4f7fb]">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Outer console card */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
          {/* Header band */}
          <header className="flex items-center justify-between gap-4 border-b border-slate-100 bg-gradient-to-b from-[#fbfdff] to-white px-6 py-5">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e8f1fc] text-[#0f4e93] ring-1 ring-inset ring-[#cfdef5]">
                <Wrench className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-[18px] font-semibold leading-tight text-slate-800">Tools</h1>
                <p className="mt-0.5 text-[12.5px] text-slate-500">
                  Internal utilities and external services we ship for the team.
                </p>
              </div>
            </div>
            <span className="hidden md:inline-flex items-center rounded-full bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 ring-1 ring-inset ring-slate-200">
              {TOOLS.length} {TOOLS.length === 1 ? "Tool" : "Tools"}
            </span>
          </header>

          {/* Body — tool tile grid */}
          <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2 lg:grid-cols-3">
            {TOOLS.map((t) => {
              const tile = (
                <article
                  className="group relative flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 transition hover:border-[#cfdef5] hover:shadow-[0_8px_24px_rgba(15,110,205,0.08)]"
                >
                  {/* Coloured top accent bar */}
                  <span
                    className="absolute inset-x-0 top-0 h-1 rounded-t-xl"
                    style={{ background: t.accent, opacity: 0.85 }}
                  />

                  <div className="mb-4 flex items-start justify-between gap-3">
                    {/* App-icon style — gradient face with a top sheen, soft
                        coloured drop shadow, faint inner highlight + ring. */}
                    <span
                      className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl text-white"
                      style={{
                        background: `linear-gradient(140deg, ${t.accent} 0%, ${t.accent} 55%, rgba(0,0,0,0.18) 100%), ${t.accent}`,
                        boxShadow: `0 10px 22px ${t.accent}40, inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.12)`,
                      }}
                    >
                      {/* Glossy top sheen */}
                      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent" />
                      {/* Faint corner glow */}
                      <span className="pointer-events-none absolute -left-3 -top-3 h-8 w-8 rounded-full bg-white/30 blur-md" />
                      <t.Icon size={26} strokeWidth={2.2} className="relative z-10 drop-shadow-[0_1px_1px_rgba(0,0,0,0.18)]" />
                    </span>
                    {t.external ? (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-50 text-slate-400 transition group-hover:bg-[#e8f1fc] group-hover:text-[#0f6ecd]">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </span>
                    ) : null}
                  </div>

                  <p className="text-[14.5px] font-semibold text-slate-800">{t.name}</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">
                    {t.description}
                  </p>

                  <div className="mt-auto pt-4">
                    <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-400 group-hover:text-[#0f6ecd]">
                      <span className="inline-block h-1 w-1 rounded-full bg-current opacity-60" />
                      {t.external ? new URL(t.href).hostname : t.href}
                    </p>
                  </div>
                </article>
              );
              return t.external ? (
                <a
                  key={t.name}
                  href={t.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block h-full"
                >
                  {tile}
                </a>
              ) : (
                <Link key={t.name} href={t.href} className="block h-full">
                  {tile}
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
