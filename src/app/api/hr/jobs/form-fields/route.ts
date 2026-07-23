// HR-side list + bulk update of the public form's field configuration.
// Mandatory fields (name / email / job / resume) carry isMandatory=true
// in the seed and the UI prevents HR from disabling them — but we
// double-enforce that on the server too so a stray API call can't break
// the form.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// RBAC-designation-driven (policy 2026-07-14): shared isHRAdmin resolves
// MANAGE_HR from the caller's designation. Replaced a local legacy copy.
import { isHRAdmin } from "@/lib/api-auth";
function canManage(session: any): boolean {
  return isHRAdmin(session?.user);
}

export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: number; fieldKey: string; label: string; fieldType: string;
        isVisible: boolean; isRequired: boolean; sortOrder: number; isMandatory: boolean;
      }>
    >(
      `SELECT id, "fieldKey", label, "fieldType", "isVisible", "isRequired",
              "sortOrder", "isMandatory"
         FROM "JobApplicationFormField"
        ORDER BY "sortOrder" ASC`,
    );
    return NextResponse.json(rows);
  } catch (e: any) {
    console.error("[GET /api/hr/jobs/form-fields] failed:", e);
    return NextResponse.json({ error: "Could not load fields" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json();
    const updates: Array<{ fieldKey: string; isVisible?: boolean; isRequired?: boolean; label?: string }> =
      Array.isArray(body?.fields) ? body.fields : [];
    if (updates.length === 0) return NextResponse.json({ ok: true });

    // Mandatory fields stay isVisible=true and isRequired=true regardless
    // of what the client sent — defence in depth.
    for (const f of updates) {
      const key = String(f.fieldKey || "");
      if (!key) continue;
      const setClauses: string[] = [];
      const args: any[] = [];
      let i = 1;
      if (f.label !== undefined) {
        setClauses.push(`label = $${i++}`);
        args.push(String(f.label));
      }
      if (f.isVisible !== undefined) {
        setClauses.push(`"isVisible" = CASE WHEN "isMandatory" THEN true ELSE $${i++}::boolean END`);
        args.push(!!f.isVisible);
      }
      if (f.isRequired !== undefined) {
        setClauses.push(`"isRequired" = CASE WHEN "isMandatory" THEN true ELSE $${i++}::boolean END`);
        args.push(!!f.isRequired);
      }
      if (setClauses.length === 0) continue;
      setClauses.push(`"updatedAt" = now()`);
      args.push(key);
      await prisma.$executeRawUnsafe(
        `UPDATE "JobApplicationFormField" SET ${setClauses.join(", ")} WHERE "fieldKey" = $${i}`,
        ...args,
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[PUT /api/hr/jobs/form-fields] failed:", e);
    return NextResponse.json({ error: e?.message || "Save failed" }, { status: 500 });
  }
}
