"use client";

import { useEffect } from "react";

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error("Admin error:", error);
    }, [error]);

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
                    {error.message || "An unexpected error occurred."}
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
