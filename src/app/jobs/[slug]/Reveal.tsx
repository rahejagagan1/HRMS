"use client";

// Scroll-triggered reveal wrapper — fades in + slides up the first
// time the element enters the viewport. Uses IntersectionObserver
// so it's zero-dep, native, and pauses when the tab is hidden.
//
// Usage:
//   <Reveal>...your section...</Reveal>
//   <Reveal delay={150}>...</Reveal>          // ms stagger
//   <Reveal direction="left">...</Reveal>     // slide direction

import { useEffect, useRef, useState } from "react";

type Direction = "up" | "down" | "left" | "right" | "scale" | "rise3d";

export default function Reveal({
  children,
  delay = 0,
  direction = "up",
  className = "",
  threshold = 0.15,
}: {
  children: React.ReactNode;
  delay?: number;
  direction?: Direction;
  className?: string;
  threshold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Respect reduced-motion preference — show immediately.
    if (typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }
    // Re-animating observer — fires every time the element enters
    // the viewport and resets when it leaves. So scrolling back up,
    // then back down, replays the animation. We DON'T unobserve.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          setVisible(e.isIntersecting);
        }
      },
      { threshold, rootMargin: "0px 0px -60px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  // Each direction maps to a starting transform — they converge on
  // translate(0,0) when visible. Distances kept SHORT (24px) and the
  // starting-scale dropped: a long 90px slide over 1s reads as laggy
  // "buffering" on scroll. A subtle 24px rise over ~500ms feels crisp
  // and responsive while still giving the reveal life.
  const hidden: Record<Direction, string> = {
    up:    "translate3d(0, 24px, 0)",
    down:  "translate3d(0, -24px, 0)",
    left:  "translate3d(-24px, 0, 0)",
    right: "translate3d(24px, 0, 0)",
    scale: "translate3d(0,0,0) scale(0.94)",
    // 3D flip-up: the element tips back in perspective + rises, then
    // settles flat — a premium "unfolds into place" scroll entrance.
    rise3d: "perspective(900px) rotateX(16deg) translate3d(0, 34px, 0)",
  };
  const shown = direction === "rise3d"
    ? "perspective(900px) rotateX(0deg) translate3d(0,0,0)"
    : "translate3d(0,0,0)";
  // rise3d gets a slightly longer, springier transition for drama.
  const timing = direction === "rise3d"
    ? "opacity 500ms cubic-bezier(0.2,0.7,0.2,1), transform 700ms cubic-bezier(0.2,0.7,0.2,1)"
    : "opacity 450ms cubic-bezier(0.22,1,0.36,1), transform 550ms cubic-bezier(0.22,1,0.36,1)";

  return (
    <div
      ref={ref}
      className={className}
      style={{
        transition: timing,
        transitionDelay: `${delay}ms`,
        opacity: visible ? 1 : 0,
        transform: visible ? shown : hidden[direction],
        // Drop will-change after the element is settled — keeping it
        // permanently promotes every reveal to its own layer and can
        // actually hurt scroll perf when many are on-screen.
        willChange: visible ? "auto" : "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}
