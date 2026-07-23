import { LRUCache } from "lru-cache";

// In-memory cache for API responses — prevents redundant DB hits
// TTL = how long data stays fresh before next request triggers a refetch
const cache = new LRUCache<string, any>({
    max: 1000,          // increased from 100 — supports more unique cache keys
    ttl: 1000 * 60 * 2, // 2 minutes default TTL
});

/**
 * Get-or-set cache pattern.
 * If the key exists and hasn't expired, returns cached value.
 * Otherwise, calls the fetcher function, caches the result, and returns it.
 */
export async function cachedFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs?: number
): Promise<T> {
    const cached = cache.get(key);
    if (cached !== undefined) {
        return cached as T;
    }

    const data = await fetcher();
    cache.set(key, data, { ttl: ttlMs });
    return data;
}

/**
 * Invalidate a specific cache key or all keys matching a prefix.
 * Call this after sync operations or data mutations.
 */
export function invalidateCache(keyOrPrefix?: string) {
    if (!keyOrPrefix) {
        cache.clear();
        return;
    }
    // Invalidate all keys that start with the prefix
    for (const key of cache.keys()) {
        if (key.startsWith(keyOrPrefix)) {
            cache.delete(key);
        }
    }
}

export default cache;
