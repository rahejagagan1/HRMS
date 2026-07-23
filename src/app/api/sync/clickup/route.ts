import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';
import { runFullSync } from "@/lib/clickup/sync-engine";

export const maxDuration = 300; // 5 minutes for Vercel

export async function POST() {
    try {
        const log = await prisma.syncLog.create({
            data: { syncType: "clickup", status: "running" },
        });

        const results = await runFullSync();
        const totalSynced =
            results.spaces + results.capsules + results.lists + results.tasks;

        await prisma.syncLog.update({
            where: { id: log.id },
            data: {
                status: "success",
                recordsSynced: totalSynced,
                completedAt: new Date(),
            },
        });

        return NextResponse.json({ success: true, results });
    } catch (error) {
        return NextResponse.json(
            { success: false, error: "Sync failed" },
            { status: 500 }
        );
    }
}
