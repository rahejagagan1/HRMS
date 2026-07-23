import type { ReactNode } from "react";

// PageShell — the outermost wrapper every dashboard page MUST use.
//
// The app's <LayoutShell> already paints the page background and reserves
// a 92px sidebar gutter, so PageShell deliberately does NOT set its own
// background. Pages that re-declare `bg-[#...]` at the top level were
// double-painting the surface and that's the "override" we're killing.
//
// Use this as the single root of every page; put a <PageHeader> inside
// it for the title strip and a <PageContainer> for the body.
export default function PageShell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`min-h-full ${className}`}>{children}</div>;
}
