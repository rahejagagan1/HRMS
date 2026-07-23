import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";
import { notifyUsers, brandCeoIdForEmployee } from "@/lib/notifications";
import { devEmailRecipientsClause } from "@/lib/email/toggles";
import { getQualifiedCasesForRole } from "@/lib/ratings/data-resolver";
import { getManagerReportFormat, REPORT_TEMPLATE_IDS } from "@/lib/reports/manager-report-format";
import { findReportRow, upsertReportRow, deleteReportRow, MONTHLY_JSONB } from "@/lib/reports/report-store";
import { getMonthlyReportWindow } from "@/lib/reports/monthly-window";
import {
    normalizeTeamCapsuleInput,
    findCapsulesMatchingTeamCapsule,
} from "@/lib/capsule-matching";
import { writeSnapshot as writeReportTeamSnapshot } from "@/lib/reports/team-snapshot";

export const dynamic = "force-dynamic";

type Params = Promise<{ managerId: string; month: string }>;
// Production Volume auto-fill: for production managers, Total Video Completed is
// the count of cases with a Video QA1 subtask done in the reporting window
// (day 4 of month M → end of day 3 of month M+1; see monthly-window.ts), and
// Hero Content Completed is the subset whose Case.caseType matches "hero"
// (case-insensitive). CEO/developer can override — when overridden, we keep
// their value and don't recompute over it.
async function computeProductionActuals(managerId: number, month: number, year: number) {
    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd   = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));
    const cases = await getQualifiedCasesForRole(monthStart, monthEnd, "production_manager", managerId);
    const totalVideo = cases.length;
    const heroContent = cases.filter((c) => (c.caseType || "").toLowerCase().includes("hero")).length;
    return { totalVideo, heroContent };
}

// Videos Published auto-fill: count Case rows in the manager's production lists
// whose YoutubeStats.publishedAt falls in the reporting window (same day 4 → day
// 3 next month window used everywhere else). Resolves teamCapsule → list IDs
// using the same logic as content-performance/route.ts.
async function computeVideosPublished(managerId: number, month: number, year: number): Promise<number> {
    const manager = await prisma.user.findUnique({
        where: { id: managerId },
        select: { teamCapsule: true },
    });
    const tc = normalizeTeamCapsuleInput(manager?.teamCapsule ?? "");
    if (!tc) return 0;

    let listIds: number[] = [];
    const listsByExactName = await prisma.productionList.findMany({
        where: { name: { equals: tc, mode: "insensitive" } },
        select: { id: true },
    });
    if (listsByExactName.length > 0) {
        listIds = listsByExactName.map((l) => l.id);
    } else {
        const capsules = await findCapsulesMatchingTeamCapsule(tc);
        if (capsules.length > 0) {
            const lists = await prisma.productionList.findMany({
                where: { capsuleId: { in: capsules.map((c) => c.id) } },
                select: { id: true },
            });
            listIds = lists.map((l) => l.id);
        }
    }
    if (listIds.length === 0) return 0;

    const { windowStart, windowEnd } = getMonthlyReportWindow(year, month);
    return prisma.case.count({
        where: {
            productionListId: { in: listIds },
            youtubeStats: {
                is: { publishedAt: { gte: windowStart, lte: windowEnd } },
            },
        },
    });
}

/* ── GET — load monthly report ── */
export async function GET(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;


        const { managerId: managerIdRaw, month: monthRaw } = await params;
        const managerId = parseInt(managerIdRaw);
        const month     = parseInt(monthRaw);
        const year      = parseInt(req.nextUrl.searchParams.get("year") ?? "");
        const template  = req.nextUrl.searchParams.get("template");

        if (isNaN(managerId) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const report = await findReportRow("MonthlyReport", managerId, template, { month, year });

        // Auto-compute Production Volume actuals for production reports. These
        // are returned regardless of whether a draft exists yet so the UI can
        // populate them on a blank form. If the saved report has override flags
        // set, we surface the saved values instead.
        const manager = await prisma.user.findUnique({
            where: { id: managerId },
            select: { role: true, orgLevel: true, name: true },
        });
        // Whether THIS report is a production report: the URL template wins; fall
        // back to the manager's legacy-derived format for old (no-template) URLs.
        const isProduction = (template ?? (manager ? getManagerReportFormat(manager) : null)) === "production";
        const auto = isProduction
            ? await computeProductionActuals(managerId, month, year)
            : { totalVideo: 0, heroContent: 0 };
        const autoVideosPublished = isProduction
            ? await computeVideosPublished(managerId, month, year)
            : 0;

        if (!report) {
            return NextResponse.json({
                submitted: false,
                locked: false,
                data: isProduction ? {
                    totalVideoActual:  String(auto.totalVideo),
                    heroContentActual: String(auto.heroContent),
                    videosPublishedActual: String(autoVideosPublished),
                    totalVideoActualOverridden: false,
                    heroContentActualOverridden: false,
                    videosPublishedActualOverridden: false,
                } : null,
            });
        }

        // Snapshot-on-submit behaviour for ClickUp-sourced actuals:
        //   - CEO-overridden value  → always use saved value
        //   - Report is locked      → use saved snapshot (frozen at submit time)
        //                             developer can refresh via /refresh-actuals
        //   - Draft / unsubmitted   → recompute live so manager sees fresh data
        //                             while writing the report
        const useSnapshot = report.isLocked;
        const totalVideoActual = (report as any).totalVideoActualOverridden
            ? report.totalVideoActual
            : useSnapshot
                ? report.totalVideoActual
                : (isProduction ? String(auto.totalVideo) : report.totalVideoActual);
        const heroContentActual = (report as any).heroContentActualOverridden
            ? report.heroContentActual
            : useSnapshot
                ? report.heroContentActual
                : (isProduction ? String(auto.heroContent) : report.heroContentActual);
        const videosPublishedActual = (report as any).videosPublishedActualOverridden
            ? (report as any).videosPublishedActual
            : useSnapshot
                ? (report as any).videosPublishedActual
                : (isProduction ? String(autoVideosPublished) : (report as any).videosPublishedActual);

        return NextResponse.json({
            submitted: true,
            locked:    report.isLocked,
            reportId:  report.id,
            data: {
                // Section 1
                executiveSummary:    report.executiveSummary,
                // Section 2
                totalVideoTarget:    report.totalVideoTarget,
                totalVideoActual,
                totalVideoVariance:  report.totalVideoVariance,
                heroContentTarget:   report.heroContentTarget,
                heroContentActual,
                heroContentVariance: report.heroContentVariance,
                videosPublishedTarget:   (report as any).videosPublishedTarget   ?? null,
                videosPublishedActual,
                videosPublishedVariance: (report as any).videosPublishedVariance ?? null,
                totalVideoActualOverridden:      (report as any).totalVideoActualOverridden      ?? false,
                heroContentActualOverridden:     (report as any).heroContentActualOverridden     ?? false,
                videosPublishedActualOverridden: (report as any).videosPublishedActualOverridden ?? false,
                totalVideoTargetAchieved:        (report as any).totalVideoTargetAchieved        ?? null,
                heroContentTargetAchieved:       (report as any).heroContentTargetAchieved       ?? null,
                videosPublishedTargetAchieved:   (report as any).videosPublishedTargetAchieved   ?? null,
                editorNotes:         report.editorNotes,
                writerNotes:         report.writerNotes,
                editorExtraCases:    (report as any).editorExtraCases ?? null,
                writerExtraCases:    (report as any).writerExtraCases ?? null,
                // Section 3
                shortfallSummary:    report.shortfallSummary,
                // Section 4
                teamRecognition:     report.teamRecognition,
                // Section 5
                keyLearning1:        report.keyLearning1,
                keyLearning2:        report.keyLearning2,
                keyLearning3:        report.keyLearning3,
                // Section 5B
                risksAttention:      report.risksAttention,
                // Section 6
                behavioralConcerns:  report.behavioralConcerns,
                // Section 7
                remark:              report.remark,
                // Nishant Bhatia researcher monthly format
                nishantResearcherRows: report.nishantResearcherRows,
                nishantOverview:       report.nishantOverview,
                // Andrew James monthly sections
                andrewA1Rows: (report as any).andrewA1Rows,
                andrewA2Rows: (report as any).andrewA2Rows,
                andrewBRows:  (report as any).andrewBRows,
                andrewSBRows: (report as any).andrewCRows,  // thumbnails → andrewCRows in DB
                andrewSCRows: (report as any).andrewDRows,  // capsule views → andrewDRows in DB
                andrewSERows: (report as any).andrewERows,  // Section E shorts → andrewERows in DB
                // HR Manager (Tanvi Dogra) monthly report — dedicated column
                hrMonthlyData: (report as any).hrMonthlyData,
            },
        });
    } catch (error) {
        return serverError(error, "route");
    }
}

/* ── DELETE — delete an unlocked (draft) monthly report ── */
export async function DELETE(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;


        const { managerId: managerIdRaw, month: monthRaw } = await params;
        const managerId = parseInt(managerIdRaw);
        const month     = parseInt(monthRaw);
        const year      = parseInt(req.nextUrl.searchParams.get("year") ?? "");
        const template  = req.nextUrl.searchParams.get("template");

        if (isNaN(managerId) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const report = await findReportRow("MonthlyReport", managerId, template, { month, year });

        if (!report) {
            return NextResponse.json({ error: "Report not found" }, { status: 404 });
        }
        if (report.isLocked) {
            return NextResponse.json({ error: "Cannot delete a submitted report. Ask an admin to unlock it first." }, { status: 403 });
        }

        await deleteReportRow("MonthlyReport", managerId, report.reportTemplate ?? template, { month, year });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverError(error, "reports/monthly DELETE");
    }
}

/* ── POST — save draft or submit (lock) the monthly report ── */
export async function POST(req: NextRequest, { params }: { params: Params }) {
    try {
        const { session, errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;


        const { managerId: managerIdRaw, month: monthRaw } = await params;
        const managerId = parseInt(managerIdRaw);
        const month     = parseInt(monthRaw);
        const body      = await req.json();
        const { year, isDraft, template, ...fields } = body;

        if (isNaN(managerId) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const shouldLock = !isDraft;

        const manager = await prisma.user.findUnique({
            where: { id: managerId },
            select: { role: true, orgLevel: true, name: true },
        });
        // Resolve the report template: explicit body.template when valid, else
        // the manager's legacy-derived format (back-compat).
        const reportTemplate = (typeof template === "string" && (REPORT_TEMPLATE_IDS as string[]).includes(template))
            ? template
            : (manager ? getManagerReportFormat(manager) : "production");
        const isProduction = reportTemplate === "production";

        const existing = await findReportRow("MonthlyReport", managerId, reportTemplate, { month, year });
        if (existing?.isLocked) {
            return NextResponse.json({ error: "Report is locked. Ask an admin to unlock it first." }, { status: 403 });
        }

        // Only CEO / developer / special_access can override auto-computed actuals.
        // For everyone else, auto-recompute on every save so the DB always reflects
        // the latest qualified-case count.
        const sessionUser = (session as any)?.user;
        const canOverride =
            sessionUser?.orgLevel === "ceo" ||
            sessionUser?.orgLevel === "special_access" ||
            sessionUser?.isDeveloper === true;
        const auto = isProduction
            ? await computeProductionActuals(managerId, month, year)
            : { totalVideo: 0, heroContent: 0 };
        const autoVideosPublished = isProduction
            ? await computeVideosPublished(managerId, month, year)
            : 0;

        const prevTotalOverridden  = (existing as any)?.totalVideoActualOverridden      ?? false;
        const prevHeroOverridden   = (existing as any)?.heroContentActualOverridden     ?? false;
        const prevVideosOverridden = (existing as any)?.videosPublishedActualOverridden ?? false;

        // Decide the next override state + value for each actual. Non-privileged
        // callers can never flip a flag on, and their submitted actual is ignored
        // whenever auto-compute is in effect.
        let totalVideoActualOverridden = prevTotalOverridden;
        let totalVideoActual: string | null = fields.totalVideoActual ?? null;
        if (isProduction) {
            if (canOverride && typeof fields.totalVideoActualOverridden === "boolean") {
                totalVideoActualOverridden = fields.totalVideoActualOverridden;
            }
            if (!totalVideoActualOverridden) {
                totalVideoActual = String(auto.totalVideo);
            } else if (!canOverride) {
                // Non-privileged save on an already-overridden row: keep the existing value.
                totalVideoActual = existing?.totalVideoActual ?? String(auto.totalVideo);
            }
        }

        let heroContentActualOverridden = prevHeroOverridden;
        let heroContentActual: string | null = fields.heroContentActual ?? null;
        if (isProduction) {
            if (canOverride && typeof fields.heroContentActualOverridden === "boolean") {
                heroContentActualOverridden = fields.heroContentActualOverridden;
            }
            if (!heroContentActualOverridden) {
                heroContentActual = String(auto.heroContent);
            } else if (!canOverride) {
                heroContentActual = existing?.heroContentActual ?? String(auto.heroContent);
            }
        }

        let videosPublishedActualOverridden = prevVideosOverridden;
        let videosPublishedActual: string | null = fields.videosPublishedActual ?? null;
        if (isProduction) {
            if (canOverride && typeof fields.videosPublishedActualOverridden === "boolean") {
                videosPublishedActualOverridden = fields.videosPublishedActualOverridden;
            }
            if (!videosPublishedActualOverridden) {
                videosPublishedActual = String(autoVideosPublished);
            } else if (!canOverride) {
                videosPublishedActual = (existing as any)?.videosPublishedActual ?? String(autoVideosPublished);
            }
        }

        const payload = {
            // Section 1: Executive Summary
            executiveSummary:    fields.executiveSummary    ?? null,
            // Section 2: Production Output
            totalVideoTarget:    fields.totalVideoTarget    ?? null,
            totalVideoActual,
            totalVideoVariance:  fields.totalVideoVariance  ?? null,
            heroContentTarget:   fields.heroContentTarget   ?? null,
            heroContentActual,
            heroContentVariance: fields.heroContentVariance ?? null,
            videosPublishedTarget:   fields.videosPublishedTarget   ?? null,
            videosPublishedActual,
            videosPublishedVariance: fields.videosPublishedVariance ?? null,
            totalVideoActualOverridden,
            heroContentActualOverridden,
            videosPublishedActualOverridden,
            // Targets Completed (by Managers) — manager-entered, not auto-computed.
            totalVideoTargetAchieved:      fields.totalVideoTargetAchieved      ?? null,
            heroContentTargetAchieved:     fields.heroContentTargetAchieved     ?? null,
            videosPublishedTargetAchieved: fields.videosPublishedTargetAchieved ?? null,
            editorNotes:         fields.editorNotes         ?? null,
            writerNotes:         fields.writerNotes         ?? null,
            editorExtraCases:    fields.editorExtraCases    ?? null,
            writerExtraCases:    fields.writerExtraCases    ?? null,
            // Section 3: Shortfall Analysis
            shortfallSummary:    fields.shortfallSummary    ?? null,
            // Section 4: Team Recognition
            teamRecognition:     fields.teamRecognition     ?? null,
            // Section 5: Key Learnings
            keyLearning1:        fields.keyLearning1        ?? null,
            keyLearning2:        fields.keyLearning2        ?? null,
            keyLearning3:        fields.keyLearning3        ?? null,
            // Section 5B: Risks
            risksAttention:      fields.risksAttention      ?? null,
            // Section 6: Behavioral Concerns
            behavioralConcerns:  fields.behavioralConcerns  ?? null,
            // Section 7: Remark
            remark:              fields.remark              ?? null,
            // Nishant Bhatia researcher monthly format
            // Guard: if the frontend sends `undefined` (race condition where the
            // production template saved before the manager-format SWR call resolved),
            // fall back to the existing DB value so saved data is never wiped.
            nishantResearcherRows: fields.nishantResearcherRows !== undefined
                ? fields.nishantResearcherRows
                : ((existing as any)?.nishantResearcherRows ?? null),
            nishantOverview: fields.nishantOverview !== undefined
                ? fields.nishantOverview
                : ((existing as any)?.nishantOverview ?? null),
            // Andrew James monthly sections
            andrewA1Rows: fields.andrewA1Rows ?? null,
            andrewA2Rows: fields.andrewA2Rows ?? null,
            andrewBRows:  fields.andrewBRows  ?? null,
            andrewCRows:  fields.andrewSBRows ?? null,  // thumbnails
            andrewDRows:  fields.andrewSCRows ?? null,  // capsule views
            andrewERows:  fields.andrewSERows ?? null,  // Section D (UI) / YT shorts
            // HR Manager (Tanvi Dogra) — dedicated column
            hrMonthlyData: fields.hrMonthlyData ?? null,
            isLocked:            shouldLock,
        };
        // Only stamp submittedAt on lock; drafts keep the existing value (or the
        // DB default now() on first insert) — column omitted from the upsert.
        if (shouldLock) (payload as Record<string, unknown>).submittedAt = new Date();

        const reportId = await upsertReportRow(
            "MonthlyReport",
            { managerId, reportTemplate, month, year },
            payload as Record<string, unknown>,
            MONTHLY_JSONB
        );

        // Freeze the team roster onto the report when it transitions to
        // locked. Without this, the report's sidebar / per-member views
        // re-query User.managerId at read time and "lose" team members
        // who later switch to a different manager. See
        // src/lib/reports/team-snapshot.ts for the full rationale.
        if (shouldLock) {
            try {
                await writeReportTeamSnapshot(managerId, { kind: "monthly", month, year, template: reportTemplate });
            } catch (e) {
                console.warn("[monthly POST] snapshot write failed:", e);
            }
        }

        // Notify CEO / HR / special-access only when the report is LOCKED.
        // Same pattern as the weekly route. Developer accounts gated by
        // the "Notify developers" toggle in Admin → Emails Automation.
        if (shouldLock) {
            try {
                const devClause = await devEmailRecipientsClause();
                const [manager, recipients, ceoRecipient] = await Promise.all([
                    prisma.user.findUnique({ where: { id: managerId }, select: { name: true } }),
                    prisma.user.findMany({
                        where: {
                            isActive: true,
                            // CEO excluded from the blanket fan-out — only re-added
                            // below when the submitting manager is their OWN direct
                            // report. Top-level NOT because the CEO/owner account
                            // also carries role="admin" / may be a dev email.
                            orgLevel: { not: "ceo" },
                            OR: [
                                // Special Access + HR Manager (role).
                                // Drops orgLevel="hr_manager"-only members (HR-team
                                // folks like Vanshika are role=member) and role="admin" alone.
                                { orgLevel: "special_access" },
                                { role: "hr_manager" },
                                ...devClause,
                            ],
                        },
                        select: { id: true },
                    }),
                    brandCeoIdForEmployee(managerId),
                ]);
                // `month` is the 0-based index parsed from the URL (0=Jan,
                // 11=Dec) — same convention as the client-side monthIndex
                // and as the JavaScript Date constructor. The previous
                // `month - 1` underflowed for January (gave December of
                // the prior year), so the notification email read the
                // wrong month name for any January report.
                const monthLabel = new Date(year, month, 1).toLocaleDateString("en-IN", {
                    month: "long", year: "numeric",
                });
                const link        = `/dashboard/reports/${managerId}/monthly/${month}?year=${year}&template=${reportTemplate}`;
                const managerName = manager?.name || "A manager";
                await notifyUsers({
                    actorId:  managerId,
                    userIds:  recipients.map((u) => u.id),
                    type:     "report",
                    entityId: reportId,
                    title:    `${managerName} submitted monthly report — ${monthLabel}`,
                    body:     [
                        `kind: monthly`,
                        `period: ${monthLabel}`,
                        `manager: ${managerName}`,
                        `link: ${link}`,
                    ].join("\n"),
                    linkUrl:  link,
                });
            } catch (e) {
                console.warn("[reports/monthly] notify failed:", e);
            }
        }

        return NextResponse.json({ success: true, reportId, locked: shouldLock, isDraft });
    } catch (error) {
        return serverError(error, "route");
    }
}
