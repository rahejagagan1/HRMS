"use client";

// 3D tilt card — rotates in 3D based on cursor position within its
// bounds. Includes an optional gloss/highlight overlay that tracks
// the cursor for a "shiny surface" feel. The interactive bit users
// describe as "feeling like I'm inside the page".

import { useEffect, useRef } from "react";

export default function Tilt3D({
  children,
  className = "",
  maxDeg = 6,
  scale = 1.015,
  gloss = true,
}: {
  children: React.ReactNode;
  className?: string;
  /** Maximum tilt amplitude in degrees on either axis. */
  maxDeg?: number;
  /** Slight scale-up while hovered (lift effect). */
  scale?: number;
  /** Show a moving glossy highlight that follows the cursor. */
  gloss?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let tx = 0, ty = 0, mx = 50, my = 50;
    const apply = () => {
      el.style.transform =
        `perspective(900px) rotateX(${ty}deg) rotateY(${tx}deg) scale(${1})`;
      // Update gloss position via CSS variables — read by ::after below.
      el.style.setProperty("--mx", `${mx}%`);
      el.style.setProperty("--my", `${my}%`);
      el.style.setProperty("--hover", "1");
      raf = 0;
    };
    const reset = () => {
      el.style.transform = `perspective(900px) rotateX(0deg) rotateY(0deg) scale(1)`;
      el.style.setProperty("--hover", "0");
    };
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;   // 0..1
      const py = (e.clientY - r.top)  / r.height;  // 0..1
      tx = (px - 0.5) *  maxDeg * 2;
      ty = (py - 0.5) * -maxDeg * 2;
      mx = px * 100;
      my = py * 100;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onEnter = () => { el.style.transition = "transform 120ms ease-out"; void el.offsetWidth; el.style.transition = ""; };
    const onLeave = () => { el.style.transition = "transform 600ms cubic-bezier(0.16,1,0.3,1)"; reset(); };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [maxDeg, scale]);

  return (
    <div
      ref={ref}
      className={`relative ${className}`}
      style={{
        transformStyle: "preserve-3d",
        willChange: "transform",
        ["--mx" as any]: "50%",
        ["--my" as any]: "50%",
        ["--hover" as any]: "0",
      }}
    >
      {children}
      {gloss && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{
            background: "radial-gradient(420px circle at var(--mx) var(--my), rgba(59,130,246,0.14), transparent 50%)",
            opacity: "var(--hover)",
            transition: "opacity 250ms ease",
            mixBlendMode: "multiply",
          }}
        />
      )}
    </div>
  );
}
