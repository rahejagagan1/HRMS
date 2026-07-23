"use client";

// Floating social-platform badges — YouTube, Instagram, Spotify,
// Facebook. On page load they "burst" outward from the center of the
// hero to their final scattered positions, then settle into a gentle
// float-bob.
//
// MOBILE strategy: the badges DO render on phones now, but at
// roughly 55% of their desktop size and pinned to the four corners
// of the section (far away from the title + subtitle text). That
// gives mobile the same "fun, on-brand decoration" the desktop hero
// has, without the badges crashing into the typography.

import { useEffect, useRef } from "react";
import { Play } from "lucide-react";

type Platform = "youtube" | "facebook" | "instagram" | "spotify";

type Badge = {
  platform: Platform;
  /** Desktop size in px. Mobile size is computed via --badge-scale. */
  size:     number;
  /** Desktop position. Mobile uses the same anchor side (left/right
   *  + top/bottom) but at safer corner-hugging offsets to avoid
   *  overlapping the title/CTA stack in the centre. */
  top?:     string;
  bottom?:  string;
  left?:    string;
  right?:   string;
  /** Mobile-only position overrides — when present, replaces the
   *  desktop positions on viewports < 640 px. */
  mobile?:  { top?: string; bottom?: string; left?: string; right?: string };
  rotate:   number;
  /** Approximate offset from final position toward viewport center,
   *  used as the starting point of the spread animation so badges
   *  appear to fly out from the hero centre. */
  fromX:    string;
  fromY:    string;
};

const BADGES: Badge[] = [
  // Top-left corner — YouTube
  { platform: "youtube",   size: 60, top: "12%", left:  "5%",
    mobile: { top: "5%",  left:  "4%"  },
    rotate: -10, fromX:  "40vw", fromY:  "30vh" },
  // Top-right corner — Instagram
  { platform: "instagram", size: 64, top: "18%", right: "6%",
    mobile: { top: "5%",  right: "4%"  },
    rotate:   6, fromX: "-40vw", fromY:  "28vh" },
  // Bottom-left corner — Spotify
  { platform: "spotify",   size: 52, top: "62%", left:  "8%",
    mobile: { bottom: "8%", left:  "4%" },
    rotate:   8, fromX:  "38vw", fromY: "-22vh" },
  // Bottom-right corner — Facebook
  { platform: "facebook",  size: 48, top: "70%", right: "12%",
    mobile: { bottom: "8%", right: "4%" },
    rotate: -12, fromX: "-36vw", fromY: "-28vh" },
];

const PLATFORM: Record<Platform, { bg: string; shadow: string }> = {
  youtube: {
    bg:     "linear-gradient(180deg, #ff1f1f 0%, #d90000 100%)",
    shadow: "0 14px 30px -8px rgba(217,0,0,0.45), 0 2px 4px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.35)",
  },
  facebook: {
    bg:     "linear-gradient(180deg, #1877f2 0%, #0e5fcc 100%)",
    shadow: "0 14px 30px -8px rgba(24,119,242,0.45), 0 2px 4px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.35)",
  },
  instagram: {
    bg:     "radial-gradient(115% 115% at 25% 110%, #fdc468 0%, #f5733a 25%, #d6249f 55%, #285aeb 100%)",
    shadow: "0 14px 30px -8px rgba(214,36,159,0.45), 0 2px 4px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.4)",
  },
  spotify: {
    bg:     "linear-gradient(180deg, #1ed760 0%, #0fb84e 100%)",
    shadow: "0 14px 30px -8px rgba(30,215,96,0.45), 0 2px 4px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.35)",
  },
};

// Hand-rolled brand glyphs (lucide doesn't ship Facebook/Instagram/Spotify).
function FacebookMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="#ffffff" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 7h-2.5c-.5 0-.5.4-.5.7V10h3l-.4 3H13v8h-3v-8H8v-3h2V7.5C10 5 11.5 4 13.6 4H16v3z" />
    </svg>
  );
}
function InstagramMark({ size }: { size: number }) {
  const sw = Math.max(1.6, size * 0.05);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="5.5" stroke="#ffffff" strokeWidth={sw} />
      <circle cx="12" cy="12" r="4" stroke="#ffffff" strokeWidth={sw} />
      <circle cx="17.5" cy="6.5" r="1.1" fill="#ffffff" />
    </svg>
  );
}
function SpotifyMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="#000000" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.9 10.9C14.7 9 9.35 8.8 6.3 9.75c-.5.15-1-.15-1.15-.6-.15-.5.15-1 .6-1.15 3.55-1.05 9.4-.85 13.1 1.35.45.25.6.85.35 1.3-.25.35-.85.5-1.3.25z" />
      <path d="M17.8 13.7c-.25.35-.7.5-1.05.25-2.7-1.65-6.8-2.15-9.95-1.15-.4.1-.85-.1-.95-.5-.1-.4.1-.85.5-.95 3.65-1.1 8.15-.55 11.25 1.35.3.15.45.6.2 1z" />
      <path d="M16.6 16.45c-.2.3-.55.4-.85.2-2.35-1.45-5.3-1.75-8.8-.95-.35.1-.65-.15-.75-.45-.1-.35.15-.65.45-.75 3.8-.85 7.1-.5 9.7 1.1.35.15.4.55.25.85z" />
    </svg>
  );
}

// Per-badge parallax depth — how far each badge drifts relative to
// the cursor. Varied so the four badges move at different rates,
// creating a layered 3D-depth feel rather than moving as one sheet.
const PARALLAX_DEPTH: Record<Platform, number> = {
  youtube:   1.4,
  instagram: 1.7,
  spotify:   0.9,
  facebook:  1.2,
};

export default function PlayBadges() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Mouse-parallax. On pointer move we set --px/--py (cursor offset
  // from viewport centre, in px, damped) on the host; each badge
  // wrapper multiplies them by its own --depth. rAF-throttled and
  // transform-only so it stays smooth. Skipped for touch / reduced
  // motion (no hover pointer → nothing to react to).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia?.("(hover: none)").matches) return;

    let raf = 0;
    let tx = 0, ty = 0;
    const onMove = (e: MouseEvent) => {
      // Offset from centre, normalised to roughly ±18px of travel.
      const nx = (e.clientX / window.innerWidth - 0.5) * 2;   // -1..1
      const ny = (e.clientY / window.innerHeight - 0.5) * 2;  // -1..1
      tx = -nx * 18;
      ty = -ny * 18;
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        host.style.setProperty("--px", `${tx}px`);
        host.style.setProperty("--py", `${ty}px`);
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <style>{`
        /* Theatrical reveal on page load — each badge whirls out from
           the hero centre: starts tiny + blurred + spun back ~120°,
           flies to its corner while sharpening, overshoots in scale +
           rotation, then settles. Followed by the gentle float-bob.
           The resting size is scale(var(--scale)) (0.55 mobile → 1
           desktop) so both keyframes share the var. */
        @keyframes badgeSpread {
          0% {
            transform: translate(var(--fx), var(--fy))
                       rotate(calc(var(--rot) - 120deg))
                       scale(0);
            opacity: 0;
            filter: blur(7px);
          }
          45% { opacity: 1; filter: blur(0); }
          72% {
            transform: translate(0, 0)
                       rotate(calc(var(--rot) + 7deg))
                       scale(calc(var(--scale) * 1.16));
            opacity: 1;
            filter: blur(0);
          }
          100% {
            transform: translate(0, 0) rotate(var(--rot)) scale(var(--scale));
            opacity: 1;
            filter: blur(0);
          }
        }
        @keyframes badgeFloat {
          0%, 100% { transform: translate3d(0, 0, 0) rotate(var(--rot)) scale(var(--scale)); }
          50%      { transform: translate3d(6px, -10px, 0) rotate(calc(var(--rot) + 2deg)) scale(var(--scale)); }
        }
        .badge-host {
          /* Mobile: 55% scale, anchored to the four corners.
             Tablet (sm:): 85% scale, hybrid positions.
             Desktop (lg:): 100% scale, original loose layout. */
          --scale: 0.55;
        }
        @media (min-width: 640px)  { .badge-host { --scale: 0.85; } }
        @media (min-width: 1024px) { .badge-host { --scale: 1;    } }

        .badge {
          opacity: 0;
          transform-origin: center;
          /* Longer reveal (1500ms) + a springier curve so the
             overshoot reads. Per-badge stagger (animationDelay below)
             makes them whirl in one-after-another. */
          animation:
            badgeSpread 1500ms cubic-bezier(0.22, 1.15, 0.34, 1) 200ms forwards,
            badgeFloat  6000ms ease-in-out 2000ms infinite;
        }

        /* Parallax wrapper — drifts each badge by (cursor offset ×
           its depth). Smoothed with a transition so motion eases
           rather than snapping to the pointer. The inner .badge keeps
           its own spread+float animation independently. */
        .badge-host { --px: 0px; --py: 0px; }
        .badge-parallax {
          transition: transform 350ms cubic-bezier(0.22, 1, 0.36, 1);
          transform: translate3d(
            calc(var(--px) * var(--depth, 1)),
            calc(var(--py) * var(--depth, 1)),
            0
          );
          will-change: transform;
        }
        @media (prefers-reduced-motion: reduce) {
          .badge-parallax { transform: none; }
          /* Reduced-motion: skip the burst-in + perpetual float.
             Badges just appear in place (opacity 1, no animation). */
          .badge { animation: none !important; opacity: 1 !important; }
        }
      `}</style>
      <div
        ref={hostRef}
        aria-hidden="true"
        className="badge-host pointer-events-none absolute inset-0 overflow-hidden"
      >
        {BADGES.map((b, i) => {
          const p = PLATFORM[b.platform];
          const isYouTube = b.platform === "youtube";
          const isSpotify = b.platform === "spotify";
          const width  = isYouTube ? Math.round(b.size * 1.4) : b.size;
          const height = isYouTube ? Math.round(b.size * 0.95) : b.size;
          const iconSize = Math.round(b.size * 0.5);
          const borderRadius =
            isYouTube ? 14 :
            isSpotify ? "9999px" :
            Math.round(b.size * 0.26);

          // Render twice — once positioned for desktop, once for
          // mobile — using Tailwind responsive utilities to swap.
          // It's cheaper than dynamically computing positions in JS
          // and avoids a hydration mismatch from window.innerWidth
          // checks. Both share the .badge animation + transform.
          const baseStyle = {
            width,
            height,
            background:     p.bg,
            boxShadow:      p.shadow,
            borderRadius,
            // Stronger stagger (150ms) so the badges whirl in one
            // after another as a clear reveal. Float starts only
            // after each badge's 1500ms reveal completes.
            animationDelay: `${i * 150}ms, ${1500 + i * 150}ms`,
            ["--rot" as any]: `${b.rotate}deg`,
            ["--fx"  as any]: b.fromX,
            ["--fy"  as any]: b.fromY,
          };
          const inner = (
            <>
              {b.platform === "youtube"   && <Play         size={iconSize} strokeWidth={0} className="fill-white" style={{ marginLeft: 2 }} />}
              {b.platform === "facebook"  && <FacebookMark  size={iconSize} />}
              {b.platform === "instagram" && <InstagramMark size={iconSize} />}
              {b.platform === "spotify"   && <SpotifyMark   size={iconSize} />}
            </>
          );
          const depth = PARALLAX_DEPTH[b.platform];
          return (
            <span key={i} aria-hidden="true">
              {/* Desktop placement — parallax wrapper (mouse drift) >
                  badge (spread + float). Hidden on phones. */}
              <span
                className="badge-parallax absolute hidden sm:block"
                style={{
                  top: b.top, bottom: b.bottom, left: b.left, right: b.right,
                  ["--depth" as any]: depth,
                }}
              >
                <span
                  className="badge inline-flex items-center justify-center"
                  style={baseStyle}
                >
                  {inner}
                </span>
              </span>
              {/* Mobile placement — corner-pinned, smaller via --scale.
                  No parallax on touch (no hover pointer). */}
              {b.mobile && (
                <span
                  className="absolute sm:hidden"
                  style={{
                    top:    b.mobile.top,
                    bottom: b.mobile.bottom,
                    left:   b.mobile.left,
                    right:  b.mobile.right,
                  }}
                >
                  <span
                    className="badge inline-flex items-center justify-center"
                    style={baseStyle}
                  >
                    {inner}
                  </span>
                </span>
              )}
            </span>
          );
        })}
      </div>
    </>
  );
}
