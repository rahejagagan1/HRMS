// SWR global configuration + fetcher
// SWR provides: caching, revalidation, deduplication, error retry

export const fetcher = (url: string) =>
    fetch(url).then((res) => {
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
    });

// Default SWR options for the app.
// No blanket auto-poll or focus-revalidation: these are spread into the heavy
// dashboard / list pages, which only need to fetch on mount + navigation.
// Genuinely-live surfaces (notification/inbox badges, attendance boards) opt
// into polling explicitly with their own `refreshInterval`. The previous
// `refreshInterval: 30000` + `revalidateOnFocus: true` re-ran those heavy
// aggregations on every open tab every 30s and on every tab focus — a constant
// background load on Postgres.
export const swrConfig = {
    revalidateOnFocus: false,     // Don't re-run heavy queries on every tab focus
    dedupingInterval: 30000,      // Deduplicate identical requests within 30s
    errorRetryCount: 2,           // Retry failed requests twice
    keepPreviousData: true,       // Show stale data while revalidating
};
