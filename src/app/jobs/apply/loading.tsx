import { Skeleton } from "@/components/ui/Skeleton";

// Streamed skeleton for the public application form (/jobs/apply). The form is
// a client component, so on a slow connection this shows while its JS loads —
// header + title + a stack of field rows + submit button.
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#e2e8f0] text-slate-900 antialiased">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-[#e2e8f0]/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-2.5 px-4 sm:px-8">
          <Skeleton className="h-9 w-9 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-24 rounded" />
            <Skeleton className="h-2 w-14 rounded" />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-8">
        <div className="space-y-3">
          <Skeleton className="h-8 w-1/2 rounded-lg" />
          <Skeleton className="h-3 w-3/4 rounded" />
        </div>
        <div className="space-y-6 rounded-2xl border border-slate-200/70 bg-white p-6 sm:p-8">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-32 rounded" />
              <Skeleton className="h-11 w-full rounded-lg" />
            </div>
          ))}
          <Skeleton className="h-11 w-40 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
