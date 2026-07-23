import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireHRAdmin, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET /api/hr/number-series — list active employee-ID series for the Add Employee wizard.
export async function GET() {
    try {
        const { errorResponse } = await requireHRAdmin();
        if (errorResponse) return errorResponse;

        const series = await prisma.employeeNumberSeries.findMany({
            where: { isActive: true },
            orderBy: { id: "asc" },
            select: { id: true, name: true, prefix: true, nextNumber: true },
        });
        return NextResponse.json(series);
    } catch (error) {
        return serverError(error, "GET /api/hr/number-series");
    }
}
