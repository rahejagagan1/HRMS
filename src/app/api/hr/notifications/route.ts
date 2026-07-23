import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET /api/hr/notifications?view=unread|all&limit=20&type=<NotificationType>&countOnly=1
//   type     — narrow to one notification type (e.g. "job_application")
//   countOnly — skip the items array, return just `{ unreadCount, typedCount }`.
//               Lightweight polling shape for tab-badge widgets.
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const { searchParams } = new URL(req.url);
    const view      = searchParams.get("view") || "all";
    const limit     = Math.min(parseInt(searchParams.get("limit") || "20", 10) || 20, 100);
    const type      = searchParams.get("type") || null;
    const countOnly = searchParams.get("countOnly") === "1" || searchParams.get("countOnly") === "true";

    const where: any = { userId: myId };
    if (view === "unread") where.isRead = false;
    if (type)              where.type = type;

    // typedCount = unread rows matching the optional `type` filter so a
    // single round-trip can drive a per-tab badge (e.g. unread
    // job_application count on the Candidates tab).
    const typedWhere: any = { userId: myId, isRead: false };
    if (type) typedWhere.type = type;

    if (countOnly) {
      const [unreadCount, typedCount] = await Promise.all([
        prisma.notification.count({ where: { userId: myId, isRead: false } }),
        prisma.notification.count({ where: typedWhere }),
      ]);
      return NextResponse.json({ unreadCount, typedCount });
    }

    const [items, unreadCount, typedCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { actor: { select: { id: true, name: true, profilePictureUrl: true } } },
      }),
      prisma.notification.count({ where: { userId: myId, isRead: false } }),
      prisma.notification.count({ where: typedWhere }),
    ]);

    return NextResponse.json({ items, unreadCount, typedCount });
  } catch (e) { return serverError(e, "GET /api/hr/notifications"); }
}

// PATCH /api/hr/notifications
// Body shapes:
//   { id: number, action: "read" }
//   { action: "read_all" }
//   { action: "read_by_type", type: NotificationType, entityId?: number }
//     — marks every unread notification of that type (and optionally
//       that specific entityId) as read for the current user. Drives
//       the per-tab badge clearing (e.g. "user viewed the Candidates
//       tab → clear all unread job_application notifications").
export async function PATCH(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const body = await req.json();
    const now  = new Date();

    if (body?.action === "read_all") {
      const res = await prisma.notification.updateMany({
        where: { userId: myId, isRead: false },
        data:  { isRead: true, readAt: now },
      });
      return NextResponse.json({ updated: res.count });
    }
    if (body?.action === "read_by_type" && typeof body.type === "string") {
      const where: any = { userId: myId, isRead: false, type: body.type };
      if (typeof body.entityId === "number") where.entityId = body.entityId;
      const res = await prisma.notification.updateMany({
        where,
        data: { isRead: true, readAt: now },
      });
      return NextResponse.json({ updated: res.count });
    }
    if (body?.action === "read" && typeof body.id === "number") {
      const res = await prisma.notification.updateMany({
        where: { id: body.id, userId: myId },
        data:  { isRead: true, readAt: now },
      });
      if (res.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ updated: res.count });
    }
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e) { return serverError(e, "PATCH /api/hr/notifications"); }
}

// DELETE /api/hr/notifications?scope=read
// Removes notifications belonging to the current user. The `scope` query
// controls what's deleted:
//   • "read" (default) — delete only notifications already marked isRead.
//   • "all"            — delete everything for this user (tidy-up nuke).
export async function DELETE(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get("scope") || "read";
    if (scope !== "read" && scope !== "all") {
      return NextResponse.json({ error: "scope must be 'read' or 'all'" }, { status: 400 });
    }
    const where = scope === "all"
      ? { userId: myId }
      : { userId: myId, isRead: true };
    const res = await prisma.notification.deleteMany({ where });
    return NextResponse.json({ deleted: res.count });
  } catch (e) { return serverError(e, "DELETE /api/hr/notifications"); }
}
