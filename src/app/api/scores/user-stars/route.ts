import { serverError } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serializeBigInt } from "@/lib/utils";
import { getFinalScoreBrackets, scoreToFinalStars } from "@/lib/ratings/writer-calculator";
// Note: getFinalScoreBrackets / scoreToFinalStars are stable helpers kept in writer-calculator.
// They are also used by the formula engine internally.

export const dynamic = "force-dynamic";

// GET: Fetch auto-calculated stars for a user in a given month
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const userId = parseInt(searchParams.get("userId") || "0");
        const month = searchParams.get("month"); // "YYYY-MM"

        if (!userId || !month) {
            return NextResponse.json({ error: "Missing userId or month" }, { status: 400 });
        }

        const [year, mon] = month.split("-").map(Number);
        const monthDate = new Date(Date.UTC(year, mon - 1, 1));

        const rating = await prisma.monthlyRating.findFirst({
            where: {
                userId,
                month: monthDate,
            },
            orderBy: { calculatedAt: "desc" },
            select: {
                roleType: true,
                parametersJson: true,
                casesCompleted: true,
                overallRating: true,
                rankInRole: true,
            },
        });

        if (!rating || !rating.parametersJson) {
            return NextResponse.json(null);
        }

        // Compute finalStars from overallRating using configurable brackets
        let finalStars: number | null = null;
        if (rating.overallRating != null) {
            const brackets = await getFinalScoreBrackets();
            finalStars = scoreToFinalStars(Number(rating.overallRating), brackets);
        }

        return NextResponse.json(serializeBigInt({
            roleType: rating.roleType,
            parameters: rating.parametersJson,
            casesCompleted: rating.casesCompleted,
            overallRating: rating.overallRating,
            finalStars,
            rankInRole: rating.rankInRole,
        }));
    } catch (error) {
        console.error("User stars API error:", error);
        return serverError(error, "route");
    }
}
