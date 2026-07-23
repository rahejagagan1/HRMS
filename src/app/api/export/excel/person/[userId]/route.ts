import { requireAuth, serverError } from "@/lib/api-auth";
import { NextResponse } from "next/server";
import { generatePersonExcel } from "@/lib/excel/generator";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ userId: string }> }
) {
    const { session, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;


        const { userId: userIdRaw } = await params;
    try {
        const userId = parseInt(userIdRaw);
        if (isNaN(userId)) {
            return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
        }

        // Only allow admins/CEOs or the user exporting their own data
        const requestingUser = session!.user as any;
        const isAdmin = requestingUser.orgLevel === "ceo" ||
            requestingUser.orgLevel === "special_access" ||
            requestingUser.isDeveloper === true;
        const isSelf = requestingUser.dbId === userId;
        if (!isAdmin && !isSelf) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const buffer = await generatePersonExcel(userId);

        return new NextResponse(new Uint8Array(buffer), {
            headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="person-${userId}-report.xlsx"`,
            },
        });
    } catch (error) {
        return serverError(error, "route");
    }
}
