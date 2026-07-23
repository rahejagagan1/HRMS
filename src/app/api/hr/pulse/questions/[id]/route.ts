// Weekly Pulse — single-question PATCH / DELETE.
// Both gated to HR-admin tier (mirrors POST in the parent route).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

const VALID_TYPES = new Set(["emoji", "rating", "likert", "enps", "text"]);

async function gate(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return { errorResponse };
  if (!isHRAdmin(session!.user)) {
    return { errorResponse: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { errorResponse } = await gate(req);
  if (errorResponse) return errorResponse;
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));

    // Build SET clause from only-the-fields-the-client-sent so a
    // PATCH with just { text } doesn't blank `emojis` etc.
    const sets: string[] = [];
    const args: any[] = [];
    if (typeof body?.text === "string") {
      const v = body.text.trim();
      if (!v || v.length > 400) {
        return NextResponse.json({ error: "text required (≤400 chars)" }, { status: 400 });
      }
      args.push(v); sets.push(`"text" = $${args.length}`);
    }
    if (typeof body?.type === "string") {
      if (!VALID_TYPES.has(body.type)) {
        return NextResponse.json({ error: "type must be emoji | rating | likert | enps | text" }, { status: 400 });
      }
      args.push(body.type); sets.push(`"type" = $${args.length}`);
    }
    if ("emojis" in body) {
      const v = Array.isArray(body.emojis) && body.emojis.length === 5
        ? JSON.stringify(body.emojis.map((e: any) => String(e).slice(0, 8)))
        : null;
      args.push(v); sets.push(`"emojis" = $${args.length}::jsonb`);
    }
    if (typeof body?.order === "number" && Number.isInteger(body.order)) {
      args.push(body.order); sets.push(`"order" = $${args.length}`);
    }
    if (typeof body?.isActive === "boolean") {
      args.push(body.isActive); sets.push(`"isActive" = $${args.length}`);
    }
    // Brand re-tagging. NOT NULL after the strict-brands migration —
    // every question belongs to exactly one brand.
    if ("brand" in body) {
      const raw = String(body.brand ?? "").trim().toLowerCase();
      const v =
        raw === "nb_media" || raw === "nbmedia" || raw === "nb media" ? "NB Media"
      : raw === "yt_labs"  || raw === "ytlabs"  || raw === "yt labs"  ? "YT Labs"
      : null;
      if (!v) {
        return NextResponse.json({ error: "brand must be 'NB Media' or 'YT Labs'" }, { status: 400 });
      }
      args.push(v); sets.push(`brand = $${args.length}`);
    }
    if (sets.length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    args.push(id);
    const updated = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE "PulseQuestion"
          SET ${sets.join(", ")}, "updatedAt" = NOW()
        WHERE id = $${args.length}
        RETURNING id, week, "order", text, type, emojis, "isActive", "surveyType", brand, "createdAt", "updatedAt"`,
      ...args,
    );
    if (!updated[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ question: updated[0] });
  } catch (e) {
    return serverError(e, "PATCH /api/hr/pulse/questions/[id]");
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { errorResponse } = await gate(_req);
  if (errorResponse) return errorResponse;
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }
    // Hard delete. No PulseResponse FK yet — when we ship the
    // employee-facing answer flow, add ON DELETE SET NULL or
    // switch this to a soft-delete (isActive=false).
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM "PulseQuestion" WHERE id = $1`, id,
    );
    return NextResponse.json({ ok: true, deleted: n });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/pulse/questions/[id]");
  }
}
