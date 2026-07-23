import prisma from "@/lib/prisma";
import { detectVideoChannel, batchGetFirst30DaysViews, getChannelConfigs } from "./youtube-analytics";

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// Extract YouTube video ID from various URL formats
export function extractVideoId(url: string): string | null {
    if (!url) return null;
    const patterns = [
        /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
        /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

// Get current YT API mode from database
async function getYtApiMode(): Promise<"data_api" | "analytics_api"> {
    try {
        const config = await prisma.syncConfig.findUnique({ where: { key: "yt_api_mode" } });
        return (config?.value as string) === "analytics_api" ? "analytics_api" : "data_api";
    } catch {
        return "data_api";
    }
}

export async function syncYoutubeStats(): Promise<number> {
    if (!YOUTUBE_API_KEY) {
        throw new Error("YOUTUBE_API_KEY environment variable is not set");
    }

    const mode = await getYtApiMode();

    // Get all cases with video links (check both youtubeVideoUrl and finalVideoLink)
    const cases = await prisma.case.findMany({
        where: {
            OR: [
                { youtubeVideoUrl: { not: null } },
                { finalVideoLink: { not: null } },
            ],
        },
        select: { id: true, youtubeVideoUrl: true, finalVideoLink: true },
    });

    // Extract video IDs — prefer youtubeVideoUrl, fallback to finalVideoLink
    const caseVideoMap: { caseId: number; videoId: string; url: string }[] = [];
    for (const c of cases) {
        const url = c.youtubeVideoUrl || c.finalVideoLink;
        if (!url) continue;
        const videoId = extractVideoId(url);
        if (videoId) {
            caseVideoMap.push({ caseId: c.id, videoId, url });
        }
    }

    if (caseVideoMap.length === 0) return 0;

    // Detect channels for analytics features (first-30-day views)
    let first30Map = new Map<string, number>();
    const channelDetectionMap = new Map<string, string>();
    const publishDates = new Map<string, Date | null>();
    const hasChannelConfigs = getChannelConfigs().length > 0;

    if (hasChannelConfigs) {
        console.log("[YouTube Sync] Detecting channels for analytics...");

        for (let i = 0; i < caseVideoMap.length; i += 50) {
            const batch = caseVideoMap.slice(i, i + 50);
            const ids = batch.map(b => b.videoId).join(",");

            try {
                const res = await fetch(
                    `https://www.googleapis.com/youtube/v3/videos?id=${ids}&part=snippet&key=${YOUTUBE_API_KEY}`
                );
                const data = await res.json();
                for (const item of data.items || []) {
                    if (item.snippet?.channelId) {
                        channelDetectionMap.set(item.id, item.snippet.channelId);
                    }
                    publishDates.set(item.id, item.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : null);
                }
            } catch (err) {
                console.error("Channel detection batch error:", err);
            }
        }

        console.log(`[YouTube Sync] Detected channels for ${channelDetectionMap.size} videos`);

        // First-30-day views only in analytics_api mode
        if (mode === "analytics_api") {
            const existingStats = await prisma.youtubeStats.findMany({
                where: { caseId: { in: caseVideoMap.map(c => c.caseId) }, last30DaysViews: { not: null } },
                select: { youtubeVideoId: true, last30DaysViews: true },
            });
            const alreadyFetchedSet = new Set(existingStats.map(s => s.youtubeVideoId));

            const now = new Date();
            const videosNeedingFirst30 = caseVideoMap
                .map(c => c.videoId)
                .filter(vid => {
                    const pubDate = publishDates.get(vid);
                    if (!pubDate) return true;
                    const daysSincePublish = Math.floor((now.getTime() - pubDate.getTime()) / (1000 * 60 * 60 * 24));
                    if (daysSincePublish > 35 && alreadyFetchedSet.has(vid)) {
                        return false;
                    }
                    return true;
                });

            console.log(`[YouTube Sync] ${caseVideoMap.length - videosNeedingFirst30.length} videos skipped (older than 35 days, first-30-day views already stored)`);

            if (videosNeedingFirst30.length > 0) {
                first30Map = await batchGetFirst30DaysViews(
                    videosNeedingFirst30,
                    channelDetectionMap,
                    publishDates
                );
            }
            console.log(`[YouTube Sync] Got first-30-day views for ${first30Map.size} videos`);
        }
    }

    let count = 0;

    // Batch Data API calls for views/title (max 50 IDs per request)
    for (let i = 0; i < caseVideoMap.length; i += 50) {
        const batch = caseVideoMap.slice(i, i + 50);
        const ids = batch.map((b) => b.videoId).join(",");

        try {
            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/videos?id=${ids}&part=statistics,snippet&key=${YOUTUBE_API_KEY}`
            );

            if (!response.ok) {
                console.error(`YouTube API error: ${response.status} ${response.statusText}`);
                continue;
            }

            const data = await response.json();

            for (const item of data.items || []) {
                const caseEntry = batch.find((b) => b.videoId === item.id);
                if (!caseEntry) continue;

                try {
                    const first30Days = first30Map.get(item.id);

                    const viewCountBig = BigInt(item.statistics?.viewCount || 0);
                    const likeCountBig = BigInt(item.statistics?.likeCount || 0);

                    await prisma.youtubeStats.upsert({
                        where: { caseId: caseEntry.caseId },
                        create: {
                            caseId: caseEntry.caseId,
                            youtubeVideoId: item.id,
                            videoUrl: caseEntry.url,
                            videoTitle: item.snippet?.title || null,
                            viewCount: viewCountBig,
                            likeCount: likeCountBig,
                            commentCount: BigInt(item.statistics?.commentCount || 0),
                            last30DaysViews: first30Days !== undefined ? BigInt(first30Days) : null,
                            publishedAt: item.snippet?.publishedAt
                                ? new Date(item.snippet.publishedAt)
                                : null,
                            lastFetchedAt: new Date(),
                        },
                        update: {
                            videoUrl: caseEntry.url,
                            videoTitle: item.snippet?.title || null,
                            viewCount: viewCountBig,
                            likeCount: likeCountBig,
                            commentCount: BigInt(item.statistics?.commentCount || 0),
                            ...(first30Days !== undefined ? { last30DaysViews: BigInt(first30Days) } : {}),
                            lastFetchedAt: new Date(),
                        },
                    });

                    // Daily snapshot
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);

                    const existingStats = await prisma.youtubeStats.findUnique({
                        where: { caseId: caseEntry.caseId },
                    });

                    if (existingStats) {
                        await prisma.youtubeStatsHistory.upsert({
                            where: {
                                youtubeStatsId_snapshotDate: {
                                    youtubeStatsId: existingStats.id,
                                    snapshotDate: today,
                                },
                            },
                            create: {
                                youtubeStatsId: existingStats.id,
                                snapshotDate: today,
                                viewCount: BigInt(item.statistics?.viewCount || 0),
                                likeCount: BigInt(item.statistics?.likeCount || 0),
                            },
                            update: {
                                viewCount: BigInt(item.statistics?.viewCount || 0),
                                likeCount: BigInt(item.statistics?.likeCount || 0),
                            },
                        });
                    }

                    count++;
                } catch (error) {
                    console.error(
                        `Error upserting YouTube stats for case ${caseEntry.caseId}:`,
                        error
                    );
                }
            }
        } catch (error) {
            console.error(`Error fetching YouTube batch:`, error);
        }
    }

    return count;
}
