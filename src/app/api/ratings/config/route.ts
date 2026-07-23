import { serverError } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serializeBigInt } from "@/lib/utils";

export const dynamic = "force-dynamic";

function hasDeveloperAccess(session: any): boolean {
    const user = session?.user as any;
    const isDev = process.env.NODE_ENV === "development" && user?.role === "admin";
    return user?.isDeveloper === true || isDev;
}

// GET /api/ratings/config — Get all rating config + channel baselines
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!hasDeveloperAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const configs = await prisma.ratingConfig.findMany({
            orderBy: { key: "asc" },
        });

        const baselines = await prisma.channelBaseline.findMany({
            orderBy: { channelName: "asc" },
        });

        // Get list of unique channels from cases for reference
        const channels = await prisma.case.findMany({
            where: { channel: { not: null } },
            select: { channel: true },
            distinct: ["channel"],
        });

        return NextResponse.json(
            serializeBigInt({
                configs: configs.reduce((acc: any, c: any) => {
                    acc[c.key] = c.value;
                    return acc;
                }, {}),
                baselines,
                availableChannels: channels.map((c: any) => c.channel).filter(Boolean),
            })
        );
    } catch (error) {
        console.error("Rating config GET error:", error);
        return serverError(error, "route");
    }
}

// PUT /api/ratings/config — Update rating config or channel baselines
export async function PUT(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasDeveloperAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const body = await request.json();
        const { type, key, value, channelName, baselineViews } = body;

        if (type === "config") {
            // Update a RatingConfig entry
            if (!key || value === undefined) {
                return NextResponse.json(
                    { error: "Missing key or value" },
                    { status: 400 }
                );
            }

            const updated = await prisma.ratingConfig.upsert({
                where: { key },
                create: { key, value },
                update: { value },
            });

            return NextResponse.json(serializeBigInt({ success: true, config: updated }));
        }

        if (type === "baseline") {
            // Update a channel baseline
            if (!channelName || baselineViews === undefined) {
                return NextResponse.json(
                    { error: "Missing channelName or baselineViews" },
                    { status: 400 }
                );
            }

            const updated = await prisma.channelBaseline.upsert({
                where: { channelName },
                create: { channelName, baselineViews: BigInt(baselineViews) },
                update: { baselineViews: BigInt(baselineViews) },
            });

            return NextResponse.json(serializeBigInt({ success: true, baseline: updated }));
        }

        if (type === "delete_baseline") {
            if (!channelName) {
                return NextResponse.json(
                    { error: "Missing channelName" },
                    { status: 400 }
                );
            }
            await prisma.channelBaseline.delete({
                where: { channelName },
            });
            return NextResponse.json({ success: true });
        }

        return NextResponse.json(
            { error: "Invalid type. Use 'config', 'baseline', or 'delete_baseline'" },
            { status: 400 }
        );
    } catch (error) {
        console.error("Rating config PUT error:", error);
        return serverError(error, "route");
    }
}
