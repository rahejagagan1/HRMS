// KPI document management — upload, list, and delete the per-department
// KPI files. Admin-only: only `isFullHRAdmin` (HR Manager + admin tier)
// can write. One document per department; re-uploading replaces the
// existing file in place.
//
// Files land in /public/uploads/kpis/<random>-<safe-name> so they're
// served via Next's static asset handler.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { can, hasResolvedPermissions } from "@/lib/permissions/can";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024;       // 10 MB
const ALLOWED_EXTS   = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx"]);

type DocRow = {
  id: number;
  brand: string;
  department: string;
  fileName: string;
  fileUrl: string;
  uploadedAt: Date;
  uploadedBy: number | null;
};

/** Resolve `?brand=` from kebab-case slug to the storage value used in
 *  `KpiDocument.brand`. Empty / unknown / "all" → null (no filter). */
function parseBrandParam(raw: string | null): "NB Media" | "YT Labs" | null {
  const v = (raw ?? "").toLowerCase();
  if (v === "yt-labs" || v === "yt")     return "YT Labs";
  if (v === "nb-media" || v === "nb")    return "NB Media";
  return null;
}

// RBAC-designation-driven (policy 2026-07-14): MANAGE_KPIS is the KPI-docs
// permission (the actual HR Manager designation holds it; plain HR staff
// deliberately don't — matching the old role=hr_manager-only check). Legacy
// expression kept only as fallback for sessions without resolved permissions.
function isAdmin(u: any): boolean {
  if (hasResolvedPermissions(u)) return can(u, "MANAGE_KPIS");
  return (
    u?.orgLevel === "ceo" ||
    u?.isDeveloper === true ||
    u?.orgLevel === "special_access" ||
    u?.role === "admin" ||
    u?.role === "hr_manager"
  );
}

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const brand = parseBrandParam(req.nextUrl.searchParams.get("brand"));
    const docs = brand
      ? await prisma.$queryRawUnsafe<DocRow[]>(
          `SELECT id, brand, department, "fileName", "fileUrl", "uploadedAt", "uploadedBy"
             FROM "KpiDocument"
            WHERE brand = $1
            ORDER BY department ASC`,
          brand,
        )
      : await prisma.$queryRawUnsafe<DocRow[]>(
          `SELECT id, brand, department, "fileName", "fileUrl", "uploadedAt", "uploadedBy"
             FROM "KpiDocument"
            ORDER BY brand ASC, department ASC`,
        );
    return NextResponse.json({ docs });
  } catch (e) {
    return serverError(e, "GET /api/kpis/documents");
  }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const department = (form.get("department") as string | null)?.trim();
    const file       = form.get("file");
    // Brand from the form (kebab slug) — admin UI passes whichever
    // brand they're managing. Default to NB Media if omitted, matches
    // the column default and keeps legacy clients working.
    const brand = parseBrandParam((form.get("brand") as string | null) ?? null) ?? "NB Media";

    if (!department) {
      return NextResponse.json({ error: "Department is required" }, { status: 400 });
    }
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Please attach a file" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File must be 10 MB or smaller" }, { status: 400 });
    }
    const ext = extname(file.name).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      return NextResponse.json({ error: "File must be a PDF, Word, or Excel document" }, { status: 400 });
    }

    const safeBase = file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .slice(0, 60) || "kpi";
    const stamped  = `${randomUUID()}-${safeBase}${ext}`;
    const dir      = resolve(process.cwd(), "public", "uploads", "kpis");
    await mkdir(dir, { recursive: true });
    const buf      = Buffer.from(await file.arrayBuffer());
    await writeFile(resolve(dir, stamped), buf);
    const fileUrl  = `/uploads/kpis/${stamped}`;

    const uploadedBy = await resolveUserId(session);
    // Upsert on (brand, department) — same department name can now
    // hold a separate doc per brand (e.g. "HR Operations & TA" exists
    // under both NB Media and YT Labs). Re-uploading from the same
    // brand still replaces in place so each brand-dept pair has one
    // active doc.
    const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
      `INSERT INTO "KpiDocument" ("brand","department","fileName","fileUrl","uploadedAt","uploadedBy")
       VALUES ($1,$2,$3,$4,NOW(),$5)
       ON CONFLICT ("brand","department")
       DO UPDATE SET
         "fileName"   = EXCLUDED."fileName",
         "fileUrl"    = EXCLUDED."fileUrl",
         "uploadedAt" = NOW(),
         "uploadedBy" = EXCLUDED."uploadedBy"
       RETURNING id`,
      brand, department, file.name, fileUrl, uploadedBy,
    );

    return NextResponse.json({ ok: true, id: rows[0]?.id, fileUrl });
  } catch (e) {
    return serverError(e, "POST /api/kpis/documents");
  }
}

export async function DELETE(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const idRaw = searchParams.get("id");
    const id = idRaw && /^\d+$/.test(idRaw) ? parseInt(idRaw, 10) : NaN;
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "KpiDocument" WHERE id = $1`, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "DELETE /api/kpis/documents");
  }
}
