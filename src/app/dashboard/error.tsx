"use client";

import { useEffect } from "react";

// Detect stale-chunk errors that happen the first time a tab tries
// to fetch a JS chunk that was renamed by a fresh deploy. Next.js
// uses content-hashed chunk filenames (e.g. /_next/static/chunks/
// 0re2wg98.n8dq.js). A new build replaces those with new hashes,
// so the OLD page's references 404. Browser surfaces this as
// "Failed to load chunk" / ChunkLoadError. A full page reload
// fetches the new chunk manifest + the page works again.
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
        console.error("Dashboard error:", error);
        // Auto-recover from stale-chunk errors after a deploy.
        // sessionStorage guards against an infinite reload loop —
        // we only reload once per tab per error type.
        if (isChunkLoadError(error) && typeof window !== "undefined") {
            const KEY = "nb-chunk-reload";
            if (!sessionStorage.getItem(KEY)) {
                sessionStorage.setItem(KEY, "1");
                window.location.reload();
            }
        }
    }, [error]);

    // For stale-chunk errors we're already reloading — show a
    // friendlier "refreshing…" state while the new JS lands.
    if (isChunkLoadError(error)) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
                <div className="w-10 h-10 border-4 border-slate-300 border-t-[#008CFF] rounded-full animate-spin" />
                <div className="text-center">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Updating to the latest version…
                    </h2>
                    <p className="text-sm text-slate-500 max-w-md">
                        A new build is live — reloading the page so you see the latest changes.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
                <svg
                    className="w-8 h-8 text-red-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                </svg>
            </div>
            <div className="text-center">
                <h2 className="text-lg font-semibold text-white mb-1">
                    Something went wrong
                </h2>
                <p className="text-sm text-slate-400 max-w-md">
                    {error.message || "An unexpected error occurred while loading data."}
                </p>
            </div>
            <button
                onClick={reset}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium text-white transition-colors"
            >
                Try Again
            </button>
        </div>
    );
}
