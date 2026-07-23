"use client";

import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delayMs`
 * of no changes. Use it to key expensive work (filtering/sorting a large
 * list) off the settled value while the input itself stays responsive:
 *
 *   const [search, setSearch] = useState("");
 *   const debouncedSearch = useDebouncedValue(search, 300);
 *   const filtered = useMemo(() => rows.filter(...debouncedSearch...), [rows, debouncedSearch]);
 *   <input value={search} onChange={e => setSearch(e.target.value)} />
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
