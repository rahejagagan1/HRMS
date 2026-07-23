"use client";

// Mouse-follow spotlight — a soft radial gradient that tracks the
// cursor inside its container, fading away when the user leaves.
// Pure CSS variables + RAF throttled so it's cheap. The "live website
// trend" effect popularised by Linear / Vercel landing pages.

import { useEffect, useRef } from "react";

export default function Spotlight({
  color = "rgba(168, 85, 247, 0.35)",
  size = 600,
  className = "",
}: {
  color?: string;
  size?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Respect reduced-motion users.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let pendingX = 0, pendingY = 0;
    const apply = () => {
      el.style.setProperty("--mx", `${pendingX}px`);
      el.style.setProperty("--my", `${pendingY}px`);
      raf = 0;
    };
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      pendingX = e.clientX - r.left;
      pendingY = e.clientY - r.top;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onEnter = () => { el.style.setProperty("--opacity", "1"); };
    const onLeave = () => { el.style.setProperty("--opacity", "0"); };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{
        // CSS vars default to center if JS hasn't fired yet.
        ["--mx" as any]: "50%",
        ["--my" as any]: "50%",
        ["--opacity" as any]: "0",
        background: `radial-gradient(${size}px circle at var(--mx) var(--my), ${color}, transparent 70%)`,
        opacity: "var(--opacity)",
        transition: "opacity 400ms ease",
      }}
    />
  );
}
