/**
 * Parses the YOUTUBE_CHANNELS env var (a JSON array of channel configs)
 * and returns just the public-facing fields ({ channelId, name }) for the
 * dashboard / HR-admin UIs. Credentials (clientId, clientSecret,
 * refreshToken) live in the same env entry but are intentionally stripped
 * here so they can't leak into a route handler that just needs the list.
 *
 * Returns [] on any parse error so callers don't have to guard each call —
 * an empty list naturally renders "no channels configured" in the UI.
 */
export function listConfiguredChannels(): Array<{ channelId: string; name: string }> {
    const raw = process.env.YOUTUBE_CHANNELS;
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((entry: any) => ({
                channelId: typeof entry?.channelId === "string" ? entry.channelId : "",
                name: typeof entry?.name === "string" ? entry.name : "",
            }))
            .filter((c) => c.channelId.length > 0);
    } catch {
        return [];
    }
}
