// HR-side offboarding — ExitNote endpoints.
//
//   GET  /api/hr/exits/:id/notes  → notes ordered newest-first
//   POST /api/hr/exits/:id/notes  → adds a note (body required)
//
// Notes mirror Keka's "Add note" surface in the offboarding drawer:
// HR drops a chronological log of what's been done / agreed.
//
// Raw SQL because the typed Prisma client may not yet know about
// ExitNote (same pattern the rest of the offboarding routes use).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

// Use the canonical isHRAdmin helper. Was inline before — same
// set of roles, just centralised so all exits sub-routes agree.
const canManage = (session: any) => isHRAdmin(session?.user);

type NoteRow = {
  id: number;
  exitId: number;
  authorId: number | null;
  authorName: string | null;
  authorPicture: string | null;
  body: string;
  createdAt: Date;
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    // Joined to User so the UI can render the author's name + avatar
    // without a second fetch. System entries (authorId NULL) render
    // as "System".
    const rows = await prisma.$queryRawUnsafe<NoteRow[]>(
      `SELECT n.id, n."exitId", n."authorId",
              u.name              AS "authorName",
              u."profilePictureUrl" AS "authorPicture",
              n.body, n."createdAt"
         FROM "ExitNote" n
         LEFT JOIN "User" u ON u.id = n."authorId"
        WHERE n."exitId" = $1
        ORDER BY n."createdAt" DESC`,
      id,
    );
    return NextResponse.json(rows);
  } catch (e: any) {
    console.error("[GET /api/hr/exits/:id/notes] failed:", e);
    return NextResponse.json({ error: "Could not load notes" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    if (!text) return NextResponse.json({ error: "Note body is required" }, { status: 400 });

    // Confirm the exit row actually exists so we don't insert an
    // orphan note (the FK would catch it anyway, but a clear 404 is
    // friendlier than a constraint-violation message).
    const exists = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT id FROM "EmployeeExit" WHERE id = $1`, id,
    );
    if (exists.length === 0) {
      return NextResponse.json({ error: "Exit not found" }, { status: 404 });
    }

    const authorId = (session!.user as any)?.dbId ?? null;

    // Insert and return the row in one round-trip so the UI can append
    // it locally without a re-fetch.
    const created = await prisma.$queryRawUnsafe<NoteRow[]>(
      `INSERT INTO "ExitNote" ("exitId", "authorId", body)
       VALUES ($1, $2, $3)
       RETURNING id, "exitId", "authorId", body, "createdAt",
                 NULL::text AS "authorName", NULL::text AS "authorPicture"`,
      id, authorId, text,
    );

    // Hydrate author fields from the User table (the RETURNING above
    // can't join, and we want the UI to render the avatar immediately).
    if (created[0] && authorId) {
      const u = await prisma.user.findUnique({
        where: { id: authorId },
        select: { name: true, profilePictureUrl: true },
      });
      created[0].authorName    = u?.name ?? null;
      created[0].authorPicture = u?.profilePictureUrl ?? null;
    }

    return NextResponse.json(created[0]);
  } catch (e: any) {
    console.error("[POST /api/hr/exits/:id/notes] failed:", e);
    return NextResponse.json({ error: e?.message || "Could not save note" }, { status: 500 });
  }
}
