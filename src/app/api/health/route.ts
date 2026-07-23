import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Liveness + readiness probe for load balancers and uptime monitors.
 *
 *   GET /api/health  →  200 if the app is up AND the DB is reachable
 *                       503 if the DB is down (so traffic is routed away)
 *
 * No auth on purpose — uptime monitors shouldn't need credentials.
 * Single `SELECT 1` so the check is cheap.
 */
export async function GET() {
    const start = Date.now();
    const noStore = { "Cache-Control": "no-store, max-age=0" };
    try {
        await prisma.$queryRaw`SELECT 1`;
        return NextResponse.json(
            {
                status: "ok",
                db: "up",
                latencyMs: Date.now() - start,
                uptimeSec: Math.round(process.uptime()),
                timestamp: new Date().toISOString(),
            },
            { status: 200, headers: noStore }
        );
    } catch (e: any) {
        return NextResponse.json(
            {
                status: "degraded",
                db: "down",
                error: e?.message || "DB unreachable",
                latencyMs: Date.now() - start,
                uptimeSec: Math.round(process.uptime()),
                timestamp: new Date().toISOString(),
            },
            { status: 503, headers: noStore }
        );
    }
}
