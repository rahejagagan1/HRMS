"use client";

// Word-by-word reveal — splits a string into spans and animates each
// word in sequence as the element scrolls into view. Each word slides
// up + fades in with a small stagger so the heading appears to write
// itself. Awwwards-style hero treatment.

import { useEffect, useRef, useState } from "react";

export default function WordReveal({
  text,
  className = "",
  staggerMs = 60,
  baseDelayMs = 0,
  blur = true,
}: {
  text: string;
  className?: string;
  staggerMs?: number;
  baseDelayMs?: number;
  /** Blur-to-sharp focus pull. Disable for many-instance spots. */
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
    // Re-animating observer: replays the word-by-word reveal every
    // time the title scrolls back into view. Don't unobserve.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          setVisible(e.isIntersecting);
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const words = text.split(/\s+/);

  return (
    <span ref={ref} className={className} style={{ display: "inline-block" }}>
      {words.map((w, i) => (
        <span
          key={i}
          // Mask each word in its own clipping span so the slide-up
          // doesn't reveal blank space above the line. The padding /
          // negative-margin pair adds space for descenders (g, p, y,
          // j) so they aren't clipped on tight-leading headings.
          style={{
            display:       "inline-block",
            overflow:      "hidden",
            verticalAlign: "top",
            paddingBottom: "0.2em",
            marginBottom:  "-0.2em",
          }}
        >
          <span
            style={{
              display: "inline-block",
              opacity: visible ? 1 : 0,
              // Slide-up + (optional) blur-to-sharp focus pull.
              filter: blur ? (visible ? "blur(0px)" : "blur(5px)") : undefined,
              transform: visible ? "translateY(0)" : "translateY(110%)",
              transition: blur
                ? "transform 800ms cubic-bezier(0.16,1,0.3,1), opacity 600ms cubic-bezier(0.16,1,0.3,1), filter 500ms ease"
                : "transform 800ms cubic-bezier(0.16,1,0.3,1), opacity 600ms cubic-bezier(0.16,1,0.3,1)",
              transitionDelay: `${baseDelayMs + i * staggerMs}ms`,
              willChange: visible ? "auto" : (blur ? "opacity, transform, filter" : "opacity, transform"),
            }}
          >
            {w}
            {i < words.length - 1 && " "}
          </span>
        </span>
      ))}
    </span>
  );
}
