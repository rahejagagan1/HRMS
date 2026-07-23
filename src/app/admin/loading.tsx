// Admin (sync settings) page — tab strip across the top + content
// panel matching whichever tab is active. The Users tab shows a tree
// of cards, the Workspaces tab a list of sync rows, etc. — the
// skeleton covers the common shape (tabs + content grid).

import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function AdminLoading() {
  return (
    <div className="p-6 mx-auto max-w-7xl space-y-6">
      {/* Title block */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-32 rounded" />
        <Skeleton className="h-3 w-56 rounded" />
      </div>

      {/* Tab strip */}
      <div className="inline-flex gap-1 rounded-2xl bg-slate-200/40 p-1 w-fit">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-xl" />
        ))}
      </div>

      {/* Content panel */}
      <div className="rounded-2xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/60 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-48 rounded" />
          <Skeleton className="h-9 w-40 rounded-xl" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} className="h-36" lines={3} />
          ))}
        </div>
      </div>
    </div>
  );
}
