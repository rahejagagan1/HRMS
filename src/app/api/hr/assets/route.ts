import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { can } from "@/lib/permissions/can";

// Asset write permission — OR-gates two paths so users get in via
// EITHER the new RBAC OR the legacy role check:
//   1. can(user, "MANAGE_ASSETS") — covers IT Security designations,
//      backfilled HR / admin / CEO sessions, and devs (blanket).
//   2. Legacy fallback — anyone whose orgLevel / role places them in
//      the HR-admin tier. Catches users whose designation hasn't been
//      backfilled yet on prod (the failure mode we hit for Khushal —
//      special_access, but his session's permissions array didn't
//      include MANAGE_ASSETS because the seed re-run hadn't happened).
//      As soon as the designation backfill lands the legacy branch is
//      a no-op for him — both paths agree.
function canManageAssets(user: any): boolean {
  if (!user) return false;
  if (can(user, "MANAGE_ASSETS")) return true;
  return user.orgLevel === "ceo"
    || user.orgLevel === "special_access"
    || user.orgLevel === "hr_manager"
    || user.role === "hr_manager"
    || user.role === "admin"
    || user.isDeveloper === true;
}

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!can(session!.user as any, "MANAGE_ASSETS")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const category = searchParams.get("category");
    const mineParam = searchParams.get("mine") === "true";

    // Scope resolution — anyone without MANAGE_ASSETS is FORCED to
    // their own assigned-and-not-yet-returned items, regardless of
    // any `?mine=` value. Asset-managing roles can still pass
    // ?mine=true explicitly when they want to preview their own view.
    const session = await getServerSession(authOptions);
    const sUser = session?.user as any;
    const canManage = can(sUser, "MANAGE_ASSETS");
    const mine = !canManage || mineParam;

    // Resolve the viewer's user id for the mine-scope filter. Prefer
    // session.dbId (set on every login); fall back to a DB lookup by
    // email so an older session that pre-dates the dbId field still
    // works without a forced re-login.
    let viewerId: number | null = null;
    if (sUser?.dbId != null) {
      const n = Number(sUser.dbId);
      if (Number.isInteger(n) && n > 0) viewerId = n;
    }
    if (viewerId == null && sUser?.email) {
      const row = await prisma.user.findUnique({ where: { email: sUser.email }, select: { id: true } });
      if (row?.id) viewerId = row.id;
    }

    const where: any = {};
    if (status) where.status = status;
    if (category) where.category = category;
    if (mine) {
      // No valid viewer id → return empty rather than leaking the
      // full register through a misconfigured session.
      if (viewerId == null) return NextResponse.json([]);
      where.assignments = { some: { userId: viewerId, returnedAt: null } };
    }

    const assets = await prisma.asset.findMany({
      where, include: { assignments: { where: { returnedAt: null }, include: { user: { select: { id: true, name: true, profilePictureUrl: true } } }, take: 1 } },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(assets);
  } catch (e) { return serverError(e, "GET /api/hr/assets"); }
}

// POST accepts TWO shapes — legacy single-asset and batch multi-asset:
//
//  Legacy (still supported for any older caller):
//    { name, category, ...assetFields, assignedToUserId? }
//    → creates one Asset.
//
//  Batch (new — drives the redesigned "Add Assets" modal so HR can
//   hand a new hire their laptop + monitor + keyboard + mouse +
//   headset in ONE submit):
//    {
//      assignedToUserId?: number,    // shared by every item; null = stock
//      purchaseDate?: ISO string,    // shared
//      notes?: string,               // shared
//      items: [{ name, category, condition?, serialNumber?, currentValue? }, …]
//    }
//    → creates N Assets atomically (prisma transaction). If any item
//      fails validation, the whole batch rolls back so HR doesn't end
//      up with half a kit on a fresh joiner.
//
// The legacy branch stays bytewise-equivalent so any client that hasn't
// upgraded keeps working.
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManageAssets(session?.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();

    // ── BATCH branch ────────────────────────────────────────────────
    if (Array.isArray(body?.items)) {
      const sharedAssignee = body.assignedToUserId
        ? Number(body.assignedToUserId)
        : null;
      const sharedPurchaseDate = body.purchaseDate ? new Date(body.purchaseDate) : null;
      const sharedNotes: string | null = body.notes ? String(body.notes) : null;
      const items: any[] = body.items;
      if (items.length === 0) {
        return NextResponse.json({ error: "Add at least one item." }, { status: 400 });
      }
      // Validate every row up-front so a transaction failure surfaces a
      // clear message (rather than a generic Prisma error).
      for (const [i, it] of items.entries()) {
        if (!it?.name || !String(it.name).trim()) {
          return NextResponse.json({ error: `Item #${i + 1}: name is required.` }, { status: 400 });
        }
        if (!it?.category || !String(it.category).trim()) {
          return NextResponse.json({ error: `Item #${i + 1}: category is required.` }, { status: 400 });
        }
      }
      const created = await prisma.$transaction(items.map((it) => prisma.asset.create({
        data: {
          name: String(it.name).trim(),
          category: String(it.category).trim(),
          serialNumber: it.serialNumber ? String(it.serialNumber).trim() : null,
          condition: it.condition || "good",
          currentValue: it.currentValue != null && it.currentValue !== ""
            ? Number(it.currentValue)
            : null,
          purchaseDate: sharedPurchaseDate,
          notes: sharedNotes,
          status: sharedAssignee ? "assigned" : "available",
          ...(sharedAssignee
            ? {
                assignments: {
                  create: {
                    userId: sharedAssignee,
                    conditionOnAssign: it.condition || "good",
                  },
                },
              }
            : {}),
        },
        include: { assignments: { include: { user: { select: { id: true, name: true } } } } },
      })));
      return NextResponse.json({ ok: true, count: created.length, assets: created });
    }

    // ── LEGACY single-asset branch ─────────────────────────────────
    if (body.purchaseDate) body.purchaseDate = new Date(body.purchaseDate);
    const { assignedToUserId, ...assetData } = body;
    if (assignedToUserId) assetData.status = "assigned";
    const asset = await prisma.asset.create({
      data: {
        ...assetData,
        ...(assignedToUserId
          ? {
              assignments: {
                create: {
                  userId: Number(assignedToUserId),
                  conditionOnAssign: assetData.condition ?? null,
                },
              },
            }
          : {}),
      },
      include: { assignments: { include: { user: { select: { id: true, name: true } } } } },
    });
    return NextResponse.json(asset);
  } catch (e) { return serverError(e, "POST /api/hr/assets"); }
}
