import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { canUseMissingFields } from "@/lib/missing-fields/access";
import { sanitizeStatusPlan } from "@/lib/missing-fields/catalog";

export const dynamic = "force-dynamic";

// PUT /api/missing-fields/plans  { productionListId, plan: { [status]: string[] } }
// Upsert one capsule's plan — a map of case status -> required field keys for
// cases in that status. Unknown statuses/fields are dropped.
export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canUseMissingFields(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const productionListId = Number(body?.productionListId);
    if (!Number.isInteger(productionListId) || productionListId <= 0) {
      return NextResponse.json({ error: "Invalid productionListId" }, { status: 400 });
    }
    const plan = sanitizeStatusPlan(body?.plan);

    await prisma.$executeRawUnsafe(
      `INSERT INTO "CapsuleFieldPlan" ("productionListId", "requiredFields", "updatedAt")
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT ("productionListId")
         DO UPDATE SET "requiredFields" = $2::jsonb, "updatedAt" = CURRENT_TIMESTAMP`,
      productionListId,
      JSON.stringify(plan),
    );

    return NextResponse.json({ ok: true, productionListId, plan });
  } catch (e) {
    return serverError(e, "PUT /api/missing-fields/plans");
  }
}
