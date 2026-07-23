import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { getMonthlyReportWindow } from "@/lib/reports/monthly-window";
import { resolveReportTeam, teamFunction } from "@/lib/reports/team-snapshot";

export const dynamic = "force-dynamic";

type Params = Promise<{ managerId: string; month: string }>;

// GET /api/reports/{managerId}/monthly/{month}/eligible-cases?year=Y
//
// Returns the universe of cases a manager could pick from when using
// "+ Add case" in Section 3. Broader than contributor-stats — that one is
// scoped to "auto-detected cases per team member"; this one returns ALL
// cases the manager's team could have worked on in the reporting window,
// so a manager can credit one of their reports for work that was missed
// or mis-attributed by the auto-detector.
//
// Scope:
//   - role=editor → cases with an "Editing" subtask done in the window,
//     where Case.editorUserId is in the manager's team
//   - role=writer → cases with a "Scripting" subtask done in the window,
//     where Case.writerUserId is in the manager's team
//
// Per-case payload: id, name, qualityScore (role-appropriate), currentOwnerName.
export async function GET(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const { managerId: managerIdRaw, month: monthRaw } = await params;
        const managerId  = parseInt(managerIdRaw);
        const monthIndex = parseInt(monthRaw);
        const year       = parseInt(req.nextUrl.searchParams.get("year") ?? "");

        if (isNaN(managerId) || isNaN(monthIndex) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const { windowStart, windowEnd } = getMonthlyReportWindow(year, monthIndex);

        const manager = await prisma.user.findUnique({ where: { id: managerId }, select: { id: true } });
        if (!manager) return NextResponse.json({ error: "Manager not found" }, { status: 404 });

        // Prefer the frozen team snapshot on locked reports so a user who
        // was on the team in month M still appears here even if they
        // later switched managers. Falls back to live `User.managerId`
        // for drafts and for legacy locked rows that pre-date snapshots.
        const team = await resolveReportTeam(managerId, { kind: "monthly", month: monthIndex, year });
        const editorIds = team.filter((m) => teamFunction(m) === "editor").map((m) => m.id);
        const writerIds = team.filter((m) => teamFunction(m) === "writer").map((m) => m.id);

        // Resolve the team's caseIds via the relevant subtask kind done in window.
        const [editingSubtasks, scriptingSubtasks] = await Promise.all([
            editorIds.length
                ? prisma.subtask.findMany({
                    where: {
                        name: { contains: "Editing", mode: "insensitive" },
                        status: { in: ["done", "complete", "closed"] },
                        dateDone: { gte: windowStart, lte: windowEnd },
                    },
                    select: { caseId: true },
                })
                : Promise.resolve([] as { caseId: number }[]),
            writerIds.length
                ? prisma.subtask.findMany({
                    where: {
                        name: { contains: "Scripting", mode: "insensitive" },
                        status: { in: ["done", "complete", "closed"] },
                        dateDone: { gte: windowStart, lte: windowEnd },
                    },
                    select: { caseId: true },
                })
                : Promise.resolve([] as { caseId: number }[]),
        ]);

        const editorCaseIds = [...new Set(editingSubtasks.map((s) => s.caseId))];
        const writerCaseIds = [...new Set(scriptingSubtasks.map((s) => s.caseId))];

        const [editorRows, writerRows] = await Promise.all([
            editorCaseIds.length
                ? prisma.case.findMany({
                    where: { id: { in: editorCaseIds }, editorUserId: { in: editorIds } },
                    select: {
                        id: true,
                        name: true,
                        editorQualityScore: true,
                        editor: { select: { name: true } },
                    },
                    orderBy: { name: "asc" },
                })
                : Promise.resolve([] as any[]),
            writerCaseIds.length
                ? prisma.case.findMany({
                    where: { id: { in: writerCaseIds }, writerUserId: { in: writerIds } },
                    select: {
                        id: true,
                        name: true,
                        writerQualityScore: true,
                        writer: { select: { name: true } },
                    },
                    orderBy: { name: "asc" },
                })
                : Promise.resolve([] as any[]),
        ]);

        const editorCases = editorRows.map((c: any) => ({
            id:               c.id,
            name:             c.name,
            qualityScore:     c.editorQualityScore,
            currentOwnerName: c.editor?.name ?? null,
        }));
        const writerCases = writerRows.map((c: any) => ({
            id:               c.id,
            name:             c.name,
            qualityScore:     c.writerQualityScore,
            currentOwnerName: c.writer?.name ?? null,
        }));

        return NextResponse.json({ editorCases, writerCases });
    } catch (e) {
        return serverError(e, "eligible-cases");
    }
}
