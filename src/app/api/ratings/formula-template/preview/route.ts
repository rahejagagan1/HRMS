import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import type { FormulaTemplateData } from "@/lib/ratings/types";
import { calculateUserRating, ensureDefaultTemplate } from "@/lib/ratings/unified-calculator";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

/**
 * POST /api/ratings/formula-template/preview
 *
 * Dry-run a formula template against real data for a specific user/month.
 * DOES NOT save any results to the database.
 *
 * Body:
 * {
 *   userId: number,
 *   month: "YYYY-MM",
 *   templateId?: number,    // use a specific template (can be inactive draft)
 *   templateBody?: object   // OR pass raw template JSON for live editing preview
 * }
 */
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasAdminAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const body = await request.json();
        const { userId, month, templateId, templateBody } = body;

        if (!userId || !month) {
            return NextResponse.json(
                { error: "Missing required fields: userId, month" },
                { status: 400 }
            );
        }

        const [yearStr, monStr] = String(month).split("-");
        const year = parseInt(yearStr);
        const mon  = parseInt(monStr);
        if (!year || !mon || mon < 1 || mon > 12) {
            return NextResponse.json({ error: "Invalid month. Use YYYY-MM" }, { status: 400 });
        }

        const monthStart  = new Date(Date.UTC(year, mon - 1, 1));
        const monthEnd    = new Date(Date.UTC(year, mon, 0, 23, 59, 59));
        const monthPeriod = `${year}-${String(mon).padStart(2, "0")}`;

        // Resolve the target user
        const user = await prisma.user.findUnique({
            where: { id: parseInt(String(userId)) },
            select: { id: true, name: true, role: true },
        });
        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        const roleType = (user.role === "editor" ? "editor" : "writer") as "writer" | "editor";

        // Resolve the template to preview
        let template: FormulaTemplateData;

        if (templateBody) {
            // Inline template from request body (for live editing preview)
            if (!templateBody.sections || !Array.isArray(templateBody.sections)) {
                return NextResponse.json(
                    { error: "templateBody must include a 'sections' array" },
                    { status: 400 }
                );
            }
            template = {
                id:          0,
                roleType,
                version:     0,
                isActive:    false,
                label:       templateBody.label ?? "Preview",
                description: templateBody.description ?? null,
                sections:    templateBody.sections,
                guardrails:  templateBody.guardrails ?? [],
                roundOff:    templateBody.roundOff ?? false,
                createdAt:   new Date(),
                updatedAt:   new Date(),
            };
        } else if (templateId) {
            const found = await prisma.formulaTemplate.findUnique({
                where: { id: parseInt(String(templateId)) },
            });
            if (!found) {
                return NextResponse.json({ error: "Template not found" }, { status: 404 });
            }
            template = found as unknown as FormulaTemplateData;
        } else {
            // Use active template for the role (or seed default)
            template = await ensureDefaultTemplate(roleType);
        }

        // Load channel baselines
        const baselines = await prisma.channelBaseline.findMany();
        const baselineMap = new Map(
            baselines.map((b) => [b.channelName, Number(b.baselineViews)])
        );

        // Run evaluation (no DB writes)
        const result = await calculateUserRating(
            user.id,
            roleType,
            monthStart,
            monthEnd,
            monthPeriod,
            template,
            baselineMap
        );

        return NextResponse.json(
            serializeBigInt({
                preview:    true,
                user:       { id: user.id, name: user.name, role: user.role },
                month,
                roleType,
                templateId: template.id,
                templateVersion: template.version,
                templateLabel:   template.label,
                result,
            })
        );
    } catch (error: any) {
        console.error("[FormulaTemplate Preview] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
