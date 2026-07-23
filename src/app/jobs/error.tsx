"use client";

// Error boundary for the public careers flow (/jobs, /jobs/[slug], /jobs/apply).
// If a render throws (e.g. a transient DB error while loading openings), the
// candidate sees a friendly, on-brand recovery screen with a retry + a link
// back to all openings — never a blank page.

import { useEffect } from "react";
import Link from "next/link";

function isChunkLoadError(err: any): boolean {
  const msg = String(err?.message ?? err ?? "");
  return /ChunkLoadError|Loading chunk \d|Failed to load chunk|Loading CSS chunk/i.test(msg);
}

export default function JobsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Careers page error:", error);
    if (isChunkLoadError(error) && typeof window !== "undefined") {
      const KEY = "nb-chunk-reload";
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, "1");
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#e2e8f0] p-6 text-center text-slate-900 antialiased">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-2xl">⚠️</div>
      <h2 className="text-xl font-semibold">We couldn’t load this page</h2>
      <p className="max-w-md text-sm text-slate-500">
        Something went wrong on our end. Please try again — it usually works on a second attempt.
      </p>
      <div className="mt-1 flex items-center gap-2">
        <button
          onClick={() => reset()}
          className="rounded-xl bg-[#008CFF] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0077dd]"
        >
          Try again
        </button>
        <Link
          href="/jobs"
          className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          All openings
        </Link>
      </div>
    </div>
  );
}
