// HR section route fallback — shown between any /dashboard/hr/* nav.
// Slightly richer than the generic /dashboard one because HR pages
// almost always have a header + filter chip row + table or grid below.

import { SkeletonPage, SkeletonStatCards, SkeletonTable } from "@/components/ui/Skeleton";

export default function HRLoading() {
  return (
    <SkeletonPage>
      <SkeletonStatCards count={5} />
      <SkeletonTable rows={8} columns={6} />
    </SkeletonPage>
  );
}
