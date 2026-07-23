import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';
import { syncUsers } from "@/lib/clickup/sync-engine";

export async function POST() {
    try {
        const log = await prisma.syncLog.create({
            data: { syncType: "users", status: "running" },
        });

        const count = await syncUsers();

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
