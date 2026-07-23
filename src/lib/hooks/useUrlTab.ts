"use client";

// useUrlTab — drop-in replacement for useState that mirrors the tab
// value into the URL's search params. Reloading the page (or sharing
// the URL) returns to the same tab.
//
//   const [tab, setTab] = useUrlTab("tab", "candidates",
//     ["candidates", "pipeline", "jobs"] as const);
//
// Conventions:
//   • `key` is the search-param name (default "tab"). Pick something
//     scoped if a page renders nested tab groups — e.g. "settingsSection"
//     so it doesn't collide with the outer tab.
//   • `allowed` (optional) is the list of valid values. When the URL
//     contains anything outside this list (manual edit / stale link),
//     the hook silently falls back to `defaultValue` so we never end
//     up rendering a tab that doesn't exist.
//   • Updates use replaceState (no history bloat) and skip the
//     scroll-to-top behaviour, so clicking a tab feels instant.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Setter<T> = (next: T) => void;

export function useUrlTab<T extends string>(
  key: string,
  defaultValue: T,
  allowed?: readonly T[],
): [T, Setter<T>] {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  // Resolve initial value:
  //   1. URL value (if present + in allowed list).
  //   2. defaultValue.
  // useMemo so this only re-runs when the URL changes.
  const fromUrl = useMemo<T>(() => {
    const raw = searchParams?.get(key);
    if (!raw) return defaultValue;
    if (allowed && !allowed.includes(raw as T)) return defaultValue;
    return raw as T;
  }, [searchParams, key, defaultValue, allowed]);

  const [value, setValue] = useState<T>(fromUrl);

  // Keep React state in sync when the URL changes from elsewhere
  // (back/forward button, programmatic navigation, deep link).
  useEffect(() => {
    if (fromUrl !== value) setValue(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUrl]);

  const set = useCallback<Setter<T>>((next) => {
    setValue(next);
    // Write to URL without scrolling or pushing history.
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === defaultValue) params.delete(key); // keep URL clean on defaults
    else                       params.set(key, next);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, pathname, searchParams, key, defaultValue]);

  return [value, set];
}
