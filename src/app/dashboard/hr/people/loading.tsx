// People directory + Org tree loading skeleton. Mimics the page's
// own header (Welcome card) + tab strip + filter chip row + employee
// card grid.

import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function PeopleLoading() {
  return (
    <div className="space-y-0">
      {/* Module tab strip skeleton — Employees / Documents / Engage */}
      <div className="flex items-center gap-4 border-b border-slate-200 dark:border-white/[0.06] px-6 py-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-20 rounded" />
        ))}
      </div>

      {/* Sub-tab strip (Employee Directory / Organization Tree) +
          Add Employee button placeholder. */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 dark:border-white/[0.06]">
        <div className="flex gap-6">
          <Skeleton className="h-4 w-32 rounded" />
          <Skeleton className="h-4 w-32 rounded" />
        </div>
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>

      <div className="px-6 py-6 space-y-5">
        {/* Title */}
        <Skeleton className="h-6 w-48 rounded" />

        {/* Filter chip row */}
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-32 rounded-lg" />
          ))}
          <Skeleton className="h-9 flex-1 min-w-[200px] rounded-lg" />
        </div>

        {/* Employee card grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <SkeletonCard key={i} className="h-44" lines={3} />
          ))}
        </div>
      </div>
    </div>
  );
}
