// Generic dashboard route fallback — Next.js streams this while the
// child page's server components fetch. Keeps the rest of the
// LayoutShell (sidebar, top bar) on-screen so the user never sees a
// blank flash between navigations.

import { SkeletonPage, SkeletonStatCards, SkeletonTable } from "@/components/ui/Skeleton";

export default function DashboardLoading() {
  return (
    <SkeletonPage>
      <SkeletonStatCards count={4} />
      <SkeletonTable rows={6} columns={5} />
    </SkeletonPage>
  );
}
