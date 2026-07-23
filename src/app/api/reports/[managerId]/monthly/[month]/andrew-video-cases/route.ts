import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
type Params = Promise<{ managerId: string; month: string }>;
export async function GET(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;


        const { month: monthRaw } = await params;
        const month = parseInt(monthRaw);
        const year  = parseInt(req.nextUrl.searchParams.get("year") ?? "");
        if (isNaN(month) || isNaN(year)) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

        const monthStart = new Date(year, month, 1, 0, 0, 0);
        const monthEnd   = new Date(year, month + 1, 0, 23, 59, 59);

        const cases = await prisma.case.findMany({
            where: { qaVideoMeetingDate: { gte: monthStart, lte: monthEnd } },
            include: {
                writer: { select: { id: true, name: true } },
                editor: { select: { id: true, name: true } },
                productionList: { select: { name: true, capsule: { select: { shortName: true, name: true } } } },
            },
            orderBy: { qaVideoMeetingDate: "asc" },
        });

        const na = "N/A";
        const clean = (s: string | null | undefined) => s ? s.replace(/^\d+\.\s*/, "").trim() : null;

        return NextResponse.json({ videoCases: cases.map(c => ({
            caseName:           c.name || na,
            capsuleName:        clean(c.productionList?.capsule?.shortName) || clean(c.productionList?.capsule?.name) || clean(c.productionList?.name) || na,
            caseRating:         c.caseRating != null ? String(c.caseRating) : na,
            caseType:           c.caseType || "Normal",
            writerName:         c.writer?.name || na,
            writerQualityScore: c.writerQualityScore != null ? String(c.writerQualityScore) : na,
            editorName:         c.editor?.name || na,
            qaVideoStartDate:   c.qaVideoMeetingDate
                ? c.qaVideoMeetingDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                : na,
            videoQualityRating: c.videoQualityRating != null ? String(c.videoQualityRating) : na,
            editorQualityScore: c.editorQualityScore != null ? String(c.editorQualityScore) : na,
        })) });
    } catch (e) { return serverError(e, "monthly-andrew-video-cases"); }
}
