import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { canUseMissingFields } from "@/lib/missing-fields/access";

export const dynamic = "force-dynamic";

// PUT /api/missing-fields/lists  { activeListIds: number[] }
// Save which production lists ("capsules") the tool manages + scans.
export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canUseMissingFields(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const activeListIds: number[] = Array.isArray(body?.activeListIds)
      ? Array.from(new Set(body.activeListIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)))
      : [];

    await prisma.$executeRawUnsafe(
      `INSERT INTO "MissingFieldsConfig" ("id", "activeListIds", "updatedAt")
         VALUES (1, $1::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT ("id")
         DO UPDATE SET "activeListIds" = $1::jsonb, "updatedAt" = CURRENT_TIMESTAMP`,
      JSON.stringify(activeListIds),
    );

    return NextResponse.json({ ok: true, activeListIds });
  } catch (e) {
    return serverError(e, "PUT /api/missing-fields/lists");
  }
}
