import { serverError } from "@/lib/api-auth";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: idRaw } = await params;
        const id = parseInt(idRaw);
        if (isNaN(id)) {
            return NextResponse.json({ error: "Invalid case ID" }, { status: 400 });
        }

        const body = await request.json();

        // Only allow updating manual/QA fields
        const allowedFields = [
            "writerQualityScore",
            "writerDeliveryTime",
            "writerEfficiencyScore",
            "scriptQualityRating",
            "scriptRatingReason",
            "editorQualityScore",
            "editorDeliveryTime",
            "editorEfficiencyScore",
            "videoQualityRating",
            "videoRatingReason",
            "videoChangesCount",
            "caseRating",
            "caseType",
            "channel",
        ];

        const updateData: Record<string, any> = {};
        for (const field of allowedFields) {
            if (body[field] !== undefined) {
                updateData[field] = body[field];
            }
        }

        const updated = await prisma.case.update({
            where: { id },
            data: updateData,
        });

        return NextResponse.json({ success: true, case: updated });
    } catch (error) {
        return serverError(error, "route");
    }
}
