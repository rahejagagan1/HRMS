// HR-admin endpoint for the WFH monthly quota policy.
//
//   GET   /api/hr/admin/wfh-policy
//     → { limitEnabled, nbMediaQuota, ytLabsQuota, updatedAt,
//          updatedByName }
//
//   PATCH /api/hr/admin/wfh-policy
//     body: { limitEnabled?, nbMediaQuota?, ytLabsQuota? }
//     → updated row
//
// HR-admin tier only. The toggle + quotas drive both the
// auto-credit cron and the WFH-request POST guard.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { getWfhPolicy } from "@/lib/hr/wfh-balance";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const policy = await getWfhPolicy();
    return NextResponse.json(policy);
  } catch (e) {
    return serverError(e, "GET /api/hr/admin/wfh-policy");
  }
}

export async function PATCH(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json().catch(() => ({}));

    // Build SET clause from only-the-fields-the-client-sent so a
    // PATCH with only `limitEnabled` doesn't zero the quotas.
    const sets: string[] = [];
    const args: any[] = [];
    if (typeof body?.limitEnabled === "boolean") {
      args.push(body.limitEnabled);
      sets.push(`"limitEnabled" = $${args.length}`);
    }
    if (Number.isInteger(body?.nbMediaQuota) && body.nbMediaQuota >= 0 && body.nbMediaQuota <= 31) {
      args.push(body.nbMediaQuota);
      sets.push(`"nbMediaQuota" = $${args.length}`);
    }
    if (Number.isInteger(body?.ytLabsQuota) && body.ytLabsQuota >= 0 && body.ytLabsQuota <= 31) {
      args.push(body.ytLabsQuota);
      sets.push(`"ytLabsQuota" = $${args.length}`);
    }
    if (sets.length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const callerId = await resolveUserId(session);
    args.push(callerId ?? null);
    sets.push(`"updatedById" = $${args.length}`);

    await prisma.$executeRawUnsafe(
      `UPDATE "WfhPolicy" SET ${sets.join(", ")}, "updatedAt" = NOW() WHERE id = 1`,
      ...args,
    );
    const updated = await getWfhPolicy();
    return NextResponse.json(updated);
  } catch (e) {
    return serverError(e, "PATCH /api/hr/admin/wfh-policy");
  }
}
