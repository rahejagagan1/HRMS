import { serverError } from "@/lib/api-auth";
import { NextResponse } from "next/server";
import { generateTeamExcel } from "@/lib/excel/generator";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ capsuleId: string }> }
) {
    try {
        const { capsuleId: capsuleIdRaw } = await params;
        const capsuleId = parseInt(capsuleIdRaw);
        if (isNaN(capsuleId)) {
            return NextResponse.json({ error: "Invalid capsule ID" }, { status: 400 });
        }

        const buffer = await generateTeamExcel(capsuleId);

        return new NextResponse(new Uint8Array(buffer), {
            headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="team-${capsuleId}-report.xlsx"`,
            },
        });
    } catch (error) {
        return serverError(error, "route");
    }
}
