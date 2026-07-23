import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listVariables } from "@/lib/ratings/variable-registry";

export const dynamic = "force-dynamic";

/**
 * GET /api/ratings/variables
 *
 * Returns all registered formula variables.
 * Used by the admin formula builder to show available variables
 * when constructing sections.
 */
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        const user = session?.user as any;

        const isDev = process.env.NODE_ENV === "development" && user?.role === "admin";
        const hasAccess =
            user?.isDeveloper === true ||
            user?.orgLevel === "ceo" ||
            user?.orgLevel === "special_access" ||
            isDev;

        if (!hasAccess) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const variables = listVariables();
        return NextResponse.json({ variables, count: variables.length });
    } catch (error: any) {
        console.error("[Variables GET] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
