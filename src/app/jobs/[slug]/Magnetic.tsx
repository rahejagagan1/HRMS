"use client";

// Magnetic-button wrapper — element subtly pulls toward the cursor
// while it's hovered, snaps back on leave. Trendy "gravity" effect
// you see on modern award-winning portfolios.
//
// Pure inline-style translate via RAF — no DOM thrash, no deps.

import { useEffect, useRef } from "react";

export default function Magnetic({
  children,
  strength = 0.25,
  as: As = "div",
  className = "",
}: {
  children: React.ReactNode;
  /** 0 → no pull, 1 → element exactly follows the cursor */
  strength?: number;
  /** Render-tag — use "span" to wrap an inline button. */
  as?: any;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let tx = 0, ty = 0;
    const apply = () => {
      el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      raf = 0;
    };
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      tx = (e.clientX - cx) * strength;
      ty = (e.clientY - cy) * strength;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => { tx = 0; ty = 0; if (!raf) raf = requestAnimationFrame(apply); };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [strength]);

  return (
    <As
      ref={ref as any}
      className={className}
      style={{ display: "inline-block", transition: "transform 350ms cubic-bezier(0.16,1,0.3,1)" }}
    >
      {children}
    </As>
  );
}
