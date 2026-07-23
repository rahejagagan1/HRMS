import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { canUseMissingFields } from "@/lib/missing-fields/access";

export const dynamic = "force-dynamic";

// GET /api/missing-fields/runs        → recent run history (light, no results)
// GET /api/missing-fields/runs?id=123 → one run with its full flagged results
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canUseMissingFields(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (Number.isInteger(id) && id > 0) {
      const rows = await prisma.$queryRawUnsafe<Array<any>>(
        `SELECT "id","runAt","runByName","summary","results" FROM "MissingFieldsRun" WHERE id = $1`,
        id,
      );
      return NextResponse.json({ run: rows[0] ?? null });
    }
    const runs = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT "id","runAt","runByName","scanned","flagged" FROM "MissingFieldsRun" ORDER BY "runAt" DESC LIMIT 50`,
    );
    return NextResponse.json({ runs });
  } catch (e) {
    return serverError(e, "GET /api/missing-fields/runs");
  }
}
