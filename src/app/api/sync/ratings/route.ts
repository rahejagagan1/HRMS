import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';
import { calculateMonthlyRatings } from "@/lib/ratings/calculator";

export async function POST() {
    try {
        const log = await prisma.syncLog.create({
            data: { syncType: "ratings", status: "running" },
        });

        const count = await calculateMonthlyRatings();

        await prisma.syncLog.update({
            where: { id: log.id },
            data: { status: "success", recordsSynced: count, completedAt: new Date() },
        });

        return NextResponse.json({ success: true, recordsSynced: count });
    } catch (error) {
        return NextResponse.json(
            { success: false, error: "Sync failed" },
            { status: 500 }
        );
    }
}
