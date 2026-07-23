// Personal attendance — heavily table-shaped page. Header welcome
// card up top, then a stat summary row, clock-in card, then the big
// daily log table. Mimic that vertical rhythm.

import { Skeleton, SkeletonStatCards, SkeletonTable } from "@/components/ui/Skeleton";

export default function AttendanceLoading() {
  return (
    <div className="p-6 space-y-5">
      {/* Welcome card */}
      <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/60 p-5 flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-48 rounded" />
          <Skeleton className="h-3 w-32 rounded" />
        </div>
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>

      {/* Stat strip */}
      <SkeletonStatCards count={4} />

      {/* Daily log table */}
      <SkeletonTable rows={10} columns={6} />
    </div>
  );
}
