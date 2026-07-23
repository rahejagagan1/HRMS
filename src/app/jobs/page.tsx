// Public careers landing — brand-aware (NB Media default; YT Labs
// when ?brand=yt_labs). Sober, professional design. Title is solid
// slate-900 with the brand name highlighted in brand-colour (no
// aurora shimmer). Reveal-on-scroll + magnetic Apply CTA — that's
// the entire motion budget.

import Link from "next/link";
import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import {
  MapPin, Briefcase, Clock, ArrowRight, Sparkles, Building2,
  Heart, Users, Mail, ChevronRight,
  IndianRupee, ChevronDown,
  // Why-Join cards — line-icons mapping to the emoji set HR wrote
  // (Flexible Working, Mental Health, Collaborative Culture, etc.).
  Brain, Handshake, Award, Plane, PawPrint,
} from "lucide-react";
import Reveal       from "./[slug]/Reveal";
import Magnetic     from "./[slug]/Magnetic";
import ScrollProgress from "./[slug]/ScrollProgress";
import WordReveal     from "./[slug]/WordReveal";
import LifeAtBrand, { type Reel } from "./LifeAtBrand";
import CultureSlideshow from "./CultureSlideshow";
import ContactButton from "./ContactButton";
import Card3D from "./Card3D";
import CharReveal from "./CharReveal";
import PlayBadges    from "./[slug]/PlayBadges";

// "Life at NB Media" reel carousel.
//
// EACH ENTRY pre-wires three paths so once you drop the matching
// files into /public/reels/ the videos play INLINE on the page
// (Praper-style clean playback, no IG branding):
//
//   /public/reels/<reel-id>.mp4   ← the actual video (REQUIRED for inline playback)
//   /public/reels/<reel-id>.jpg   ← still poster (recommended — shown before click)
//
// If the MP4 is missing, the card automatically falls back to
// Instagram's official /embed/ iframe so playback still works
// (just with IG's branded player chrome).
const NB_MEDIA_REELS: Reel[] = [
  { url: "https://www.instagram.com/reel/DOvs34SEgOF/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==", video: "/reels/DOvs34SEgOF.mp4", poster: "/reels/DOvs34SEgOF.jpg" },
  { url: "https://www.instagram.com/reel/DNk32l8y0LE/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==", video: "/reels/DNk32l8y0LE.mp4", poster: "/reels/DNk32l8y0LE.jpg" },
  { url: "https://www.instagram.com/reel/DO052x4kqgr/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==", video: "/reels/DO052x4kqgr.mp4", poster: "/reels/DO052x4kqgr.jpg" },
  { url: "https://www.instagram.com/reel/DRM2knZkhIf/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==", video: "/reels/DRM2knZkhIf.mp4", poster: "/reels/DRM2knZkhIf.jpg" },
  { url: "https://www.instagram.com/reel/DSXV5aHkjLJ/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==", video: "/reels/DSXV5aHkjLJ.mp4", poster: "/reels/DSXV5aHkjLJ.jpg" },
  { url: "https://www.instagram.com/reel/DTxezQGkqtH/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==", video: "/reels/DTxezQGkqtH.mp4", poster: "/reels/DTxezQGkqtH.jpg" },
  { url: "https://www.instagram.com/reel/DUS_8ybElFT/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==", video: "/reels/DUS_8ybElFT.mp4", poster: "/reels/DUS_8ybElFT.jpg" },
];
const NB_MEDIA_IG_HANDLE = "@nbmediaa_";
const NB_MEDIA_IG_URL    = "https://www.instagram.com/nbmediaa_/";
const NB_MEDIA_LIFE_BLURB = "We're not your usual agency. We move fast, ask better questions, and actually like the people we work with. It's a place where showing up as yourself isn't just accepted — it's expected. Good vibes, big ideas, and the occasional prank war included.";

// Culture Highlights photos — save the source JPGs into
// /public/culture/ with the exact filenames below. Each tile is
// 4:3 aspect ratio, caption pinned to the bottom corner. Missing
// files render a soft brand-coloured gradient placeholder.
const CULTURE_PHOTOS: Array<{ poster?: string; caption?: string }> = [
  { poster: "/culture/team-group.jpg",    caption: "The whole NB Media team" },
  { poster: "/culture/arcade-night.jpg",  caption: "Game night out" },
  { poster: "/culture/dinner-out.jpg",    caption: "Team dinner" },
  { poster: "/culture/youtube-plaque.jpg", caption: "4.3M views milestone" },
  { poster: "/culture/workspace.jpg",     caption: "The studio floor" },
  { poster: "/culture/farewell.jpg",      caption: "Team celebration" },
];

export const dynamic = "force-dynamic";

type ActiveBrand = "nb_media" | "yt_labs" | "all";

const BRAND_META: Record<"nb_media" | "yt_labs", {
  label:     string;
  domain:    string;
  tagline:   string;
  about:     string;
  /** Used for body text / link colour — needs contrast against white.
   *  The primary CTA uses a LIGHTER shade (blue-400 / purple-400) —
   *  see the conditional Tailwind class on the hero button. */
  accent:    string;
  accentHover: string;
  badgeBg:   string;
  badgeText: string;
}> = {
  nb_media: {
    label:    "NB Media",
    domain:   "nbmediaproductions.com",
    tagline:  "End-to-end content studio",
    about:    "NB Media Productions is an end-to-end content studio shipping work for India's biggest creators and brands. From scripts to edits to release, every part of the pipeline runs in-house. You'll see your work go live on the channels you watch within weeks of joining.",
    accent:   "#3b82f6",
    accentHover: "#2563eb",
    badgeBg:  "bg-blue-50",
    badgeText:"text-[#1d4ed8]",
  },
  yt_labs: {
    label:    "YT Labs",
    domain:   "ytlpro.com",
    tagline:  "Strategy, research & creative engine",
    about:    "YT Labs is the strategy, research, and creative engine behind some of India's most-watched YouTube channels. We work end-to-end with creators — from idea to thumbnail to upload — and the team behind the scenes is small, sharp, and unusually obsessed with detail.",
    accent:   "#a855f7",
    accentHover: "#9333ea",
    badgeBg:  "bg-violet-50",
    badgeText:"text-violet-700",
  },
};

export const metadata: Metadata = {
  title: "Careers — NB Media",
  description: "Open roles at NB Media. Build content for India's biggest creators.",
};

type Row = {
  id: number;
  title: string;
  slug: string;
  department: string | null;
  location: string | null;
  brand: string | null;
  employmentType: string | null;
  experienceLevel: string | null;
  salaryRange: string | null;
  salaryUnit:  string | null;
  vacancies: number;
  publishedAt: Date | null;
};

// Same formatter as the per-job detail page: append the configured
// unit ("LPA" by default) to a free-text compensation figure when
// it doesn't already carry one. Keeps "5" → "5 LPA" consistent
// across both /jobs and /jobs/[slug].
function fmtComp(range: string | null | undefined, unit: string | null | undefined): string | null {
  if (!range) return null;
  const trimmed = range.trim();
  if (!trimmed) return null;
  if (/lpa|per\s*annum|annual|p\.?\s*a\.?|monthly|per\s*month|p\.?\s*m\.?|\/month|\/year|crore|cr\b|\bk\b|\$|€|£/i.test(trimmed)) {
    return trimmed;
  }
  const suffix = unit === "monthly" ? "monthly" : unit === "annual" ? "annual" : "LPA";
  return `${trimmed} ${suffix}`;
}

async function loadJobs(brandFilter: string): Promise<Row[]> {
  try {
    const params: any[] = [];
    let where = `"status" = 'published' AND ("closesAt" IS NULL OR "closesAt" > NOW()) AND "publicSlug" IS NOT NULL`;
    if (brandFilter === "nb_media" || brandFilter === "yt_labs") {
      params.push(brandFilter);
      where += ` AND brand = $${params.length}`;
    }
    try {
      return await prisma.$queryRawUnsafe<Row[]>(
        `SELECT id, title, "publicSlug" AS slug, department, location, brand,
                "employmentType", "experienceLevel", "salaryRange", "salaryUnit", vacancies, "publishedAt"
           FROM "JobOpening"
          WHERE ${where}
          ORDER BY "isPriority" DESC, "publishedAt" DESC NULLS LAST, "createdAt" DESC`,
        ...params,
      );
    } catch {
      return await prisma.$queryRawUnsafe<Row[]>(
        `SELECT id, title, "publicSlug" AS slug, department, location, brand,
                "employmentType", "experienceLevel", "salaryRange",
                NULL AS "salaryUnit",
                vacancies, "publishedAt"
           FROM "JobOpening"
          WHERE ${where}
          ORDER BY "publishedAt" DESC NULLS LAST, "createdAt" DESC`,
        ...params,
      );
    }
  } catch {
    return [];
  }
}

export default async function CareersIndexPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const { brand: brandQs } = await searchParams;
  const brandParam = (brandQs || "").toLowerCase();

  const activeBrand: ActiveBrand =
    brandParam === "yt_labs" ? "yt_labs"
    : brandParam === "all"    ? "all"
    : "nb_media";

  const isAll  = activeBrand === "all";
  const meta   = isAll ? BRAND_META.nb_media : BRAND_META[activeBrand];
  const brandLabel = isAll ? "NB Media · YT Labs" : meta.label;

  const jobs = isAll
    ? await loadJobs("")
    : await loadJobs(activeBrand);

  const nbCount = activeBrand === "nb_media" ? jobs.length : (await loadJobs("nb_media")).length;
  const ytCount = activeBrand === "yt_labs"  ? jobs.length : (await loadJobs("yt_labs")).length;
  const totalCount = isAll ? (nbCount + ytCount) : jobs.length;

  const departments = new Set<string>();
  jobs.forEach((j) => { if (j.department) departments.add(j.department); });

  // Hero highlight word — the gradient-coloured term at the end of
  // the headline. Now used to spotlight the OUTCOME ("millions") of
  // joining, not the brand name. Keeps the warm logo gradient (NB
  // Media) / brand accent (YT Labs) treatment for visual punch.
  const heroHighlight = "millions";

  return (
    <div
      // Page-wide soft blue gradient — same family as the hero
      // backdrop. Every section inherits this; only the hero +
      // Life sections still paint their own EXPLICIT gradient on
      // top because they have additional blur-blob decorations
      // layered above.
      // NOTE: deliberately NO `background-attachment: fixed` — a fixed
      // background forces the browser to repaint the entire viewport
      // on every scroll frame, which was causing the visible scroll
      // jank. A normally-scrolling gradient paints once and is smooth.
      className="jobs-page min-h-screen text-slate-900 antialiased"
      style={{
        scrollBehavior: "smooth",
        fontFamily: '"Times New Roman", Times, serif',
        background: "linear-gradient(180deg, rgba(219,234,254,0.6) 0%, #ffffff 35%, #e2e8f0 100%)",
      }}
    >
      <ScrollProgress />
      <style>{`
        @keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(6px); } }
        .bob { animation: bob 2s ease-in-out infinite; }

        /* ── Hero "wow" animations (all transform/opacity/bg-position
              only — GPU-friendly, no layout or repaint thrash). ──── */

        /* Flowing gradient sweep across the "millions." word. The
           gradient is 200% wide and its position slides left↔right
           so the warm colours drift through the letters. */
        @keyframes gradientFlow {
          0%   { background-position:   0% 50%; }
          100% { background-position: 200% 50%; }
        }
        .grad-flow {
          background-size: 200% auto !important;
          animation: gradientFlow 5s linear infinite;
        }

        /* Slow drifting aurora — the hero's blur blobs gently float.
           TRANSLATE ONLY (no scale): scaling a filter:blur element
           forces the browser to re-rasterize the ~110px blur every
           frame; a pure translate just re-composites the cached
           blurred texture (cheap + smooth). Drift bumped a touch to
           stay noticeable without the scale. */
        @keyframes auroraA {
          0%,100% { transform: translate3d(0,0,0); }
          50%     { transform: translate3d(55px,42px,0); }
        }
        @keyframes auroraB {
          0%,100% { transform: translate3d(0,0,0); }
          50%     { transform: translate3d(-46px,54px,0); }
        }
        .aurora-a { animation: auroraA 14s ease-in-out infinite; will-change: transform; }
        .aurora-b { animation: auroraB 18s ease-in-out infinite; will-change: transform; }

        /* ── 3D interactive card (Card3D) ──────────────────────── */
        .card3d-inner {
          transform-style: preserve-3d;
          transform:
            rotateX(var(--rx, 0deg))
            rotateY(var(--ry, 0deg))
            translateZ(calc(var(--lift, 0) * 14px))
            scale(calc(1 + var(--lift, 0) * 0.015));
          /* --t is short (90ms) while the pointer is in the card so
             the tilt tracks the cursor without lag, and long (500ms)
             on leave so it eases smoothly back to flat. */
          transition: transform var(--t, 350ms) cubic-bezier(0.22,1,0.36,1);
        }
        .card3d-glow {
          background: radial-gradient(
            220px circle at var(--mx, 50%) var(--my, 50%),
            var(--glow, rgba(255,255,255,0.5)),
            transparent 62%
          );
          opacity: calc(var(--lift, 0) * 0.9);
          transition: opacity 350ms ease;
          mix-blend-mode: soft-light;
        }

        /* ── Cards flip up in 3D as they scroll into view ──────── */
        @keyframes card3dRise {
          from { opacity: 0; transform: perspective(900px) rotateX(18deg) translateY(36px); }
          to   { opacity: 1; transform: perspective(900px) rotateX(0deg)  translateY(0); }
        }
        .card-rise {
          opacity: 0;
          animation: card3dRise 0.7s cubic-bezier(0.2,0.7,0.2,1) forwards;
        }

        @media (prefers-reduced-motion: reduce) {
          .grad-flow, .aurora-a, .aurora-b { animation: none !important; }
          .card3d-inner { transform: none !important; }
          .card3d-glow  { opacity: 0 !important; }
          .card-rise    { animation: none !important; opacity: 1 !important; }
        }

        /* Force Times New Roman everywhere on the careers page —
           wins over Tailwind's font utilities (font-sans, font-mono).
           tabular-nums and font-feature-settings still apply where
           used because they don't change the family. */
        :where(.jobs-page, .jobs-page *) {
          font-family: "Times New Roman", Times, serif !important;
        }
      `}</style>

      {/* ── Sticky brand nav ──────────────────────────────────── */}
      <header
        className="sticky top-0 z-40 border-b border-slate-100 backdrop-blur"
        style={{
          // Soft blue tinted nav so it doesn't break the page-wide
          // gradient. The /80 opacity lets the body gradient peek
          // through behind the blur.
          background: "rgba(241,245,255,0.80)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-2">
          <Link href="/jobs" className="flex items-center gap-2.5 group min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f8fafc] ring-1 ring-slate-300/60 shadow-sm overflow-hidden transition-transform group-hover:scale-[1.04] shrink-0">
              <img src="/logo.png" alt={brandLabel} className="h-7 w-7 object-contain" />
            </div>
            <div className="leading-tight min-w-0">
              <p className="text-[13.5px] font-semibold text-slate-900 truncate">{brandLabel}</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Careers</p>
            </div>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            <a
              href="#open-roles"
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 text-[12.5px] font-medium text-slate-600 hover:text-slate-900 rounded-lg transition-colors"
            >Open roles</a>
            <a
              href="#why-us"
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 text-[12.5px] font-medium text-slate-600 hover:text-slate-900 rounded-lg transition-colors"
            >Why join {meta.label}</a>
            <ContactButton email="hrd@nbmediaproductions.com" />
          </nav>
        </div>
      </header>

      {/* ── Hero (scroll-snap panel 1) ───────────────────────── */}
      {/* min-h spans the full viewport (minus the 64px sticky nav)
          so the hero fills the screen on initial page load and the
          Life section below it isn't visible until the user actually
          scrolls down. NO outer Reveal wrap here — wrapping the whole
          hero in one slide-in motion clobbers the inner WordReveal
          + PlayBadges burst-from-centre animations. The hero is the
          first thing the visitor sees, so each inner element handles
          its own staggered entrance. */}
      <section className="relative overflow-hidden border-b border-slate-100 min-h-[calc(100vh-4rem)] flex items-center ">
        {/* Two-layer gradient backdrop + side blob so mobile feels
            intentional even without the desktop's floating badges. */}
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-blue-50/60 via-white to-[#e2e8f0]" />
        {/* Drifting aurora blobs — slowly float + breathe so the hero
            backdrop feels alive. */}
        <div aria-hidden="true" className="aurora-a absolute -top-32 -left-32 -z-10 h-[460px] w-[460px] rounded-full blur-[110px]" style={{ background: `${meta.accent}2e` }} />
        <div aria-hidden="true" className="aurora-b absolute top-1/3 -right-24 -z-10 h-[420px] w-[420px] rounded-full bg-[#a855f7]/[0.10] blur-[120px] hidden sm:block" />
        <div aria-hidden="true" className="aurora-b absolute -top-20 -right-24 -z-10 h-[360px] w-[360px] rounded-full bg-[#a855f7]/[0.07] blur-[100px] sm:hidden" />
        {/* Floating brand badges — desktop-only. Burst-from-centre
            entrance + gentle float-bob loop. Decorates the hero
            corners with YouTube / Instagram / Spotify / Facebook. */}
        <PlayBadges />

        <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-10 sm:py-14 relative z-10">
          <Reveal direction="up">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#f8fafc] ring-1 ring-slate-300/60 px-3 py-1 text-[11px] font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.04)] mb-6">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute inset-0 rounded-full bg-emerald-400/70 animate-ping" />
                <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-slate-700 uppercase tracking-wider">{totalCount} open role{totalCount === 1 ? "" : "s"}</span>
            </div>
          </Reveal>

          {/* Title — "Build what's next at" animates word by word,
              then the brand name renders as a single static span
              with inline gradient styles. WordReveal's nested spans
              break `background-clip: text`, so we keep the brand
              text un-split and rely on the per-word reveal of the
              preceding phrase for the entrance motion. */}
          <h1
            className="font-semibold tracking-[-0.025em] text-slate-900 leading-[1.08] sm:leading-[1.04] max-w-4xl break-words"
            style={{ fontSize: "clamp(1.95rem, 6vw, 3.8rem)" }}
          >
            <WordReveal text="Build content that reaches" staggerMs={70} baseDelayMs={80} />
            {" "}
            {activeBrand === "yt_labs" ? (
              // Period included inside the coloured span so it
              // inherits the same brand purple.
              <span style={{ color: meta.accent }}>{heroHighlight}.</span>
            ) : (
              // NB Media: warm logo gradient (red → orange → amber).
              // Inline-block + explicit -webkit-text-fill-color for
              // cross-browser reliability. Tested visible on Chrome /
              // Edge / Firefox / Safari.
              <span
                // Brand name AND the trailing period share the same
                // gradient span so the period inherits the warm tone
                // at the end of the ramp (amber/yellow), matching the
                // logo colour family. grad-flow animates the gradient
                // position so the warm colours slowly drift through.
                className="grad-flow"
                style={{
                  display:                "inline-block",
                  // Repeat the ramp so the 200%-wide sweep loops
                  // seamlessly (…amber → red → amber…).
                  background:             "linear-gradient(115deg, #ef4444 0%, #f97316 25%, #fbbf24 50%, #f97316 75%, #ef4444 100%)",
                  WebkitBackgroundClip:   "text",
                  backgroundClip:         "text",
                  WebkitTextFillColor:    "transparent",
                  color:                  "transparent",
                }}
              >
                {heroHighlight}.
              </span>
            )}
          </h1>

          <p className="mt-5 sm:mt-6 text-[14.5px] sm:text-[17px] text-slate-600 max-w-2xl leading-[1.65]">
            <WordReveal
              text="Join one of India's fastest-growing digital media companies and work with creators, storytellers, researchers, writers, editors, and innovators who shape content consumed by millions every month."
              staggerMs={22}
              baseDelayMs={420}
            />
          </p>

          {/* Hero CTAs ("See N open roles" + "Why join NB Media")
              removed per HR direction — the sticky nav still carries
              the same two links so navigation isn't lost. */}

        </div>
      </section>

      {/* ── Life at <brand> — reel carousel sits DIRECTLY below the
            hero so visitors meet the team vibe first, then read the
            why-join pitch + open roles. ─────────────────────────── */}
      {activeBrand === "nb_media" && (
        <Reveal direction="up">
          <LifeAtBrand
            brandLabel={BRAND_META.nb_media.label}
            accent={BRAND_META.nb_media.accent}
            brandGradient="linear-gradient(135deg, #ef4444 0%, #f97316 35%, #f59e0b 70%, #fbbf24 100%)"
            blurb={NB_MEDIA_LIFE_BLURB}
            igHandle={NB_MEDIA_IG_HANDLE}
            igUrl={NB_MEDIA_IG_URL}
            reels={NB_MEDIA_REELS}
          />
        </Reveal>
      )}

      {/* ── Why join <brand> — panel 2 ────────────────────────── */}
      {/* 8 icon cards in a 2x4 / 4x2 grid (Praper-style). Each pair
          uses a different tone so the section feels colourful without
          being chaotic. Card body lines are short — they tell the
          STORY behind the heading, not the heading itself. */}
      <Reveal direction="up">
      <section id="why-us" className="relative border-t border-slate-100">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-10 sm:py-20">
          <Reveal direction="up">
            {/* Centered header — aligns with the centered card grid
                below for a clean, balanced perks section. */}
            <header className="mb-10 max-w-2xl mx-auto text-center">
              {/* Eyebrow label — NB Media gets the warm logo gradient
                  (red → orange → amber). YT Labs falls back to its
                  solid violet accent. */}
              <p
                className="text-[11px] font-bold uppercase tracking-[0.16em] mb-2 inline-block"
                style={activeBrand === "nb_media" ? {
                  background:           "linear-gradient(135deg, #ef4444 0%, #f97316 45%, #fbbf24 100%)",
                  WebkitBackgroundClip: "text",
                  backgroundClip:       "text",
                  WebkitTextFillColor:  "transparent",
                  color:                "transparent",
                } : { color: meta.accent }}
              >
                Why join {meta.label}
              </p>
              <h2 className="text-[22px] sm:text-[32px] font-semibold text-slate-900 tracking-tight">
                <CharReveal text="More than a job. A place to grow." staggerMs={26} />
              </h2>
              <p className="mt-2 text-[14px] text-slate-500">
                <WordReveal text="Six reasons people choose us — and what new hires tell us six months in." staggerMs={16} />
              </p>
            </header>
          </Reveal>

          {/* Single 4-col grid for all 7 cards. The last row has 3
              cards left-aligned under cards 1-3 of row 1 so every
              card shares the same column lines (clean alignment).
              On tablet (2-col) and mobile (1-col) it just flows
              naturally. `items-stretch` keeps card heights equal
              per row. */}
          {/* 3-col grid of square cards, capped at max-w-3xl so each
              cube is a tasteful ~245px — square + filled, not bulky.
              Centered. */}
          {/* Each card: rise3d scroll-entrance (flips up into place) +
              Card3D hover (tilts toward cursor with a spotlight). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch max-w-3xl mx-auto">
            <Reveal direction="rise3d" delay={0}>
              <Card3D>
                <ValueCard
                  icon={Clock}
                  tone="cyan"
                  title="Flexible Working"
                  body="A work environment that values productivity, ownership, and flexibility."
                />
              </Card3D>
            </Reveal>
            <Reveal direction="rise3d" delay={90}>
              <Card3D>
                <ValueCard
                  icon={Brain}
                  tone="emerald"
                  title="Mental Health Support"
                  body="Free, unlimited therapy sessions plus wellness initiatives that put your mental well-being first."
                />
              </Card3D>
            </Reveal>
            <Reveal direction="rise3d" delay={180}>
              <Card3D>
                <ValueCard
                  icon={Handshake}
                  tone="indigo"
                  title="Collaborative Culture"
                  body="Work alongside the best — talented, creative, and driven individuals in an innovative and supportive environment."
                />
              </Card3D>
            </Reveal>
            <Reveal direction="rise3d" delay={270}>
              <Card3D>
                <ValueCard
                  icon={Award}
                  tone="amber"
                  title="Employee Recognition Programs"
                  body="We celebrate achievements, milestones, and exceptional contributions across teams."
                />
              </Card3D>
            </Reveal>
            <Reveal direction="rise3d" delay={360}>
              <Card3D>
                <ValueCard
                  icon={Plane}
                  tone="violet"
                  title="Fully Sponsored Retreats"
                  body="Company-funded team outings, celebrations, and retreats — connect beyond work, on us."
                />
              </Card3D>
            </Reveal>
            <Reveal direction="rise3d" delay={450}>
              <Card3D>
                <ValueCard
                  icon={PawPrint}
                  tone="rose"
                  title="Pet-Friendly Office"
                  body="Bring your pets to work — because sometimes the best coworkers have four legs and a wagging tail."
                />
              </Card3D>
            </Reveal>
          </div>
        </div>
      </section>
      </Reveal>

      {/* ── About brand(s) section removed per HR direction — the
            brand pitch already lives in the hero + Life at NB Media
            sections, so the dedicated About panel was redundant. ── */}

      {/* ── Open roles — panel 4 ──────────────────────────────── */}
      {/* Moved BELOW the company-info panels (Why join us + About
          brand) so a fresh visitor reads the company pitch first
          and lands on the role list with context. */}
      <Reveal direction="up">
      <section id="open-roles" className="relative border-t border-slate-100">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-10 sm:py-20">
          <Reveal direction="up">
            <header className="mb-8">
              <p
                className="text-[11px] font-bold uppercase tracking-[0.16em] mb-2 inline-block"
                style={activeBrand === "nb_media" ? {
                  background:           "linear-gradient(135deg, #ef4444 0%, #f97316 45%, #fbbf24 100%)",
                  WebkitBackgroundClip: "text",
                  backgroundClip:       "text",
                  WebkitTextFillColor:  "transparent",
                  color:                "transparent",
                } : { color: meta.accent }}
              >
                Hiring now
              </p>
              <h2 className="text-[22px] sm:text-[32px] font-semibold text-slate-900 tracking-tight">
                <CharReveal text="Open roles" staggerMs={34} />
              </h2>
              <p className="mt-2 text-[14px] text-slate-500 max-w-xl">
                <WordReveal
                  text={isAll
                    ? "Filter by company or browse everything. Each role has its own page with the full brief and a downloadable JD."
                    : `Open positions at ${meta.label}. Each role has its own page with the full brief and a downloadable JD.`}
                  staggerMs={16}
                />
              </p>
            </header>
          </Reveal>

          {(nbCount > 0 && ytCount > 0) && (
            <Reveal direction="up" delay={80}>
              <div className="flex items-center gap-2 mb-6 flex-wrap">
                <BrandTab href="/jobs"                active={activeBrand === "nb_media"} label="NB Media" count={nbCount} accent={BRAND_META.nb_media.accent} />
                <BrandTab href="/jobs?brand=yt_labs"  active={activeBrand === "yt_labs"}  label="YT Labs"  count={ytCount} accent={BRAND_META.yt_labs.accent} />
                <BrandTab href="/jobs?brand=all"      active={isAll}                       label="All"     count={nbCount + ytCount} accent="#64748b" />
              </div>
            </Reveal>
          )}

          {jobs.length === 0 ? (
            <Reveal direction="up">
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-8 py-16 text-center">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 mb-4">
                  <Building2 size={22} />
                </div>
                <p className="text-[15px] font-semibold text-slate-800">No open roles right now</p>
                <p className="mt-1.5 text-[13px] text-slate-500 max-w-sm mx-auto">
                  We're between hiring cycles. Drop us your CV at{" "}
                  <a href="mailto:hrd@nbmediaproductions.com" className="text-[#3b82f6] font-medium hover:underline">
                    hrd@nbmediaproductions.com
                  </a>{" "}
                  and we'll reach out when something opens up.
                </p>
              </div>
            </Reveal>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {jobs.map((j, i) => (
                <Reveal key={j.id} direction="up" delay={i * 70}>
                  <JobListCard job={j} activeBrand={activeBrand} />
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </section>
      </Reveal>

      {/* ── Culture Highlights — photo grid ──────────────────────── */}
      {/* 6-tile grid for office / team / event photos. Drop image
          files into /public/culture/ and reference here as
          "/culture/<file>". Each card falls back to a soft brand
          gradient with a corner label when a poster is missing. */}
      <Reveal direction="up">
      <section className="relative border-t border-slate-100">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-10 sm:py-20">
          <Reveal direction="up">
            <header className="mb-10 text-center max-w-2xl mx-auto">
              <p
                className="text-[11px] font-bold uppercase tracking-[0.16em] mb-2 inline-block"
                style={activeBrand === "nb_media" ? {
                  background:           "linear-gradient(135deg, #ef4444 0%, #f97316 45%, #fbbf24 100%)",
                  WebkitBackgroundClip: "text",
                  backgroundClip:       "text",
                  WebkitTextFillColor:  "transparent",
                  color:                "transparent",
                } : { color: meta.accent }}
              >
                Culture
              </p>
              <h2 className="text-[22px] sm:text-[32px] font-semibold text-slate-900 tracking-tight">
                <CharReveal text="Culture Highlights" staggerMs={30} />
              </h2>
              <p className="mt-2 text-[14px] text-slate-500">
                <WordReveal text="Moments from the studio — team off-sites, festival celebrations, behind-the-scenes work." staggerMs={16} />
              </p>
            </header>
          </Reveal>

          {/* Photo slideshow — 3 visible tiles desktop, 2 tablet,
              1 mobile. Auto-advances every 4.5s, pauses on hover,
              user-control via chevrons + dots. */}
          <CultureSlideshow photos={CULTURE_PHOTOS} accent={meta.accent} />
        </div>
      </section>
      </Reveal>

      {/* ── Final CTA — "Ready to Create the Next Big Story?" ──── */}
      <Reveal direction="up">
      <section className="relative border-t border-slate-100">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-10 sm:py-16">
          <Reveal direction="up">
            <div className="relative overflow-hidden rounded-3xl text-slate-900 ring-1 ring-slate-300/60 bg-white">
              {/* Subtle slate corner glows on the white surface */}
              <div aria-hidden="true" className="absolute -top-20 -right-20 h-80 w-80 rounded-full bg-slate-300/30 blur-[110px]" />
              <div aria-hidden="true" className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-slate-300/20 blur-[110px]" />
              {/* Top accent line — brand colour ramp (warm or violet) */}
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[2px]"
                style={{
                  background: activeBrand === "yt_labs"
                    ? "linear-gradient(90deg, transparent 0%, #a855f7 30%, #c084fc 50%, #a855f7 70%, transparent 100%)"
                    : "linear-gradient(90deg, transparent 0%, #ef4444 25%, #f97316 50%, #fbbf24 75%, transparent 100%)",
                }}
              />
              <div className="relative px-5 sm:px-12 py-9 sm:py-14 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 sm:gap-6">
                <div className="max-w-xl">
                  <div className="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] mb-3 text-slate-500">
                    <Sparkles size={11} /> Ready when you are
                  </div>
                  <h3 className="text-[22px] sm:text-[30px] font-semibold tracking-tight leading-tight text-slate-900">
                    <CharReveal text="Ready to Create the" staggerMs={26} />{" "}
                    {activeBrand === "yt_labs" ? (
                      <span style={{ color: "#7e22ce" }}>Next Big Story?</span>
                    ) : (
                      // Warm NB Media gradient on the key phrase.
                      <span
                        style={{
                          display:              "inline-block",
                          background:           "linear-gradient(115deg, #ef4444 0%, #f97316 45%, #fbbf24 100%)",
                          WebkitBackgroundClip: "text",
                          backgroundClip:       "text",
                          WebkitTextFillColor:  "transparent",
                          color:                "transparent",
                        }}
                      >
                        Next Big Story?
                      </span>
                    )}
                  </h3>
                  <p className="mt-2 text-[14.5px] text-slate-700 leading-relaxed">
                    Join a team that believes great content starts with great people.
                  </p>
                </div>
                <Magnetic strength={0.18}>
                  <a
                    href="#open-roles"
                    className="group inline-flex w-full sm:w-auto items-center justify-center gap-2 h-12 px-6 rounded-xl text-white text-[13.5px] font-semibold transition-all hover:brightness-105 whitespace-nowrap"
                    style={{
                      // NB Media warm logo gradient (red → orange → amber).
                      // Falls back to the YT Labs violet on the other brand.
                      background: activeBrand === "yt_labs"
                        ? "linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #9333ea 100%)"
                        : "linear-gradient(135deg, #ef4444 0%, #f97316 45%, #fbbf24 100%)",
                      boxShadow: activeBrand === "yt_labs"
                        ? "0 8px 22px -6px rgba(168,85,247,0.55), inset 0 1px 0 rgba(255,255,255,0.25)"
                        : "0 8px 22px -6px rgba(249,115,22,0.55), inset 0 1px 0 rgba(255,255,255,0.25)",
                    }}
                  >
                    Apply Now
                    <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
                  </a>
                </Magnetic>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
      </Reveal>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-7 sm:py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="" className="h-5 w-5 opacity-80" />
            <span className="text-[11.5px] text-slate-500">
              © {new Date().getFullYear()} {meta.label}. All rights reserved.
            </span>
          </div>
          {/* Footer "careers" link removed per HR — contact lives on
              the Contact button in the sticky nav now. */}
        </div>
      </footer>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-[26px] sm:text-[32px] font-semibold text-slate-900 tracking-tight tabular-nums leading-none">{value}</p>
      <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-slate-500 mt-2">{label}</p>
    </div>
  );
}

function BrandTab({
  href, active, label, count, accent,
}: { href: string; active: boolean; label: string; count: number; accent: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 h-10 px-4 rounded-full text-[12.5px] font-semibold transition-colors ${
        active
          ? "text-white"
          : "bg-[#f8fafc] border border-slate-300/60 text-slate-700 hover:border-slate-400/70 hover:text-slate-900"
      }`}
      style={active ? { background: accent } : undefined}
    >
      {label}
      <span className={`text-[10.5px] tabular-nums px-1.5 py-0.5 rounded ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>
        {count}
      </span>
    </Link>
  );
}

function JobListCard({ job, activeBrand }: { job: Row; activeBrand: ActiveBrand }) {
  const isYT = job.brand === "yt_labs";
  const m = isYT ? BRAND_META.yt_labs : BRAND_META.nb_media;
  const showBrandBadge = activeBrand === "all";

  return (
    <Link
      href={`/jobs/${job.slug}`}
      className="group relative flex flex-col bg-white rounded-2xl border border-slate-200 hover:border-slate-300 hover:shadow-[0_10px_28px_-8px_rgba(15,23,42,0.12)] active:scale-[0.99] sm:hover:-translate-y-0.5 transition-all overflow-hidden"
    >
      {/* Accent strip — wider on mobile so it reads as a deliberate
          design element, not a hairline. */}
      <div aria-hidden="true" className="h-[3px] sm:h-1 w-full" style={{ background: m.accent }} />
      <div className="p-5 sm:p-5 flex-1 flex flex-col">
        <div className="flex items-center gap-2 mb-2.5 sm:mb-3 flex-wrap">
          {showBrandBadge && (
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${m.badgeBg} ${m.badgeText} ring-1 ring-slate-100`}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.accent }} />
              {m.label}
            </span>
          )}
          {job.department && (
            <span className="text-[10.5px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-400">{job.department}</span>
          )}
        </div>

        <h3 className="text-[16.5px] sm:text-[17px] font-bold text-slate-900 group-hover:text-[#3b82f6] transition-colors tracking-tight leading-snug">
          {job.title}
        </h3>

        {/* Meta — `gap-y-2 gap-x-3` plus `min-w-0` keeps long labels
            (long salary ranges, "Mid-level (2-5 yrs)") wrapping
            cleanly on narrow screens. */}
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-[12px] text-slate-600">
          {job.location        && <span className="inline-flex items-center gap-1.5 min-w-0"><MapPin     size={12} className="text-[#3b82f6] shrink-0" /> <span className="truncate">{job.location}</span></span>}
          {job.employmentType  && <span className="inline-flex items-center gap-1.5 min-w-0"><Briefcase  size={12} className="text-[#3b82f6] shrink-0" /> <span className="truncate">{job.employmentType}</span></span>}
          {job.experienceLevel && <span className="inline-flex items-center gap-1.5 min-w-0"><Clock      size={12} className="text-[#3b82f6] shrink-0" /> <span className="truncate">{job.experienceLevel}</span></span>}
          {fmtComp(job.salaryRange, job.salaryUnit) && <span className="inline-flex items-center gap-1.5 min-w-0"><IndianRupee size={12} className="text-[#3b82f6] shrink-0" /> <span className="truncate">{fmtComp(job.salaryRange, job.salaryUnit)}</span></span>}
        </div>

        <div className="mt-4 sm:mt-5 pt-3 sm:pt-4 border-t border-slate-100 flex items-center justify-between text-[12px]">
          <span className="inline-flex items-center gap-1.5 text-slate-500">
            <Users size={12} />
            {job.vacancies > 1 ? `${job.vacancies} positions open` : "1 position"}
          </span>
          <span className="inline-flex items-center gap-1 font-bold group-hover:gap-1.5 transition-all" style={{ color: m.accent }}>
            View role <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

type ValueTone = "orange" | "rose" | "emerald" | "indigo" | "violet" | "amber" | "cyan" | "fuchsia";

// Each tone has BOTH the legacy gradient (used by job-detail page card
// flavours we don't want to touch) AND a refined soft palette for the
// careers Why-Join cards — soft tinted background + deep readable icon
// stroke + matching ring on hover. Editorial / Linear / Vercel feel.
const VALUE_TONE: Record<ValueTone, {
  bg: string; shadow: string;
  softBg: string; softRing: string; iconColor: string;
}> = {
  orange:  {
    bg: "linear-gradient(135deg, #fb923c 0%, #f97316 50%, #ea580c 100%)",
    shadow: "0 8px 22px -6px rgba(249,115,22,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
    softBg: "#fff4ea",  softRing: "#fed7aa",  iconColor: "#ea580c",
  },
  rose: {
    bg: "linear-gradient(135deg, #fb7185 0%, #f43f5e 50%, #e11d48 100%)",
    shadow: "0 8px 22px -6px rgba(244,63,94,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
    softBg: "#fff1f2",  softRing: "#fecdd3",  iconColor: "#e11d48",
  },
  emerald: {
    bg: "linear-gradient(135deg, #34d399 0%, #10b981 50%, #059669 100%)",
    shadow: "0 8px 22px -6px rgba(16,185,129,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
    softBg: "#ecfdf5",  softRing: "#a7f3d0",  iconColor: "#059669",
  },
  indigo: {
    bg: "linear-gradient(135deg, #818cf8 0%, #6366f1 50%, #4f46e5 100%)",
    shadow: "0 8px 22px -6px rgba(99,102,241,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
    softBg: "#eef2ff",  softRing: "#c7d2fe",  iconColor: "#4f46e5",
  },
  violet: {
    bg: "linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #9333ea 100%)",
    shadow: "0 8px 22px -6px rgba(168,85,247,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
    softBg: "#faf5ff",  softRing: "#e9d5ff",  iconColor: "#7e22ce",
  },
  amber: {
    bg: "linear-gradient(135deg, #fcd34d 0%, #f59e0b 50%, #d97706 100%)",
    shadow: "0 8px 22px -6px rgba(245,158,11,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
    softBg: "#fffbeb",  softRing: "#fde68a",  iconColor: "#b45309",
  },
  cyan: {
    bg: "linear-gradient(135deg, #67e8f9 0%, #06b6d4 50%, #0891b2 100%)",
    shadow: "0 8px 22px -6px rgba(6,182,212,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
    softBg: "#ecfeff",  softRing: "#a5f3fc",  iconColor: "#0e7490",
  },
  fuchsia: {
    bg: "linear-gradient(135deg, #f0abfc 0%, #e879f9 50%, #c026d3 100%)",
    shadow: "0 8px 22px -6px rgba(232,121,249,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
    softBg: "#fdf4ff",  softRing: "#f5d0fe",  iconColor: "#a21caf",
  },
};

function ValueCard({
  icon: Icon, title, body, tone = "orange",
}: { icon: any; title: string; body: string; tone?: ValueTone }) {
  const t = VALUE_TONE[tone];
  return (
    <div className="group relative h-full sm:aspect-square rounded-2xl bg-white border border-slate-200 p-5 transition-[transform,box-shadow,border-color] duration-300 ease-out hover:border-slate-300 hover:-translate-y-1 hover:shadow-[0_14px_34px_-14px_rgba(15,23,42,0.14)] overflow-hidden flex flex-col">
      {/* Oversized faded icon watermark — fills the lower-right of the
          square so the cube reads as full, not empty. Content sits
          ABOVE it (top-aligned); the watermark anchors the bottom. */}
      <Icon
        size={118}
        strokeWidth={1.25}
        aria-hidden
        className="pointer-events-none absolute -bottom-4 -right-4 transition-transform duration-500 ease-out group-hover:scale-105"
        style={{ color: t.iconColor, opacity: 0.08 }}
      />

      {/* Content — top-aligned (natural flow), sits above the watermark.
          Icon pops in, title flips char-by-char, body slides word-by-
          word. blur disabled on the text (6 cards × this much text would
          pile up blur cost); the flip/slide alone reads as lively. */}
      <div className="relative">
        <Reveal direction="scale" delay={120}>
          <div
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl mb-3 transition-transform duration-300 ease-out group-hover:scale-110"
            style={{ background: `${t.iconColor}1a` }}
          >
            <Icon size={20} strokeWidth={2} style={{ color: t.iconColor }} />
          </div>
        </Reveal>

        <h3 className="text-[14px] font-semibold text-slate-900 tracking-tight leading-snug">
          <CharReveal text={title} staggerMs={18} baseDelayMs={180} blur={false} />
        </h3>
        <p className="text-[12px] text-slate-500 leading-[1.55] mt-1.5">
          <WordReveal text={body} staggerMs={22} baseDelayMs={320} blur={false} />
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Culture Highlights — single photo tile. Renders the poster image
// (object-cover) if provided; otherwise a soft brand-coloured
// gradient with a small "Add photo" label. Caption pinned to the
// bottom corner.
// ─────────────────────────────────────────────────────────────────
function CulturePhoto({
  poster, caption, accent, index,
}: { poster?: string; caption?: string; accent: string; index: number }) {
  // Subtle per-tile gradient angle variance so empty placeholders
  // don't all look identical.
  const angle = (index * 37) % 360;
  return (
    <div className="group relative aspect-[4/3] rounded-2xl overflow-hidden ring-1 ring-slate-200 bg-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt={caption || `Culture photo ${index + 1}`}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
      ) : (
        <>
          <div
            aria-hidden
            className="absolute inset-0"
            style={{ background: `linear-gradient(${angle}deg, ${accent}33, ${accent}11 60%, #ffffff)` }}
          />
          <div className="absolute inset-0 flex items-center justify-center text-[11.5px] font-semibold text-slate-400 uppercase tracking-[0.12em]">
            Add photo
          </div>
        </>
      )}
      {caption && (
        <div className="absolute bottom-0 left-0 right-0 px-4 py-3 text-[12px] font-semibold text-white bg-gradient-to-t from-black/65 via-black/15 to-transparent">
          {caption}
        </div>
      )}
    </div>
  );
}

function BrandCard({
  meta, roleCount, brandKey, expanded,
}: {
  meta: typeof BRAND_META["nb_media"];
  roleCount: number;
  brandKey: "nb_media" | "yt_labs";
  expanded?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#f8fafc] border border-slate-300/60 hover:border-slate-400/70 transition-colors">
      <div aria-hidden="true" className="absolute -top-16 -right-16 h-44 w-44 rounded-full blur-3xl" style={{ background: `${meta.accent}14` }} />
      <div className={`relative ${expanded ? "p-8 sm:p-10" : "p-7"}`}>
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-[0.08em] mb-3 ring-1 ring-slate-100 ${meta.badgeBg} ${meta.badgeText}`}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.accent }} />
          {meta.label}
        </span>
        <h3 className={`${expanded ? "text-[22px]" : "text-[20px]"} font-semibold text-slate-900 tracking-tight`}>{meta.tagline}</h3>
        <p className={`mt-2.5 ${expanded ? "text-[15px]" : "text-[14px]"} text-slate-600 leading-[1.7] max-w-3xl`}>{meta.about}</p>
        <div className="mt-5 flex items-center gap-4 flex-wrap">
          <Link
            href={`/jobs?brand=${brandKey}`}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold transition-colors hover:opacity-80"
            style={{ color: meta.accentHover }}
          >
            {roleCount} open role{roleCount === 1 ? "" : "s"} at {meta.label}
            <ChevronRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}
