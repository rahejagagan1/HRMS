// POST /api/hr/hiring/jobs/[id]/priority
//   body: { isPriority: boolean }
//
// Star-flag toggle for the Jobs grid. Shared across HR (not per-user)
// so the team is aligned on which requisitions are hot.
//
// Soft-fails 200 when the isPriority column doesn't exist yet (pre-
// migration on local dev) so the UI doesn't break — the toggle just
// reverts to its prior state on the next refresh. Once the migration
// is applied the toggle starts persisting.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const isPriority = body?.isPriority === true;

    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "JobOpening" SET "isPriority" = $1, "updatedAt" = NOW() WHERE id = $2`,
        isPriority, id,
      );
    } catch (e: any) {
      const code = e?.meta?.code || e?.code;
      const msg = String(e?.meta?.message || e?.message || "");
      // Soft-fail when the migration hasn't been applied to this DB.
      if (code === "42703" || /does not exist/i.test(msg)) {
        return NextResponse.json({ ok: true, persisted: false });
      }
      throw e;
    }
    return NextResponse.json({ ok: true, isPriority });
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/jobs/[id]/priority");
  }
}
