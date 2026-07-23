import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireAdmin, resolveUserId, serverError } from "@/lib/api-auth";
import { sendEmail, emailsForAllActiveUsers } from "@/lib/email/sender";
import { announcementEmail } from "@/lib/email/templates";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const now = new Date();
    const announcements = await prisma.announcement.findMany({
      where: { publishAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
      include: {
        postedBy: { select: { id: true, name: true, profilePictureUrl: true } },
        reads: { where: { userId: myId }, select: { readAt: true } },
        _count: { select: { reads: true } },
      },
      orderBy: [{ isPinned: "desc" }, { publishAt: "desc" }],
      take: 50,
    });
    return NextResponse.json(announcements);
  } catch (e) { return serverError(e, "GET /api/hr/announcements"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;
  try {
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const body = await req.json();
    if (body.publishAt) body.publishAt = new Date(body.publishAt);
    if (body.expiresAt) body.expiresAt = new Date(body.expiresAt);
    const ann = await prisma.announcement.create({
      data: { ...body, postedById: myId },
      include: { postedBy: { select: { id: true, name: true } } },
    });

    // Broadcast email to every active user — fire-and-forget, never blocks
    // the response. Skipped if the announcement is scheduled for later.
    const publishesNow = !ann.publishAt || new Date(ann.publishAt).getTime() <= Date.now();
    if (publishesNow) {
      void (async () => {
        try {
          const to = await emailsForAllActiveUsers();
          if (to.length === 0) return;
          await sendEmail({
            to,
            content: announcementEmail({
              title: (ann as any).title || "New announcement",
              body:  (ann as any).body  || "",
              authorName: ann.postedBy?.name || "HR",
            }),
          });
        } catch (e) { console.error("[email] announcement broadcast failed:", e); }
      })();
    }

    return NextResponse.json(ann);
  } catch (e) { return serverError(e, "POST /api/hr/announcements"); }
}
