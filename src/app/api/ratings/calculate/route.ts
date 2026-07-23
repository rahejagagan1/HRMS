import { serverError } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serializeBigInt } from "@/lib/utils";
import { calculateAllRatings } from "@/lib/ratings/unified-calculator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/ratings/calculate?month=YYYY-MM&role=writer|editor
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        const user = session?.user as any;

        const isDev = process.env.NEXT_PUBLIC_DEV_LOGIN === "true" && user?.role === "admin";
        const hasAccess =
            user?.isDeveloper ||
            user?.orgLevel === "ceo" ||
            user?.orgLevel === "special_access" ||
            isDev;

        if (!hasAccess) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const monthParam = searchParams.get("month");
        const roleParam  = searchParams.get("role") ?? "writer";

        if (!["writer", "editor", "hr_manager", "researcher_manager", "production_manager", "researcher_foia", "researcher_rtc", "researcher_foia_pitching"].includes(roleParam)) {
            return NextResponse.json(
                { error: "Invalid role. Supported: writer, editor, hr_manager, researcher_manager, production_manager, researcher_foia, researcher_rtc, researcher_foia_pitching" },
                { status: 400 }
            );
        }

        let targetMonth: Date;
        if (monthParam) {
            const [year, mon] = monthParam.split("-").map(Number);
            if (!year || !mon || mon < 1 || mon > 12) {
                return NextResponse.json(
                    { error: "Invalid month format. Use YYYY-MM" },
                    { status: 400 }
                );
            }
            targetMonth = new Date(Date.UTC(year, mon - 1, 1));
        } else {
            const now = new Date();
            targetMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
        }

        console.log(
            `[Calculate] Starting ${roleParam} ratings for ${targetMonth.toISOString().slice(0, 7)}`
        );

        const result = await calculateAllRatings(roleParam, targetMonth);

        return NextResponse.json(
            serializeBigInt({
                success: true,
                month:            targetMonth.toISOString().slice(0, 7),
                role:             roleParam,
                usersCalculated:  result.count,
                skippedManualLocks: result.skippedManualLocks,
                templateId:       result.templateId,
                templateVersion:  result.templateVersion,
                results:          result.results,
                errors:           result.errors,
            })
        );
    } catch (error: any) {
        console.error("[Calculate] Fatal error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
