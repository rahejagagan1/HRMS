import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

// Streamed skeleton for the public job-detail page (/jobs/[slug]).
// Next renders this instantly via Suspense while the server builds the JD,
// so slow connections see the page's shape immediately instead of a blank
// screen. Shown only on a cache miss — an ISR cache hit serves the real page
// directly. Mirrors the real layout: sticky header, hero title + meta chips,
// JD body card, and the sticky Apply card.
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#e2e8f0] text-slate-900 antialiased">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-[#e2e8f0]/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-2 px-4 sm:px-8">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-9 w-9 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-24 rounded" />
              <Skeleton className="h-2 w-14 rounded" />
            </div>
          </div>
          <Skeleton className="h-8 w-28 rounded-lg" />
        </div>
      </header>

      {/* Hero + body */}
      <div className="mx-auto max-w-5xl px-5 pb-20 pt-10 sm:px-8 sm:pt-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
          {/* Main column */}
          <div className="space-y-8">
            <Skeleton className="h-3 w-40 rounded" />
            {/* title */}
            <div className="space-y-3">
              <Skeleton className="h-9 w-3/4 rounded-lg sm:h-12" />
              <Skeleton className="h-9 w-1/2 rounded-lg sm:h-12" />
            </div>
            {/* meta chips */}
            <div className="flex flex-wrap gap-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-28 rounded-full" />
              ))}
            </div>
            {/* JD body */}
            <div className="space-y-6 rounded-2xl border border-slate-200/70 bg-white p-6 sm:p-8">
              <Skeleton className="h-5 w-40 rounded" />
              <SkeletonText lines={4} />
              <Skeleton className="mt-2 h-5 w-48 rounded" />
              <SkeletonText lines={5} />
              <Skeleton className="mt-2 h-5 w-36 rounded" />
              <SkeletonText lines={3} />
            </div>
          </div>
          {/* Sticky apply card */}
          <div>
            <div className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-6">
              <Skeleton className="h-4 w-32 rounded" />
              <Skeleton className="h-11 w-full rounded-xl" />
              <Skeleton className="h-9 w-full rounded-lg" />
              <div className="space-y-2 pt-2">
                <Skeleton className="h-3 w-full rounded" />
                <Skeleton className="h-3 w-2/3 rounded" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
