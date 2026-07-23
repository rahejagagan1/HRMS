/** Shared helpers for admin Team / list dropdowns (capsule + production list). */

export type TeamCapsuleCatalog = {
    capsules: { id: number; name: string; shortName: string | null }[];
    productionLists: {
        id: number;
        name: string;
        capsule: { id: number; name: string; shortName: string | null };
    }[];
};

export function teamCapsuleToSelectionKey(
    tc: string | null | undefined,
    c: TeamCapsuleCatalog | null,
): string {
    if (!c || !tc?.trim()) return "";
    const t = tc.trim().toLowerCase();
    const list = c.productionLists.find((l) => l.name.toLowerCase() === t);
    if (list) return `l:${list.id}`;
    const cap = c.capsules.find((x) => x.name.toLowerCase() === t);
    if (cap) return `c:${cap.id}`;
    return "";
}

export function teamCapsuleSelectionKeyToName(
    key: string,
    c: TeamCapsuleCatalog | null,
): string | null {
    if (!c || !key) return null;
    if (key.startsWith("l:")) {
        const id = parseInt(key.slice(2), 10);
        if (Number.isNaN(id)) return null;
        return c.productionLists.find((l) => l.id === id)?.name ?? null;
    }
    if (key.startsWith("c:")) {
        const id = parseInt(key.slice(2), 10);
        if (Number.isNaN(id)) return null;
        return c.capsules.find((x) => x.id === id)?.name ?? null;
    }
    return null;
}
