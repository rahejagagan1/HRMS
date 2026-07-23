"use client";

// useUrlState — like useUrlTab but for arbitrary string values
// (typically numeric IDs serialised as strings). Use when the
// state value isn't a fixed union of allowed labels — e.g.
// "which job is currently selected" (any positive integer) or
// "which candidate's drawer is open" (any candidate id).
//
// Conventions:
//   • `key` is the search-param name to bind to ("job", "candidate", …).
//   • Setting `null` (or `""`) removes the param from the URL.
//   • replaceState (no history bloat) + scroll:false — feels instant.
//   • Stays in sync with URL changes from elsewhere (back/forward,
//     programmatic navigation, deep-link).

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Setter = (next: string | null) => void;

export function useUrlState(key: string): [string | null, Setter] {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  const fromUrl = useMemo<string | null>(
    () => searchParams?.get(key) ?? null,
    [searchParams, key],
  );

  const [value, setValue] = useState<string | null>(fromUrl);

  // Keep React state in sync when the URL changes from elsewhere
  // (back/forward, deep link, programmatic navigation).
  useEffect(() => {
    if (fromUrl !== value) setValue(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUrl]);

  const set = useCallback<Setter>((next) => {
    setValue(next);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === null || next === "") params.delete(key);
    else                              params.set(key, next);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, pathname, searchParams, key]);

  return [value, set];
}
