import prisma from "@/lib/prisma";

/** Normalize admin "Team / capsule" field for matching `Capsule.name` / `shortName`. */
export function normalizeTeamCapsuleInput(s: string | null | undefined): string {
    return (s ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Resolve a free-text token to ProductionList rows (synced from ClickUp).
 * Exact match on list name first, then substring contains on name.
 */
export async function findProductionListsMatchingTeamInput(
    token: string,
): Promise<{ id: number; name: string; capsuleId: number | null }[]> {
    const q = normalizeTeamCapsuleInput(token);
    if (!q) return [];

    const exact = await prisma.productionList.findMany({
        where: { name: { equals: q, mode: "insensitive" } },
        select: { id: true, name: true, capsuleId: true },
        orderBy: { name: "asc" },
    });
    if (exact.length > 0) return exact;

    return prisma.productionList.findMany({
        where: { name: { contains: q, mode: "insensitive" } },
        select: { id: true, name: true, capsuleId: true },
        orderBy: { name: "asc" },
    });
}

/**
 * Resolve a free-text token to Capsule rows (synced from ClickUp).
 * Exact match on name/shortName first, then substring contains.
 */
export async function findCapsulesMatchingTeamCapsule(
    token: string,
): Promise<{ id: number; name: string; shortName: string | null }[]> {
    const q = normalizeTeamCapsuleInput(token);
    if (!q) return [];

    const exact = await prisma.capsule.findMany({
        where: {
            OR: [
                { name: { equals: q, mode: "insensitive" } },
                { shortName: { equals: q, mode: "insensitive" } },
            ],
        },
        select: { id: true, name: true, shortName: true },
        orderBy: { name: "asc" },
    });
    if (exact.length > 0) return exact;

    return prisma.capsule.findMany({
        where: {
            OR: [
                { name: { contains: q, mode: "insensitive" } },
                { shortName: { contains: q, mode: "insensitive" } },
            ],
        },
        select: { id: true, name: true, shortName: true },
        orderBy: { name: "asc" },
    });
}

/**
 * Validate and canonicalize `User.teamCapsule` for storage.
 * Prefer a synced **production list** name (what managers work with), then a **capsule** folder name.
 */
export async function resolveTeamCapsuleForSave(
    raw: string | null | undefined,
): Promise<{ ok: true; value: string | null } | { ok: false; error: string }> {
    if (raw === undefined || raw === null || String(raw).trim() === "") {
        return { ok: true, value: null };
    }
    const lists = await findProductionListsMatchingTeamInput(String(raw));
    if (lists.length > 0) {
        return { ok: true, value: lists[0].name };
    }
    const caps = await findCapsulesMatchingTeamCapsule(String(raw));
    if (caps.length === 0) {
        const q = normalizeTeamCapsuleInput(String(raw));
        return {
            ok: false,
            error: `No production list or capsule matches "${q}". Pick a row from the admin list (synced from ClickUp).`,
        };
    }
    return { ok: true, value: caps[0].name };
}
