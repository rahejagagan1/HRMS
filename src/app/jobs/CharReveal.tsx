"use client";

// CharReveal — character-by-character 3D flip-up reveal. Each letter
// starts rotated back in 3D (rotateX) below the line and flips up into
// place with a stagger, so the headline "unfolds" as it scrolls into
// view. More dramatic than a word slide — the "extraordinary" headline
// treatment trending 3D sites use.
//
// Words are kept whole (wrapped in nowrap spans) so line-breaks only
// happen between words, never mid-word. Spaces are preserved.
//
// Respects prefers-reduced-motion (renders instantly). Re-animates
// each time it scrolls back into view.

import { useEffect, useRef, useState } from "react";

export default function CharReveal({
  text,
  className = "",
  staggerMs = 28,
  baseDelayMs = 0,
  blur = true,
}: {
  text: string;
  className?: string;
  staggerMs?: number;
  baseDelayMs?: number;
  /** Blur-to-sharp focus pull. Disable for many-instance spots
   *  (e.g. the 6 perk-card titles) to avoid a blur-cost pile-up. */
  blur?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => { for (const e of entries) setVisible(e.isIntersecting); },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const words = text.split(" ");
  let charIdx = 0;

  return (
    <span
      ref={ref}
      className={className}
      style={{ display: "inline-block", perspective: "600px" }}
    >
      {words.map((word, wi) => (
        <span key={wi} style={{ display: "inline-block", whiteSpace: "nowrap" }}>
          {Array.from(word).map((ch) => {
            const i = charIdx++;
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  transformOrigin: "50% 100%",
                  transformStyle: "preserve-3d",
                  opacity: visible ? 1 : 0,
                  // 3D flip-up + (optional) blur-to-sharp focus pull —
                  // each letter resolves from a soft blur as it rotates
                  // into place. Premium, cinematic.
                  filter: blur ? (visible ? "blur(0px)" : "blur(6px)") : undefined,
                  transform: visible
                    ? "rotateX(0deg) translateY(0)"
                    : "rotateX(-92deg) translateY(0.4em)",
                  transition: blur
                    ? "transform 640ms cubic-bezier(0.2,0.75,0.25,1), opacity 420ms ease, filter 520ms ease"
                    : "transform 640ms cubic-bezier(0.2,0.75,0.25,1), opacity 420ms ease",
                  transitionDelay: `${baseDelayMs + i * staggerMs}ms`,
                  willChange: visible ? "auto" : (blur ? "transform, opacity, filter" : "transform, opacity"),
                }}
              >
                {ch}
              </span>
            );
          })}
          {/* Real space between words (also counts toward stagger). */}
          {wi < words.length - 1 && (() => { charIdx++; return <span>&nbsp;</span>; })()}
        </span>
      ))}
    </span>
  );
}
