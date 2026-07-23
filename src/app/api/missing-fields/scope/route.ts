import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { canUseMissingFields } from "@/lib/missing-fields/access";

export const dynamic = "force-dynamic";

// PUT /api/missing-fields/scope  { inScopeStatuses: string[] }
// Save the global list of Case.status values a run should scan. Single-row
// config (id = 1).
export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canUseMissingFields(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const inScopeStatuses: string[] = Array.isArray(body?.inScopeStatuses)
      ? Array.from(new Set(body.inScopeStatuses.filter((s: unknown) => typeof s === "string" && (s as string).length > 0)))
      : [];

    await prisma.$executeRawUnsafe(
      `INSERT INTO "MissingFieldsConfig" ("id", "inScopeStatuses", "updatedAt")
         VALUES (1, $1::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT ("id")
         DO UPDATE SET "inScopeStatuses" = $1::jsonb, "updatedAt" = CURRENT_TIMESTAMP`,
      JSON.stringify(inScopeStatuses),
    );

    return NextResponse.json({ ok: true, inScopeStatuses });
  } catch (e) {
    return serverError(e, "PUT /api/missing-fields/scope");
  }
}
