import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

// Streamed skeleton for the public careers landing (/jobs). Shown instantly
// while the server renders the openings list, so slow connections get the
// page shape rather than a blank screen. Mirrors the real layout: sticky
// header, hero heading + subtext, and the openings card grid.
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#e2e8f0] text-slate-900 antialiased">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-[#e2e8f0]/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-8">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-9 w-9 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-24 rounded" />
              <Skeleton className="h-2 w-14 rounded" />
            </div>
          </div>
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
      </header>

      {/* Hero */}
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-8 sm:py-16">
        <Skeleton className="mb-6 h-7 w-44 rounded-full" />
        <div className="max-w-4xl space-y-3">
          <Skeleton className="h-10 w-full rounded-lg sm:h-14" />
          <Skeleton className="h-10 w-2/3 rounded-lg sm:h-14" />
        </div>
        <div className="mt-6 max-w-2xl">
          <SkeletonText lines={2} lineClassName="h-3.5" />
        </div>
      </div>

      {/* Openings grid */}
      <div className="mx-auto max-w-6xl px-4 pb-20 sm:px-8">
        <Skeleton className="mb-6 h-6 w-48 rounded" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-6">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-2/3 rounded" />
                <Skeleton className="h-7 w-7 rounded-full" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-28 rounded-full" />
              </div>
              <SkeletonText lines={2} />
              <Skeleton className="h-9 w-32 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
