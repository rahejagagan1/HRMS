import prisma from "@/lib/prisma";
import { isHRAdmin } from "@/lib/access";

// ClientUser shape matches the parameter type of `isHRAdmin` in @/lib/access.
// Kept inline (rather than imported) because the type is not exported.
type ViewerLike = Parameters<typeof isHRAdmin>[0];

/**
 * Per-channel visibility filter for the dashboard view-targets tile.
 *
 * Mapping (confirmed by HR on 2026-06-12):
 *   • M7      + M7CS    → capsules C1, C2, C5  (Tanya / Manpreet / Abhishek)
 *   • Echo 3D            → capsule 3D          (Sreyasi)
 *   • Bodycam            → capsule C4          (Bhoomika)
 *
 * A viewer can see a channel iff:
 *   1. They pass `isHRAdmin` (CEO + HR-admin + Developer + Special Access)
 *      — always-bypass for management oversight.
 *   2. Their own `User.teamCapsule` label ends with one of the allowed
 *      suffixes (lead themselves).
 *   3. Their direct manager (`managerId` or `inlineManagerId`) is a user
 *      whose `teamCapsule` ends with one of the allowed suffixes.
 *
 * The teamCapsule values in the DB look like "01. Tanya C1" / "03. Sreyasi 3D";
 * we strip to the last whitespace-separated token (C1 / C2 / C5 / 3D / C4)
 * for matching so the display label can evolve without breaking visibility.
 */

// channelId → set of capsule suffixes that grant visibility.
// The id strings are the YouTube channel IDs from YOUTUBE_CHANNELS.
const CHANNEL_CAPSULES: Record<string, ReadonlySet<string>> = {
    // M7
    "UCjRdMPERN1T0LwAtnshS9UQ": new Set(["C1", "C2", "C5"]),
    // M7CS
    "UC7_MOIpN8fn_UZAivnn10_Q": new Set(["C1", "C2", "C5"]),
    // Echo 3D — accept both "3D" (current label) and "C3" (likely future
    // rename when the lead-name format is normalised).
    "UCKfvp0tC2RL6qBDZSsPYn4g": new Set(["3D", "C3"]),
    // Bodycam
    "UCWuhiF3rWQ7gZgpaTh-4tIg": new Set(["C4"]),
};

/**
 * Designations that always see every channel (no capsule filter).
 *
 *   • "Executive Assistant" (Palak Dhiman) — coordinates across all
 *     brands/capsules on behalf of leadership.
 *   • "Associate Operations Head" (Aditi Tiwari) — Operations leadership
 *     oversees every channel's targets, so she gets full cross-channel
 *     visibility regardless of capsule placement (she has no teamCapsule
 *     of her own, and the capsule filter would otherwise hide the panel).
 *
 * Compared case-insensitively against EmployeeProfile.designation.
 * Add more designations here as policy evolves; one-line change.
 */
const BYPASS_DESIGNATIONS: ReadonlySet<string> = new Set([
    "executive assistant",
    "associate operations head",
]);

function suffixOf(capsule: string | null | undefined): string | null {
    if (!capsule) return null;
    const trimmed = capsule.trim();
    if (!trimmed) return null;
    const parts = trimmed.split(/\s+/);
    const last = parts[parts.length - 1];
    return last ? last.toUpperCase() : null;
}

/**
 * Returns the channelIds (from the supplied list) that the user is
 * allowed to see, given their org position. Always-bypass for
 * isHRAdmin viewers — they see everything. Channels not present in
 * CHANNEL_CAPSULES are visible by default (no rule = no filter).
 */
export async function filterVisibleChannels<T extends { channelId: string }>(
    user: ViewerLike,
    channels: T[],
): Promise<T[]> {
    if (channels.length === 0) return channels;
    if (isHRAdmin(user)) return channels;

    // Resolve viewer's own + direct managers' teamCapsule labels in
    // a single query. user.id is the User PK (ClientUser carries it
    // via NextAuth session).
    // Under our credentials login `session.user.id` is undefined — the DB
    // user id lives on `session.user.dbId` (set by the auth session
    // callback + ensured by requireAuth). Reading `.id` left `userId` null,
    // so this fell into the fail-closed branch below and returned ZERO
    // capsule-gated channels for everyone except isHRAdmin — i.e. team
    // members saw an EMPTY targets tile. Prefer dbId, fall back to id.
    const ids = user as { dbId?: number | string; id?: number | string };
    const userIdRaw = ids.dbId ?? ids.id;
    const userId = typeof userIdRaw === "number"
        ? userIdRaw
        : typeof userIdRaw === "string" && /^\d+$/.test(userIdRaw)
            ? parseInt(userIdRaw, 10)
            : null;
    if (!Number.isFinite(userId) || userId == null || userId <= 0) {
        // Can't identify the viewer — fail closed so they only see
        // channels without a visibility rule.
        return channels.filter((c) => !CHANNEL_CAPSULES[c.channelId]);
    }

    const rows = await prisma.$queryRawUnsafe<Array<{ teamCapsule: string | null; designation: string | null }>>(
        `SELECT cap."teamCapsule", ep.designation
           FROM "User" me
      LEFT JOIN "User" mgr  ON mgr.id = me."managerId"
      LEFT JOIN "User" inl  ON inl.id = me."inlineManagerId"
      LEFT JOIN "EmployeeProfile" ep ON ep."userId" = me.id
      JOIN LATERAL (VALUES (me."teamCapsule"), (mgr."teamCapsule"), (inl."teamCapsule"))
           AS cap("teamCapsule") ON TRUE
          WHERE me.id = $1`,
        userId,
    );

    // Designation-based bypass — fires before the capsule filter so an
    // EA / equivalent sees every channel regardless of org placement.
    const designation = rows.find((r) => r.designation)?.designation?.trim().toLowerCase();
    if (designation && BYPASS_DESIGNATIONS.has(designation)) return channels;
    // Researchers (any "…Researcher…" / "Research Manager" designation) get
    // org-wide channel visibility so they can see every channel's targets,
    // regardless of which capsule they're assigned to.
    if (designation && designation.includes("research")) return channels;

    const mySuffixes = new Set(
        rows.map((r) => suffixOf(r.teamCapsule)).filter((s): s is string => s != null),
    );

    return channels.filter((c) => {
        const allowed = CHANNEL_CAPSULES[c.channelId];
        if (!allowed) return true; // no rule for this channel → visible to everyone
        for (const s of mySuffixes) if (allowed.has(s)) return true;
        return false;
    });
}
