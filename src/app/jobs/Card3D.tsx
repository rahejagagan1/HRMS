"use client";

// Card3D — wraps a card and gives it an interactive 3D tilt toward
// the cursor plus a soft spotlight that follows the pointer. The kind
// of premium, "Awwwards" micro-interaction trending product sites use.
//
// All transform/opacity only (GPU-composited) so it stays buttery and
// never triggers layout/paint thrash. Disabled on touch + reduced
// motion (no hover pointer → nothing to tilt toward).
//
// Usage:  <Card3D>…card markup…</Card3D>
// The child should be a full-size block; Card3D adds perspective on
// the wrapper and the tilt/spotlight on an inner layer.

import { useRef } from "react";

export default function Card3D({
  children,
  className = "",
  /** Max tilt in degrees at the card's edges. */
  max = 9,
  /** Spotlight tint (rgba/hex). Defaults to a soft white sheen. */
  glow = "rgba(255,255,255,0.5)",
}: {
  children: React.ReactNode;
  className?: string;
  max?: number;
  glow?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const raf = useRef<number>(0);
  // Cache the card's rect so we DON'T call getBoundingClientRect on
  // every mousemove (a forced layout read that fights the compositor
  // and causes the tilt to feel laggy). Re-measured only on enter.
  const rect = useRef<DOMRect | null>(null);

  const reduce =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      window.matchMedia?.("(hover: none)").matches);

  const onEnter = () => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    rect.current = el.getBoundingClientRect();   // measure ONCE per hover
    // While the pointer is in the card the tilt tracks it crisply
    // (short transition = no lag). The longer ease is reserved for
    // the return-to-flat on leave.
    el.style.setProperty("--t", "90ms");
  };

  const onMove = (e: React.MouseEvent) => {
    if (reduce) return;
    const el = ref.current;
    const r = rect.current;
    if (!el || !r) return;
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      el.style.setProperty("--rx", `${(-py * max).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${(px * max).toFixed(2)}deg`);
      el.style.setProperty("--mx", `${((px + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${((py + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty("--lift", "1");
    });
  };

  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    if (raf.current) cancelAnimationFrame(raf.current);
    // Longer, eased return so the card glides back to flat.
    el.style.setProperty("--t", "500ms");
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--lift", "0");
  };

  return (
    <div
      ref={ref}
      onMouseEnter={onEnter}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={`card3d h-full ${className}`}
      style={{
        // Perspective lives on the wrapper; the inner card rotates.
        perspective: "900px",
        // Defaults so the very first frame is flat.
        ["--rx" as any]: "0deg",
        ["--ry" as any]: "0deg",
        ["--mx" as any]: "50%",
        ["--my" as any]: "50%",
        ["--lift" as any]: "0",
        ["--t" as any]: "500ms",
        ["--glow" as any]: glow,
      }}
    >
      <div className="card3d-inner relative h-full">
        {children}
        {/* Cursor spotlight — a radial sheen that follows the pointer.
            pointer-events-none so it never blocks clicks. Fades in via
            --lift on hover. */}
        <span
          aria-hidden
          className="card3d-glow pointer-events-none absolute inset-0 rounded-2xl"
        />
      </div>
    </div>
  );
}
