// Approvals queue — top tabs (Leave / Comp / WFH / etc.), header
// card with title + search, filter card with brand-scope dropdown +
// status chips + Filter By row, then the queue table.

import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

export default function ApprovalsLoading() {
  return (
    <div className="p-6 space-y-4">
      {/* Top kind-tabs */}
      <div className="flex gap-4 border-b border-slate-200 dark:border-white/[0.06] pb-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-24 rounded" />
        ))}
      </div>

      {/* Header card */}
      <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/60 p-5 flex items-center justify-between gap-3">
        <div className="space-y-2 min-w-0 flex-1">
          <Skeleton className="h-5 w-40 rounded" />
          <Skeleton className="h-3 w-72 rounded" />
        </div>
        <Skeleton className="h-9 w-[280px] rounded-lg shrink-0" />
      </div>

      {/* Filter card */}
      <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/60 p-5 space-y-4">
        <div>
          <Skeleton className="h-2.5 w-24 rounded mb-2" />
          <Skeleton className="h-9 w-[260px] rounded-lg" />
        </div>
        <div>
          <Skeleton className="h-2.5 w-24 rounded mb-2" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-32 rounded-lg" />
            ))}
          </div>
        </div>
      </div>

      {/* Queue table */}
      <SkeletonTable rows={10} columns={7} />
    </div>
  );
}
