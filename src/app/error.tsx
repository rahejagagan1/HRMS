"use client";

// Root-level error boundary — catches render errors in any route segment that
// doesn't have its own error.tsx (e.g. /login, /onboarding, the root page).
// Keeps the user on a friendly, recoverable screen instead of a blank page.

import { useEffect } from "react";
import Link from "next/link";

function isChunkLoadError(err: any): boolean {
  const msg = String(err?.message ?? err ?? "");
  return /ChunkLoadError|Loading chunk \d|Failed to load chunk|Loading CSS chunk/i.test(msg);
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
    if (isChunkLoadError(error) && typeof window !== "undefined") {
      const KEY = "nb-chunk-reload";
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, "1");
        window.location.reload();
      }
    }
  }, [error]);

  // Stale-chunk after a deploy — we're already reloading; show a calm state.
  if (isChunkLoadError(error)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#e2e8f0] p-6 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-300 border-t-[#008CFF]" />
        <h2 className="text-lg font-semibold text-slate-900">Updating to the latest version…</h2>
        <p className="max-w-md text-sm text-slate-500">A new build is live — reloading the page.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#e2e8f0] p-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-2xl">⚠️</div>
      <h2 className="text-lg font-semibold text-slate-900">Something went wrong</h2>
      <p className="max-w-md text-sm text-slate-500">
        {error?.message || "An unexpected error occurred. Please try again."}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <button
          onClick={() => reset()}
          className="rounded-xl bg-[#008CFF] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0077dd]"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
