// Public job detail page — clean, professional, content-first.
// No gimmicks (aurora shimmer, mesh blobs, 3D tilts, custom cursor)
// — just a strong typography hierarchy, generous whitespace, and
// understated motion (scroll-reveal + magnetic CTA + subtle hover
// states). Reads like Stripe / Linear / Notion careers pages.

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import {
  MapPin, Briefcase, Clock, IndianRupee, Users, ArrowRight,
  Share2, ChevronLeft,
  Mail, Calendar, ChevronRight, Download, FileText,
  ChevronDown,
} from "lucide-react";
import sanitizeHtml from "sanitize-html";
import { mergeSoftWrappedJdParagraphs } from "@/lib/jd-html";
import JobShareButton from "./JobShareButton";
import Reveal from "./Reveal";
import Magnetic from "./Magnetic";
import ScrollProgress from "./ScrollProgress";
import WordReveal from "./WordReveal";
import CharReveal from "../CharReveal";
import PlayBadges from "./PlayBadges";
import TrackJobView from "./track-job-view";

// JDs authored via the new Quill-based editor are stored as HTML;
// older JDs are plain text. Detect by looking for a leading `<`
// or any block-level tag. When HR uses Bold / Italic / lists /
// alignment / font-size in the editor, the resulting markup needs
// to be preserved on the public render — but only the safe inline
// + block tags that Quill emits.
function isHtmlJd(s: string | null | undefined): boolean {
  if (!s) return false;
  const trimmed = s.trim();
  if (!trimmed.startsWith("<")) return false;
  return /<\/?(p|h[1-6]|ul|ol|li|strong|em|u|s|span|br|div)\b/i.test(trimmed);
}

// Sanitiser config tuned to the exact tag set Quill produces with
// the JD toolbar. Tags / classes outside this set are stripped so
// pasted HTML can't inject scripts or arbitrary styling. The
// `class` attribute is allowed only on inline elements for Quill's
// alignment classes (ql-align-center, ql-align-right, ql-align-
// justify); the `style` attribute is allowed only for inline
// font-size variants Quill emits when HR picks Small / Large /
// Huge from the size dropdown.
const JD_SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "div", "span",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "strong", "b", "em", "i", "u", "s", "strike",
    "blockquote",
  ],
  allowedAttributes: {
    "*":    ["class", "style"],
  },
  allowedClasses: {
    "*": [
      "ql-align-center", "ql-align-right", "ql-align-justify",
      "ql-size-small",   "ql-size-large", "ql-size-huge",
    ],
  },
  allowedStyles: {
    "*": {
      "font-size":  [/^\d+(?:px|em|%)$/],
      "text-align": [/^(left|right|center|justify)$/],
    },
  },
  transformTags: {
    // Quill emits its own classes for alignment; some browsers /
    // pastes use inline style="text-align:…" instead. Both pass
    // through the sanitiser cleanly.
  },
};

// ISR: the public JD page reads only `params.slug` (no cookies/headers), so it
// can be statically rendered and revalidated every 5 minutes instead of running
// a DB query + full render on every hit. This is the highest-traffic public page
// (re-applies the perf fix from commit d596d34, which was lost off this branch).
export const revalidate = 300;

type PublicJob = {
  id: number;
  title: string;
  slug: string;
  department: string | null;
  location: string | null;
  brand: string | null;
  employmentType: string | null;
  experienceLevel: string | null;
  salaryRange: string | null;
  salaryUnit:  string | null;   // 'lpa' | 'monthly' | 'annual'
  description: string | null;
  vacancies: number;
  publishedAt: Date | null;
  closesAt: Date | null;
  jdFileUrl: string | null;
  jdFileName: string | null;
  /** Plain-text version of the JD, populated by HR's inline editor.
   *  When set, we render it as styled HTML sections on the page
   *  (so candidates see real headings + bullets, not a flat PDF
   *  iframe). Fallback to the iframe preview when jdText is null. */
  jdText: string | null;
  /** Used as a cache-buster on the public JD URL so a replaced
   *  file invalidates any in-flight browser cache immediately. */
  updatedAt: Date | null;
};

// Append the configured unit suffix to a free-text compensation
// figure when it doesn't already carry one. HR types "5" or "5 - 15"
// in the wizard and the public page should render "5 LPA" / "5 - 15
// LPA" / "₹50,000 monthly" depending on the unit they picked.
function fmtCompensation(range: string | null | undefined, unit: string | null | undefined): string | null {
  if (!range) return null;
  const trimmed = range.trim();
  if (!trimmed) return null;
  // Already contains a unit hint — leave it alone.
  if (/lpa|per\s*annum|annual|p\.?\s*a\.?|monthly|per\s*month|p\.?\s*m\.?|\/month|\/year|crore|cr\b|\bk\b|\$|€|£/i.test(trimmed)) {
    return trimmed;
  }
  const suffix =
    unit === "monthly" ? "monthly"
    : unit === "annual" ? "annual"
    : "LPA";   // default for both null and "lpa"
  return `${trimmed} ${suffix}`;
}

// Extract plain text from a JD file on disk — used to auto-backfill
// jdText for legacy jobs so the HTML view kicks in everywhere. PDF
// goes through pdf-parse v2 (PDFParse class); .docx through mammoth.
// Returns null on failure so the caller can fall back gracefully.
async function tryExtractJdText(jdFileUrl: string): Promise<string | null> {
  try {
    // jdFileUrl is "/uploads/jds/<file>" — resolve relative to /public.
    if (!jdFileUrl.startsWith("/uploads/")) return null;
    const { readFile, realpath } = await import("node:fs/promises");
    const { resolve, extname, sep } = await import("node:path");
    // Resolve the public root through realpath() so any parent
    // symlink in the deployment doesn't fool the prefix check.
    const publicRoot = await realpath(resolve(process.cwd(), "public"));
    const candidate  = resolve(publicRoot, "." + jdFileUrl);
    // realpath() on the candidate catches two attack shapes:
    //   1. Symlink under /public/uploads pointing outside the root.
    //      Without realpath, the symlink's path lives inside public/
    //      and passes the prefix check, but readFile() follows it.
    //   2. A file that doesn't exist — realpath throws ENOENT here,
    //      we treat that the same as a denial.
    let filePath: string;
    try {
      filePath = await realpath(candidate);
    } catch {
      return null;
    }
    // Trailing path-separator on the root prevents a sibling-dir
    // bypass — e.g. "/var/www/public-attacker" would otherwise start
    // with "/var/www/public" and pass.
    const rootPrefix = publicRoot.endsWith(sep) ? publicRoot : publicRoot + sep;
    if (filePath !== publicRoot && !filePath.startsWith(rootPrefix)) return null;
    const buf = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();

    let text = "";
    if (ext === ".pdf") {
      const mod = await import("pdf-parse") as unknown as {
        PDFParse: new (opts: { data: Uint8Array }) => {
          getText: () => Promise<{ text: string }>;
          destroy: () => Promise<void>;
        };
      };
      const parser = new mod.PDFParse({ data: new Uint8Array(buf) });
      try {
        const r = await parser.getText();
        text = String(r?.text ?? "");
      } finally {
        try { await parser.destroy(); } catch { /* noop */ }
      }
    } else if (ext === ".docx" || ext === ".doc") {
      const mammoth = (await import("mammoth")).default;
      const r = await mammoth.extractRawText({ buffer: buf });
      text = String(r?.value ?? "");
    } else if (ext === ".txt" || ext === ".rtf") {
      text = buf.toString("utf8");
    }

    text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return text || null;
  } catch (e: any) {
    console.error("[jobs/[slug]] auto-backfill jdText failed:", e?.message ?? e);
    return null;
  }
}

async function loadJob(slug: string): Promise<PublicJob | null> {
  try {
    try {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, title, "publicSlug" AS slug, department, location, brand,
                "employmentType", "experienceLevel", "salaryRange", "salaryUnit",
                description, vacancies, "publishedAt", "closesAt",
                "jdFileUrl", "jdFileName", "jdText", "updatedAt"
           FROM "JobOpening"
          WHERE "publicSlug" = $1
            AND "status" = 'published'
            AND ("closesAt" IS NULL OR "closesAt" > NOW())
          LIMIT 1`,
        slug,
      );
      const row = rows[0] ?? null;
      // Auto-backfill jdText for legacy jobs (created before the
      // inline-edit feature was added). Extract once from the
      // existing PDF, save back to the DB so subsequent renders are
      // instant and the HTML view kicks in. Failures stay silent —
      // the iframe fallback still renders the file.
      if (row && !row.jdText && row.jdFileUrl) {
        const extracted = await tryExtractJdText(row.jdFileUrl);
        if (extracted) {
          row.jdText = extracted;
          try {
            await prisma.$executeRawUnsafe(
              `UPDATE "JobOpening" SET "jdText" = $1 WHERE "id" = $2`,
              extracted, row.id,
            );
          } catch { /* non-fatal */ }
        }
      }
      return row as PublicJob | null;
    } catch (e: any) {
      const code = e?.meta?.code || e?.code;
      if (code !== "42703" && !/does not exist/i.test(String(e?.message))) throw e;
      // Legacy fallback — older DBs lack salaryUnit and/or jdFile* cols.
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, title, "publicSlug" AS slug, department, location, brand,
                "employmentType", "experienceLevel", "salaryRange",
                NULL AS "salaryUnit",
                description, vacancies, "publishedAt", "closesAt",
                NULL AS "jdFileUrl", NULL AS "jdFileName",
                NULL::text AS "jdText",
                "updatedAt"
           FROM "JobOpening"
          WHERE "publicSlug" = $1
            AND "status" = 'published'
            AND ("closesAt" IS NULL OR "closesAt" > NOW())
          LIMIT 1`,
        slug,
      );
      return (rows[0] ?? null) as PublicJob | null;
    }
  } catch {
    return null;
  }
}

function brandLabel(brand: string | null): string {
  return brand === "yt_labs" ? "YT Labs" : "NB Media";
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const job = await loadJob(slug);
  if (!job) return { title: "Job not found" };
  const brand = brandLabel(job.brand);
  return {
    title: `${job.title} — ${brand} Careers`,
    description: job.description?.slice(0, 160) || `${job.title} role at ${brand}. Apply now.`,
    openGraph: {
      title: `${job.title} — ${brand} Careers`,
      description: job.description?.slice(0, 160) || `Open role at ${brand}. Apply now.`,
      type: "website",
    },
  };
}

export default async function PublicJobDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const job = await loadJob(slug);
  if (!job) notFound();

  // Cache-buster for the JD URL — derived from JobOpening.updatedAt so
  // that swapping the file (HR clicks "Replace file") invalidates any
  // browser / CDN cache instantly. Without this, the iframe + open/
  // download links served the previous PDF for up to whatever the
  // intermediate cache TTL allowed.
  const jdRev = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
  const jdUrl = `/api/public/jd/${slug}?v=${jdRev}`;

  const brand = brandLabel(job.brand);
  const closesLabel = job.closesAt
    ? new Date(job.closesAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const applyHref = `/jobs/apply?role=${job.id}`;
  const showDeptInBreadcrumb = job.department && job.department.toLowerCase() !== job.title.toLowerCase();

  return (
    <div
      // Soft cool-gray off-white. Easier on the eyes than pure white
      // under long reading; cards stay #ffffff so they pop with a
      // crisp visual layer above the body.
      className="min-h-screen bg-[#e2e8f0] text-slate-900 antialiased"
      style={{ scrollBehavior: "smooth" }}
    >
      <ScrollProgress />
      <TrackJobView jobId={job.id} jobTitle={job.title} />
      <style>{`
        @keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(6px); } }
        .bob { animation: bob 2s ease-in-out infinite; }
      `}</style>

      {/* ── Top nav ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-[#e2e8f0]/85 backdrop-blur supports-[backdrop-filter]:bg-[#e2e8f0]/70">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-2">
          <Link href="/jobs" className="flex items-center gap-2.5 group min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f8fafc] ring-1 ring-slate-300/60 shadow-sm overflow-hidden transition-transform group-hover:scale-[1.04] shrink-0">
              <img src="/logo.png" alt={`${brand} logo`} className="h-7 w-7 object-contain" />
            </div>
            <div className="leading-tight min-w-0">
              <p className="text-[13.5px] font-semibold text-slate-900 truncate">{brand}</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Careers</p>
            </div>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            {/* Header Apply button removed — the sticky sidebar's
                "Apply for this job" CTA is the canonical apply
                affordance on this page, visible whenever the JD /
                body area is in view. Keeping a second Apply button
                in the header turned out to be visual noise (it
                lived in the same row as "All openings" and didn't
                add scrolled-state value the sidebar didn't
                already provide). */}
            <Link
              href="/jobs"
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 text-[12.5px] font-medium text-slate-600 hover:text-slate-900 rounded-lg transition-colors"
            ><ChevronLeft size={14} /> All openings</Link>
          </nav>
        </div>
      </header>

      {/* ── Hero — minimum viewport-height so the sticky sidebar
          (Apply / Share / etc.) lands FULLY below the fold at
          scroll 0. Earlier the hero was content-sized + bottom
          padding, which meant the sidebar's top edge peeked into
          the lower-right of the initial viewport. With min-h-screen
          and the header taking 64px, the sidebar's natural position
          sits ~64px past the fold — invisible at the top of page,
          slides into view as the user scrolls down. lg: only so
          mobile keeps its compact hero (the sidebar stacks below
          on mobile and doesn't have this overlap problem). */}
      <section className="relative overflow-hidden border-b border-slate-100 min-h-[calc(100vh-4rem)] flex flex-col justify-center">
        {/* Layered gradient backdrop — mobile gets a richer, more
            saturated wash so the page feels intentional even without
            the desktop's floating social badges. */}
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-blue-50/60 via-white to-[#e2e8f0]" />
        <div aria-hidden="true" className="absolute -top-32 -left-32 -z-10 h-[460px] w-[460px] rounded-full bg-[#3b82f6]/[0.12] blur-[110px]" />
        <div aria-hidden="true" className="absolute -top-20 -right-24 -z-10 h-[360px] w-[360px] rounded-full bg-[#a855f7]/[0.07] blur-[100px] sm:hidden" />
        {/* Floating social-platform badges — desktop only (component
            self-hides on phones because they fight the title/chips). */}
        <PlayBadges />

        <div className="w-full max-w-5xl mx-auto px-5 sm:px-8 pt-8 sm:pt-20 pb-10 sm:pb-24">
          <Reveal direction="up">
            <nav className="flex items-center gap-1.5 text-[11.5px] sm:text-[12px] text-slate-500 mb-5 sm:mb-7 overflow-x-auto whitespace-nowrap">
              <Link href="/jobs" className="hover:text-slate-900 transition-colors font-medium shrink-0">Careers</Link>
              {showDeptInBreadcrumb && (<>
                <span className="text-slate-300 shrink-0">/</span>
                <span className="shrink-0">{job.department}</span>
              </>)}
              <span className="text-slate-300 shrink-0">/</span>
              <span className="text-slate-900 font-medium truncate max-w-[180px] sm:max-w-[260px]">{job.title}</span>
            </nav>

            {/* OPEN-ROLE chip — a single tight pill on mobile so it
                doesn't break to two lines. */}
            <div className="inline-flex items-center gap-2 rounded-full bg-white/90 ring-1 ring-slate-200/80 px-3 py-1 text-[10.5px] sm:text-[11px] font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.04)] mb-5 sm:mb-6 backdrop-blur">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute inset-0 rounded-full bg-emerald-400/70 animate-ping" />
                <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-slate-700 uppercase tracking-wider">{brand}</span>
              <span className="text-slate-300">·</span>
              <span className="text-emerald-600 uppercase tracking-wider">Open role</span>
            </div>
          </Reveal>

          {/* Title — character-by-character 3D flip + blur-to-sharp
              focus pull (matches the careers-index headline treatment).
              Plain slate-900 so the animation is the focus. Mobile
              floor tightened to 1.75rem so 2 long words still fit on
              one line on most 360px+ devices. */}
          <h1
            className="font-bold tracking-[-0.028em] text-slate-900 leading-[1.06] sm:leading-[1.04] break-words"
            style={{ fontSize: "clamp(1.75rem, 6vw, 3.8rem)" }}
          >
            <CharReveal text={job.title} staggerMs={34} baseDelayMs={120} />
          </h1>
          {job.department && (
            <p className="mt-3 sm:mt-4 text-[14px] sm:text-[16px] text-slate-500">
              <WordReveal text={`on the ${job.department} team`} staggerMs={24} baseDelayMs={120 + job.title.length * 34} blur={false} />
            </p>
          )}

          {/* Meta chips — on mobile we display them as a 2-column
              grid (tight, easy to scan) instead of a free-wrap that
              creates uneven row heights. */}
          <Reveal direction="up" delay={160}>
            <div className="mt-6 sm:mt-7 grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
              {job.location        && <Chip icon={MapPin}     label={job.location} />}
              {job.employmentType  && <Chip icon={Briefcase}  label={job.employmentType} />}
              {job.experienceLevel && <Chip icon={Clock}      label={job.experienceLevel} />}
              {fmtCompensation(job.salaryRange, job.salaryUnit) && <Chip icon={IndianRupee} label={fmtCompensation(job.salaryRange, job.salaryUnit)!} />}
              {job.vacancies > 1   && <Chip icon={Users}      label={`${job.vacancies} positions`} />}
            </div>
          </Reveal>

          {/* Primary CTAs — apply is full-width-feel on mobile (h-12,
              big tap target, gradient + glow), View-JD sits next to
              it as the secondary. Share + Posted move into their own
              tertiary row on mobile so the primary actions own the
              eye-line. */}
          <Reveal direction="up" delay={240}>
            <div className="mt-7 sm:mt-8 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2.5 sm:gap-3">
              <Magnetic strength={0.16}>
                <Link
                  href={applyHref}
                  className="group inline-flex w-full sm:w-auto items-center justify-center gap-2 h-12 sm:h-11 px-6 rounded-xl bg-gradient-to-r from-[#3b82f6] via-[#60a5fa] to-[#3b82f6] bg-[length:200%_100%] hover:bg-right !text-white text-[14px] sm:text-[13.5px] font-semibold transition-all shadow-[0_6px_18px_-4px_rgba(59,130,246,0.55)] hover:shadow-[0_10px_24px_-4px_rgba(59,130,246,0.6)] [&_svg]:text-white"
                  style={{ color: "#fff", transition: "background-position 0.5s ease, box-shadow 0.3s ease" }}
                >
                  Apply for this role
                  <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Magnetic>
              {job.jdFileUrl && (
                /\.pdf(\?|$)/i.test(job.jdFileUrl) ? (
                  <a
                    href="#job-description"
                    className="inline-flex w-full sm:w-auto items-center justify-center gap-2 h-12 sm:h-11 px-5 rounded-xl border border-slate-300/70 bg-white hover:border-[#3b82f6]/60 hover:bg-[#3b82f6]/[0.04] text-slate-800 text-[13.5px] sm:text-[13px] font-semibold transition-colors"
                    title={job.jdFileName || "Read the job description below"}
                  >
                    <FileText size={14} /> View JD
                  </a>
                ) : (
                  <a
                    href={job.jdFileUrl}
                    download={job.jdFileName || undefined}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex w-full sm:w-auto items-center justify-center gap-2 h-12 sm:h-11 px-5 rounded-xl border border-slate-300/70 bg-white hover:border-[#3b82f6]/60 hover:bg-[#3b82f6]/[0.04] text-slate-800 text-[13.5px] sm:text-[13px] font-semibold transition-colors"
                    title={job.jdFileName || "Download the job description"}
                  >
                    <Download size={14} /> Download JD
                  </a>
                )
              )}
            </div>

            {/* Tertiary row — Share only. The posted-date chip was
                dropped: a stale posted date can make a still-open
                role look forgotten, and "Closes" already conveys
                the urgency that matters to candidates. */}
            <div className="mt-3 sm:mt-3 flex flex-wrap items-center gap-2 sm:gap-3">
              <JobShareButton
                title={job.title}
                brand={brand}
                className="inline-flex items-center justify-center gap-2 h-10 sm:h-11 px-4 sm:px-5 rounded-xl border border-slate-200 bg-white/80 hover:bg-slate-50 text-slate-700 text-[12.5px] sm:text-[13px] font-medium transition-colors backdrop-blur"
              >
                <Share2 size={13} /> Share
              </JobShareButton>
              {closesLabel && (
                <span className="text-[11.5px] sm:text-[12px] text-slate-500 inline-flex items-center gap-1.5">
                  <Calendar size={12} /> Closes {closesLabel}
                </span>
              )}
            </div>
          </Reveal>

        </div>
      </section>

      {/* ── Body ────────────────────────────────────────────── */}
      {/* Two-column layout (≥lg): JD on the left, sticky sidebar
          (Apply CTA + share + careers link) on the right. On
          mobile the columns stack — sidebar drops below the JD. */}
      {/* Sidebar (300px) only appears at xl (1280px+). Below that the
          JD takes the full width — squeezing it into a narrow column
          on a 1024-1279 laptop caused short words to overflow the
          rounded card's right edge. */}
      <main className="max-w-6xl mx-auto px-4 sm:px-8 py-10 sm:py-16 grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6 xl:gap-10 items-start">
        <div className="space-y-6 sm:space-y-8 min-w-0">
        {/* Job description — rendered as HTML sections from the
            edited jdText. Falls back to the PDF iframe when jdText
            isn't populated (legacy rows). Same NB Media branding as
            the printed PDF: logo at top, watermark behind content.
            Sits ABOVE "About the role" because the full JD is the
            content candidates actually came to read. */}
        {(job.jdText && job.jdText.trim()) ? (
          <section id="job-description">
            <Reveal direction="up" className="w-full">
              <Card>
                <CardHeader title="Full job description" eyebrow="Read the brief" />
                <div className="px-4 sm:px-8 pb-6 sm:pb-8">
                  <JdHtmlPanel
                    text={job.jdText}
                    downloadUrl={job.jdFileUrl ? jdUrl : null}
                    downloadName={job.jdFileName}
                  />
                </div>
              </Card>
            </Reveal>
          </section>
        ) : job.jdFileUrl && /\.pdf(\?|$)/i.test(job.jdFileUrl) ? (
          <section id="job-description">
            <Reveal direction="up" className="w-full">
              <Card>
                <CardHeader title="Full job description" eyebrow="Read the brief" />
                <div className="px-4 sm:px-8 pb-6 sm:pb-8">
                  {/* Legacy fallback: jobs created before the inline-
                      edit feature have no jdText yet. Show the
                      embedded PDF iframe so candidates can still read
                      the brief. */}
                  <div className="rounded-xl sm:rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.12)]">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-3 sm:px-5 py-3 bg-gradient-to-r from-[#eff6ff] via-white to-white border-b border-slate-200/80">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#3b82f6] text-white shadow-sm shadow-blue-200 flex-shrink-0">
                          <FileText size={16} strokeWidth={2.2} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-[#3b82f6]">
                            Job description · PDF preview
                          </p>
                          <p className="text-[13px] font-semibold text-slate-800 truncate leading-tight mt-0.5">
                            {job.jdFileName || "Job description"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <a
                          href={jdUrl}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white hover:border-[#3b82f6] hover:text-[#3b82f6] text-slate-700 text-[12px] font-semibold transition-colors"
                        >Open</a>
                        <a
                          href={jdUrl}
                          download={job.jdFileName || undefined}
                          className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 h-9 px-3 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[12px] font-semibold transition-colors shadow-sm shadow-blue-200"
                        ><Download size={12} /> Download</a>
                      </div>
                    </div>
                    <div className="bg-slate-50 p-1.5 sm:p-4">
                      <iframe
                        src={`${jdUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                        title={job.jdFileName || "Job description"}
                        className="w-full block rounded-md sm:rounded-lg bg-white shadow-sm h-[60vh] min-h-[420px] sm:h-[820px]"
                        style={{ border: 0 }}
                      />
                    </div>
                  </div>
                </div>
              </Card>
            </Reveal>
          </section>
        ) : null}
        </div>

        {/* ── Sidebar (sticky on desktop) ──────────────────────
            Apply CTA + HR contact cards. On lg+ this sticks to the
            top of the viewport so the candidate can hit Apply or
            ping HR at any scroll position; on mobile it drops to
            the bottom as a normal stacked section.

            `lg:sticky lg:top-24 lg:h-fit` keeps the panel pinned
            ~96px below the top so the navbar / hero negative-space
            stays comfortable. h-fit prevents the column from
            forcing 100vh stretch. */}
        {/* Sticky sidebar: the outer <aside> stretches to fill the
            grid row (so it has scroll runway equal to the JD
            column), and the inner wrapper is `sticky top-24` —
            24×4 = 96px, clearing the page header (h-16 = 64px) +
            a 32px gap so it sits cleanly below the sticky header
            instead of colliding with the "All openings / Apply"
            row. Earlier we put sticky on the aside itself with
            h-fit, which collapsed the column to the panel height
            and made the sidebar scroll OFF the screen as soon as
            the JD scrolled past — fixed by separating the row
            stretch from the sticky wrapper. */}
        <aside className="xl:self-stretch">
          <div className="xl:sticky xl:top-24">
            <Reveal direction="up" className="w-full">
            <div className="space-y-7">
              {/* ── Apply CTA ─────────────────────────────────
                  Primary action. Solid blue, full-width within the
                  sidebar column, prominent shadow. Sits at the top
                  of the sidebar with breathing room above the
                  secondary links below. */}
              <Link
                href={applyHref}
                className="group flex w-full items-center justify-center gap-2 h-12 rounded-xl bg-[#3b82f6] hover:bg-[#2563eb] !text-white text-[13.5px] font-semibold tracking-[-0.005em] transition-all shadow-[0_4px_14px_-4px_rgba(59,130,246,0.5),0_2px_4px_-1px_rgba(59,130,246,0.3)] hover:shadow-[0_8px_20px_-4px_rgba(59,130,246,0.6),0_4px_8px_-2px_rgba(59,130,246,0.35)] [&_svg]:text-white"
                style={{ color: "#fff" }}
              >
                Apply for this job
                <ArrowRight size={15} strokeWidth={2.5} className="transition-transform group-hover:translate-x-0.5" />
              </Link>

              {/* ── Share row ─────────────────────────────────
                  Lightweight social-share row — small uppercase
                  label + three monochrome icon buttons. The
                  JobShareButton component owns the actual share
                  behavior so it stays consistent with the hero
                  Share button elsewhere on the page. */}
              <div>
                <p className="text-[11px] text-slate-500 mb-3">
                  Share with someone awesome
                </p>
                <div className="flex items-center gap-3.5">
                  {/* Inline brand SVGs — lucide-react dropped its
                      Facebook/Linkedin/Twitter exports in v0.475+,
                      so each platform gets its own path here. */}
                  <a
                    href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`https://nbmedia.in/jobs/${slug}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Share on Facebook"
                    className="text-slate-300 hover:text-[#1877F2] transition-colors"
                  >
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.52 1.49-3.91 3.78-3.91 1.09 0 2.24.2 2.24.2v2.47H15.2c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.44 2.91h-2.34V22c4.78-.76 8.43-4.92 8.43-9.94z" />
                    </svg>
                  </a>
                  <a
                    href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`https://nbmedia.in/jobs/${slug}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Share on LinkedIn"
                    className="text-slate-300 hover:text-[#0A66C2] transition-colors"
                  >
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.95v5.66H9.34V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zm1.78 13.02H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
                    </svg>
                  </a>
                  <a
                    href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(`https://nbmedia.in/jobs/${slug}`)}&text=${encodeURIComponent(`${job.title} at ${brand}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Share on X (formerly Twitter)"
                    className="text-slate-300 hover:text-slate-900 transition-colors"
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.659l-5.214-6.817-5.967 6.817H1.677l7.73-8.835L1.254 2.25h6.828l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
                    </svg>
                  </a>
                </div>
              </div>

              {/* ── Got questions? ────────────────────────────
                  Light contact row — single point of contact for
                  candidate queries about the role. Click opens
                  Gmail compose with the To: prefilled. */}
              <div>
                <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">
                  Got questions?
                </p>
                <a
                  href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent("tanvi@nbmediaproductions.com")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Email Tanvi, HR Manager"
                  className="group flex items-center gap-3 rounded-xl bg-white border border-slate-200 hover:border-[#3b82f6] hover:shadow-[0_4px_12px_-4px_rgba(59,130,246,0.18)] px-3 py-2.5 transition-all"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#3b82f6] text-white text-[12px] font-bold uppercase shrink-0 shadow-[0_2px_6px_-1px_rgba(59,130,246,0.4)]">
                    T
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-slate-900 leading-tight tracking-[-0.005em]">
                      Tanvi
                      <span className="ml-1.5 text-[11px] font-medium text-slate-400">HR Manager</span>
                    </p>
                    {/* Email is allowed to wrap (break-all) so the
                        full address is always visible in the narrow
                        sidebar column instead of being truncated to
                        "tanvi@nbmediap…". */}
                    <p className="mt-1 text-[11px] text-slate-500 leading-snug break-all group-hover:text-[#3b82f6] transition-colors">
                      tanvi@nbmediaproductions.com
                    </p>
                  </div>
                  <Mail size={13} strokeWidth={2.25} className="text-slate-300 group-hover:text-[#3b82f6] transition-colors shrink-0" />
                </a>
              </div>

              {/* ── Careers link ──────────────────────────────
                  Light-touch nav back to the full careers index.
                  Mirrors the "View all job openings" affordance in
                  the reference design. */}
              <div>
                <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">
                  Other openings
                </p>
                <Link
                  href="/jobs"
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#3b82f6] hover:text-[#2563eb] transition-colors"
                >
                  View all job openings
                  <ArrowRight size={13} strokeWidth={2.5} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
            </Reveal>
          </div>
        </aside>

        {/* Footer — spans both grid columns on lg+. */}
        <footer className="xl:col-span-2 pt-6 pb-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11.5px] text-slate-400">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="" className="h-5 w-5 opacity-70" />
            <span>© {new Date().getFullYear()} {brand}. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-5">
            <Link href="/jobs" className="hover:text-slate-700 transition-colors">All openings</Link>
            <a href="mailto:careers@nbmediaproductions.com" className="hover:text-slate-700 transition-colors inline-flex items-center gap-1"><Mail size={11} /> careers</a>
          </div>
        </footer>
      </main>
    </div>
  );
}

// ── Building blocks ─────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  // Card surface uses #f8fafc (slate-50) — one shade lighter than the
  // page bg (#e2e8f0 slate-200) so cards stay visibly elevated while
  // remaining in the same colour family. Border + shadow finish the
  // "raised plaque on a soft surface" look.
  return (
    <div className={`bg-[#f8fafc] rounded-2xl ring-1 ring-slate-300/60 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <div className="px-5 sm:px-10 pt-7 sm:pt-9 pb-5 sm:pb-6">
      <p className="text-[10.5px] sm:text-[11px] font-bold uppercase tracking-[0.16em] text-[#3b82f6] mb-2">{eyebrow}</p>
      <h2 className="text-[20px] sm:text-[28px] font-semibold text-slate-900 tracking-tight">{title}</h2>
    </div>
  );
}

function Chip({ icon: Icon, label }: { icon: any; label: string }) {
  // On mobile we render the chips inside a 2-column grid (see hero
  // above). `inline-flex` would collapse to content-width and look
  // staggered, so we let the chip stretch to its grid cell on mobile
  // and revert to inline-flex pill on tablet+.
  return (
    <span className="flex sm:inline-flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-full bg-white ring-1 ring-slate-200 text-slate-700 text-[12px] sm:text-[12.5px] font-medium shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur min-w-0">
      <Icon size={13} className="text-[#3b82f6] shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

// JdHtmlPanel — render HR's edited JD text as a designed document
// on the careers page. Mirrors the printed PDF's visual signature
// (NB Media logo top-right + faded watermark behind the body) so
// candidates see the same branding whether they read it inline or
// download the file. The body text is auto-classified into headings
// (lines ending with `:`), bulleted lists, numbered lists, or plain
// paragraphs — just like the PDF renderer.
function JdHtmlPanel({
  text, downloadUrl, downloadName,
}: {
  text: string;
  downloadUrl: string | null;
  downloadName: string | null;
}) {
  // Two render paths:
  //   • HTML (Quill-authored)     → sanitise + dangerouslySetInnerHTML
  //   • Plain text (legacy JDs)   → parseJdBlocks → typed JSX
  // The branch is invisible to the candidate — both produce the
  // same Times New Roman prose under the NB Media letterhead +
  // watermark frame.
  // JDs extracted from an uploaded file often store EVERY space as &nbsp;
  // (non-breaking). On the page that BLOCKS word-wrapping, forcing ugly
  // mid-word breaks at the only allowed break point — hyphens (e.g.
  // "hands-\non execution", "day-To-\nday"). Normalise them back to regular
  // spaces so the text wraps naturally, matching the clean PDF preview.
  const normalised = (text ?? "").split("&nbsp;").join(" ").split("&#160;").join(" ").split(String.fromCharCode(160)).join(" ");
  const html       = isHtmlJd(normalised);
  // Merge soft-wrapped <p> fragments (one per PDF line in extracted JDs)
  // into flowing paragraphs BEFORE sanitising, so the text reflows to
  // this column's width instead of breaking where the source PDF's lines
  // ended. Same helper runs in the editor preview + the generated PDF.
  const sanitised  = html ? sanitizeHtml(mergeSoftWrappedJdParagraphs(normalised), JD_SANITIZE) : "";
  const blocks     = html ? [] : parseJdBlocks(normalised);

  return (
    <div className="relative rounded-xl sm:rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.12)]">
      {/* ── Top strip: brand block on left, logo on right ──── */}
      <div className="relative flex items-start justify-between gap-4 px-5 sm:px-8 pt-5 sm:pt-7 pb-3 border-b border-slate-100 bg-gradient-to-b from-white to-slate-50/40">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#3b82f6]">
            NB Media
          </p>
          <p className="mt-1 text-[12px] sm:text-[13px] text-slate-600 leading-snug">
            YT Money Productions Pvt. Ltd.
          </p>
          <p className="text-[10.5px] sm:text-[11.5px] text-slate-400 leading-snug">
            HRD@nbmediaproductions.com · +91&nbsp;81468&nbsp;91380
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="NB Media"
          className="h-10 sm:h-12 w-auto shrink-0"
        />
      </div>

      {/* ── Body wrapped over a faded watermark ──────────────── */}
      <div className="relative">
        {/* Watermark — large faded logo behind the prose. Pointer-
            events: none so candidates can still select + copy the
            body text without the image interfering. */}
        <div
          aria-hidden="true"
          className="pointer-events-none select-none absolute inset-0 flex items-center justify-center overflow-hidden"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt=""
            className="w-[60%] max-w-[460px] opacity-[0.05] sm:opacity-[0.06]"
            style={{ filter: "grayscale(20%)" }}
          />
        </div>

        <div className="relative px-5 sm:px-10 py-6 sm:py-8">
          <div
            className="max-w-3xl mx-auto text-slate-800"
            style={{ fontFamily: '"Times New Roman", Georgia, serif' }}
          >
            {html ? (
              // HTML render path (Quill-authored JDs). Already
              // sanitised above through sanitize-html with a tight
              // allowlist. `jd-prose` typography rules live in
              // globals.css so the sanitised tags pick up the same
              // heading sizes / list markers / alignment as the
              // legacy plain-text path.
              <div
                className="jd-prose"
                dangerouslySetInnerHTML={{ __html: sanitised }}
              />
            ) : (
              blocks.map((block, i) => {
                if (block.kind === "heading") {
                  return (
                    <h3
                      key={i}
                      className="mt-6 first:mt-0 mb-2 text-[15.5px] sm:text-[16.5px] font-bold text-slate-900"
                    >
                      {block.text}
                    </h3>
                  );
                }
                if (block.kind === "bullet-list") {
                  return (
                    <ul key={i} className="my-2 pl-6 space-y-1.5 list-disc marker:text-slate-400">
                      {block.items.map((it, j) => (
                        <li key={j} className="text-[14.5px] leading-[1.7]">{it}</li>
                      ))}
                    </ul>
                  );
                }
                if (block.kind === "numbered-list") {
                  return (
                    <ol key={i} className="my-2 pl-6 space-y-1.5 list-decimal marker:text-slate-500 marker:font-semibold">
                      {block.items.map((it, j) => (
                        <li key={j} className="text-[14.5px] leading-[1.7]">{it}</li>
                      ))}
                    </ol>
                  );
                }
                return (
                  <p key={i} className="my-2 text-[14.5px] leading-[1.8] text-slate-700">
                    {block.text}
                  </p>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Footer: download CTA (when a PDF is available) ──── */}
      {downloadUrl && (
        <div className="relative border-t border-slate-100 bg-slate-50/60 px-5 sm:px-8 py-3 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[11px] text-slate-500">
            Prefer to read offline? Grab a copy.
          </span>
          <a
            href={downloadUrl}
            download={downloadName || undefined}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[12px] font-semibold transition-colors shadow-sm shadow-blue-200"
          >
            <Download size={12} /> Download JD
          </a>
        </div>
      )}
    </div>
  );
}

// parseJdBlocks — group raw lines into renderable blocks. Consecutive
// bullet lines collapse into a single <ul>; consecutive "1. 2. 3."
// lines collapse into a single <ol>; everything else is a heading or
// paragraph. Mirrors the auto-format logic in
// src/lib/jd-doc-from-text.ts so the inline HTML and the saved PDF
// stay visually in sync.
type JdBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet-list"; items: string[] }
  | { kind: "numbered-list"; items: string[] };

// Strip page-break artefacts left over from PDF-to-text conversion:
//   "-- 1 of 2 --", "—— 1 of 2 ——", "Page 1 of 2", "Page 1", "1 of 2"
// These appear when HR's source JD was a multi-page PDF and the
// extractor inserted page-marker lines. They shouldn't render to
// candidates.
const PAGE_MARKER_RE = /^[\s\-–—]*(?:page\s+)?\d+(?:\s*(?:of|\/)\s*\d+)?[\s\-–—]*$/i;

function parseJdBlocks(text: string): JdBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: JdBlock[] = [];
  let bulletBuf: string[]   = [];
  let numberedBuf: string[] = [];
  // Consecutive plain lines are SOFT WRAPS from PDF-to-text extraction
  // (extractors emit one line per visual line), so they're buffered and
  // joined into ONE paragraph. Only a blank line, bullet, number, or
  // heading starts a new block — mirrors how the text reads in the PDF.
  let paraBuf: string[]     = [];

  const flushBullets = () => {
    if (bulletBuf.length) {
      out.push({ kind: "bullet-list", items: bulletBuf });
      bulletBuf = [];
    }
  };
  const flushNumbered = () => {
    if (numberedBuf.length) {
      out.push({ kind: "numbered-list", items: numberedBuf });
      numberedBuf = [];
    }
  };
  const flushPara = () => {
    if (paraBuf.length) {
      out.push({ kind: "paragraph", text: paraBuf.join(" ") });
      paraBuf = [];
    }
  };
  const flushAll = () => { flushBullets(); flushNumbered(); flushPara(); };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushAll(); continue; }
    if (PAGE_MARKER_RE.test(line)) { flushAll(); continue; }

    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      flushNumbered(); flushPara();
      bulletBuf.push(bullet[1]);
      continue;
    }
    const num = line.match(/^\d+[.)]\s+(.*)$/);
    if (num) {
      flushBullets(); flushPara();
      numberedBuf.push(num[1]);
      continue;
    }

    flushBullets(); flushNumbered();

    // Heading heuristic: short line ending with ":" (≤60 chars).
    if (/:\s*$/.test(line) && line.length <= 60) {
      flushPara();
      out.push({ kind: "heading", text: line.replace(/:\s*$/, "") + ":" });
      continue;
    }
    paraBuf.push(line);
  }
  flushAll();
  return out;
}

