import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getChannelConfigs } from "@/lib/youtube/youtube-analytics";
import { serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET: return current YT API mode and channel info
export async function GET() {
    try {
        const config = await prisma.syncConfig.findUnique({ where: { key: "yt_api_mode" } });
        const mode = (config?.value as string) || "data_api";
        const channels = getChannelConfigs().map(c => ({ name: c.name, channelId: c.channelId }));
        return NextResponse.json({ mode, channels });
    } catch (error) {
        return serverError(error, "admin/yt-settings GET");
    }
}

// POST: save YT API mode toggle
export async function POST(request: NextRequest) {
    try {
        const { mode } = await request.json();
        if (!["data_api", "analytics_api"].includes(mode)) {
            return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
        }

        await prisma.syncConfig.upsert({
            where: { key: "yt_api_mode" },
            create: { key: "yt_api_mode", value: mode },
            update: { value: mode },
        });

        return NextResponse.json({ success: true, mode });
    } catch (error) {
        return serverError(error, "admin/yt-settings POST");
    }
}
