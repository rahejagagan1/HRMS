"use client";

// Scroll-driven parallax — translates the wrapped element in the
// opposite direction of scroll by a small ratio. The classic "feels
// like 3D depth" effect (Apple / Linear landing pages use this on
// hero ornaments and section dividers).

import { useEffect, useRef } from "react";

export default function Parallax({
  children,
  speed = 0.3,
  className = "",
}: {
  children: React.ReactNode;
  /** -1 → moves opposite scroll, 0 → static, 1 → moves with scroll. */
  speed?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const apply = () => {
      const r = el.getBoundingClientRect();
      const centerOffset = r.top + r.height / 2 - window.innerHeight / 2;
      el.style.transform = `translate3d(0, ${centerOffset * -speed * 0.15}px, 0)`;
      raf = 0;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [speed]);

  return (
    <div ref={ref} className={className} style={{ willChange: "transform" }}>
      {children}
    </div>
  );
}
