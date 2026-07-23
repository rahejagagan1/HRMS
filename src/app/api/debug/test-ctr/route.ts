import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getChannelConfigs } from "@/lib/youtube/youtube-analytics";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const channels = getChannelConfigs();
        if (channels.length === 0) return NextResponse.json({ error: "No channel configs" });

        const ch = channels[0];
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: ch.clientId, client_secret: ch.clientSecret,
                refresh_token: ch.refreshToken, grant_type: "refresh_token",
            }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) return NextResponse.json({ error: "Token failed", tokenData });

        const token = tokenData.access_token;

        // Check what scopes this token has
        const tokenInfoRes = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${token}`);
        const tokenInfo = await tokenInfoRes.json();

        const end = new Date(); end.setDate(end.getDate() - 1);
        const endDate = end.toISOString().split("T")[0];

        const testStats = await prisma.youtubeStats.findFirst({
            where: { publishedAt: { not: null } },
            orderBy: { publishedAt: "desc" },
            select: { youtubeVideoId: true, publishedAt: true },
        });
        if (!testStats) return NextResponse.json({ error: "No videos" });

        const vid = testStats.youtubeVideoId;
        const base = `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==${ch.channelId}&startDate=2025-01-01&endDate=${endDate}`;

        const tests: Record<string, any> = {};

        const queries = [
            { name: "1_views_with_traffic_dim", url: `${base}&dimensions=insightTrafficSourceType&metrics=views&filters=video==${vid}` },
            { name: "2_views+thumbnail_with_traffic_dim", url: `${base}&dimensions=insightTrafficSourceType&metrics=views,videoThumbnailImpressions&filters=video==${vid}` },
            { name: "3_thumbnail+ctr_with_traffic_dim", url: `${base}&dimensions=insightTrafficSourceType&metrics=videoThumbnailImpressions,videoThumbnailImpressionsClickRate&filters=video==${vid}` },
            { name: "4_thumbnail+ctr_no_video_filter", url: `${base}&dimensions=insightTrafficSourceType&metrics=videoThumbnailImpressions,videoThumbnailImpressionsClickRate` },
        ];

        for (const q of queries) {
            const r = await fetch(q.url, { headers: { Authorization: `Bearer ${token}` } });
            const b = await r.json();
            tests[q.name] = {
                status: r.status,
                ok: r.ok,
                rowCount: b.rows?.length ?? 0,
                sampleRows: b.rows?.slice(0, 3),
                errorMsg: b.error?.message?.substring(0, 200),
            };
        }

        return NextResponse.json({
            channel: ch.name,
            channelId: ch.channelId,
            videoId: vid,
            tokenScopes: tokenInfo.scope || tokenInfo,
            tests,
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
