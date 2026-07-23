import { NextResponse } from "next/server";
import { generateCompanyExcel } from "@/lib/excel/generator";
import { requireAdmin, serverError } from "@/lib/api-auth";

export async function GET() {
    try {
        const { errorResponse } = await requireAdmin();
        if (errorResponse) return errorResponse;

        const buffer = await generateCompanyExcel();

        return new NextResponse(new Uint8Array(buffer), {
            headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="company-report.xlsx"`,
            },
        });
    } catch (error) {
        return serverError(error, "export/excel/company GET");
    }
}
