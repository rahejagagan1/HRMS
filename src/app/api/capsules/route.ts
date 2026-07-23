import { requireAuth, serverError } from "@/lib/api-auth";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export async function GET() {
    const { errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    try {
        // Get selected list IDs from admin config
        const config = await prisma.syncConfig.findUnique({ where: { key: "selected_lists" } });
        const selectedListIds: string[] = config?.value ? (config.value as string[]) : [];

        if (selectedListIds.length === 0) {
            return NextResponse.json([]);
        }

        // Fetch the production lists that are selected for sync
        const lists = await prisma.productionList.findMany({
            where: { clickupListId: { in: selectedListIds } },
            select: {
                id: true,
                name: true,
                capsule: { select: { shortName: true, name: true } },
            },
            orderBy: { name: "asc" },
        });

        // Return with capsule shortName as a label
        const result = lists.map(l => ({
            id: l.id,
            name: l.name,
            capsule: l.capsule?.shortName || l.capsule?.name || null,
        }));

        return NextResponse.json(result);
    } catch (error) {
        return serverError(error, "route");
    }
}
