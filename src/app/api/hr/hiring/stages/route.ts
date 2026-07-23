// HR Hiring — pipeline stages CRUD.
//
//   GET    /api/hr/hiring/stages         → list (optionally include inactive)
//   POST   /api/hr/hiring/stages         → create a new stage
//   PATCH  /api/hr/hiring/stages         → bulk reorder (body: { order: [id, id, …] })
//
// Per-stage PATCH / DELETE live in ./[id]/route.ts.
//
// Soft-fails GET when the HiringStage table doesn't exist yet (pre-
// migration on dev) — returns an empty array so the kanban renders
// "No stages configured" instead of 500'ing the whole page.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

const ALLOWED_COLORS = new Set([
  "slate", "blue", "cyan", "violet", "amber", "pink", "emerald", "rose", "indigo", "teal", "orange",
]);

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { searchParams } = new URL(req.url);
    const includeInactive = searchParams.get("includeInactive") === "1";

    let stages: any[] = [];
    try {
      stages = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, key, label, "sortOrder", kind, color, "isActive"
           FROM "HiringStage"
          ${includeInactive ? "" : `WHERE "isActive" = true`}
          ORDER BY "sortOrder" ASC`,
      );
    } catch (e: any) {
      const code = e?.meta?.code || e?.code;
      const msg = String(e?.meta?.message || e?.message || "");
      if (code !== "42P01" && !/does not exist/i.test(msg)) throw e;
    }
    return NextResponse.json({ stages });
  } catch (e) {
    return serverError(e, "GET /api/hr/hiring/stages");
  }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const label = String(body?.label ?? "").trim();
    if (!label) return NextResponse.json({ error: "Label required" }, { status: 400 });

    const color = ALLOWED_COLORS.has(body?.color) ? body.color : "slate";
    // Auto-generate a unique key from the label — caller can pass an
    // explicit `key` if they want one (must be lowercase + underscores).
    const proposedKey = (body?.key ?? label)
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!proposedKey) return NextResponse.json({ error: "Could not derive a key from the label" }, { status: 400 });

    // Find a sortOrder that puts the new stage just BEFORE the
    // terminal Hired / Rejected stages (sortOrder >= 100). Mid-flow
    // stages cluster between 10 and 90.
    const maxActive = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(MAX("sortOrder"), 0) AS m FROM "HiringStage"
        WHERE "kind" = 'active'`,
    );
    const nextSort = Math.min(90, Number(maxActive[0]?.m ?? 0) + 10);

    try {
      const row = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO "HiringStage" ("key", "label", "sortOrder", "kind", "color", "isActive")
         VALUES ($1, $2, $3, 'active', $4, true)
         RETURNING id, key, label, "sortOrder", kind, color, "isActive"`,
        proposedKey, label, nextSort, color,
      );
      return NextResponse.json({ stage: row[0] }, { status: 201 });
    } catch (e: any) {
      const msg = String(e?.meta?.message || e?.message || "");
      if (/duplicate|unique/i.test(msg)) {
        return NextResponse.json(
          { error: `A stage with key "${proposedKey}" already exists. Pick a different label.` },
          { status: 409 },
        );
      }
      throw e;
    }
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/stages");
  }
}

/** Bulk reorder. Body: { order: number[] } — array of stage IDs in
 *  the new display order. The handler assigns sortOrder = (index * 10)
 *  to each, leaving room for future insertions. Terminal stages
 *  (Hired/Rejected) are excluded from reordering and stay at >=100. */
export async function PATCH(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    if (!Array.isArray(body?.order)) {
      return NextResponse.json({ error: "order array required" }, { status: 400 });
    }
    const ids: number[] = body.order
      .map((x: any) => Number(x))
      .filter((n: number) => Number.isInteger(n));

    // Skip terminal stages — they're not draggable. We re-assign
    // sortOrder only to the 'active' kind based on the passed order.
    const active = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM "HiringStage" WHERE "kind" = 'active'`,
    );
    const activeIds = new Set(active.map((r) => Number(r.id)));

    await prisma.$transaction(async (tx) => {
      let order = 10;
      for (const id of ids) {
        if (!activeIds.has(id)) continue;
        await tx.$executeRawUnsafe(
          `UPDATE "HiringStage" SET "sortOrder" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
          order,
          id,
        );
        order += 10;
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "PATCH /api/hr/hiring/stages");
  }
}
