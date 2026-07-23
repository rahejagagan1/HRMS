import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";
import { notifyUsers, brandCeoIdForEmployee } from "@/lib/notifications";
import { writeSnapshot as writeReportTeamSnapshot } from "@/lib/reports/team-snapshot";
import { devEmailRecipientsClause } from "@/lib/email/toggles";
import { getManagerReportFormat, REPORT_TEMPLATE_IDS } from "@/lib/reports/manager-report-format";
import { findReportRow, upsertReportRow, deleteReportRow, WEEKLY_JSONB } from "@/lib/reports/report-store";

export const dynamic = "force-dynamic";

type Params = Promise<{ managerId: string; week: string }>;

// Resolve the report template for a write: the explicit ?template= / body.template
// when valid, else the manager's legacy-derived format (back-compat).
async function resolveTemplate(managerId: number, raw: unknown): Promise<string> {
    if (typeof raw === "string" && (REPORT_TEMPLATE_IDS as string[]).includes(raw)) return raw;
    const mgr = await prisma.user.findUnique({ where: { id: managerId }, select: { role: true, orgLevel: true, name: true } });
    return mgr ? getManagerReportFormat(mgr) : "production";
}

/* ── GET — load weekly report ── */
export async function GET(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const { managerId: managerIdRaw, week: weekRaw } = await params;
        const managerId = parseInt(managerIdRaw);
        const week      = parseInt(weekRaw);
        const month     = parseInt(req.nextUrl.searchParams.get("month") ?? "");
        const year      = parseInt(req.nextUrl.searchParams.get("year")  ?? "");
        const template  = req.nextUrl.searchParams.get("template");

        if (isNaN(managerId) || isNaN(week) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const report = await findReportRow("WeeklyReport", managerId, template, { week, month, year });
        if (!report) return NextResponse.json({ submitted: false, locked: false, data: null });

        // Return named columns; fall back to legacy dataJson for old records
        const data = (report.writerRows || report.editorRows || report.overviewRows || report.researcherRows || report.viewsRows || report.shortsRows)
            ? {
                writerRows:     report.writerRows,
                editorRows:     report.editorRows,
                researcherRows: report.researcherRows,
                overviewRows:   report.overviewRows,
                viewsRows:      report.viewsRows,
                shortsRows:     report.shortsRows,
              }
            : report.dataJson; // legacy fallback

        return NextResponse.json({
            submitted: true,
            locked:    report.isLocked,
            data,
            reportId:  report.id,
        });
    } catch (error) {
        return serverError(error, "route");
    }
}

/* ── DELETE — delete an unlocked (draft) weekly report ── */
export async function DELETE(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const { managerId: managerIdRaw, week: weekRaw } = await params;
        const managerId = parseInt(managerIdRaw);
        const week      = parseInt(weekRaw);
        const month     = parseInt(req.nextUrl.searchParams.get("month") ?? "");
        const year      = parseInt(req.nextUrl.searchParams.get("year")  ?? "");
        const template  = req.nextUrl.searchParams.get("template");

        if (isNaN(managerId) || isNaN(week) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const report = await findReportRow("WeeklyReport", managerId, template, { week, month, year });
        if (!report) {
            return NextResponse.json({ error: "Report not found" }, { status: 404 });
        }
        if (report.isLocked) {
            return NextResponse.json({ error: "Cannot delete a submitted report. Ask an admin to unlock it first." }, { status: 403 });
        }

        await deleteReportRow("WeeklyReport", managerId, report.reportTemplate ?? template, { week, month, year });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverError(error, "reports/weekly DELETE");
    }
}

/* ── POST — save draft or submit (and lock) the weekly report ── */
export async function POST(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const { managerId: managerIdRaw, week: weekRaw } = await params;
        const managerId = parseInt(managerIdRaw);
        const week      = parseInt(weekRaw);
        const body      = await req.json();
        const { month, year, isDraft, writerRows, editorRows, researcherRows, overviewRows, viewsRows, shortsRows } = body;

        if (isNaN(managerId) || isNaN(week) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const shouldLock = !isDraft;
        const reportTemplate = await resolveTemplate(managerId, body.template);

        const existing = await findReportRow("WeeklyReport", managerId, reportTemplate, { week, month, year });
        if (existing?.isLocked) {
            return NextResponse.json({ error: "Report is locked. Ask an admin to unlock it first." }, { status: 403 });
        }

        const values: Record<string, unknown> = {
            writerRows:     writerRows     ?? null,  // Section A1
            editorRows:     editorRows     ?? null,  // Section A2
            researcherRows: researcherRows ?? null,  // Section A3 / Andrew Section C
            overviewRows:   overviewRows   ?? null,  // Section B
            viewsRows:      viewsRows      ?? null,  // Andrew Section D
            shortsRows:     shortsRows     ?? null,  // Andrew Section E (YT Shorts)
            isLocked:       shouldLock,
        };
        // Only stamp submittedAt on lock; drafts keep the existing value (or the
        // DB default now() on first insert) — column omitted from the upsert.
        if (shouldLock) values.submittedAt = new Date();

        const reportId = await upsertReportRow(
            "WeeklyReport",
            { managerId, reportTemplate, week, month, year },
            values,
            WEEKLY_JSONB
        );

        // Freeze the team roster onto the report when it transitions to locked.
        if (shouldLock) {
            try {
                await writeReportTeamSnapshot(managerId, { kind: "weekly", week, month, year, template: reportTemplate });
            } catch (e) {
                console.warn("[weekly POST] snapshot write failed:", e);
            }
        }

        // Notify CEO / HR / admins / developers / special-access only when LOCKED.
        if (shouldLock) {
            try {
                const devClause = await devEmailRecipientsClause();
                const [manager, recipients, ceoRecipient] = await Promise.all([
                    prisma.user.findUnique({ where: { id: managerId }, select: { name: true } }),
                    prisma.user.findMany({
                        where: {
                            isActive: true,
                            orgLevel: { not: "ceo" },
                            OR: [
                                { orgLevel: "special_access" },
                                { role: "hr_manager" },
                                ...devClause,
                            ],
                        },
                        select: { id: true },
                    }),
                    brandCeoIdForEmployee(managerId),
                ]);
                const periodLabel = `Week ${week}, ${month}/${year}`;
                const link        = `/dashboard/reports/${managerId}/weekly/${week}?month=${month}&year=${year}&template=${reportTemplate}`;
                const managerName = manager?.name || "A manager";
                await notifyUsers({
                    actorId:  managerId,
                    userIds:  [...recipients.map((u) => u.id), ...(ceoRecipient ? [ceoRecipient] : [])],
                    type:     "report",
                    entityId: reportId,
                    title:    `${managerName} submitted weekly report — ${periodLabel}`,
                    body:     [
                        `kind: weekly`,
                        `period: ${periodLabel}`,
                        `manager: ${managerName}`,
                        `link: ${link}`,
                    ].join("\n"),
                    linkUrl:  link,
                });
            } catch (e) {
                console.warn("[reports/weekly] notify failed:", e);
            }
        }

        return NextResponse.json({ success: true, reportId, locked: shouldLock, isDraft });
    } catch (error) {
        return serverError(error, "route");
    }
}
