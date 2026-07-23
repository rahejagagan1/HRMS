import type { ReactNode } from "react";

// PageContainer — centered content column with a fluid max-width cap.
//
// Width caps in pixels (chosen to read well at the 1280px laptop floor
// AND stop content from sprawling on 1920px+ monitors):
//   sm:   640   — narrow forms / single-column reads
//   md:   768   — standard article width
//   lg:  1024   — feed pages (Engage, Inbox)
//   xl:  1180   — multi-column dashboards
//   2xl: 1360   — wide grids (Attendance board, Analytics)
//   full: no cap — full-bleed pages
//
// Horizontal padding scales: px-4 (mobile) → px-6 (sm) → px-8 (lg) so
// content has breathing room on wide screens but never crowds the
// sidebar at 1280px.
const MAX_W: Record<string, string> = {
  sm:   "max-w-[640px]",
  md:   "max-w-[768px]",
  lg:   "max-w-[1024px]",
  xl:   "max-w-[1180px]",
  "2xl": "max-w-[1360px]",
  full: "max-w-none",
};

export default function PageContainer({
  children,
  maxWidth = "xl",
  className = "",
}: {
  children: ReactNode;
  maxWidth?: keyof typeof MAX_W;
  className?: string;
}) {
  return (
    <div
      className={`mx-auto w-full ${MAX_W[maxWidth] ?? MAX_W.xl} px-4 sm:px-6 lg:px-8 ${className}`}
    >
      {children}
    </div>
  );
}
