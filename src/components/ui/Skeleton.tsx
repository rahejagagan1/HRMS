// Reusable skeleton primitives — drop into any component / page that
// shows data and wants a polished loading state instead of a blank
// flash or a spinner. Compose from these four building blocks rather
// than hand-rolling pulse divs per file.
//
// Usage:
//   <Skeleton className="h-9 w-32 rounded-lg" />
//   <SkeletonText lines={3} />
//   <SkeletonCard className="h-32" />
//   <SkeletonTable rows={8} columns={5} />
//
// The base <Skeleton> respects whatever className you pass — sizes /
// rounding / margins all stay in your hands. The composite components
// just stack <Skeleton>s in common shapes so HR-dashboard, table, and
// page layouts can pick the right preset in one line.

import { ReactNode } from "react";

/** Base shimmer block. Pass any sizing via className. */
export function Skeleton({ className = "", children }: { className?: string; children?: ReactNode }) {
  return (
    <div
      aria-hidden
      className={`relative overflow-hidden bg-slate-200/70 dark:bg-white/[0.06] ${className}`}
    >
      {/* Shimmer sweep — pure CSS so no JS / state. Uses the
          `animate-skeleton-shimmer` keyframes defined in globals.css. */}
      <div className="absolute inset-0 -translate-x-full animate-skeleton-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/[0.08]" />
      {children}
    </div>
  );
}

/** N text-line skeletons of decreasing width (last line shorter). */
export function SkeletonText({
  lines = 1,
  className = "",
  lineClassName = "h-3",
}: {
  lines?: number;
  className?: string;
  /** Per-line className — override height / spacing. */
  lineClassName?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`${lineClassName} rounded ${
            i === lines - 1 && lines > 1 ? "w-3/4" : "w-full"
          }`}
        />
      ))}
    </div>
  );
}

/** Card-shaped block with optional inner skeleton lines. */
export function SkeletonCard({
  className = "",
  lines,
}: {
  className?: string;
  /** When provided, renders that many SkeletonText lines inside a padded shell. */
  lines?: number;
}) {
  if (lines == null) {
    return <Skeleton className={`rounded-xl ${className}`} />;
  }
  return (
    <div className={`rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/60 p-5 ${className}`}>
      <Skeleton className="h-4 w-1/3 rounded mb-3" />
      <SkeletonText lines={lines} />
    </div>
  );
}

/** Table-row skeleton — N rows × M columns, each cell a thin block. */
export function SkeletonTable({
  rows = 6,
  columns = 5,
  className = "",
  withHeader = true,
}: {
  rows?: number;
  columns?: number;
  className?: string;
  withHeader?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/60 overflow-hidden ${className}`}>
      {withHeader && (
        <div className="grid border-b border-slate-100 dark:border-white/[0.04] bg-slate-50/60 dark:bg-white/[0.02] px-5 py-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: "1rem" }}>
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-2.5 w-2/3 rounded" />
          ))}
        </div>
      )}
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid border-b border-slate-100 dark:border-white/[0.04] last:border-b-0 px-5 py-4"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: "1rem" }}
        >
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={c}
              className={`h-3 rounded ${c === 0 ? "w-3/4" : c === columns - 1 ? "w-1/3" : "w-2/3"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Stat-card grid (e.g. Attendance Dashboard top cards). */
export function SkeletonStatCards({ count = 5, className = "" }: { count?: number; className?: string }) {
  return (
    <div className={`flex flex-wrap gap-3 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex-1 min-w-[150px] rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/60 p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <div className="flex-1 min-w-0 space-y-2">
              <Skeleton className="h-2.5 w-2/3 rounded" />
              <Skeleton className="h-5 w-1/2 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Full-page skeleton wrapper — title + meta strip + content area. */
export function SkeletonPage({
  title = true,
  filterRow = true,
  children,
}: {
  title?: boolean;
  filterRow?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="p-6 space-y-5">
      {title && (
        <div className="space-y-2">
          <Skeleton className="h-6 w-48 rounded" />
          <Skeleton className="h-3 w-72 rounded" />
        </div>
      )}
      {filterRow && (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-32 rounded-lg" />
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
