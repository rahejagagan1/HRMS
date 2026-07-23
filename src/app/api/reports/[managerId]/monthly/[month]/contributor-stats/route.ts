import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { getMonthlyReportWindow } from "@/lib/reports/monthly-window";
import { resolveReportTeam, teamFunction } from "@/lib/reports/team-snapshot";

export const dynamic = "force-dynamic";

type Params = Promise<{ managerId: string; month: string }>;
// Reporting window: 4th of month M through end of day 3 of month M+1. See
// src/lib/reports/monthly-window.ts for the canonical definition.

export async function GET(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;


        const { managerId: managerIdRaw, month: monthRaw } = await params;
        const managerId = parseInt(managerIdRaw);
        const monthIndex = parseInt(monthRaw); // 0-based
        const year = parseInt(req.nextUrl.searchParams.get("year") ?? "");

        if (isNaN(managerId) || isNaN(monthIndex) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const { windowStart, windowEnd } = getMonthlyReportWindow(year, monthIndex);

        // Get all team members (editors + writers) — prefer the frozen
        // teamSnapshot on locked reports so contributors who later moved
        // managers still appear under the period they were rated for.
        const manager = await prisma.user.findUnique({ where: { id: managerId }, select: { id: true } });
        if (!manager) {
            return NextResponse.json({ error: "Manager not found" }, { status: 404 });
        }
        const team = await resolveReportTeam(managerId, { kind: "monthly", month: monthIndex, year });
        const editorWriters = team.filter((m) => teamFunction(m) === "editor" || teamFunction(m) === "writer");
        const editorIds = editorWriters.filter((m) => teamFunction(m) === "editor").map((m) => m.id);
        const writerIds = editorWriters.filter((m) => teamFunction(m) === "writer").map((m) => m.id);

        if (editorIds.length === 0 && writerIds.length === 0) {
            return NextResponse.json({
                editorStats: {}, writerStats: {},
                editorCases: {}, writerCases: {},
            });
        }

        // Find the Editing/Scripting subtasks finished in this month (with grace)
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

        const [editorCaseRows, writerCaseRows] = await Promise.all([
            editorCaseIds.length
                ? prisma.case.findMany({
                    where: { id: { in: editorCaseIds }, editorUserId: { in: editorIds } },
                    select: { id: true, name: true, editorUserId: true, editorQualityScore: true },
                    orderBy: { name: "asc" },
                })
                : Promise.resolve([] as { id: number; name: string; editorUserId: number | null; editorQualityScore: number | null }[]),
            writerCaseIds.length
                ? prisma.case.findMany({
                    where: { id: { in: writerCaseIds }, writerUserId: { in: writerIds } },
                    select: { id: true, name: true, writerUserId: true, writerQualityScore: true },
                    orderBy: { name: "asc" },
                })
                : Promise.resolve([] as { id: number; name: string; writerUserId: number | null; writerQualityScore: number | null }[]),
        ]);

        // Group case names per editor / writer (with quality score for inline display).
        const editorCases: Record<number, { id: number; name: string; qualityScore: number | null }[]> = {};
        const writerCases: Record<number, { id: number; name: string; qualityScore: number | null }[]> = {};

        for (const c of editorCaseRows) {
            if (c.editorUserId == null) continue;
            (editorCases[c.editorUserId] ??= []).push({ id: c.id, name: c.name, qualityScore: c.editorQualityScore });
        }
        for (const c of writerCaseRows) {
            if (c.writerUserId == null) continue;
            (writerCases[c.writerUserId] ??= []).push({ id: c.id, name: c.name, qualityScore: c.writerQualityScore });
        }

        // Build count maps from the case lists so count and names always agree.
        const editorStats: Record<number, number> = {};
        const writerStats: Record<number, number> = {};
        for (const [uid, list] of Object.entries(editorCases)) editorStats[Number(uid)] = list.length;
        for (const [uid, list] of Object.entries(writerCases)) writerStats[Number(uid)] = list.length;

        return NextResponse.json({ editorStats, writerStats, editorCases, writerCases });
    } catch (error) {
        return serverError(error, "contributor-stats");
    }
}
