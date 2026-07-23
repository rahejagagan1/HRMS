import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { activateTemplate } from "@/lib/ratings/unified-calculator";

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

// GET /api/ratings/formula-template/:id
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasAdminAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const { id } = await params;
        const template = await prisma.formulaTemplate.findUnique({
            where: { id: parseInt(id) },
        });

        if (!template) {
            return NextResponse.json({ error: "Template not found" }, { status: 404 });
        }

        return NextResponse.json(serializeBigInt(template));
    } catch (error: any) {
        console.error("[FormulaTemplate/:id GET] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// PUT /api/ratings/formula-template/:id
// Update a template's label, description, sections, or guardrails.
// Cannot modify roleType or version. Cannot modify an active template —
// create a new version instead (preserves audit trail).
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasAdminAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const { id } = await params;
        const templateId = parseInt(id);

        const existing = await prisma.formulaTemplate.findUnique({ where: { id: templateId } });
        if (!existing) {
            return NextResponse.json({ error: "Template not found" }, { status: 404 });
        }

        if (existing.isActive) {
            return NextResponse.json(
                {
                    error: "Cannot edit an active template. Create a new version instead (POST /api/ratings/formula-template) then activate it.",
                },
                { status: 409 }
            );
        }

        const body = await request.json();
        const { label, description, sections, guardrails, roundOff, assignedUserIds } = body;

        const updateData: any = {};
        if (label !== undefined)       updateData.label = label;
        if (description !== undefined) updateData.description = description;
        if (sections !== undefined)    updateData.sections   = JSON.parse(JSON.stringify(sections));
        if (guardrails !== undefined)  updateData.guardrails = JSON.parse(JSON.stringify(guardrails));
        if (roundOff !== undefined)    updateData.roundOff = roundOff;
        if (assignedUserIds !== undefined) updateData.assignedUserIds = Array.isArray(assignedUserIds) ? assignedUserIds : null;

        const updated = await prisma.formulaTemplate.update({
            where: { id: templateId },
            data: updateData,
        });

        return NextResponse.json(serializeBigInt(updated));
    } catch (error: any) {
        console.error("[FormulaTemplate/:id PUT] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST /api/ratings/formula-template/:id/activate
// Activates a template. All other templates for the same role are deactivated.
// Existing MonthlyRating rows are never touched — new calculation runs will use
// the newly active template and stamp formulaTemplateId + formulaVersion on results.
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasAdminAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const { id } = await params;
        const body = await request.json().catch(() => ({}));
        const action = body?.action ?? "activate";

        if (action !== "activate" && action !== "deactivate") {
            return NextResponse.json(
                { error: "Invalid action. Use 'activate' or 'deactivate'" },
                { status: 400 }
            );
        }

        const templateId = parseInt(id);

        if (action === "activate") {
            const activated = await activateTemplate(templateId);
            return NextResponse.json(
                serializeBigInt({
                    success: true,
                    message: `Template ${templateId} is now active for role '${activated.roleType}'. Next calculation will use this template.`,
                    template: activated,
                })
            );
        }

        // Deactivate
        const template = await prisma.formulaTemplate.findUnique({ where: { id: templateId } });
        if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

        const updated = await prisma.formulaTemplate.update({
            where: { id: templateId },
            data: { isActive: false },
        });

        return NextResponse.json(
            serializeBigInt({
                success: true,
                message: `Template ${templateId} deactivated. No active template for '${template.roleType}' — default will be seeded on next calculation.`,
                template: updated,
            })
        );
    } catch (error: any) {
        console.error("[FormulaTemplate/:id PATCH] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE /api/ratings/formula-template/:id
// Only inactive templates can be deleted.
export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasAdminAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const { id } = await params;
        const templateId = parseInt(id);

        const template = await prisma.formulaTemplate.findUnique({ where: { id: templateId } });
        if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

        if (template.isActive) {
            return NextResponse.json(
                { error: "Cannot delete an active template. Deactivate it first." },
                { status: 409 }
            );
        }

        // Check if any MonthlyRating references this template
        const usageCount = await prisma.monthlyRating.count({
            where: { formulaTemplateId: templateId },
        });

        if (usageCount > 0) {
            return NextResponse.json(
                {
                    error: `Cannot delete — ${usageCount} MonthlyRating record(s) reference this template. Deactivating is safe; deleting would break audit history.`,
                },
                { status: 409 }
            );
        }

        await prisma.formulaTemplate.delete({ where: { id: templateId } });
        return NextResponse.json({ success: true, message: `Template ${templateId} deleted.` });
    } catch (error: any) {
        console.error("[FormulaTemplate/:id DELETE] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
