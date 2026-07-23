import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { serverError } from "@/lib/api-auth";

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

function extractVideoId(url: string): string | null {
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

export async function POST(request: NextRequest) {
    try {
        if (!YOUTUBE_API_KEY) {
            return NextResponse.json({ error: "YOUTUBE_API_KEY not configured" }, { status: 500 });
        }

        const { url } = await request.json();
        if (!url) {
            return NextResponse.json({ error: "Video URL is required" }, { status: 400 });
        }

        const videoId = extractVideoId(url);
        if (!videoId) {
            return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
        }

        // Fetch from YouTube Data API
        const apiUrl = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=statistics,snippet&key=${YOUTUBE_API_KEY}`;
        const res = await fetch(apiUrl);
        const data = await res.json();

        if (!data.items || data.items.length === 0) {
            return NextResponse.json({ error: "Video not found" }, { status: 404 });
        }

        const video = data.items[0];
        const stats = video.statistics;
        const snippet = video.snippet;

        // Upsert into database
        const saved = await prisma.ytVideoLookup.upsert({
            where: { youtubeVideoId: videoId },
            create: {
                youtubeVideoId: videoId,
                videoUrl: url,
                title: snippet.title,
                viewCount: BigInt(stats.viewCount || 0),
                likeCount: stats.likeCount ? BigInt(stats.likeCount) : null,
                commentCount: stats.commentCount ? BigInt(stats.commentCount) : null,
                publishedAt: snippet.publishedAt ? new Date(snippet.publishedAt) : null,
                fetchedAt: new Date(),
            },
            update: {
                videoUrl: url,
                title: snippet.title,
                viewCount: BigInt(stats.viewCount || 0),
                likeCount: stats.likeCount ? BigInt(stats.likeCount) : null,
                commentCount: stats.commentCount ? BigInt(stats.commentCount) : null,
                fetchedAt: new Date(),
            },
        });

        return NextResponse.json(serializeBigInt(saved));
    } catch (error) {
        return serverError(error, "admin/yt-views");
    }
}

// GET: return all saved video lookups
export async function GET() {
    try {
        const videos = await prisma.ytVideoLookup.findMany({
            orderBy: { fetchedAt: "desc" },
        });
        return NextResponse.json(serializeBigInt(videos));
    } catch (error) {
        return serverError(error, "admin/yt-views");
    }
}
