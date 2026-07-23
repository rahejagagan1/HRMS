"use client";

// Last-resort error boundary. Next.js renders this ONLY when the root layout
// itself throws — the one case a normal error.tsx can't catch. It must supply
// its own <html>/<body> (it replaces the root layout) and uses inline styles
// so it still renders a friendly screen even if the stylesheet failed to load.
// Without this file, a root-layout crash shows a fully blank, unstyled page.

import { useEffect } from "react";

function isChunkLoadError(err: any): boolean {
  const msg = String(err?.message ?? err ?? "");
  return /ChunkLoadError|Loading chunk \d|Failed to load chunk|Loading CSS chunk/i.test(msg);
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
    // Stale-chunk after a deploy → reload once to fetch the new manifest.
    if (isChunkLoadError(error) && typeof window !== "undefined") {
      const KEY = "nb-chunk-reload";
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, "1");
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", background: "#e2e8f0" }}>
        <div
          style={{
            minHeight: "100vh", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 16,
            padding: 24, textAlign: "center", color: "#0f172a",
          }}
        >
          <div
            style={{
              width: 56, height: 56, borderRadius: 9999, background: "rgba(239,68,68,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
            }}
          >
            ⚠️
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Something went wrong</h2>
          <p style={{ fontSize: 14, color: "#64748b", maxWidth: 420, margin: 0, lineHeight: 1.5 }}>
            The page hit an unexpected error. Reloading usually fixes it.
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: "10px 22px", background: "#008CFF", color: "#fff", border: "none",
              borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
