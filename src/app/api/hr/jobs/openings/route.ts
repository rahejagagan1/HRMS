// HR-admin CRUD for JobOpening rows. Used by the Hiring → Openings tab
// to add new roles, toggle Open/Closed, and update title / department /
// location / description.
//
// Raw SQL keeps us off the typed Prisma client, which may not know the
// new tables until `prisma generate` reruns.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// RBAC-designation-driven (policy 2026-07-14): MANAGE_HIRING is the hiring-
// console permission. Legacy expression kept only as the fallback for
// sessions without resolved permissions.
import { can, hasResolvedPermissions } from "@/lib/permissions/can";
function canManageHiring(session: any): boolean {
  const u = session?.user as any;
  if (!u) return false;
  if (hasResolvedPermissions(u)) return can(u, "MANAGE_HIRING");
  return u.orgLevel === "ceo" || u.orgLevel === "hr_manager" || u.role === "admin" || u.isDeveloper === true;
}

export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: number; title: string; department: string | null; location: string | null;
              description: string | null; isOpen: boolean; createdAt: Date }>
    >(
      `SELECT id, title, department, location, description, "isOpen", "createdAt"
         FROM "JobOpening"
        ORDER BY "isOpen" DESC, title ASC`,
    );
    return NextResponse.json(rows);
  } catch (e: any) {
    console.error("[GET /api/hr/jobs/openings] failed:", e);
    return NextResponse.json({ error: "Could not load openings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManageHiring(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json();
    const title = String(body?.title ?? "").trim();
    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    const department = body?.department ? String(body.department).trim() : null;
    const location   = body?.location   ? String(body.location).trim()   : null;
    const description = body?.description ? String(body.description).trim() : null;
    const isOpen = body?.isOpen === undefined ? true : !!body.isOpen;

    const inserted = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `INSERT INTO "JobOpening" (title, department, location, description, "isOpen", "updatedAt")
       VALUES ($1,$2,$3,$4,$5, now())
       RETURNING id`,
      title, department, location, description, isOpen,
    );
    return NextResponse.json({ id: inserted[0]?.id });
  } catch (e: any) {
    if (String(e?.message || "").includes("duplicate")) {
      return NextResponse.json({ error: "A role with that title already exists" }, { status: 409 });
    }
    console.error("[POST /api/hr/jobs/openings] failed:", e);
    return NextResponse.json({ error: e?.message || "Save failed" }, { status: 500 });
  }
}
