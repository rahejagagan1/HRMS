"use client";

// Culture Highlights — continuous rolling marquee that loops
// SEAMLESSLY without any visible jump at the wrap-around point.
//
// Why it doesn't jump:
//   • Tile widths are in `vw` units (viewport-relative), NOT % of
//     the flex parent. % of flex parent is ambiguous in some
//     browsers and can subpixel-round, causing the loop point at
//     translateX(-50%) to land 1px off and produce a visible snap.
//   • We render the photos array TWICE in the track.
//   • The keyframe translates by EXACTLY -(photos.length * tileVw)
//     vw — i.e. one full original-set width in pixel-exact units.
//     At the end of one cycle, tile N+1 sits where tile 1 was;
//     since they're literally the same image, the snap back to
//     translateX(0) is invisible.
//   • Hover pauses the animation so visitors can dwell on a caption.

import { useEffect, useState } from "react";

type CulturePhoto = { poster?: string; caption?: string };

// Seconds per FULL revolution through all photos. Lower = faster.
const DURATION_SECONDS = 20;

export default function CultureSlideshow({
  photos, accent,
}: { photos: CulturePhoto[]; accent: string }) {
  // Match viewport so each tile occupies a sensible width. SSR
  // default is desktop (3-up); useEffect refines after hydration.
  const [visibleCount, setVisibleCount] = useState(3);

  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      setVisibleCount(w >= 1024 ? 3 : w >= 640 ? 2 : 1);
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  // Each tile = (100 / visibleCount) vw. So 3-up tiles are 33.33vw,
  // 2-up are 50vw, 1-up are 100vw. The total track is the doubled
  // array's worth of tiles = 2 * photos.length * tileVw vw.
  const tileVw = 100 / visibleCount;
  const singleSetVw = photos.length * tileVw;
  const doubled = [...photos, ...photos];

  // Unique animation name keyed by the precise translate amount so
  // the keyframe rule swaps cleanly when viewport size changes
  // (visibleCount → tileVw → singleSetVw).
  const animName = `culture-roll-${singleSetVw.toFixed(3).replace(".", "_")}`;

  return (
    <div className="relative group/marquee overflow-hidden rounded-2xl">
      <style>{`
        @keyframes ${animName} {
          from { transform: translate3d(0, 0, 0); }
          to   { transform: translate3d(-${singleSetVw}vw, 0, 0); }
        }
        .culture-track {
          animation: ${animName} ${DURATION_SECONDS}s linear infinite;
          will-change: transform;
        }
        .group\\/marquee:hover .culture-track {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .culture-track { animation: none; }
        }
      `}</style>

      {/* Fade edges so photos don't pop in/out abruptly at the
          left/right boundaries — they ease in and out of view. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-16 sm:w-24 z-10"
        style={{ background: "linear-gradient(to right, rgba(255,255,255,0.85), transparent)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-16 sm:w-24 z-10"
        style={{ background: "linear-gradient(to left, rgba(255,255,255,0.85), transparent)" }}
      />

      <div className="culture-track flex">
        {doubled.map((p, i) => (
          <div
            key={i}
            className="shrink-0 px-2"
            style={{ width: `${tileVw}vw` }}
          >
            <CultureSlide
              poster={p.poster}
              caption={p.caption}
              accent={accent}
              index={i % photos.length}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function CultureSlide({
  poster, caption, accent, index,
}: { poster?: string; caption?: string; accent: string; index: number }) {
  const angle = (index * 37) % 360;
  return (
    <div className="group/tile relative aspect-[4/3] rounded-2xl overflow-hidden ring-1 ring-slate-200 bg-slate-100 shadow-sm">
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt={caption || `Culture photo ${index + 1}`}
          className="absolute inset-0 w-full h-full object-cover"
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
        <div
          className="absolute bottom-0 left-0 right-0 px-4 py-3 text-[12px] font-semibold bg-gradient-to-t from-black/70 via-black/25 to-transparent"
          // Force pure white — `style` beats any cascading colour
          // from the page-wide Times New Roman / accent rules.
          style={{ color: "#ffffff", textShadow: "0 1px 3px rgba(0,0,0,0.45)" }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}
