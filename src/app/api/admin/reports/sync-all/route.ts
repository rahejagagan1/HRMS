import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { calcBusinessDaysTat, formatTatDays } from "@/lib/utils";
import { getWeeklyReportPeriod, resolveWeeklyReportPeriodForDate } from "@/lib/reports/weekly-period";
import { getManagerReportFormat, isManagerReportEligible } from "@/lib/reports/manager-report-format";

export const dynamic = "force-dynamic";

/* ── helpers ── */
function resolveTat(sub: { tat?: any; startDate: Date | null; dateDone: Date | null }): string {
    if (sub.tat != null) { const n = Number(sub.tat); if (!isNaN(n)) return formatTatDays(n); }
    if (sub.startDate && sub.dateDone) return formatTatDays(calcBusinessDaysTat(sub.startDate, sub.dateDone));
    return "";
}
const isFirstDraft   = (n: string) => { const l = n.toLowerCase(); return (l.includes("script") && l.includes("first draft")) || (l.includes("scripting") && l.includes("draft")); };
const isRevision     = (n: string) => { const l = n.toLowerCase(); return (l.includes("script") && l.includes("revision")) || l.startsWith("revision"); };
const isEditing      = (n: string) => { const l = n.toLowerCase(); return l === "editing" || l === "video editing" || (l.includes("edit") && !l.includes("revision") && !l.includes("script") && !l.includes("re-edit")); };
const isEditRevision = (n: string) => { const l = n.toLowerCase(); return (l.includes("edit") && l.includes("revision")) || l.includes("re-edit") || l === "editing revision" || l.includes("video revision"); };

const toBigInt = (v: bigint | null | undefined): bigint => v != null ? BigInt(v.toString()) : BigInt(0);

/* ── POST /api/admin/reports/sync-all ── */
export async function POST() {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const now = new Date();
        const { year, monthIndex: month, week } = resolveWeeklyReportPeriodForDate(now);

        const managers = await prisma.user.findMany({
            where: {
                isActive: true,
                OR: [
                    { reportAccess: true },
                    { orgLevel: { in: ["hod", "manager", "hr_manager"] } },
                    { role: { in: ["production_manager", "researcher_manager", "hr_manager"] } },
                    { AND: [{ role: "qa" }, { orgLevel: { in: ["manager", "hod"] } }] },
                ],
            },
            select: { id: true, name: true, role: true, orgLevel: true, reportAccess: true },
        });

        const results: { managerId: number; name: string; weekly: string; monthly: string }[] = [];

        for (const mgr of managers) {
            if (!isManagerReportEligible(mgr)) continue;
            let weeklyStatus  = "skipped";
            let monthlyStatus = "skipped";
            const fmt = getManagerReportFormat(mgr);
            const isResearcher = fmt === "researcher";
            const isQa = fmt === "qa";

            /* ── WEEKLY ── */
            try {
                const existingWeekly = await prisma.weeklyReport.findUnique({
                    where: { managerId_reportTemplate_week_month_year: { managerId: mgr.id, reportTemplate: fmt, week, month, year } },
                });
                if (!existingWeekly?.isLocked) {
                    const period = getWeeklyReportPeriod(year, month, week);
                    if (!period) {
                        weeklyStatus = "skipped — week not in range for month";
                    } else {
                    const { weekStart, weekEnd } = period;

                    // Fetch writer cases
                    const writerCasesRaw = await prisma.case.findMany({
                        where: { writerUserId: { not: null }, subtasks: { some: { dateDone: { gte: weekStart, lte: weekEnd } } }, writer: { managerId: mgr.id, isActive: true } },
                        include: { writer: { select: { id: true, name: true } }, subtasks: { orderBy: [{ orderIndex: "asc" }, { dateCreated: "asc" }] } },
                        orderBy: { dateCreated: "asc" },
                    });
                    const writerRows = writerCasesRaw
                        .filter(c => {
                            const fd = c.subtasks.find(s => isFirstDraft(s.name));
                            const rv = c.subtasks.find(s => isRevision(s.name));
                            return (fd?.dateDone && fd.dateDone >= weekStart && fd.dateDone <= weekEnd) ||
                                   (rv?.dateDone && rv.dateDone >= weekStart && rv.dateDone <= weekEnd);
                        })
                        .map(c => {
                            const fd = c.subtasks.find(s => isFirstDraft(s.name)) ?? null;
                            const rv = c.subtasks.find(s => isRevision(s.name)) ?? null;
                            const fdInWeek = !!(fd?.dateDone && fd.dateDone >= weekStart && fd.dateDone <= weekEnd);
                            const rvInWeek = !!(rv?.dateDone && rv.dateDone >= weekStart && rv.dateDone <= weekEnd);
                            return {
                                writer:       c.writer?.name ?? "",
                                caseName:     c.name,
                                heroCase:     (c.caseType?.toLowerCase().includes("hero") || c.name?.toLowerCase().includes("hero")) ? "yes" : "no",
                                tatFirstDraft: fdInWeek && fd ? (resolveTat(fd) || "N/A") : "N/A",
                                tatRevision:   rvInWeek && rv ? (resolveTat(rv) || "N/A") : "N/A",
                                qualityScore:  c.writerQualityScore != null ? String(c.writerQualityScore) : "N/A",
                                scriptQualityRating: "",
                                reasonForRating: "",
                                structuralChanges: "",
                                autoFilled: true,
                            };
                        });

                    // Fetch editor cases
                    const editorCasesRaw = await prisma.case.findMany({
                        where: { editorUserId: { not: null }, subtasks: { some: { dateDone: { gte: weekStart, lte: weekEnd } } }, editor: { managerId: mgr.id, isActive: true } },
                        include: { editor: { select: { id: true, name: true } }, subtasks: { orderBy: [{ orderIndex: "asc" }, { dateCreated: "asc" }] } },
                        orderBy: { dateCreated: "asc" },
                    });
                    const editorRows = editorCasesRaw
                        .filter(c => {
                            const ed = c.subtasks.find(s => isEditing(s.name));
                            const rv = c.subtasks.find(s => isEditRevision(s.name));
                            return (ed?.dateDone && ed.dateDone >= weekStart && ed.dateDone <= weekEnd) ||
                                   (rv?.dateDone && rv.dateDone >= weekStart && rv.dateDone <= weekEnd);
                        })
                        .map(c => {
                            const ed = c.subtasks.find(s => isEditing(s.name)) ?? null;
                            const rv = c.subtasks.find(s => isEditRevision(s.name)) ?? null;
                            const edInWeek = !!(ed?.dateDone && ed.dateDone >= weekStart && ed.dateDone <= weekEnd);
                            const rvInWeek = !!(rv?.dateDone && rv.dateDone >= weekStart && rv.dateDone <= weekEnd);
                            return {
                                editor:       c.editor?.name ?? "",
                                caseName:     c.name,
                                heroCase:     (c.caseType?.toLowerCase().includes("hero") || c.name?.toLowerCase().includes("hero")) ? "yes" : "no",
                                tatEditing:   edInWeek && ed ? (resolveTat(ed) || "N/A") : "N/A",
                                tatRevision:  rvInWeek && rv ? (resolveTat(rv) || "N/A") : "N/A",
                                qualityScore: (c as any).editorQualityScore != null ? String((c as any).editorQualityScore) : "N/A",
                                videoQualityRating: "",
                                reasonForRating: "",
                                autoFilled: true,
                            };
                        });

                    await prisma.weeklyReport.upsert({
                        where:  { managerId_reportTemplate_week_month_year: { managerId: mgr.id, reportTemplate: fmt, week, month, year } },
                        create: { managerId: mgr.id, reportTemplate: fmt, week, month, year, writerRows, editorRows, isLocked: false },
                        update: { writerRows, editorRows },
                    });
                    weeklyStatus = `synced (${writerRows.length} writers, ${editorRows.length} editors)`;
                    }
                } else {
                    weeklyStatus = "locked — skipped";
                }
            } catch (e: any) {
                weeklyStatus = `error: ${e.message}`;
            }

            /* ── MONTHLY ── */
            try {
                const existingMonthly = await prisma.monthlyReport.findUnique({
                    where: { managerId_reportTemplate_month_year: { managerId: mgr.id, reportTemplate: fmt, month, year } },
                });
                if (!existingMonthly?.isLocked) {
                    const monthStart = new Date(year, month, 1);
                    const monthEnd   = new Date(year, month + 1, 0, 23, 59, 59, 999);

                    if (isResearcher) {
                        // Researcher stats
                        const researchers = await prisma.user.findMany({
                            where: { managerId: mgr.id, isActive: true, role: "researcher" },
                            select: { id: true, name: true },
                        });
                        const cases = await prisma.case.findMany({
                            where: { researcherUserId: { in: researchers.map(r => r.id) }, statusType: "done", dateDone: { gte: monthStart, lte: monthEnd } },
                            select: { researcherUserId: true, caseRating: true },
                        });
                        const grouped: Record<number, { count: number; ratings: number[] }> = {};
                        for (const c of cases) {
                            if (!c.researcherUserId) continue;
                            if (!grouped[c.researcherUserId]) grouped[c.researcherUserId] = { count: 0, ratings: [] };
                            grouped[c.researcherUserId].count++;
                            if (c.caseRating != null) grouped[c.researcherUserId].ratings.push(Number(c.caseRating));
                        }
                        const nishantResearcherRows = researchers.map(r => {
                            const g = grouped[r.id];
                            const ratings = g?.ratings ?? [];
                            return {
                                id: `r-${r.id}`,
                                researcher: r.name,
                                approvedCasesRTC: String(g?.count ?? 0),
                                avgRating: ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : "",
                                approvedCasesFOIA: "", targetRTC: "", expectedFOIA: "", actualFOIAPitched: "", foiaReceived: "", overallRemarks: "",
                                autoFilled: true,
                            };
                        });
                        await prisma.monthlyReport.upsert({
                            where:  { managerId_reportTemplate_month_year: { managerId: mgr.id, reportTemplate: fmt, month, year } },
                            create: { managerId: mgr.id, reportTemplate: fmt, month, year, nishantResearcherRows, isLocked: false },
                            update: { nishantResearcherRows },
                        });
                        monthlyStatus = `synced researcher manager (${nishantResearcherRows.length} researchers)`;

                    } else if (isQa) {
                        // Capsule views (andrewDRows)
                        const fallbackCases = await prisma.case.findMany({
                            where: { youtubeStats: { isNot: null }, channel: { not: null } },
                            select: { channel: true, youtubeStats: { select: { last30DaysViews: true } } },
                        });
                        const viewMap = new Map<string, bigint>();
                        for (const c of fallbackCases) {
                            if (!c.channel) continue;
                            const l30 = toBigInt(c.youtubeStats?.last30DaysViews);
                            if (l30 > BigInt(0)) viewMap.set(c.channel, (viewMap.get(c.channel) ?? BigInt(0)) + l30);
                        }
                        const andrewSCRows = Array.from(viewMap.entries())
                            .filter(([, v]) => v > BigInt(0))
                            .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
                            .map(([channel, v], i) => ({ id: `sc-auto-${i}`, capsule: channel, currentMonthViews: String(v), lastMonthViews: "", remark: "", autoFilled: true }));

                        // Thumbnails (andrewCRows)
                        const thumbSubtasks = await prisma.subtask.findMany({
                            where: { name: { contains: "Thumbnail", mode: "insensitive" }, dateDone: { gte: monthStart, lte: monthEnd } },
                            select: { assignee: { select: { name: true } } },
                        });
                        const thumbCount = new Map<string, number>();
                        for (const s of thumbSubtasks) { const n = s.assignee?.name; if (n) thumbCount.set(n, (thumbCount.get(n) ?? 0) + 1); }
                        const andrewSBRows = Array.from(thumbCount.entries())
                            .map(([person, count], i) => ({ id: `sb-auto-${i}`, person, thumbnailsDone: String(count), avgCtr: "", remark: "", autoFilled: true }));

                        await prisma.monthlyReport.upsert({
                            where:  { managerId_reportTemplate_month_year: { managerId: mgr.id, reportTemplate: fmt, month, year } },
                            create: { managerId: mgr.id, reportTemplate: fmt, month, year, andrewCRows: andrewSBRows as any, andrewDRows: andrewSCRows as any, isLocked: false },
                            update: { andrewCRows: andrewSBRows as any, andrewDRows: andrewSCRows as any },
                        });
                        monthlyStatus = `synced QA manager (${andrewSCRows.length} channels, ${andrewSBRows.length} thumbnail persons)`;
                    } else {
                        monthlyStatus = "no auto-fill data for this manager type";
                    }
                } else {
                    monthlyStatus = "locked — skipped";
                }
            } catch (e: any) {
                monthlyStatus = `error: ${e.message}`;
            }

            results.push({ managerId: mgr.id, name: mgr.name ?? "", weekly: weeklyStatus, monthly: monthlyStatus });
        }

        return NextResponse.json({ ok: true, year, month, week, results });
    } catch (error) {
        return serverError(error, "sync-all");
    }
}
