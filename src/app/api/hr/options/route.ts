// Generic dropdown-options API — anyone can read; HR admin tier can
// write. Used by the CustomSelect component to load + manage custom
// values per dropdown (department, jobTitle, etc.).
//
// Endpoints:
//   GET    /api/hr/options?key=<listKey>     — list values for a key
//   POST   /api/hr/options                   — { listKey, value }
//   DELETE /api/hr/options?id=<id>           — remove a value

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
// Canonical HR-admin gate — uses the new RBAC MANAGE_HR
// permission when resolved, falls back to legacy orgLevel/role.
// Previously this route had its OWN local isHRAdmin that
// hard-coded orgLevel checks and missed the permission-based
// path entirely — so HR Managers who only had MANAGE_HR granted
// (no legacy orgLevel="hr_manager") got 403'd when they clicked
// "+ Add custom value" in the CustomSelect dropdown. User report:
// "for HR Manager Add custom value isn't available, fix it".
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

type Row = { id: number; listKey: string; value: string; createdAt: Date };

export async function GET(req: NextRequest) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const { searchParams } = new URL(req.url);
    const key = (searchParams.get("key") || "").trim();
    if (!key) return NextResponse.json({ items: [] });

    const items = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT id, "listKey", value, "createdAt" FROM "OptionList"
        WHERE "listKey" = $1
        ORDER BY value ASC`,
      key,
    );
    return NextResponse.json({ items });
  } catch (e) {
    return serverError(e, "GET /api/hr/options");
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
    const listKey = String(body?.listKey ?? "").trim();
    const value   = String(body?.value   ?? "").trim();
    if (!listKey)        return NextResponse.json({ error: "listKey required" }, { status: 400 });
    if (!value)          return NextResponse.json({ error: "value required"   }, { status: 400 });
    if (value.length > 120) {
      return NextResponse.json({ error: "value too long (max 120 chars)" }, { status: 400 });
    }

    const createdBy = await resolveUserId(session);
    // ON CONFLICT: re-adding the same (listKey, value) is a no-op,
    // returns the existing row so callers can rely on a deterministic
    // response shape.
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `INSERT INTO "OptionList" ("listKey", value, "createdBy")
       VALUES ($1, $2, $3)
       ON CONFLICT ("listKey", value) DO UPDATE SET value = EXCLUDED.value
       RETURNING id, "listKey", value, "createdAt"`,
      listKey, value, createdBy,
    );
    return NextResponse.json({ item: rows[0] }, { status: 201 });
  } catch (e) {
    return serverError(e, "POST /api/hr/options");
  }
}

export async function DELETE(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const idRaw = searchParams.get("id");
    const id = idRaw && /^\d+$/.test(idRaw) ? parseInt(idRaw, 10) : NaN;
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "OptionList" WHERE id = $1`, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/options");
  }
}
