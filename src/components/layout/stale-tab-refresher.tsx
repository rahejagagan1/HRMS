"use client";

// Auto-reloads the page when the user returns to a tab that's been
// hidden for longer than STALE_MS, or when the page is restored from
// the browser's back/forward cache (bfcache). Catches the "I left
// this open last week" scenario where the SPA state is hours stale
// but SWR's revalidate-on-focus alone isn't enough — auth cookies
// can have rotated, deployed code might differ, etc.
//
// Why a hard reload and not router.refresh():
//   • Picks up new client bundles after a deploy
//   • Re-runs the auth bootstrap (NextAuth session + RealtimeProvider)
//   • Clears any in-memory state that drifted (SWR cache, timers)
// The trade-off is in-flight form edits get blown away, hence the
// 5-minute threshold — quick alt-tabs won't trigger it.

import { useEffect } from "react";

const STALE_MS = 5 * 60 * 1000; // 5 minutes hidden → refresh on return

export default function StaleTabRefresher() {
  useEffect(() => {
    if (typeof document === "undefined") return;

    let hiddenAt: number | null = document.hidden ? Date.now() : null;

    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt != null && Date.now() - hiddenAt >= STALE_MS) {
        hiddenAt = null;
        window.location.reload();
      } else {
        hiddenAt = null;
      }
    };

    // Pages restored from bfcache (browser back/forward) come back with
    // event.persisted === true — the JS state inside is frozen and may
    // be hours old, so always force a fresh load.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return null;
}
