import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import type { FormulaSection, GuardrailRule } from "@/lib/ratings/types";

export const dynamic = "force-dynamic";

function hasAdminAccess(session: any): boolean {
    const user = session?.user as any;
    const isDev = process.env.NODE_ENV === "development" && user?.role === "admin";
    return (
        user?.isDeveloper === true ||
        user?.orgLevel === "ceo" ||
        user?.orgLevel === "special_access" ||
        isDev
    );
}

// GET /api/ratings/formula-template
// ?roleType=writer  → filter by role
// ?activeOnly=true  → only active templates
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasAdminAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const roleType   = searchParams.get("roleType");
        const activeOnly = searchParams.get("activeOnly") === "true";

        const where: any = {};
        if (roleType)   where.roleType = roleType;
        if (activeOnly) where.isActive = true;

        const templates = await prisma.formulaTemplate.findMany({
            where,
            orderBy: [{ roleType: "asc" }, { version: "desc" }],
        });

        return NextResponse.json(serializeBigInt(templates));
    } catch (error: any) {
        console.error("[FormulaTemplate GET] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST /api/ratings/formula-template
// Create a new template (as inactive draft). Use PUT /:id/activate to activate.
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasAdminAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const body = await request.json();
        const { roleType, label, description, sections, guardrails, roundOff, assignedUserIds } = body;

        if (!roleType || !label || !sections) {
            return NextResponse.json(
                { error: "Missing required fields: roleType, label, sections" },
                { status: 400 }
            );
        }

        if (!Array.isArray(sections) || sections.length === 0) {
            return NextResponse.json(
                { error: "'sections' must be a non-empty array" },
                { status: 400 }
            );
        }

        // Validate sections
        const validationError = validateSections(sections);
        if (validationError) {
            return NextResponse.json({ error: validationError }, { status: 400 });
        }

        // Auto-increment version for this role
        const latest = await prisma.formulaTemplate.findFirst({
            where: { roleType },
            orderBy: { version: "desc" },
        });
        const nextVersion = (latest?.version ?? 0) + 1;

        const template = await prisma.formulaTemplate.create({
            data: {
                roleType,
                version: nextVersion,
                isActive: false, // must be explicitly activated
                label,
                description: description ?? null,
                sections: JSON.parse(JSON.stringify(sections)),
                guardrails: guardrails ? JSON.parse(JSON.stringify(guardrails)) : [],
                roundOff: roundOff ?? false,
                assignedUserIds: Array.isArray(assignedUserIds) ? assignedUserIds : undefined,
            },
        });

        return NextResponse.json(serializeBigInt(template), { status: 201 });
    } catch (error: any) {
        console.error("[FormulaTemplate POST] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// ═══════════════════════════════════════════════════════
// Validation helpers
// ═══════════════════════════════════════════════════════

const VALID_TYPES = new Set([
    "bracket_lookup", "matrix_lookup", "manager_questions_avg", "manager_direct_rating",
    "yt_baseline_ratio", "passthrough", "team_quality_avg", "combined_team_manager_rating",
    "rm_pipeline_targets_avg",
]);
const VALID_SOURCES = new Set(["clickup", "manager", "youtube", "formula"]);

function validateSections(sections: any[]): string | null {
    const totalWeight = sections.reduce((s: number, sec: any) => s + (Number(sec.weight) || 0), 0);
    if (Math.abs(totalWeight - 1.0) > 0.01) {
        return `Section weights must sum to 1.0. Got ${totalWeight.toFixed(3)}`;
    }

    const keys = new Set<string>();
    for (const sec of sections) {
        if (!sec.key || typeof sec.key !== "string") return "Each section must have a string 'key'";
        if (keys.has(sec.key)) return `Duplicate section key: '${sec.key}'`;
        keys.add(sec.key);

        if (!sec.label) return `Section '${sec.key}' missing 'label'`;
        if (!VALID_TYPES.has(sec.type)) return `Section '${sec.key}' has invalid type: '${sec.type}'`;
        if (!VALID_SOURCES.has(sec.source)) return `Section '${sec.key}' has invalid source: '${sec.source}'`;

        if (sec.type === "bracket_lookup" && !sec.variable) {
            return `Section '${sec.key}' (bracket_lookup) requires 'variable'`;
        }
        if (sec.type === "bracket_lookup" && (!Array.isArray(sec.brackets) || sec.brackets.length === 0)) {
            return `Section '${sec.key}' (bracket_lookup) requires 'brackets' array`;
        }
        if (sec.type === "matrix_lookup" && !sec.variable_x) {
            return `Section '${sec.key}' (matrix_lookup) requires 'variable_x'`;
        }
        if (sec.type === "matrix_lookup" && !sec.variable_y_section) {
            return `Section '${sec.key}' (matrix_lookup) requires 'variable_y_section'`;
        }
        if (sec.type === "matrix_lookup" && !sec.matrix) {
            return `Section '${sec.key}' (matrix_lookup) requires 'matrix'`;
        }
        if (sec.type === "manager_questions_avg" && (!Array.isArray(sec.question_keys) || sec.question_keys.length === 0)) {
            return `Section '${sec.key}' (manager_questions_avg) requires 'question_keys' array`;
        }
        if (sec.type === "team_quality_avg" && !sec.variable) {
            return `Section '${sec.key}' (team_quality_avg) requires 'variable'`;
        }
        if (sec.type === "passthrough" && !sec.variable) {
            return `Section '${sec.key}' (passthrough) requires 'variable'`;
        }
        if (sec.type === "passthrough") {
            const hasMin = sec.passthrough_scale_min !== undefined && sec.passthrough_scale_min !== null;
            const hasMax = sec.passthrough_scale_max !== undefined && sec.passthrough_scale_max !== null;
            if (hasMin !== hasMax) {
                return `Section '${sec.key}' (passthrough): set both passthrough_scale_min and passthrough_scale_max, or neither`;
            }
            if (hasMin && Number(sec.passthrough_scale_max) <= Number(sec.passthrough_scale_min)) {
                return `Section '${sec.key}' (passthrough): passthrough_scale_max must be > passthrough_scale_min`;
            }
        }
        if (sec.type === "combined_team_manager_rating") {
            if (!Array.isArray(sec.manager_question_keys) || sec.manager_question_keys.length === 0) {
                return `Section '${sec.key}' (combined_team_manager_rating) requires 'manager_question_keys' array`;
            }
            if (!Array.isArray(sec.team_question_keys) || sec.team_question_keys.length === 0) {
                return `Section '${sec.key}' (combined_team_manager_rating) requires 'team_question_keys' array`;
            }
        }
        if (sec.type === "rm_pipeline_targets_avg") {
            const tr = Number(sec.rm_target_rtc);
            const tf = Number(sec.rm_target_foia);
            const tp = Number(sec.rm_target_foia_pitched);
            if (!Number.isFinite(tr) || tr <= 0) {
                return `Section '${sec.key}' (rm_pipeline_targets_avg) requires rm_target_rtc > 0`;
            }
            if (!Number.isFinite(tf) || tf <= 0) {
                return `Section '${sec.key}' (rm_pipeline_targets_avg) requires rm_target_foia > 0`;
            }
            if (!Number.isFinite(tp) || tp <= 0) {
                return `Section '${sec.key}' (rm_pipeline_targets_avg) requires rm_target_foia_pitched > 0`;
            }
        }
    }

    // Validate variable_y_section references
    for (const sec of sections) {
        if (sec.type === "matrix_lookup" && sec.variable_y_section) {
            if (!keys.has(sec.variable_y_section)) {
                return `Section '${sec.key}': variable_y_section '${sec.variable_y_section}' references unknown section key`;
            }
        }
    }

    return null;
}
