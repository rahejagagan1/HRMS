import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Synced Capsules (ClickUp folders) and ProductionLists for admin dropdowns / validation.
 * Managers usually pick a **list**; whole-capsule options include every list in that folder.
 * GET — authenticated users only.
 */
export async function GET() {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const [capsules, productionLists] = await Promise.all([
            prisma.capsule.findMany({
                select: { id: true, name: true, shortName: true, clickupFolderId: true },
                orderBy: { name: "asc" },
            }),
            prisma.productionList.findMany({
                select: {
                    id: true,
                    name: true,
                    capsule: { select: { id: true, name: true, shortName: true } },
                },
                orderBy: [{ capsule: { name: "asc" } }, { name: "asc" }],
            }),
        ]);

        return NextResponse.json({ capsules, productionLists });
    } catch (error) {
        return serverError(error, "capsules/catalog");
    }
}
