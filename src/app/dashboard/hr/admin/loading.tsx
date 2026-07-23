// HR admin dashboard — two-column layout (rail menu + content).
// The rail stays static so the skeleton mainly covers the content
// pane (header card + stat cards + table or panel-shaped block).

import { Skeleton, SkeletonStatCards, SkeletonTable } from "@/components/ui/Skeleton";

export default function HRAdminLoading() {
  return (
    <div className="flex">
      {/* Rail menu — narrow column of menu-item skeletons. */}
      <div className="hidden md:block w-[220px] shrink-0 border-r border-slate-200 dark:border-white/[0.06] p-4 space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded-lg" />
        ))}
      </div>

      <div className="flex-1 p-6 space-y-5">
        {/* Page header card */}
        <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/60 p-5 space-y-2">
          <Skeleton className="h-5 w-48 rounded" />
          <Skeleton className="h-3 w-72 rounded" />
        </div>

        {/* Stat cards */}
        <SkeletonStatCards count={5} />

        {/* Content panel — could be Approvals table, Departments grid, etc. */}
        <SkeletonTable rows={8} columns={6} />
      </div>
    </div>
  );
}
