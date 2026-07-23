import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { invalidateCache } from "@/lib/cache";

export const dynamic = 'force-dynamic';
import { runFullSync } from "@/lib/clickup/sync-engine";
import { syncYoutubeStats } from "@/lib/youtube/sync";
import { calculateMonthlyRatings } from "@/lib/ratings/calculator";

export const maxDuration = 300;

export async function POST() {
    const log = await prisma.syncLog.create({
        data: { syncType: "all", status: "running" },
    });

    const errors: string[] = [];
    let totalSynced = 0;

    try {
        // Step 1: ClickUp sync
        const clickupResults = await runFullSync();
        totalSynced += clickupResults.tasks;
    } catch (error) {
        errors.push(`ClickUp sync: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        // Step 2: YouTube sync
        const ytCount = await syncYoutubeStats();
        totalSynced += ytCount;
    } catch (error) {
        errors.push(`YouTube sync: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        // Step 3: Ratings
        const ratingCount = await calculateMonthlyRatings();
        totalSynced += ratingCount;
    } catch (error) {
        errors.push(`Ratings: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Clear API cache so dashboards fetch fresh data after sync
    invalidateCache();

    await prisma.syncLog.update({
        where: { id: log.id },
        data: {
            status: errors.length > 0 ? "partial" : "success",
            recordsSynced: totalSynced,
            errorsCount: errors.length,
            errorDetails: errors.length > 0 ? errors : undefined,
            completedAt: new Date(),
        },
    });

    return NextResponse.json({
        success: errors.length === 0,
        recordsSynced: totalSynced,
        errors,
    });
}
