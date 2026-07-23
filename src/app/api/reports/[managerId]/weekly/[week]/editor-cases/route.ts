import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { calcBusinessDaysTat, formatTatDays } from "@/lib/utils";
import { getWeeklyReportPeriod } from "@/lib/reports/weekly-period";
import { resolveReportTeam, teamFunction } from "@/lib/reports/team-snapshot";

export const dynamic = "force-dynamic";

type Params = Promise<{ managerId: string; week: string }>;
/** Use DB-stored TAT if present, otherwise calculate on the fly. */
function resolveSubtaskTat(sub: { tat?: any; startDate: Date | null; dateDone: Date | null }): string {
    if (sub.tat !== null && sub.tat !== undefined) {
        const n = Number(sub.tat);
        if (!isNaN(n)) return formatTatDays(n);
    }
    if (sub.startDate && sub.dateDone) {
        const days = calcBusinessDaysTat(sub.startDate, sub.dateDone);
        return formatTatDays(days);
    }
    return "";
}

/** Match subtask names for the first editing pass */
function isEditingSubtask(name: string): boolean {
    const n = name.toLowerCase();
    return (
        n === "editing" ||
        n === "video editing" ||
        (n.includes("edit") && !n.includes("revision") && !n.includes("script") && !n.includes("re-edit"))
    );
}

/** Match subtask names for editing revision */
function isEditingRevisionSubtask(name: string): boolean {
    const n = name.toLowerCase();
    return (
        (n.includes("edit") && n.includes("revision")) ||
        n.includes("re-edit") ||
        n === "editing revision" ||
        n.includes("video revision")
    );
}

export async function GET(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;


        const { managerId: managerIdRaw, week: weekRaw } = await params;
        const managerId = parseInt(managerIdRaw);
        const week      = parseInt(weekRaw);
        const month     = parseInt(req.nextUrl.searchParams.get("month") ?? "");
        const year      = parseInt(req.nextUrl.searchParams.get("year")  ?? "");

        if (isNaN(managerId) || isNaN(week) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const period = getWeeklyReportPeriod(year, month, week);
        if (!period) {
            return NextResponse.json({ error: "Invalid week for this month" }, { status: 400 });
        }
        const { weekStart, weekEnd } = period;

        // Editors under this manager — prefer the locked report's team
        // snapshot so a user who edited cases in this week still appears
        // even if they later moved managers. Falls back to live team
        // for drafts / legacy reports.
        const manager = await prisma.user.findUnique({ where: { id: managerId }, select: { id: true } });
        if (!manager) {
            return NextResponse.json({ error: "Manager not found" }, { status: 404 });
        }
        const team = await resolveReportTeam(managerId, { kind: "weekly", week, month, year });
        const editors = team.filter((m) => teamFunction(m) === "editor");
        const editorIds = editors.map((m) => m.id);
        if (editorIds.length === 0) {
            return NextResponse.json({ editorCases: [] });
        }
        const editorIdSet = new Set(editorIds);
        const editorNameById = new Map(editors.map((e) => [e.id, e.name]));

        // Same approach as writer-cases: a case qualifies when EITHER
        // a milestone subtask was completed in-week OR a milestone is
        // currently in progress (startDate set, dateDone null — covers
        // started-this-week + earlier-week carryover). Each branch is
        // additionally constrained to team editors via SubtaskAssignee,
        // Subtask.assigneeUserId, or Case.editorUserId.
        const cases = await prisma.case.findMany({
            where: {
                OR: [
                    // Branch A: a milestone subtask was completed in-week.
                    {
                        subtasks: { some: { dateDone: { gte: weekStart, lte: weekEnd } } },
                        OR: [
                            { subtasks: { some: { dateDone: { gte: weekStart, lte: weekEnd }, assignees: { some: { userId: { in: editorIds } } } } } },
                            { subtasks: { some: { dateDone: { gte: weekStart, lte: weekEnd }, assigneeUserId: { in: editorIds } } } },
                            { editorUserId: { in: editorIds } },
                        ],
                    },
                    // Branch B: a milestone subtask is currently in progress.
                    {
                        subtasks: { some: { startDate: { not: null }, dateDone: null } },
                        OR: [
                            { subtasks: { some: { startDate: { not: null }, dateDone: null, assignees: { some: { userId: { in: editorIds } } } } } },
                            { subtasks: { some: { startDate: { not: null }, dateDone: null, assigneeUserId: { in: editorIds } } } },
                            { editorUserId: { in: editorIds } },
                        ],
                    },
                ],
            },
            include: {
                editor: { select: { id: true, name: true } },
                subtasks: {
                    orderBy: [
                        { orderIndex: "asc" },
                        { dateCreated: "asc" },
                    ],
                    include: {
                        assignees: { select: { userId: true, user: { select: { name: true } } } },
                    },
                },
            },
            orderBy: { dateCreated: "asc" },
        });

        const editorCases: any[] = [];

        for (const c of cases) {
            const editingSub  = c.subtasks.find((s) => isEditingSubtask(s.name)) ?? null;
            const revisionSub = c.subtasks.find((s) => isEditingRevisionSubtask(s.name)) ?? null;

            // Two relevance flags per milestone: done-in-week (existing
            // behaviour) and in-progress (started, not yet done).
            const editDoneInWeek = !!editingSub?.dateDone &&
                editingSub.dateDone >= weekStart && editingSub.dateDone <= weekEnd;
            const editInProgress = !!editingSub?.startDate && !editingSub.dateDone;
            const revDoneInWeek  = !!revisionSub?.dateDone &&
                revisionSub.dateDone >= weekStart && revisionSub.dateDone <= weekEnd;
            const revInProgress  = !!revisionSub?.startDate && !revisionSub.dateDone;

            const editRelevant = editDoneInWeek || editInProgress;
            const revRelevant  = revDoneInWeek  || revInProgress;
            if (!editRelevant && !revRelevant) continue;

            // Per-milestone assignee resolution (in team only). Same
            // priority for both done-in-week and in-progress states:
            // SubtaskAssignee → Subtask.assigneeUserId → Case.editorUserId.
            const editAssignees = new Set<number>();
            if (editRelevant && editingSub) {
                for (const a of editingSub.assignees) {
                    if (editorIdSet.has(a.userId)) {
                        editAssignees.add(a.userId);
                        if (a.user?.name) editorNameById.set(a.userId, a.user.name);
                    }
                }
                if (editAssignees.size === 0 && editingSub.assigneeUserId && editorIdSet.has(editingSub.assigneeUserId)) {
                    editAssignees.add(editingSub.assigneeUserId);
                }
                if (editAssignees.size === 0 && c.editorUserId && editorIdSet.has(c.editorUserId)) {
                    editAssignees.add(c.editorUserId);
                }
            }
            const revAssignees = new Set<number>();
            if (revRelevant && revisionSub) {
                for (const a of revisionSub.assignees) {
                    if (editorIdSet.has(a.userId)) {
                        revAssignees.add(a.userId);
                        if (a.user?.name) editorNameById.set(a.userId, a.user.name);
                    }
                }
                if (revAssignees.size === 0 && revisionSub.assigneeUserId && editorIdSet.has(revisionSub.assigneeUserId)) {
                    revAssignees.add(revisionSub.assigneeUserId);
                }
                if (revAssignees.size === 0 && c.editorUserId && editorIdSet.has(c.editorUserId)) {
                    revAssignees.add(c.editorUserId);
                }
            }

            const credited = new Set<number>([...editAssignees, ...revAssignees]);
            if (credited.size === 0) continue;

            // TAT per milestone:
            //   • done-in-week → computed (DB value or on-the-fly).
            //   • in-progress  → literal "In progress" (no dateDone).
            //   • otherwise    → "N/A".
            let tatEditingCase = "N/A";
            if (editDoneInWeek && editingSub) {
                tatEditingCase = resolveSubtaskTat(editingSub) || "N/A";
            } else if (editInProgress) {
                tatEditingCase = "In progress";
            }
            let tatRevisionCase = "N/A";
            if (revDoneInWeek && revisionSub) {
                const t = resolveSubtaskTat(revisionSub) ||
                    (revisionSub.dateDone && editingSub?.dateDone
                        ? formatTatDays(calcBusinessDaysTat(editingSub.dateDone, revisionSub.dateDone))
                        : "");
                tatRevisionCase = t || "N/A";
            } else if (revInProgress) {
                tatRevisionCase = "In progress";
            }

            const isHero = !!(
                c.caseType?.toLowerCase().includes("hero") ||
                c.name?.toLowerCase().includes("hero")
            );
            const qualityScore =
                (c as any).editorQualityScore !== null && (c as any).editorQualityScore !== undefined
                    ? String((c as any).editorQualityScore)
                    : "N/A";

            for (const eid of credited) {
                const onEdit = editAssignees.has(eid);
                const onRev  = revAssignees.has(eid);
                const subtaskName =
                    (onEdit && editingSub?.name)  ||
                    (onRev  && revisionSub?.name) || "";

                editorCases.push({
                    editorId:   eid,
                    editorName: editorNameById.get(eid) ?? (c.editor?.id === eid ? c.editor?.name : "") ?? "",
                    caseName:   c.name,
                    caseStatus: c.status ?? "",
                    heroCase:   isHero ? "yes" : "no",
                    subtaskName,
                    tatEditing: onEdit ? tatEditingCase : "N/A",
                    tatRevision: onRev ? tatRevisionCase : "N/A",
                    qualityScore,
                });
            }
        }

        return NextResponse.json({ editorCases });
    } catch (error) {
        return serverError(error, "editor-cases");
    }
}
