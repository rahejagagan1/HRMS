// Single employee profile page — Keka-style two-column layout.
// Avatar + identity card up top, tab strip, then a stack of detail
// cards. Skeleton mirrors that shape so the transition is smooth.

import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function PersonLoading() {
  return (
    <div className="p-6 space-y-5">
      {/* Top identity strip — avatar + name + designation + chip row. */}
      <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/60 p-5">
        <div className="flex items-start gap-4">
          <Skeleton className="h-20 w-20 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-48 rounded" />
            <Skeleton className="h-3 w-32 rounded" />
            <div className="flex gap-2 mt-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-20 rounded-full" />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex gap-4 border-b border-slate-200 dark:border-white/[0.06] pb-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-20 rounded" />
        ))}
      </div>

      {/* Detail cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} lines={4} />
        ))}
      </div>
    </div>
  );
}
