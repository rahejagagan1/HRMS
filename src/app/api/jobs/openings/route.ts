// Public endpoint — no auth. Returns the list of currently-open job
// titles so the public application form can populate its dropdown.
//
// Raw SQL because the typed Prisma client may not know about the new
// JobOpening table until `prisma generate` reruns.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Only PUBLISHED roles with a future (or null) close date show up
    // here — DRAFT / ON_HOLD / CLOSED are intentionally hidden. The
    // legacy isOpen flag stays consistent (mirrored by the publish
    // workflow) so anything pre-migration still appears correctly.
    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: number; title: string; department: string | null; location: string | null; slug: string | null }>
    >(
      `SELECT id, title, department, location, "publicSlug" AS slug
         FROM "JobOpening"
        WHERE "status" = 'published'
          AND ("closesAt" IS NULL OR "closesAt" > NOW())
        ORDER BY title ASC`,
    );
    return NextResponse.json(rows);
  } catch (e: any) {
    console.error("[/api/jobs/openings] failed:", e);
    return NextResponse.json({ error: "Could not load openings" }, { status: 500 });
  }
}
