"use client";

// Custom cursor — a small dot + larger outline that follows the
// mouse with smooth lag (the "Awwwards-style" feel). Outline scales
// up on interactive elements so users feel guided through the page.
//
// Hides on touch devices (no mouse to follow). Pure RAF, no deps.

import { useEffect, useRef, useState } from "react";

export default function CursorFollower() {
  const dotRef    = useRef<HTMLDivElement>(null);
  const ringRef   = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    // Skip on touch devices and reduced-motion users.
    if (typeof window === "undefined") return;
    const isTouch = window.matchMedia("(hover: none)").matches;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (isTouch || reduced) return;
    setEnabled(true);

    const dot  = dotRef.current!;
    const ring = ringRef.current!;
    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let dx = mx, dy = my;     // dot — fast follow
    let rx = mx, ry = my;     // ring — slow lag

    const onMove = (e: MouseEvent) => { mx = e.clientX; my = e.clientY; };
    const onDown = () => ring.style.transform += " scale(0.85)";
    const onUp   = () => { /* re-render handled by raf */ };

    // Detect hover on interactive elements so the ring grows.
    const onOver = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("a, button, [role=button], input, textarea, select, [data-cursor=hover]")) {
        ring.dataset.hover = "1";
      } else {
        ring.dataset.hover = "0";
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseover", onOver);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);

    let raf = 0;
    const tick = () => {
      // Dot lerps fast, ring lerps slow — creates the cinematic lag.
      dx += (mx - dx) * 0.6;
      dy += (my - dy) * 0.6;
      rx += (mx - rx) * 0.15;
      ry += (my - ry) * 0.15;
      const scale = ring.dataset.hover === "1" ? 1.6 : 1;
      dot.style.transform  = `translate3d(${dx - 4}px, ${dy - 4}px, 0)`;
      ring.style.transform = `translate3d(${rx - 16}px, ${ry - 16}px, 0) scale(${scale})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseover", onOver);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      cancelAnimationFrame(raf);
    };
  }, []);

  if (!enabled) return null;

  return (
    <>
      {/* Hide native cursor on hover-targets only — keep readable on text */}
      <style>{`
        @media (hover: hover) {
          a, button, [role=button] { cursor: none; }
        }
      `}</style>
      <div
        ref={ringRef}
        className="fixed top-0 left-0 z-[9999] pointer-events-none h-8 w-8 rounded-full border border-[#3b82f6] mix-blend-difference"
        style={{ transition: "transform 80ms linear, border-color 200ms, scale 200ms" }}
      />
      <div
        ref={dotRef}
        className="fixed top-0 left-0 z-[9999] pointer-events-none h-2 w-2 rounded-full bg-[#3b82f6] mix-blend-difference"
      />
    </>
  );
}
