// Feedback (NB Unplugged) — narrow centred form. Header card +
// category dropdown + message textarea + submit. Mirror that.

import { Skeleton } from "@/components/ui/Skeleton";

export default function FeedbackLoading() {
  return (
    <div className="w-full flex flex-col items-center py-5 md:py-9 px-2 sm:px-6 bg-violet-50/50 min-h-full">
      <div className="w-full max-w-3xl space-y-4 md:space-y-5">
        {/* Header card */}
        <div className="rounded-xl border border-violet-200 bg-white shadow-sm overflow-hidden">
          <div className="h-2 bg-gradient-to-r from-violet-300 to-fuchsia-300" />
          <div className="px-6 md:px-8 pt-6 pb-5 space-y-3">
            <Skeleton className="h-7 w-48 rounded" />
            <Skeleton className="h-3 w-full rounded" />
            <Skeleton className="h-3 w-5/6 rounded" />
            <Skeleton className="h-3 w-4/6 rounded" />
          </div>
        </div>

        {/* Category card */}
        <div className="rounded-xl border border-violet-200 bg-white shadow-sm px-6 md:px-8 py-5 space-y-3">
          <Skeleton className="h-3 w-24 rounded" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>

        {/* Message card */}
        <div className="rounded-xl border border-violet-200 bg-white shadow-sm px-6 md:px-8 py-5 space-y-3">
          <Skeleton className="h-3 w-32 rounded" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>

        {/* Submit button */}
        <div className="flex justify-end">
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
