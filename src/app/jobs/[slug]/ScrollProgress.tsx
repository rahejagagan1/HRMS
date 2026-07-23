"use client";

// Thin gradient bar pinned at the very top of the viewport that fills
// from left → right as the user scrolls. Modern, subtle, always
// visible — gives the page a sense of length and progress.

import { useEffect, useRef } from "react";

export default function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const compute = () => {
      const max = (document.documentElement.scrollHeight - window.innerHeight);
      const pct = max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0;
      el.style.transform = `scaleX(${pct / 100})`;
      raf = 0;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    compute();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="fixed inset-x-0 top-0 z-[100] h-[2px] pointer-events-none">
      <div
        ref={ref}
        className="h-full origin-left bg-gradient-to-r from-[#3b82f6] via-[#a855f7] to-[#ec4899]"
        style={{ transform: "scaleX(0)", transition: "transform 120ms linear" }}
      />
    </div>
  );
}
