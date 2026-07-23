import { serverError } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serializeBigInt } from "@/lib/utils";
import { applyBrackets, applyMatrix, customRound } from "@/lib/ratings/formula-engine";
import type { FormulaSection } from "@/lib/ratings/types";

export const dynamic = "force-dynamic";

// Check if user has admin audit access (CEO / special_access / developer / dev mode)
function hasAuditAccess(session: any): boolean {
    const user = session?.user as any;
    const isDev = process.env.NODE_ENV === "development";
    return (
        user?.orgLevel === "ceo" ||
        user?.orgLevel === "special_access" ||
        user?.isDeveloper === true ||
        (isDev && user?.role === "admin")
    );
}

// GET: Fetch all users' scores for admin audit
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasAuditAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const month = searchParams.get("month");

        const monthFilter: any = {};
        if (month) {
            const [year, mon] = month.split("-").map(Number);
            monthFilter.month = new Date(Date.UTC(year, mon - 1, 1));
        }

        // Get all monthly ratings with user info and edit logs.
        // Hide ratings belonging to deactivated users (people who left the
        // company) — their rows stop syncing so they render as "missing values"
        // in the audit panel. Active users are unaffected.
        const ratings = await prisma.monthlyRating.findMany({
            where: {
                ...monthFilter,
                user: { isActive: true },
            },
            orderBy: [{ month: "desc" }, { overallRating: "desc" }],
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        role: true,
                        orgLevel: true,
                        profilePictureUrl: true,
                        teamCapsule: true,
                        manager: { select: { id: true, name: true } },
                    },
                },
                editLogs: {
                    include: {
                        editor: { select: { id: true, name: true } },
                    },
                    orderBy: { editedAt: "desc" },
                    take: 5,
                },
            },
        });

        // Get all users for the hub view. Bulk-imported users default
        // to role=member + orgLevel=member, so the previous
        // member-only NOT filter silently hid most of the org. The
        // admin view always wants the full active roster.
        const allUsers = await prisma.user.findMany({
            where: { isActive: true },
            select: {
                id: true,
                name: true,
                role: true,
                orgLevel: true,
                profilePictureUrl: true,
                teamCapsule: true,
                managerId: true,
                manager: { select: { id: true, name: true } },
            },
            orderBy: { name: "asc" },
        });

        return NextResponse.json(serializeBigInt({ ratings, allUsers }));
    } catch (error) {
        console.error("Scores admin API error:", error);
        return serverError(error, "route");
    }
}

// Recalculate overallRating from sections (mirrors formula engine logic)
function recalcOverallRating(sections: any[]): number | null {
    const valid = sections.filter((s: any) => s.stars !== null && s.stars !== undefined);
    if (valid.length === 0) return null;
    const totalWeight = valid.reduce((sum: number, s: any) => sum + (s.weight || 0), 0);
    if (totalWeight === 0) return null;
    const raw = valid.reduce((sum: number, s: any) => sum + s.stars * (s.weight / totalWeight), 0);
    return Math.round(raw * 100) / 100;
}

// Derive new stars from an edited rawValue by re-applying the section's
// type-specific formula. Returns null if this section type doesn't have a
// deterministic value→stars mapping (caller should keep existing stars).
function recalcStarsFromRawValue(
    tplSection: FormulaSection | undefined,
    newRawValue: number,
    sections: any[]
): number | null {
    if (!tplSection) return null;
    const clamp01to5 = (v: number) => Math.max(0, Math.min(5, v));

    switch (tplSection.type) {
        case "bracket_lookup": {
            if (!tplSection.brackets?.length) return null;
            return clamp01to5(applyBrackets(newRawValue, tplSection.brackets));
        }
        case "matrix_lookup": {
            if (!tplSection.matrix || !tplSection.variable_y_section) return null;
            const ySection = sections.find((s: any) => s.key === tplSection.variable_y_section);
            if (!ySection || ySection.stars == null) return null;
            const score = applyMatrix(newRawValue, Number(ySection.stars), tplSection.matrix);
            return score == null ? null : clamp01to5(score);
        }
        case "manager_direct_rating": {
            return Math.min(5, Math.max(1, Math.round(newRawValue)));
        }
        case "manager_questions_avg":
        case "team_quality_avg": {
            if (tplSection.brackets?.length) {
                return clamp01to5(applyBrackets(newRawValue, tplSection.brackets));
            }
            return clamp01to5(customRound(newRawValue));
        }
        case "passthrough": {
            const mn = tplSection.passthrough_scale_min;
            const mx = tplSection.passthrough_scale_max;
            const base =
                mn !== undefined && mx !== undefined && mx > mn
                    ? 1 + ((newRawValue - mn) / (mx - mn)) * 4
                    : newRawValue;
            return clamp01to5(customRound(base));
        }
        case "combined_team_manager_rating":
        case "rm_pipeline_targets_avg":
        case "yt_baseline_ratio":
            // Treat rawValue as the pre-rounding star average.
            return clamp01to5(customRound(newRawValue));
        default:
            return null;
    }
}

// Map section keys to convenience DB columns
const SECTION_TO_COLUMN: Record<string, string> = {
    writerQuality: "writerQualityStars",
    editorQuality: "writerQualityStars",
    scriptQuality: "scriptQualityStars",
    videoQuality: "scriptQualityStars",
    ownership: "ownershipStars",
    monthlyTargets: "monthlyTargetsStars",
    youtubeViews: "ytViewsStars",
    youtube_views: "ytViewsStars",
};

// PATCH: Edit a specific score value (admin override)
export async function PATCH(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasAuditAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const body = await request.json();
        const { monthlyRatingId, fieldName, sectionKey, newValue, reason } = body;

        if (!monthlyRatingId || !fieldName || newValue === undefined) {
            return NextResponse.json(
                { error: "Missing required fields: monthlyRatingId, fieldName, newValue" },
                { status: 400 }
            );
        }

        const editorUser = session!.user as any;
        if (editorUser?.dbId == null || Number.isNaN(Number(editorUser.dbId))) {
            return NextResponse.json(
                { error: "Your login is not linked to a dashboard user record, so edits cannot be saved. Try signing out and back in." },
                { status: 400 }
            );
        }
        const editorDbId = Number(editorUser.dbId);

        // Get current rating
        const current = await prisma.monthlyRating.findUnique({
            where: { id: monthlyRatingId },
        });
        if (!current) {
            return NextResponse.json({ error: "Monthly rating not found" }, { status: 404 });
        }

        const updateData: any = { isManualOverride: true };

        if ((fieldName === "section_stars" || fieldName === "section_value") && sectionKey) {
            // ── Edit a specific pillar's stars or rawValue within parametersJson ──
            const numVal = parseFloat(newValue);
            if (isNaN(numVal)) {
                return NextResponse.json({ error: "Value must be a number" }, { status: 400 });
            }
            if (fieldName === "section_stars" && (numVal < 0 || numVal > 5)) {
                return NextResponse.json({ error: "Stars must be between 0 and 5" }, { status: 400 });
            }

            const sections = Array.isArray(current.parametersJson)
                ? JSON.parse(JSON.stringify(current.parametersJson))
                : [];
            const section = sections.find((s: any) => s.key === sectionKey);
            if (!section) {
                return NextResponse.json({ error: `Section '${sectionKey}' not found` }, { status: 400 });
            }

            const isStarsEdit = fieldName === "section_stars";
            const oldVal = isStarsEdit ? section.stars : section.rawValue;

            if (isStarsEdit) {
                section.stars = numVal;
                section.isOverridden = true;
                section.details = `Manual override: ${numVal}★ (was ${oldVal ?? "null"})`;
            } else {
                // Edit score value + auto-recompute stars from the template so the
                // rating follows the value.
                section.rawValue = numVal;

                // Auto-derive stars from the new value via the section's formula.
                // Load the template that produced this rating so we can re-apply
                // bracket/matrix/etc. logic. Cascade to dependent matrix sections.
                let derivedNote = "";
                let recalcedStars = false;
                try {
                    const tplId = current.formulaTemplateId ?? null;
                    if (tplId != null) {
                        const tpl = await prisma.formulaTemplate.findUnique({
                            where: { id: tplId },
                        });
                        const tplSections = (tpl?.sections as unknown as FormulaSection[]) ?? [];
                        const tplSection = tplSections.find((s) => s.key === sectionKey);
                        const newStars = recalcStarsFromRawValue(tplSection, numVal, sections);
                        if (newStars != null) {
                            section.stars = newStars;
                            recalcedStars = true;
                            derivedNote = ` → ${newStars}★`;

                            // Cascade: matrix_lookup sections that depend on this
                            // section's stars (y-axis) must also be recomputed.
                            for (const depTpl of tplSections) {
                                if (
                                    depTpl.type === "matrix_lookup" &&
                                    depTpl.variable_y_section === sectionKey &&
                                    depTpl.matrix
                                ) {
                                    const depSec = sections.find((s: any) => s.key === depTpl.key);
                                    if (depSec && depSec.rawValue != null) {
                                        const cascaded = applyMatrix(
                                            Number(depSec.rawValue),
                                            newStars,
                                            depTpl.matrix
                                        );
                                        if (cascaded != null) {
                                            depSec.stars = Math.max(0, Math.min(5, cascaded));
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.warn("[scores/admin PATCH] stars auto-recalc failed:", err);
                }

                section.isOverridden = true;
                section.details = `Manual override: value=${numVal} (was ${oldVal ?? "null"})${derivedNote}`;

                // Keep convenience star columns in sync when we recomputed stars.
                if (recalcedStars) {
                    const convCol = SECTION_TO_COLUMN[sectionKey];
                    if (convCol) updateData[convCol] = section.stars;
                }
            }

            // Recalculate overall rating from stars (any cascaded stars already applied)
            const newOverall = recalcOverallRating(sections);

            updateData.parametersJson = sections;
            updateData.overallRating = newOverall;

            // Update convenience column for direct stars edits
            if (isStarsEdit) {
                const convCol = SECTION_TO_COLUMN[sectionKey];
                if (convCol) updateData[convCol] = numVal;
            }

            // Audit log
            await prisma.scoreEditLog.create({
                data: {
                    monthlyRatingId,
                    fieldName: `${fieldName}:${sectionKey}`,
                    oldValue: String(oldVal ?? "null"),
                    newValue: String(numVal),
                    editedBy: editorDbId,
                    reason: reason || "Admin inline edit",
                },
            });
        } else if (fieldName === "overallRating") {
            // ── Direct override of final score ──
            const numVal = parseFloat(newValue);
            const oldValue = current.overallRating != null ? Number(current.overallRating) : null;
            updateData.overallRating = numVal;

            await prisma.scoreEditLog.create({
                data: {
                    monthlyRatingId,
                    fieldName: "overallRating",
                    oldValue: String(oldValue ?? "null"),
                    newValue: String(numVal),
                    editedBy: editorDbId,
                    reason: reason || "Admin inline edit",
                },
            });
        } else {
            return NextResponse.json({ error: `Field '${fieldName}' is not editable via inline edit` }, { status: 400 });
        }

        const updated = await prisma.monthlyRating.update({
            where: { id: monthlyRatingId },
            data: updateData,
            include: {
                user: {
                    select: {
                        id: true, name: true, role: true, orgLevel: true,
                        profilePictureUrl: true, teamCapsule: true,
                        manager: { select: { id: true, name: true } },
                    },
                },
                editLogs: {
                    include: { editor: { select: { id: true, name: true } } },
                    orderBy: { editedAt: "desc" },
                    take: 5,
                },
            },
        });

        return NextResponse.json(serializeBigInt(updated));
    } catch (error) {
        console.error("Scores admin PATCH error:", error);
        return serverError(error, "route");
    }
}

// POST: Create a new MonthlyRating entry for a missing user
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasAuditAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const body = await request.json();
        const { userId, month, roleType } = body;

        console.log("[scores/admin POST] body:", JSON.stringify({ userId, month, roleType }));

        if (!userId || !month || !roleType) {
            return NextResponse.json({ error: "Missing required fields: userId, month, roleType" }, { status: 400 });
        }

        if (typeof month !== "string" || !month.includes("-")) {
            return NextResponse.json({ error: `Invalid month format: ${month}` }, { status: 400 });
        }

        const [year, mon] = month.split("-").map(Number);
        const monthDate = new Date(Date.UTC(year, mon - 1, 1));

        // Check if entry already exists
        const existing = await prisma.monthlyRating.findUnique({
            where: { userId_month_roleType: { userId: parseInt(userId), month: monthDate, roleType } },
        });
        if (existing) {
            return NextResponse.json({ error: "Rating entry already exists for this user/month/role" }, { status: 409 });
        }

        // Load the active template to get section structure
        const template = await prisma.formulaTemplate.findFirst({
            where: { roleType, isActive: true },
            orderBy: { version: "desc" },
        });

        // Build empty parametersJson from template sections
        const sections = template?.sections;
        const emptySections = Array.isArray(sections)
            ? (sections as any[]).map((s: any) => ({
                key: s.key,
                label: s.label,
                weight: s.weight,
                source: s.source,
                rawValue: null,
                stars: null,
                details: "Manually added — pending data",
                blocksScore: s.blocks_final_score ?? false,
                isOverridden: false,
            }))
            : [];

        const created = await prisma.monthlyRating.create({
            data: {
                userId: parseInt(userId),
                month: monthDate,
                roleType,
                casesCompleted: 0,
                overallRating: null,
                isManualOverride: true,
                manualRatingsPending: true,
                parametersJson: emptySections,
                formulaTemplateId: template?.id ?? null,
                formulaVersion: template?.version ?? null,
            },
            include: {
                user: {
                    select: {
                        id: true, name: true, role: true, orgLevel: true,
                        profilePictureUrl: true, teamCapsule: true,
                        manager: { select: { id: true, name: true } },
                    },
                },
                editLogs: true,
            },
        });

        return NextResponse.json(serializeBigInt(created));
    } catch (error: any) {
        console.error("Scores admin POST error:", error);
        const msg = error instanceof Error ? error.message : String(error);
        const code = error?.code || "";
        // Return actual error details to admins (this route is admin-only)
        if (code === "P2002") {
            return NextResponse.json(
                { error: "Rating entry already exists for this user/month/role (constraint)" },
                { status: 409 }
            );
        }
        if (code === "P2003") {
            return NextResponse.json(
                { error: `Foreign key constraint failed: ${error.meta?.field_name || "unknown field"}` },
                { status: 400 }
            );
        }
        return NextResponse.json(
            { error: `Failed to create entry: ${code ? `[${code}] ` : ""}${msg}` },
            { status: 500 }
        );
    }
}
