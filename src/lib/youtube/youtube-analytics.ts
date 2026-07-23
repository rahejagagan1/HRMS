/**
 * YouTube Analytics API client
 * Uses per-channel OAuth2 refresh tokens to fetch detailed analytics
 */

export interface ChannelConfig {
    name: string;
    channelId: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
}

// Parse channel configs from environment
export function getChannelConfigs(): ChannelConfig[] {
    const raw = process.env.YOUTUBE_CHANNELS;
    if (!raw) return [];
    try {
        return JSON.parse(raw);
    } catch {
        console.error("Failed to parse YOUTUBE_CHANNELS env variable");
        return [];
    }
}

// Get access token from refresh token
async function getAccessToken(channel: ChannelConfig): Promise<string> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: channel.clientId,
            client_secret: channel.clientSecret,
            refresh_token: channel.refreshToken,
            grant_type: "refresh_token",
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`OAuth2 token refresh failed for ${channel.name}: ${err}`);
    }

    const data = await response.json();
    return data.access_token;
}

// Find which channel a video belongs to using Data API
export async function detectVideoChannel(videoId: string): Promise<string | null> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) return null;

    try {
        const res = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet&key=${apiKey}`
        );
        const data = await res.json();
        return data.items?.[0]?.snippet?.channelId || null;
    } catch {
        return null;
    }
}

// Get first 30 days views for a video using YouTube Analytics API
// Uses publishedAt date to calculate the first 30 days window
export async function getFirst30DaysViews(
    videoId: string,
    channelConfig: ChannelConfig,
    publishedAt: Date | null
): Promise<number | null> {
    try {
        if (!publishedAt) return null;

        const accessToken = await getAccessToken(channelConfig);

        // Calculate date range: publishedAt to publishedAt + 30 days
        const startDate = new Date(publishedAt);
        const endDate = new Date(publishedAt);
        endDate.setDate(endDate.getDate() + 30);

        // If the 30-day window hasn't ended yet, use yesterday as end date
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (endDate > yesterday) {
            endDate.setTime(yesterday.getTime());
        }

        const startStr = startDate.toISOString().split("T")[0]; // YYYY-MM-DD
        const endStr = endDate.toISOString().split("T")[0];

        const url = `https://youtubeanalytics.googleapis.com/v2/reports?` +
            `ids=channel==${channelConfig.channelId}` +
            `&startDate=${startStr}` +
            `&endDate=${endStr}` +
            `&metrics=views` +
            `&filters=video==${videoId}`;

        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok) {
            const err = await response.text();
            console.error(`Analytics API error for ${channelConfig.name}:`, err);
            return null;
        }

        const data = await response.json();
        // Response format: { rows: [[totalViews]], ... }
        if (data.rows && data.rows.length > 0) {
            return data.rows[0][0]; // total views in first 30 days since publish
        }
        return 0;
    } catch (error) {
        console.error(`Error fetching analytics for video ${videoId}:`, error);
        return null;
    }
}

// Get lifetime thumbnail impression CTR for a video using YouTube Analytics API.
// The metric videoThumbnailImpressionsClickRate is only available in traffic source
// reports (requires insightTrafficSourceType dimension), so we query per-source
// data and compute the weighted average.
export async function getVideoLifetimeCTR(
    videoId: string,
    channelConfig: ChannelConfig,
    publishedAt: Date | null
): Promise<number | null> {
    try {
        const accessToken = await getAccessToken(channelConfig);

        const startDate = publishedAt
            ? publishedAt.toISOString().split("T")[0]
            : "2020-01-01";
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const endDate = yesterday.toISOString().split("T")[0];

        const url = `https://youtubeanalytics.googleapis.com/v2/reports?` +
            `ids=channel==${channelConfig.channelId}` +
            `&startDate=${startDate}` +
            `&endDate=${endDate}` +
            `&dimensions=insightTrafficSourceType` +
            `&metrics=videoThumbnailImpressions,videoThumbnailImpressionsClickRate` +
            `&filters=video==${videoId}`;

        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[CTR] Failed for ${channelConfig.name} / ${videoId}: ${response.status} — ${errText}`);
            return null;
        }

        const data = await response.json();
        // rows: [[trafficSource, impressions, ctrDecimal], ...]
        if (data.rows && data.rows.length > 0) {
            let totalImpressions = 0;
            let totalClicks = 0;

            for (const row of data.rows) {
                const impressions = row[1] || 0;
                const ctrDecimal = row[2] || 0;
                totalImpressions += impressions;
                totalClicks += impressions * ctrDecimal;
            }

            if (totalImpressions > 0) {
                return parseFloat(((totalClicks / totalImpressions) * 100).toFixed(2));
            }
        }
        return null;
    } catch (error) {
        console.error(`[CTR] Error fetching CTR for video ${videoId}:`, error);
        return null;
    }
}

// Batch: get lifetime CTR for multiple videos
export async function batchGetLifetimeCTR(
    videoIds: string[],
    channelDetectionMap: Map<string, string>,
    publishDates: Map<string, Date | null>
): Promise<Map<string, number>> {
    const channels = getChannelConfigs();
    const results = new Map<string, number>();

    console.log(`[CTR Batch] Starting CTR fetch for ${videoIds.length} videos, ${channels.length} channel configs available`);

    const channelVideos = new Map<string, string[]>();
    for (const videoId of videoIds) {
        const chId = channelDetectionMap.get(videoId);
        if (!chId) continue;
        const existing = channelVideos.get(chId) || [];
        existing.push(videoId);
        channelVideos.set(chId, existing);
    }

    console.log(`[CTR Batch] ${channelVideos.size} channels with videos mapped`);

    let attempted = 0;
    let succeeded = 0;

    for (const [channelId, vids] of channelVideos.entries()) {
        const channelConfig = channels.find(c => c.channelId === channelId);
        if (!channelConfig) {
            console.warn(`[CTR Batch] No config found for channel ${channelId}, skipping ${vids.length} videos`);
            continue;
        }

        // Test with first video only to detect if metric is supported
        if (attempted === 0) {
            console.log(`[CTR Batch] Testing CTR fetch with first video: ${vids[0]} on channel ${channelConfig.name}`);
        }

        for (const vid of vids) {
            attempted++;
            const ctr = await getVideoLifetimeCTR(vid, channelConfig, publishDates.get(vid) || null);
            if (ctr !== null) {
                results.set(vid, ctr);
                succeeded++;
            }
        }
    }

    console.log(`[CTR Batch] Done: ${succeeded}/${attempted} videos got CTR values`);

    return results;
}

// Batch: get first 30 days views for multiple videos
export async function batchGetFirst30DaysViews(
    videoIds: string[],
    channelDetectionMap: Map<string, string>, // videoId -> channelId
    publishDates: Map<string, Date | null> // videoId -> publishedAt
): Promise<Map<string, number>> {
    const channels = getChannelConfigs();
    const results = new Map<string, number>();

    // Group videos by channel
    const channelVideos = new Map<string, string[]>();
    for (const videoId of videoIds) {
        const chId = channelDetectionMap.get(videoId);
        if (!chId) continue;
        const existing = channelVideos.get(chId) || [];
        existing.push(videoId);
        channelVideos.set(chId, existing);
    }

    // Fetch analytics per channel
    for (const [channelId, vids] of channelVideos.entries()) {
        const channelConfig = channels.find(c => c.channelId === channelId);
        if (!channelConfig) {
            console.warn(`No config found for channel ${channelId}`);
            continue;
        }

        // Fetch each video's analytics (Analytics API doesn't support batch video filters well)
        for (const vid of vids) {
            const views = await getFirst30DaysViews(vid, channelConfig, publishDates.get(vid) || null);
            if (views !== null) {
                results.set(vid, views);
            }
        }
    }

    return results;
}

/** Full calendar quarter in UTC — always first day through last day of quarter (e.g. Q1 = Jan 1–Mar 31). */
export function getFullQuarterDateStrings(
    year: number,
    quarter: number
): { startStr: string; endStr: string; label: string } {
    const q = Math.min(4, Math.max(1, Math.floor(quarter))) as 1 | 2 | 3 | 4;
    const monthStarts = [0, 3, 6, 9];
    const m0 = monthStarts[q - 1];
    const start = new Date(Date.UTC(year, m0, 1));
    const quarterEnd = new Date(Date.UTC(year, m0 + 3, 0));
    return {
        startStr: start.toISOString().split("T")[0],
        endStr: quarterEnd.toISOString().split("T")[0],
        label: `Q${q} ${year}`,
    };
}

/**
 * Calendar quarter in UTC, but end date is capped at **yesterday** (UTC) while the quarter is still in progress.
 * Use for YouTube Analytics API (incomplete “today”). Do **not** use for DB “published in quarter” filters.
 */
export function getQuarterDateStrings(
    year: number,
    quarter: number
): { startStr: string; endStr: string; label: string } {
    const { startStr, endStr: fullEndStr, label } = getFullQuarterDateStrings(year, quarter);

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    const endStr = fullEndStr < yesterdayStr ? fullEndStr : yesterdayStr;
    return {
        startStr,
        endStr: startStr > endStr ? startStr : endStr,
        label,
    };
}

/**
 * Calendar quarters to refresh on dashboard sync: from (UTC year − yearsBack) through the current UTC quarter (inclusive).
 * Aligns with the year range users can pick on the YouTube dashboard.
 */
export function getQuarterKeysToRefreshOnSync(now = new Date(), yearsBack = 5): { year: number; quarter: number }[] {
    const cy = now.getUTCFullYear();
    const cq = Math.floor(now.getUTCMonth() / 3) + 1;
    const yMin = cy - yearsBack;
    const out: { year: number; quarter: number }[] = [];
    for (let y = yMin; y <= cy; y++) {
        const qHi = y === cy ? cq : 4;
        for (let q = 1; q <= qHi; q++) {
            out.push({ year: y, quarter: q });
        }
    }
    return out;
}

/**
 * Total channel views between startStr and endStr (YYYY-MM-DD), YouTube Analytics API.
 * Returns null if the request fails (auth, quota, etc.).
 */
export async function getChannelViewsInRange(
    channel: ChannelConfig,
    startStr: string,
    endStr: string
): Promise<number | null> {
    try {
        if (!startStr || !endStr || startStr > endStr) return 0;

        console.log(`[YT Analytics] ${channel.name}: fetching views ${startStr} → ${endStr}`);

        let accessToken: string;
        try {
            accessToken = await getAccessToken(channel);
            console.log(`[YT Analytics] ${channel.name}: token OK`);
        } catch (tokenErr) {
            console.error(`[YT Analytics] ${channel.name}: TOKEN FAILED:`, tokenErr);
            return null;
        }

        // Fetch views broken down by content type so we can pick only LONG_FORM (videos, no Shorts/Live)
        const url =
            `https://youtubeanalytics.googleapis.com/v2/reports?` +
            `ids=channel==${channel.channelId}` +
            `&startDate=${startStr}` +
            `&endDate=${endStr}` +
            `&dimensions=creatorContentType` +
            `&metrics=views`;

        console.log(`[YT Analytics] ${channel.name}: requesting with creatorContentType dimension...`);
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok) {
            const err = await response.text();
            console.error(`[YT Analytics] ${channel.name}: creatorContentType FAILED (${response.status}):`, err);

            // Fallback: try without dimension (returns all content types combined)
            console.log(`[YT Analytics] ${channel.name}: trying fallback (no dimension)...`);
            const fallbackUrl =
                `https://youtubeanalytics.googleapis.com/v2/reports?` +
                `ids=channel==${channel.channelId}` +
                `&startDate=${startStr}` +
                `&endDate=${endStr}` +
                `&metrics=views`;
            const fbRes = await fetch(fallbackUrl, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (fbRes.ok) {
                const fbData = await fbRes.json();
                console.log(`[YT Analytics] ${channel.name}: fallback response:`, JSON.stringify(fbData));
                if (fbData.rows?.length > 0) {
                    const n = Number(fbData.rows[0][0]);
                    console.log(`[YT Analytics] ${channel.name}: fallback views = ${n} (includes all content types)`);
                    return Number.isFinite(n) ? n : 0;
                }
            } else {
                const fbErr = await fbRes.text();
                console.error(`[YT Analytics] ${channel.name}: FALLBACK ALSO FAILED (${fbRes.status}):`, fbErr);
            }
            return null;
        }

        const data = await response.json();
        console.log(`[YT Analytics] ${channel.name}: creatorContentType response rows:`, JSON.stringify(data.rows));

        // rows = [["videoOnDemand", views], ["shorts", views], ["liveStream", views]]
        // "videoOnDemand" = long-form videos in YouTube Analytics API
        if (data.rows && data.rows.length > 0) {
            const longFormRow = data.rows.find(
                (r: any[]) => r[0] === "videoOnDemand" || r[0] === "LONG_FORM"
            );
            if (longFormRow) {
                const n = typeof longFormRow[1] === "number" ? longFormRow[1] : Number(longFormRow[1]);
                console.log(`[YT Analytics] ${channel.name}: video views = ${n}`);
                return Number.isFinite(n) ? n : 0;
            }
            console.log(`[YT Analytics] ${channel.name}: no videoOnDemand row found in response`);
            return 0; // No long-form views in this period
        }
        return 0;
    } catch (error) {
        console.error(`[YT quarterly] ${channel.name}:`, error);
        return null;
    }
}

export type DailyViewPoint = { day: string; views: number; subscribersGained: number };

/**
 * Channel-level views + subscribers gained per calendar day (YouTube Analytics). Uses OAuth.
 * Columns returned by API: day, views, subscribersGained
 */
export async function getChannelDailyViewsSeries(
    channel: ChannelConfig,
    startStr: string,
    endStr: string
): Promise<DailyViewPoint[] | null> {
    try {
        if (!startStr || !endStr || startStr > endStr) return [];
        const accessToken = await getAccessToken(channel);
        const url =
            `https://youtubeanalytics.googleapis.com/v2/reports?` +
            `ids=channel==${channel.channelId}` +
            `&startDate=${startStr}` +
            `&endDate=${endStr}` +
            `&metrics=views,subscribersGained` +
            `&dimensions=day` +
            `&sort=day`;
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok) {
            console.error(`[YT daily] ${channel.name}:`, await response.text());
            return null;
        }
        const data = await response.json();
        const rows = data.rows as unknown[][] | undefined;
        if (!rows?.length) return [];
        // API columns: [day, views, subscribersGained]
        return rows.map((r) => ({
            day: String(r[0]),
            views: Number(r[1]) || 0,
            subscribersGained: Number(r[2]) || 0,
        }));
    } catch (error) {
        console.error(`[YT daily series] ${channel.name}:`, error);
        return null;
    }
}

export type UploadSnippet = { publishedAt: string; title: string; videoId: string };

/**
 * Batch-fetch current subscriber counts for multiple channels via YouTube Data API (API key only, no OAuth).
 * Returns a Map of channelId → subscriberCount. Channels with hidden subscriber counts are omitted.
 */
export async function getChannelSubscriberCounts(
    channelIds: string[]
): Promise<Map<string, number>> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey || channelIds.length === 0) return new Map();

    try {
        // Data API allows up to 50 IDs per request as comma-separated values
        const ids = channelIds.slice(0, 50).join(",");
        const res = await fetch(
            `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(ids)}&key=${encodeURIComponent(apiKey)}&maxResults=50`
        );
        if (!res.ok) return new Map();
        const data = await res.json();
        const result = new Map<string, number>();
        for (const item of data.items ?? []) {
            const stats = item?.statistics;
            if (!stats || stats.hiddenSubscriberCount) continue;
            const count = parseInt(stats.subscriberCount, 10);
            if (Number.isFinite(count)) result.set(item.id as string, count);
        }
        return result;
    } catch {
        return new Map();
    }
}

/**
 * Long-form uploads in a date range via YouTube Data API (API key). Newest-first pagination stops when older than range.
 */
export async function fetchChannelUploadsInRange(
    channelId: string,
    startStr: string,
    endStr: string
): Promise<UploadSnippet[]> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) return [];

    const startIso = `${startStr}T00:00:00.000Z`;
    const endIso = `${endStr}T23:59:59.999Z`;

    try {
        const chRes = await fetch(
            `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(apiKey)}`
        );
        if (!chRes.ok) return [];
        const chJson = await chRes.json();
        const uploadsPlaylistId = chJson.items?.[0]?.contentDetails?.relatedPlaylists?.uploads as string | undefined;
        if (!uploadsPlaylistId) return [];

        const out: UploadSnippet[] = [];
        let pageToken: string | undefined;
        let stop = false;

        do {
            const url =
                `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=50` +
                (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "") +
                `&key=${encodeURIComponent(apiKey)}`;
            const res = await fetch(url);
            if (!res.ok) break;
            const json = await res.json();
            const items = json.items as any[] | undefined;
            if (!items?.length) break;

            for (const item of items) {
                const publishedAt = item?.snippet?.publishedAt as string | undefined;
                const title = (item?.snippet?.title as string) || "Video";
                const videoId = item?.contentDetails?.videoId as string | undefined;
                if (!publishedAt || !videoId) continue;
                if (publishedAt > endIso) continue;
                if (publishedAt < startIso) {
                    stop = true;
                    break;
                }
                out.push({ publishedAt, title, videoId });
            }

            pageToken = json.nextPageToken as string | undefined;
        } while (pageToken && !stop);

        out.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
        return out;
    } catch (e) {
        console.error("[YT uploads list]", e);
        return [];
    }
}
