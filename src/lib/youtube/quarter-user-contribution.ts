import type { UserRole } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isEditingFirstDraftMilestone, isWriterFirstDraftMilestone } from "@/lib/clickup/subtask-milestones";
import type { ChannelConfig } from "@/lib/youtube/youtube-analytics";

export type MeQuarterContribution = {
    videoCount: number;
    viewsOnVideos: number;
};

export function normalizeChannelNameKey(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function isManagerLikeRole(role: UserRole): boolean {
    return (
        role === "manager" ||
        role === "production_manager" ||
        role === "lead" ||
        role === "sub_lead" ||
        role === "hr_manager" ||
        role === "researcher_manager"
    );
}

/**
 * Case IDs that count toward this user's YouTube contribution for the quarter,
 * using role-specific completion rules (subtasks vs main task dateDone).
 */
async function eligibleCaseIdsForUserQuarter(
    userId: number,
    role: UserRole,
    quarterStart: Date,
    quarterEnd: Date
): Promise<number[]> {
    const ids = new Set<number>();

    if (role === "editor") {
        const subs = await prisma.subtask.findMany({
            where: {
                dateDone: { gte: quarterStart, lte: quarterEnd },
                case: { editorUserId: userId, isArchived: false },
            },
            select: { caseId: true, name: true },
        });
        for (const s of subs) {
            if (isEditingFirstDraftMilestone(s.name)) ids.add(s.caseId);
        }
        return [...ids];
    }

    if (role === "writer") {
        const subs = await prisma.subtask.findMany({
            where: {
                dateDone: { gte: quarterStart, lte: quarterEnd },
                case: { writerUserId: userId, isArchived: false },
            },
            select: { caseId: true, name: true },
        });
        for (const s of subs) {
            if (isWriterFirstDraftMilestone(s.name)) ids.add(s.caseId);
        }
        return [...ids];
    }

    if (role === "researcher") {
        const rows = await prisma.case.findMany({
            where: {
                researcherUserId: userId,
                dateDone: { gte: quarterStart, lte: quarterEnd },
                isArchived: false,
            },
            select: { id: true },
        });
        return rows.map((r) => r.id);
    }

    if (isManagerLikeRole(role)) {
        const rows = await prisma.case.findMany({
            where: {
                assigneeUserId: userId,
                dateDone: { gte: quarterStart, lte: quarterEnd },
                isArchived: false,
            },
            select: { id: true },
        });
        return rows.map((r) => r.id);
    }

    const rows = await prisma.case.findMany({
        where: {
            assigneeUserId: userId,
            dateDone: { gte: quarterStart, lte: quarterEnd },
            isArchived: false,
        },
        select: { id: true },
    });
    return rows.map((r) => r.id);
}

async function persistContributions(
    userId: number,
    year: number,
    quarter: number,
    byChannelId: Map<string, MeQuarterContribution>
): Promise<void> {
    const delegate = (prisma as unknown as { youtubeDashUserQuarterChannel?: { deleteMany: (args: { where: object }) => Promise<unknown>; createMany: (args: { data: object[] }) => Promise<unknown> } }).youtubeDashUserQuarterChannel;
    if (!delegate || typeof delegate.deleteMany !== "function") return;

    await delegate.deleteMany({ where: { userId, year, quarter } });

    const rows = [...byChannelId.entries()].map(([channelId, v]) => ({
        userId,
        channelId,
        year,
        quarter,
        videoCount: v.videoCount,
        viewsSum: BigInt(Math.max(0, Math.round(v.viewsOnVideos))),
    }));
    if (rows.length === 0) return;
    await delegate.createMany({ data: rows });
}

/**
 * Per configured YouTube channel: videos that count for this user in the quarter (role rules)
 * and sum of YoutubeStats.viewCount. Results are written to YoutubeDashUserQuarterChannel.
 */
export async function getUserQuarterContributionsByChannelId(
    userId: number,
    year: number,
    quarter: number,
    quarterStart: Date,
    quarterEnd: Date,
    configs: ChannelConfig[]
): Promise<Map<string, MeQuarterContribution>> {
    const out = new Map<string, MeQuarterContribution>();
    for (const c of configs) {
        out.set(c.channelId, { videoCount: 0, viewsOnVideos: 0 });
    }
    if (configs.length === 0) return out;

    const nameNormToChannelId = new Map<string, string>();
    for (const c of configs) {
        nameNormToChannelId.set(normalizeChannelNameKey(c.name), c.channelId);
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
    });
    if (!user) return out;

    const caseIds = await eligibleCaseIdsForUserQuarter(userId, user.role, quarterStart, quarterEnd);
    if (caseIds.length === 0) {
        await persistContributions(userId, year, quarter, out).catch((e) =>
            console.error("[quarter-user-contribution] persist:", e)
        );
        return out;
    }

    const cases = await prisma.case.findMany({
        where: {
            id: { in: caseIds },
            channel: { not: null },
            isArchived: false,
        },
        select: {
            id: true,
            channel: true,
            youtubeStats: { select: { viewCount: true } },
        },
    });

    for (const row of cases) {
        const raw = row.channel?.trim();
        if (!raw) continue;
        const channelId = nameNormToChannelId.get(normalizeChannelNameKey(raw));
        if (!channelId) continue;
        const cur = out.get(channelId)!;
        cur.videoCount += 1;
        const v = row.youtubeStats?.viewCount;
        if (v != null) cur.viewsOnVideos += Number(v);
    }

    await persistContributions(userId, year, quarter, out).catch((e) =>
        console.error("[quarter-user-contribution] persist:", e)
    );

    return out;
}
